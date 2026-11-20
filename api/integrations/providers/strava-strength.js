/* Optional structured strength uploads using Strava's JSON format.
 * Uses the existing openGym Strava OAuth connection and durable outbox.
 * No network calls occur during import.
 * https://developers.strava.com/docs/uploads/
 */
import crypto from 'node:crypto';
import { stravaExerciseType } from './strava-exercise-map.js';
export { stravaExerciseType } from './strava-exercise-map.js';

export const STRUCTURED_UPLOAD_URL = 'https://www.strava.com/api/v3/uploads';

/** Stable pseudonymous Strava external ID. Never upload a raw watch/workout ID.
 * The server-secret-derived key is separate from OAuth and encryption keys.
 */
export function opaqueExternalId(job, workout, key) {
  if (!key || (typeof key === 'string' && key.length < 16))
    throw new Error('Strava external ID key missing');
  const principal = String(job?.uid || '');
  const identifier = String(workout?.id || job?.key || '');
  if (!principal || !identifier) throw new Error('Strava upload identity missing');
  const mac = crypto.createHmac('sha256', key)
    .update('opengym-strength-external-id:v1\u0000')
    .update(principal).update('\u0000').update(identifier).digest('hex');
  return 'opengym-' + mac;
}

const AGGREGATE_SIDES = new Set(['1204', '4948', '11251']);
const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const rounded = n => Math.round(n * 1000) / 1000;
export function strengthSets(workout) {
  const sets = [], unmapped = [], factor = workout.unit === 'lb' ? 0.45359237 : 1;
  for (const ex of workout.exercises || []) {
    const source = (ex.sets || []).filter(s => !s.warmup);
    if (!source.length) continue;
    const exercise_type = stravaExerciseType(ex);
    if (!exercise_type) { unmapped.push({ id: ex.id, name: ex.name }); continue; }
    for (const s of source) {
      const sides = s.sides ? [s.sides.left, s.sides.right].filter(Boolean) : null;
      const split = !sides && AGGREGATE_SIDES.has(String(ex.id)) &&
        Number.isInteger(s.reps) && s.reps > 0 && s.reps % 2 === 0;
      const parts = sides || (split
        ? [{ ...s, reps: s.reps / 2 }, { ...s, reps: s.reps / 2 }] : [s]);
      for (const p of parts) {
        const item = { exercise_type };
        if (valid(p.reps) && p.reps > 0) item.repetitions = Math.round(p.reps);
        else if (valid(p.seconds) && p.seconds > 0) item.duration = Math.round(p.seconds);
        else continue;
        // openGym users choose their own dumbbell load convention. Do not
        // silently halve the entered weight; preserve it and convert lb to kg.
        if (valid(p.weight) && p.weight > 0) item.weight = rounded(p.weight * factor);
        sets.push(item);
      }
    }
  }
  return { sets, unmapped };
}
export function strengthJson(workout, { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } = {}) {
  const time = typeof workout.startedAt === 'string' ? Date.parse(workout.startedAt) : NaN;
  // openGym rounds durationMin to whole minutes in its event payload. A
  // legitimately completed 12-second test session therefore has durationMin=0.
  // Prefer the original end/start timestamps to preserve second precision.
  const end = typeof workout.endedAt === 'string' ? Date.parse(workout.endedAt) : NaN;
  const measured = Number.isFinite(time) && Number.isFinite(end) && end > time
    ? Math.max(1, Math.round((end - time) / 1000)) : NaN;
  const fallback = Number(workout.durationMin) > 0 ? Math.round(Number(workout.durationMin) * 60) : NaN;
  const duration = Number.isFinite(measured) ? measured : fallback;
  const { sets, unmapped } = strengthSets(workout);
  if (!sets.length || !Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0)
    return { json: null, unmapped, reason: !sets.length ? 'No mapped exercise sets' : 'Missing start time or duration' };
  const offset = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(time)).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const m = /^GMT([+-])(\d{1,2}):(\d{2})$/.exec(offset);
  const utc_offset = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60) : 0;
  return { json: { version:'1.0', start_time:new Date(time).toISOString(), utc_offset,
    elapsed_time:Math.round(duration), creator:{ name:'openGym' }, sets }, unmapped };
}
async function response(r) {
  let data = null;
  try { data = await r.json(); } catch { /* body optional */ }
  return { status:r.status, data };
}
/* The outbox job stores stravaUploadId; after a restart an accepted upload is
 * polled, never posted again. Unknown POST outcomes fail closed to avoid duplicates.
 */
