/* Optional structured strength uploads using Strava's JSON format.
 * Uses the existing openGym Strava OAuth connection and durable outbox.
 * No network calls occur during import.
 * https://developers.strava.com/docs/uploads/
 */
export const STRUCTURED_UPLOAD_URL = 'https://www.strava.com/api/v3/uploads';

// Explicit, documented Strava exercise types only. Unknown exercises remain in
// the existing human-readable activity description rather than being mislabeled.
const MAPPING = Object.freeze({
  '0025':'BARBELL_BENCH_PRESS','0294':'STANDING_DUMBBELL_BICEPS_CURL',
  '0043':'BARBELL_SQUAT',
  '0289':'DUMBBELL_BENCH_PRESS','0405':'SEATED_DUMBBELL_SHOULDER_PRESS',
  '9698':'CHEST_SUPPORTED_ROW','1204':'SINGLE_ARM_LAT_PULLDOWN',
  '4948':'SINGLE_ARM_LAT_PULLDOWN','0577':'MACHINE_CHEST_PRESS',
  '11251':'CABLE_WOODCHOP','5609':'FACE_PULL','0868':'CABLE_CURL',
  '0201':'CABLE_TRICEPS_PUSHDOWN','7384':'HIP_THRUST',
  '5516':'MACHINE_HACK_SQUAT','2130':'WEIGHTED_DECLINE_CRUNCH',
});
const ALIASES = Object.freeze({
  'barbell bench press':'BARBELL_BENCH_PRESS',
  'dumbbell biceps curl':'STANDING_DUMBBELL_BICEPS_CURL',
  'barbell full squat':'BARBELL_SQUAT',
  'dumbbell bench press':'DUMBBELL_BENCH_PRESS',
  'dumbbell seated shoulder press':'SEATED_DUMBBELL_SHOULDER_PRESS',
  'dumbbell chest supported row':'CHEST_SUPPORTED_ROW',
  'lever hip thrust (plate loaded)':'HIP_THRUST',
  'lever hack squat':'MACHINE_HACK_SQUAT',
  'cable pushdown':'CABLE_TRICEPS_PUSHDOWN',
  'cable one arm lateral raise':'CABLE_LATERAL_RAISE',
  'lever chest press':'MACHINE_CHEST_PRESS',
  'cable kneeling woodchop v. 3':'CABLE_WOODCHOP',
  'cable kneeling woodchop':'CABLE_WOODCHOP',
  'cable one arm lat pulldown':'SINGLE_ARM_LAT_PULLDOWN',
  'cable kneeling one arm lat pulldown':'SINGLE_ARM_LAT_PULLDOWN',
  'cable standing face pull':'FACE_PULL','cable curl':'CABLE_CURL',
  'weighted decline crunch':'WEIGHTED_DECLINE_CRUNCH',
});
const AGGREGATE_SIDES = new Set(['1204','4948','11251']);
const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const rounded = n => Math.round(n * 1000) / 1000;
export function stravaExerciseType(ex) {
  if (!ex) return null;
  return MAPPING[String(ex.id)] || ALIASES[String(ex.name || '').trim().toLowerCase()] || null;
}
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
} = {}) {
  const { json, unmapped, reason } = strengthJson(workout, { timezone });
  if (!json) return { ok:false, retry:false, code:'structure', msg:reason };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    if (!job.stravaUploadId) {
      const form = new FormData();
      form.append('file', new Blob([JSON.stringify(json)], { type:'application/json' }), 'opengym-strength.json');
      form.append('data_type','json');
      form.append('sport_type','WeightTraining');
      form.append('name',activity.name);
      form.append('description',activity.description);
      form.append('external_id', String('opengym-' + (workout.id || job.key)).slice(0,120));
      const r = await response(await fetchFn(STRUCTURED_UPLOAD_URL, {
        method:'POST', headers:{ Authorization:'Bearer ' + token }, body:form, signal:controller.signal,
      }));
      // A server error after POST has an uncertain outcome: the upload may
      // already exist. Fail closed, like a dropped connection, to prevent
      // the outbox from POSTing a duplicate activity on automatic retry.
      if (r.status >= 500) return { ok:false, retry:false, code:'unknown-upload', status:r.status,
        msg:'Strava may have accepted this upload. Inspect Strava before manually retrying.' };
      if (r.status === 429) return { ok:false, retry:true, code:'rate', status:r.status,
        retryAfterMs:15 * 60_000 };
      if (r.status !== 200 && r.status !== 201)
        return { ok:false, retry:false, code:'http', status:r.status, msg:'Strava upload rejected (' + r.status + ')' };
      const id = r.data?.id_str ?? r.data?.id;
      if (id == null) return { ok:false, retry:false, code:'upload',
        msg:'Upload returned no ID; inspect Strava before retrying to avoid duplicates.' };
      job.stravaUploadId = String(id);
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
