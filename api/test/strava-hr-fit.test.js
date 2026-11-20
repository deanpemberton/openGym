import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stravaStrengthFit, validHrTrace } from '../integrations/strength-fit.js';
import { createIntegrations } from '../integrations/index.js';
import { TOKEN_URL, UPLOAD_URL, ACTIVITY_URL } from '../integrations/providers/strava.js';

const NOW = Date.now();
const start = NOW + 60000, end = start + 600000;
const workout = {
  id: 'hr-test', d: new Date(start).toISOString().slice(0, 10), name: 'Gym strength',
  start, end, hrTrace: [[start, 100], [start + 10000, 112], [start + 20000, 125], [start + 30000, 141]],
  entries: [{ id: '0025', sets: [{ r: 8, w: 60, at: start + 30000, done: true }] }],
};
const doc = { unit: 'kg', workouts: [] };
const response = (status, data) => ({ status, json: async () => data });

// A tiny FIT reader validates that the upload has real timed record messages, rather than
// approximated per-set averages, and that the CRC agrees with Garmin's FIT polynomial.
function decodeRecords(fit) {
  const bytes = new Uint8Array(fit), v = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), '.FIT');
  let p = bytes[0], end = p + v.getUint32(4, true);
  const locals = new Map(), records = [];
  while (p < end) {
    const hdr = bytes[p++], local = hdr & 15;
    if (hdr & 0x40) {
      p++; const endian = bytes[p++]; const glob = endian ? v.getUint16(p, false) : v.getUint16(p, true); p += 2;
      const n = bytes[p++], fields = [];
      for (let i = 0; i < n; i++) { const id = bytes[p++], size = bytes[p++], type = bytes[p++]; fields.push([id, size, type]); }
      locals.set(local, { glob, fields });
    } else {
      const d = locals.get(local); assert.ok(d, 'FIT message must have definition');
      const row = {};
      for (const [id, size] of d.fields) {
        row[id] = size === 1 ? bytes[p] : size === 2 ? v.getUint16(p, true) : v.getUint32(p, true);
        p += size;
      }
      if (d.glob === 20) records.push(row);
    }
  }
  return records;
}

test('FIT contains exact timestamped Garmin HR samples as records', () => {
  const encoded = stravaStrengthFit({
    id: 'hr-test', startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(),
    hrTrace: workout.hrTrace, exercises: [{ name: 'Bench press', sets: [{ weight: 60, reps: 8, at: start + 30000 }] }],
    totals: { sets: 1 }, unit: 'kg',
  });
  const records = decodeRecords(encoded);
  assert.deepEqual(records.map(r => r[3]), [100, 112, 125, 141]);
  assert.equal(records[0][253], Math.round(start / 1000) - 631065600);
  assert.equal(records[3][253], Math.round((start + 30000) / 1000) - 631065600);
  assert.equal(validHrTrace({ startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(), hrTrace: [[start, 100], [start, 100], [start + 10e3, 250]] }).length, 1);
});

test('Strava server uploads FIT, polls once by upload ID, posts no duplicate activity', async () => {
  let posted = 0, polled = 0, bytes;
  let clock = Date.now();
  const fetchFn = async (url, options) => {
    if (url === TOKEN_URL) return response(200, {
      access_token: 'access', refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600,
      athlete: { id: 1, firstname: 'Test' },
    });
    if (url === UPLOAD_URL && options.method === 'POST') {
      posted++;
      assert.equal(options.body.get('data_type'), 'fit');
      assert.equal(options.body.get('sport_type'), 'WeightTraining');
      bytes = new Uint8Array(await options.body.get('file').arrayBuffer());
      return response(201, { id: 99, status: 'Your activity is still being processed.' });
    }
    if (url === UPLOAD_URL + '/99' && options.method === 'GET') {
      polled++;
      return response(200, { id: 99, activity_id: 12345, status: 'Your activity is ready.' });
    }
    if (url === ACTIVITY_URL) throw Error('Trace workouts must not use manual Strava activities');
    return response(404, {});
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-fit-'));
  try {
    const h = createIntegrations({ dataDir: dir, secret: 's'.repeat(64),
      env: { INTEGRATIONS: 'strava', STRAVA_CLIENT_ID: '100', STRAVA_CLIENT_SECRET: 'secret' }, fetchFn, now: () => clock });
    const uri = h.oauthStart('user', 'strava', 'https://gym.example.org/callback');
    await h.oauthFinish({ state: new URL(uri).searchParams.get('state'), code: 'ok', scope: 'activity:write' }, 'user');
    const conn = h.describe('user').connections[0];
    h.update('user', conn.id, { strength: true });
    assert.equal(h.onStateWrite('user', doc, { ...doc, workouts: [workout] }), 1);
    await h._outbox().run();
    assert.equal(posted, 0, 'wait for the last HR batch after phone Finish');
    const late = { ...workout, hrTrace: [...workout.hrTrace, [start + 40000, 152]] };
    assert.equal(h.onStateWrite('user', { ...doc, workouts: [workout] }, { ...doc, workouts: [late] }), 0);
    clock += 60001;
    await h._outbox().run();
    assert.equal(posted, 1);
    assert.deepEqual(decodeRecords(bytes).map(x => x[3]), [100,112,125,141,152]);
    // Deferred processing is persisted with the job, so it cannot post twice.
    assert.equal(h._outbox().counts('user', conn.id).queued, 1);
    clock += 20001;
    await h._outbox().run();
    assert.equal(posted, 1);
    assert.equal(polled, 1);
    assert.equal(h._outbox().counts('user', conn.id).queued, 0);
    h.stop();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