export async function deliverStructuredStrength(job, token, workout, activity, {
  fetchFn = globalThis.fetch,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  timeoutMs = 15000,
  checkpoint = () => {},
  externalIdKey = null,
} = {}) {
  const { json, unmapped, reason } = strengthJson(workout, { timezone });
  if (!json) return { ok:false, retry:false, code:'structure', msg:reason };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    // A crash between a successful POST and receipt of its upload ID is
    // ambiguous. Persist intent BEFORE sending and refuse a repeat POST on
    // restart; a human can resolve the uncertain activity in Strava.
    if (!job.stravaUploadId && job.stravaUploadAttempted) return {
      ok:false, retry:false, code:'unknown-upload',
      msg:'Previous upload may have reached Strava. Inspect the activity before retrying.',
    };
    const save = patch => {
      Object.assign(job, patch);
      checkpoint(patch); // strict synchronous, atomic outbox write when queued
    };
    if (!job.stravaUploadId) {
      let externalId;
      try {
        externalId = opaqueExternalId(job, workout, externalIdKey);
        save({ stravaUploadAttempted:true });
      } catch {
        return {ok:false,retry:false,code:'checkpoint',
          msg:'Cannot safely record Strava upload intent. No upload was attempted.'};
      }
      const form = new FormData();
      form.append('file', new Blob([JSON.stringify(json)], { type:'application/json' }), 'opengym-strength.json');
      form.append('data_type','json');
      form.append('sport_type','WeightTraining');
      form.append('name',activity.name);
      form.append('description',activity.description);
      form.append('external_id', externalId);
      const r = await response(await fetchFn(STRUCTURED_UPLOAD_URL, {
        method:'POST', headers:{ Authorization:'Bearer ' + token }, body:form, signal:controller.signal,
      }));
      // A server error after POST has an uncertain outcome: the upload may
      // already exist. Fail closed, like a dropped connection, to prevent
      // the outbox from POSTing a duplicate activity on automatic retry.
      if (r.status >= 500) return { ok:false, retry:false, code:'unknown-upload', status:r.status,
        msg:'Strava may have accepted this upload. Inspect Strava before manually retrying.' };
      // An explicit 401/429 rejection is known not to have created an
      // upload: clear the attempt flag durably so refresh/backoff can retry.
      if (r.status === 401 || r.status === 429) {
        try { save({stravaUploadAttempted:false}); }
        catch { return {ok:false,retry:false,code:'checkpoint',
          msg:'Cannot safely save Strava retry state. Inspect Strava.'}; }
      }
      if (r.status === 429) return { ok:false, retry:true, code:'rate', status:r.status,
        retryAfterMs:15 * 60_000 };
      if (r.status !== 200 && r.status !== 201)
        return { ok:false, retry:false, code:'http', status:r.status, msg:'Strava upload rejected (' + r.status + ')' };
      const id = r.data?.id_str ?? r.data?.id;
      if (id == null) return { ok:false, retry:false, code:'upload',
        msg:'Upload returned no ID; inspect Strava before retrying to avoid duplicates.' };
      try { save({stravaUploadId:String(id)}); }
      catch { return {ok:false,retry:false,code:'checkpoint',
        msg:'Strava accepted an upload, but its ID could not be saved. Inspect Strava before retrying.'}; }
    }
    const r = await response(await fetchFn(STRUCTURED_UPLOAD_URL + '/' + encodeURIComponent(job.stravaUploadId), {
      method:'GET', headers:{ Authorization:'Bearer ' + token }, signal:controller.signal,
    }));
    if (r.status === 429 || r.status >= 500)
      return { ok:false, retry:true, code:'poll', status:r.status, retryAfterMs:30000 };
    if (r.status !== 200)
      return { ok:false, retry:false, code:'poll', status:r.status, msg:'Upload status failed (' + r.status + ')' };
    if (r.data?.error) return { ok:false, retry:false, code:'upload', msg:String(r.data.error).slice(0,150) };
    if (r.data?.activity_id) return { ok:true, status:200, activityId:String(r.data.activity_id), unmapped };
    return { defer:15000 };
  } catch (e) {
    if (!job.stravaUploadId) return { ok:false, retry:false, code:'unknown-upload',
      msg:'Upload outcome uncertain; inspect Strava before manually retrying.' };
    return { ok:false, retry:true, code:'network', msg:e?.message || 'Strava status unavailable' };
  } finally { clearTimeout(timer); }
}
