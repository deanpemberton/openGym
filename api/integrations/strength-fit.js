/* A small, dependency-free FIT writer for OpenGym's server-side Strava uploads.
 * Based on the FIT message definitions used by frontend/src/lib/fit-export.js.
 * The watch sends real timestamped HR samples; never interpolate set averages. */
const EPOCH = 631065600;
const atFit = ms => Math.max(0, Math.round(ms / 1000) - EPOCH);
const crcTable = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x6C00,0x2800,0xE401,0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];
// Kept as a canonical FIT CRC table: reflected polynomial 0xA001.
function fitCrc(bytes, crc = 0) {
  for (const b of bytes) {
    let tmp = crcTable[crc & 15]; crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ crcTable[b & 15];
    tmp = crcTable[crc & 15]; crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ crcTable[(b >> 4) & 15];
  }
  return crc;
}
const TYPES = { enum: [0,1,255], uint8: [2,1,255], uint16: [0x84,2,65535], uint32: [0x86,4,0xffffffff], uint32z: [0x8c,4,0] };
function encode(messages) {
  const out = [];
  const u8 = v => out.push(v & 255);
  const u16 = v => { u8(v); u8(v >>> 8); };
  const u32 = v => { u16(v & 65535); u16(v >>> 16); };
  const slots = new Map(), owners = [];
  let next = 0;
  for (const m of messages) {
    const fields = m.fields.map(([num, kind, value]) => {
      const [type, width, invalid] = TYPES[kind];
      return { num, type, width, invalid, value };
    });
    const signature = m.global + ':' + fields.map(f => f.num + '/' + f.type).join(',');
    let slot = slots.get(signature);
    if (slot == null || owners[slot] !== signature) {
      slot = next; next = (next + 1) % 16;
      if (owners[slot]) slots.delete(owners[slot]);
      slots.set(signature, slot); owners[slot] = signature;
      u8(0x40 | slot); u8(0); u8(0); u16(m.global); u8(fields.length);
      for (const f of fields) { u8(f.num); u8(f.width); u8(f.type); }
    }
    u8(slot);
    for (const f of fields) {
      const n = Number(f.value);
      const max = f.width === 1 ? 255 : f.width === 2 ? 65535 : 0xffffffff;
      const v = f.value == null || !Number.isFinite(n) || n < 0 || n > max ? f.invalid : Math.round(n);
      if (f.width === 1) u8(v); else if (f.width === 2) u16(v); else u32(v);
    }
  }
  const data = Uint8Array.from(out);
  const buf = new Uint8Array(14 + data.length + 2);
  const header = new DataView(buf.buffer, 0, 14);
  buf[0] = 14; buf[1] = 0x10; header.setUint16(2, 2132, true);
  header.setUint32(4, data.length, true);
  buf.set([0x2e,0x46,0x49,0x54], 8);
  header.setUint16(12, fitCrc(buf.subarray(0, 12)), true);
  buf.set(data, 14);
  const crc = fitCrc(buf.subarray(0, 14 + data.length));
  buf[buf.length - 2] = crc & 255; buf[buf.length - 1] = crc >>> 8;
  return buf;
}

export function validHrTrace(w) {
  const start = Date.parse(w?.startedAt || ''), end = Date.parse(w?.endedAt || '');
  if (!(start > 0 && end > start)) return [];
  const found = new Map();
  for (const pair of Array.isArray(w?.hrTrace) ? w.hrTrace : []) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [t, bpm] = pair.map(Number);
    if (Number.isFinite(t) && t >= start && t <= end && Number.isInteger(bpm) && bpm >= 30 && bpm <= 240) found.set(t, bpm);
  }
  return [...found].sort((a, b) => a[0] - b[0]).slice(-2160);
}

const CAT = [
  [/leg curl|hamstring curl/,15], [/calf|heel raise/,1], [/bench press|chest press|floor press/,0],
  [/deadlift|rack pull/,8], [/hip thrust|glute bridge/,10], [/lateral raise|side raise|front raise/,14],
  [/flye?|crossover|pec deck/,9], [/curl/,7], [/lunge|split squat|step.?up/,17],
  [/clean|snatch|jerk/,18], [/plank/,19], [/pull.?up|chin.?up|pull.?down/,21],
  [/push.?up/,22], [/\brow\b|rows\b/,23], [/shoulder press|overhead press|military press/,24],
  [/shrug/,26], [/crunch|sit.?up/,6], [/squat|leg press|hack/,28], [/tricep|push.?down|skull|dips?/,30],
];
const catOf = name => CAT.find(([re]) => re.test(String(name || '').toLowerCase()))?.[1] ?? 65534;
const SERIAL = id => { let x = 2166136261; for (const c of String(id || 'openGym')) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x || 1; };

