/* Optional structured strength uploads using Strava's JSON format.
 * Uses the existing openGym Strava OAuth connection and durable outbox.
 * No network calls occur during import.
 * https://developers.strava.com/docs/uploads/
 */
import { STRAVA_EXERCISE_TYPES } from './strava-exercises.js';

export const STRUCTURED_UPLOAD_URL = 'https://www.strava.com/api/v3/uploads';

// A small ID override table for openGym titles that differ from Strava's exact
// identifiers. The full 572-type Strava vocabulary lives in strava-exercises.js.
const MAPPING = Object.freeze({
  '0025':'BARBELL_BENCH_PRESS','0294':'STANDING_DUMBBELL_BICEPS_CURL',
  '0043':'BARBELL_SQUAT','0289':'DUMBBELL_BENCH_PRESS',
  '0405':'SEATED_DUMBBELL_SHOULDER_PRESS','9698':'CHEST_SUPPORTED_ROW',
  '1204':'SINGLE_ARM_LAT_PULLDOWN','4948':'SINGLE_ARM_LAT_PULLDOWN',
  '0577':'MACHINE_CHEST_PRESS','11251':'CABLE_WOODCHOP',
  '5609':'FACE_PULL','0868':'CABLE_CURL',
  '0201':'CABLE_TRICEPS_PUSHDOWN','7384':'HIP_THRUST',
  '5516':'MACHINE_HACK_SQUAT','2130':'WEIGHTED_DECLINE_CRUNCH',
});

// Curated semantic synonyms; unlike near-match/fuzzy matching, each is a
// deliberately reviewed substitution. Never silently substitute another lift.
const ALIASES = Object.freeze({
  'barbell full squat':'BARBELL_SQUAT',
  'barbell full squat back pov':'BARBELL_SQUAT',
  'barbell full squat side pov':'BARBELL_SQUAT',
  'dumbbell bicep curl':'STANDING_DUMBBELL_BICEPS_CURL',
  'barbell bent over row':'BENT_OVER_BARBELL_ROW',
  'dumbbell bent over row':'BENT_OVER_DUMBBELL_ROW',
  'barbell incline bench press':'INCLINE_BARBELL_BENCH_PRESS',
  'dumbbell incline bench press':'INCLINE_DUMBBELL_BENCH_PRESS',
  'barbell close grip bench press':'CLOSE_GRIP_BARBELL_BENCH_PRESS',
  'barbell wide bench press':'WIDE_GRIP_BARBELL_BENCH_PRESS',
  'barbell sumo deadlift':'SUMO_DEADLIFT',
  'barbell zercher squat':'ZERCHER_SQUAT',
  'barbell full zercher squat':'ZERCHER_SQUAT',
  'barbell overhead squat':'OVERHEAD_SQUAT',
  'barbell seated shoulder press':'SEATED_BARBELL_PRESS',
  'barbell seated overhead press':'SEATED_BARBELL_PRESS',
  'barbell curl':'BARBELL_BICEPS_CURL',
  'barbell clean and press':'DOUBLE_ARM_CLEAN_AND_PRESS_BARBELL',
  'barbell jm bench press':'JM_PRESS',
  'dumbbell seated shoulder press':'SEATED_DUMBBELL_SHOULDER_PRESS',
  'dumbbell seated overhead press':'SEATED_DUMBBELL_SHOULDER_PRESS',
  'dumbbell overhead press':'OVERHEAD_DUMBBELL_PRESS',
  'dumbbell bulgarian split squat':'DUMBBELL_BULGARIAN_SPLIT_SQUATS',
  'dumbbell bulgarian split squats':'DUMBBELL_BULGARIAN_SPLIT_SQUATS',
  'dumbbell goblet squat':'DUMBBELL_GOBLET_SQUATS',
  'cable one arm lat pulldown':'SINGLE_ARM_LAT_PULLDOWN',
  'cable kneeling one arm lat pulldown':'SINGLE_ARM_LAT_PULLDOWN',
  'cable standing face pull':'FACE_PULL',
  'cable face pull':'FACE_PULL',
  'cable kneeling woodchop':'CABLE_WOODCHOP',
  'cable standing woodchop':'CABLE_WOODCHOP',
  'cable pushdown':'CABLE_TRICEPS_PUSHDOWN',
  'cable tricep pushdown':'CABLE_TRICEPS_PUSHDOWN',
  'cable tricep extension':'CABLE_TRICEPS_PUSHDOWN',
  'cable one arm tricep pushdown':'CABLE_SINGLE_ARM_TRICEPS_PUSHDOWN',
  'cable standing crossover':'CABLE_CROSSOVER',
  'cable rope hammer curl':'ROPE_CABLE_CURL',
  'dumbbell bent over reverse fly':'DUMBBELL_REAR_DELT_FLY',
  'dumbbell rear lateral raise':'DUMBBELL_REAR_DELT_FLY',
  'dumbbell reverse fly':'DUMBBELL_REAR_DELT_FLY',
  'lever hip thrust plate loaded':'HIP_THRUST',
  'lever tricep extension':'MACHINE_TRICEP_EXTENSION',
  'lever seated shoulder press':'MACHINE_SEATED_SHOULDER_PRESS',
  'lever seated row':'MACHINE_SEATED_ROW',
  'lever hack squat':'MACHINE_HACK_SQUAT',
  'lever chest press':'MACHINE_CHEST_PRESS',
  'lever incline chest press':'MACHINE_INCLINE_CHEST_PRESS',
  'lever back extension':'MACHINE_BACK_EXTENSION',
  'lever calf press':'MACHINE_CALF_PRESS',
  'lever leg extension':'MACHINE_LEG_EXTENSION',
  'lever bicep curl':'MACHINE_BICEP_CURL',
  'lever pullover':'MACHINE_PULLOVER',
  'weighted decline crunch':'WEIGHTED_DECLINE_CRUNCH',
});