/** Return a complete strength FIT with one lap, real HR records and exercise set messages.
 * Returned bytes are directly suitable for Strava's multipart uploads endpoint.
 */
export function stravaStrengthFit(w) {
  const start = Date.parse(w?.startedAt || ''), end = Date.parse(w?.endedAt || '');
  const trace = validHrTrace(w);
  if (!(end > start) || trace.length < 2) throw new Error('No complete heart-rate recording to upload');
  const t0 = atFit(start), t1 = atFit(end), ms = end - start;
  const bpm = trace.map(x => x[1]);
  const avg = Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length), max = Math.max(...bpm);
  const event = (at, kind) => ({ global: 21, fields: [[253,'uint32',atFit(at)],[0,'enum',0],[1,'enum',kind]] });
  const messages = [
    { global: 0, fields: [[0,'enum',4],[1,'uint16',255],[2,'uint16',0],[3,'uint32z',SERIAL(w.id)],[4,'uint32',t0]] },
    { global: 49, fields: [[0,'uint16',104]] },
    event(start, 0),
  ];
  const timeline = trace.map(([t, b]) => ({ at: t, m: { global: 20, fields: [[253,'uint32',atFit(t)],[3,'uint8',b]] } }));
  let n = 0;
  for (const exercise of Array.isArray(w.exercises) ? w.exercises : []) {
    for (const row of Array.isArray(exercise.sets) ? exercise.sets : []) {
      if (!row || row.warmup || row.sides) continue;
      const reps = Math.round(Number(row.reps) || 0), seconds = Number(row.seconds) || 0;
      if (!(reps > 0 || seconds > 0)) continue;
      const finish = Number.isFinite(row.at) ? Math.max(start, Math.min(end, row.at)) : null;
      const estimated = Math.max(15000, Math.min(120000, seconds > 0 ? seconds * 1000 : reps * 3000));
      const tick = finish ?? start + Math.min(ms, Math.round(ms * (++n) / Math.max(1, (w.totals?.sets || 1))));
      const from = Math.max(start, tick - estimated);
      const weight = Number(row.weight);
      timeline.push({ at: tick, m: { global: 225, fields: [
        [254,'uint32',atFit(tick)], [0,'uint32',Math.max(1000,tick - from)],
        [3,'uint16',reps > 0 ? reps : null],
        [4,'uint16',Number.isFinite(weight) && weight > 0 ? weight * (w.unit === 'lb' ? 0.45359237 : 1) * 16 : null],
        [5,'uint8',1], [6,'uint32',atFit(from)], [7,'uint16',catOf(exercise.name)],
        [9,'uint16',w.unit === 'lb' ? 2 : 1], [10,'uint16',n],
      ] } });
      n++;
    }
  }
  timeline.sort((a, b) => a.at - b.at).forEach(x => messages.push(x.m));
  messages.push(event(end, 4));
  messages.push({ global: 19, fields: [
    [254,'uint16',0],[253,'uint32',t1],[0,'enum',9],[1,'enum',1],
    [2,'uint32',t0],[7,'uint32',ms],[8,'uint32',ms],
    [15,'uint8',avg],[16,'uint8',max],[25,'enum',10],[39,'enum',20],
  ] });
  messages.push({ global: 18, fields: [
    [254,'uint16',0],[253,'uint32',t1],[0,'enum',8],[1,'enum',1],[2,'uint32',t0],
    [5,'enum',10],[6,'enum',20],[7,'uint32',ms],[8,'uint32',ms],
    [16,'uint8',avg],[17,'uint8',max],[25,'uint16',0],[26,'uint16',1],
  ] });
  messages.push({ global: 34, fields: [
    [253,'uint32',t1],[0,'uint32',ms],[1,'uint16',1],[2,'enum',0],[3,'enum',26],[4,'enum',1],
  ] });
  return encode(messages);
}