// Normalize only spelling, punctuation and a few singular/plural forms known to
// be equivalent. Do not remove equipment, grips, body positions or load words.
const normalizeName = value => String(value || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
  .replace(/\bbiceps\b/g, 'bicep').replace(/\btriceps\b/g, 'tricep')
  .replace(/\bflye\b/g, 'fly').replace(/\brows\b/g, 'row')
  .replace(/\braises\b/g, 'raise');

const STRAVA_BY_NAME = new Map();
const SUPPORTED = new Set(STRAVA_EXERCISE_TYPES);
for (const type of STRAVA_EXERCISE_TYPES) {
  const key = normalizeName(type);
  // Explicitly refuse ambiguous normalized names rather than picking a winner.
  if (STRAVA_BY_NAME.has(key)) STRAVA_BY_NAME.set(key, null);
  else STRAVA_BY_NAME.set(key, type);
}
// A plain "plank" or "sit up" can use Strava's documented generic type.
// A specific version always takes precedence.
for (const type of STRAVA_EXERCISE_TYPES) {
  if (!type.endsWith('_GENERIC')) continue;
  const key = normalizeName(type.slice(0, -8));
  if (!STRAVA_BY_NAME.has(key)) STRAVA_BY_NAME.set(key, type);
}
for (const [key, type] of [...Object.entries(MAPPING), ...Object.entries(ALIASES)]) {
  if (!SUPPORTED.has(type)) throw new Error('Unsupported Strava exercise alias: ' + key + ' -> ' + type);
}

function candidateNames(name) {
  const base = normalizeName(name)
    .replace(/\s+(male|female)$/,'')
    .replace(/\s+v\s+\d+$/,'');
  const names = new Set([base]);
  for (const n of [...names]) {
    if (n.startsWith('lever ')) names.add(n.replace(/^lever /, 'machine '));
    if (n.startsWith('smith ')) names.add(n.replace(/^smith /, 'smith machine '));
    if (n.startsWith('ez barbell ')) names.add(n.replace(/^ez barbell /, 'ez bar '));
    if (n.includes(' one arm ')) names.add(n.replace(' one arm ', ' single arm '));
    if (n.includes(' one leg ')) names.add(n.replace(' one leg ', ' single leg '));
    if (n.startsWith('cable standing ')) names.add(n.replace(/^cable standing /,'cable '));
    if (n.startsWith('cable kneeling ')) names.add(n.replace(/^cable kneeling /,'cable '));
    if (n.endsWith(' on bench')) names.add(n.replace(/ on bench$/, ''));
  }
  return names;
}
// openGym sometimes stores left + right repetitions as one aggregate set.
// Split only documented unilateral exercise IDs; never divide arbitrary reps.
const AGGREGATE_SIDES = new Set(['1204', '4948', '11251']);
const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const rounded = n => Math.round(n * 1000) / 1000;
export function stravaExerciseType(ex) {
  if (!ex) return null;
  // Every upstream exercise_type is accepted for exact custom names, while
  // names not in Strava's published taxonomy remain intentionally unmapped.
  if (MAPPING[String(ex.id)]) return MAPPING[String(ex.id)];
  const candidates = new Set();
  for (const key of candidateNames(ex.name)) {
    if (ALIASES[key]) candidates.add(ALIASES[key]);
    else if (STRAVA_BY_NAME.get(key)) candidates.add(STRAVA_BY_NAME.get(key));
  }
  return candidates.size === 1 ? [...candidates][0] : null;
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
