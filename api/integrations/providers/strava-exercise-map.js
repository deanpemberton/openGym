/* openGym -> Strava strength exercise mapping.
 *
 * Use openGym's stable catalogue IDs/names, not a user's translated display
 * name. Exact documented Strava types take priority. Variants that have no
 * exact counterpart use a documented *_GENERIC family only when their
 * movement is clear; stretches and ambiguous hybrids remain unmapped and
 * appear by name in the regular activity description.
 *
 * The catalogue contains thousands of movements; Strava's documented JSON
 * taxonomy contains a smaller finite number of types. One-to-one mapping is impossible.
 */
import { LIB_BY_ID } from '../../coach/core/library.js';
import { STRAVA_EXERCISE_TYPES } from './strava-exercises.js';
const STRAVA_SUPPORTED_EXERCISES = new Set(STRAVA_EXERCISE_TYPES);

// Existing curated mappings are kept alongside the catalogue-wide resolver;
// this preserves all exact upstream-tested aliases and IDs.
const LEGACY_ID = Object.freeze({
  '0025':'BARBELL_BENCH_PRESS','0294':'STANDING_DUMBBELL_BICEPS_CURL',
  '0043':'BARBELL_SQUAT','0289':'DUMBBELL_BENCH_PRESS',
  '0405':'SEATED_DUMBBELL_SHOULDER_PRESS','9698':'CHEST_SUPPORTED_ROW',
  '1204':'SINGLE_ARM_LAT_PULLDOWN','4948':'SINGLE_ARM_LAT_PULLDOWN',
  '0577':'MACHINE_CHEST_PRESS','11251':'CABLE_WOODCHOP',
  '5609':'FACE_PULL','0868':'CABLE_CURL',
  '0201':'CABLE_TRICEPS_PUSHDOWN','7384':'HIP_THRUST',
  '5516':'MACHINE_HACK_SQUAT','2130':'WEIGHTED_DECLINE_CRUNCH',
});
const LEGACY_ALIASES = Object.freeze({
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

const EXPLICIT_ID = Object.freeze({
  '0025': 'BARBELL_BENCH_PRESS',
  '0043': 'BARBELL_SQUAT',
  '0201': 'CABLE_TRICEPS_PUSHDOWN',
  '0289': 'DUMBBELL_BENCH_PRESS',
  '0294': 'STANDING_DUMBBELL_BICEPS_CURL',
  '0405': 'SEATED_DUMBBELL_SHOULDER_PRESS',
  '0577': 'MACHINE_CHEST_PRESS',
  '0868': 'CABLE_CURL',
  '1204': 'SINGLE_ARM_LAT_PULLDOWN',
  '2130': 'WEIGHTED_DECLINE_CRUNCH',
  '4948': 'SINGLE_ARM_LAT_PULLDOWN',
  '5516': 'MACHINE_HACK_SQUAT',
  '5609': 'FACE_PULL',
  '7384': 'HIP_THRUST',
  '9698': 'CHEST_SUPPORTED_ROW',
  '11251': 'CABLE_WOODCHOP',
});
const NAME_EQUIVALENTS = Object.freeze({
  'barbell full squat': 'BARBELL_SQUAT',
  'bench press': 'BARBELL_BENCH_PRESS',
  'dumbbell biceps curl': 'STANDING_DUMBBELL_BICEPS_CURL',
  'dumbbell seated shoulder press': 'SEATED_DUMBBELL_SHOULDER_PRESS',
  'lever chest press': 'MACHINE_CHEST_PRESS',
  'lever hip thrust plate loaded': 'HIP_THRUST',
  'lever hack squat': 'MACHINE_HACK_SQUAT',
  'cable kneeling woodchop': 'CABLE_WOODCHOP',
  'cable kneeling one arm lat pulldown': 'SINGLE_ARM_LAT_PULLDOWN',
  'cable one arm lat pulldown': 'SINGLE_ARM_LAT_PULLDOWN',
  'cable standing face pull': 'FACE_PULL',
  'cable standing one arm lat pulldown': 'SINGLE_ARM_LAT_PULLDOWN',
  'cable pushdown': 'CABLE_TRICEPS_PUSHDOWN',
  'dumbbell chest supported row': 'CHEST_SUPPORTED_ROW',
  'weighted decline crunch': 'WEIGHTED_DECLINE_CRUNCH',
  'dumbbell bent over row': 'BENT_OVER_DUMBBELL_ROW',
  'barbell bent over row': 'BENT_OVER_BARBELL_ROW',
  'barbell upright row': 'BARBELL_UPRIGHT_ROW',
  'cable seated row': 'SEATED_CABLE_ROW',
  'rope triceps pushdown': 'CABLE_TRICEPS_PUSHDOWN',
  'dumbbell lateral raise': 'LATERAL_RAISE_GENERIC',
  'dumbbell side lateral raise': 'LATERAL_RAISE_GENERIC',
  'cable side lateral raise': 'CABLE_LATERAL_RAISE',
  'barbell standing military press': 'STANDING_BARBELL_PRESS',
  'dumbbell shoulder press': 'OVERHEAD_DUMBBELL_PRESS',
  'dumbbell incline bench press': 'INCLINE_DUMBBELL_BENCH_PRESS',
  'barbell incline bench press': 'INCLINE_BARBELL_BENCH_PRESS',
  'cable lat pulldown': 'LAT_PULLDOWN',
  'pull up': 'PULL_UP_GENERIC',
  'chin up': 'PULL_UP_GENERIC',
  'push up': 'PUSH_UP_GENERIC',
  'dumbbell romanian deadlift': 'DUMBBELL_ROMANIAN_DEADLIFTS',
  'barbell romanian deadlift': 'BARBELL_ROMANIAN_DEADLIFT',
  'barbell deadlift': 'BARBELL_DEADLIFT',
  'barbell squat': 'BARBELL_SQUAT',
  'front squat': 'BARBELL_FRONT_SQUAT',
  'leg press': 'LEG_PRESS',
  'leg extension': 'MACHINE_LEG_EXTENSION',
  'seated leg curl': 'MACHINE_LEG_CURL_SEATED',
  'standing leg curl': 'STANDING_LEG_CURL',
  'barbell hip thrust': 'BARBELL_HIP_THRUST',
  'dumbbell hip thrust': 'DUMBBELL_HIP_THRUST',
  'barbell shrug': 'BARBELL_SHRUG',
  'dumbbell shrug': 'SHRUG_GENERIC',
  'cable crunch': 'CABLE_CRUNCH',
  'ab wheel rollout': 'AB_WHEEL_ROLLOUT',
  'pallof press': 'PALLOF_PRESS',
  'plank': 'PLANK_HOLD',
  'wall sit': 'WALL_SIT',
  'burpee': 'BURPEE',
});

export function normalizedExerciseName(input) {
  return String(input || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:v(?:ersion)?\.?\s*\d+)\b/g, '')
    .replace(/\((?:male|female|form check|version\s*\d+)\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    // Apply word rules AFTER replacing snake-case separators: underscores
    // are word characters in regex and otherwise hide plural/flye forms.
    .replace(/\bbiceps\b/g, 'bicep').replace(/\btriceps\b/g, 'tricep')
    .replace(/\bflye\b/g, 'fly').replace(/\brows\b/g, 'row')
    .replace(/\braises\b/g, 'raise')
    .replace(/\s+/g, ' ').trim();
}

// Keep this index exact: no stemming or token-order guesses for custom entries.
const SUPPORTED_BY_NAME = new Map();
for (const id of STRAVA_SUPPORTED_EXERCISES) {
  const key = normalizedExerciseName(id);
  // A collision must not silently map an ambiguous exercise to one type.
  SUPPORTED_BY_NAME.set(key, SUPPORTED_BY_NAME.has(key) ? null : id);
}
for (const id of STRAVA_SUPPORTED_EXERCISES) {
  if (!id.endsWith('_GENERIC')) continue;
  const key = normalizedExerciseName(id.slice(0,-'_GENERIC'.length));
  if (!SUPPORTED_BY_NAME.has(key)) SUPPORTED_BY_NAME.set(key,id);
}
const CANONICAL_LEGACY_ALIASES = new Map(Object.entries(LEGACY_ALIASES)
  .map(([key,type])=>[normalizedExerciseName(key),type]));
const CANONICAL_EQUIVALENTS = new Map(Object.entries(NAME_EQUIVALENTS)
  .map(([key,type])=>[normalizedExerciseName(key),type]));
function candidateNames(name) {
  const all = new Set([name]);
  for (const key of [...all]) {
    if (key.startsWith('lever ')) all.add(key.replace(/^lever /, 'machine '));
    if (key.startsWith('smith ')) all.add(key.replace(/^smith /, 'smith machine '));
    if (key.startsWith('ez barbell ')) all.add(key.replace(/^ez barbell /, 'ez bar '));
    if (key.includes(' one arm ')) all.add(key.replace(' one arm ', ' single arm '));
    if (key.includes(' one leg ')) all.add(key.replace(' one leg ', ' single leg '));
    if (key.startsWith('cable standing ')) all.add(key.replace(/^cable standing /,'cable '));
    if (key.startsWith('cable kneeling ')) all.add(key.replace(/^cable kneeling /,'cable '));
    if (key.endsWith(' on bench')) all.add(key.replace(/ on bench$/, ''));
  }
  return all;
}

// Movement families: intentionally anchored to the exercise concept and
// restricted to the body region. A "stretch" is not a squat just because the
// word squat occurs in its name. Multiple movements aren't silently reduced
// to the first movement.
const UNSAFE = /\b(?:stretch(?:ing)?|yoga|pose|mobility|foam roll(?:ing)?|massage|release|self myofascial|myofascial|breathing|warm up|cool down|activation drill|rehab|therap(?:y|eutic))\b/;
const HYBRID = /\b(?:complex|combo|combination|circuit)\b|\b(?:to|into|and)\b.*\b(?:press|curl|squat|lunge|row|deadlift|clean|snatch)\b/;
const MATCHERS = [
  { regions:['chest'], re:/\b(?:bench|chest)\s+press\b/, type:'BENCH_PRESS_GENERIC' },
  { regions:['chest'], re:/\b(?:fly|flye|flyes|flys|crossover)\b/, type:'FLYE_GENERIC' },
  { regions:['chest'], re:/\b(?:push\s*up|pushup|press\s*up|pressup)\b/, type:'PUSH_UP_GENERIC' },
  { regions:['chest','upper arms'], re:/\b(?:dip|dips)\b/, type:'TRICEPS_EXTENSION_GENERIC' },
  { regions:['back'], re:/\b(?:pull\s*up|pullup|chin\s*up|chinup|pulldown|pull\s*down)\b/, type:'PULL_UP_GENERIC' },
  { regions:['back'], re:/\b(?:row|rows|rowing)\b/, type:'ROW_GENERIC' },
  { regions:['upper arms','lower arms'], re:/\b(?:biceps?\s*curl|hammer\s*curl|preacher\s*curl|concentration\s*curl|reverse\s*curl|wrist\s*curl|curls?)\b/, type:'CURL_GENERIC' },
  { regions:['upper arms'], re:/\b(?:triceps?|skull\s*crusher|push\s*down|pushdown|pressdown|kickback)\b/, type:'TRICEPS_EXTENSION_GENERIC' },
  { regions:['shoulders'], re:/\b(?:shoulder\s*press|overhead\s*press|military\s*press|arnold\s*press|push\s*press)\b/, type:'SHOULDER_PRESS_GENERIC' },
  { regions:['shoulders'], re:/\b(?:lateral\s*raise|side\s*raise|front\s*raise|rear\s*delt|reverse\s*fly)\b/, type:'LATERAL_RAISE_GENERIC' },
  { regions:['shoulders'], re:/\b(?:shrug|upright\s*row)\b/, type:'SHRUG_GENERIC' },
  { regions:['upper legs'], re:/\b(?:leg\s*press|hack\s*squat|squat|squats|wall\s*sit)\b/, type:'SQUAT_GENERIC' },
  { regions:['upper legs'], re:/\b(?:lunge|lunges|split\s*squat)\b/, type:'LUNGE_GENERIC' },
  { regions:['upper legs','back'], re:/\b(?:deadlift|deadlifts|romanian\s*deadlift|rdl)\b/, type:'DEADLIFT_GENERIC' },
  { regions:['upper legs'], re:/\b(?:leg\s*curl|hamstring\s*curl|nordic\s*curl)\b/, type:'LEG_CURL_GENERIC' },
  { regions:['upper legs'], re:/\b(?:hip\s*thrust|glute\s*bridge|hip\s*raise)\b/, type:'HIP_RAISE_GENERIC' },
  { regions:['upper legs'], re:/\b(?:hip\s*abduction|hip\s*adduction|clamshell|fire\s*hydrant)\b/, type:'HIP_STABILITY_GENERIC' },
  { regions:['lower legs'], re:/\b(?:calf\s*raise|calf\s*press|calf\s*extension|heel\s*raise)\b/, type:'CALF_RAISE_GENERIC' },
  { regions:['waist'], re:/\b(?:sit\s*up|situp)\b/, type:'SIT_UP_GENERIC' },
  { regions:['waist'], re:/\b(?:plank|sideplank)\b/, type:'PLANK_GENERIC' },
  { regions:['waist'], re:/\b(?:crunch|ab\s*rollout|abdominal|abs?\s*wheel|leg\s*raise|knee\s*raise)\b/, type:'CORE_GENERIC' },
  { regions:['waist'], re:/\b(?:woodchop|wood\s*chop|rotational\s*chop)\b/, type:'CHOP_GENERIC' },
  { regions:['waist'], re:/\b(?:russian\s*twist|oblique\s*twist|dead\s*bug|bird\s*dog)\b/, type:'CORE_GENERIC' },
  { regions:['back'], re:/\b(?:back\s*extension|hyperextension)\b/, type:'HYPEREXTENSION_GENERIC' },
  { regions:['full body'], re:/\b(?:clean|snatch|jerk)\b/, type:'OLYMPIC_LIFT_GENERIC' },
  { regions:['full body'], re:/\b(?:burpee|squat\s*thrust)\b/, type:'TOTAL_BODY_GENERIC' },
  { regions:['full body','upper legs'], re:/\b(?:box\s*jump|jump\s*squat|jump\s*lunge|medicine\s*ball\s*slam)\b/, type:'PLYO_GENERIC' },
  { regions:['full body','back'], re:/\b(?:farmer.s?\s*(?:walk|carry)|suitcase\s*carry|overhead\s*carry|dead\s*hang)\b/, type:'CARRY_GENERIC' },
];

// Narrow exact equivalents for exercise names that aren't identical to Strava's
// published labels. Each rule selects a type Strava documents as supported.
function preferredVariant(name, entry) {
  const equipment = entry.eq || '';
  const region = entry.bp;
  if (/\bface\s*pull\b/.test(name) && (region==='back'||region==='shoulders')) return 'FACE_PULL';
  if (/\blat\s*pull\s*down|lat\s*pulldown\b/.test(name) && region==='back') {
    if (/\b(?:one|single)\s*arm\b/.test(name)) return 'SINGLE_ARM_LAT_PULLDOWN';
    if (/\bneutral\s*grip\b/.test(name)) return 'NEUTRAL_GRIP_LAT_PULLDOWN';
    if (/\bunderhand\b/.test(name)) return 'UNDERHAND_LAT_PULLDOWN';
    return 'LAT_PULLDOWN';
  }
  if (/\b(?:bench|chest)\s+press\b/.test(name) && region==='chest') {
    if (/\b(?:lever|machine)\b/.test(name) || equipment==='leverage machine') {
      if (/\bincline\b/.test(name)) return 'MACHINE_INCLINE_CHEST_PRESS';
      if (/\bdecline\b/.test(name)) return 'MACHINE_DECLINE_BENCH_PRESS';
      return 'MACHINE_CHEST_PRESS';
    }
    if (equipment==='barbell') {
      if (/\bdecline\b|\breverse\s*grip\b/.test(name)) return 'BENCH_PRESS_GENERIC';
      if (/\bincline\b/.test(name)) return 'INCLINE_BARBELL_BENCH_PRESS';
      if (/\b(?:close|narrow)\s*grip\b/.test(name)) return 'CLOSE_GRIP_BARBELL_BENCH_PRESS';
      return 'BARBELL_BENCH_PRESS';
    }
    if (equipment==='dumbbell') {
      if (/\bincline\b/.test(name)) return 'INCLINE_DUMBBELL_BENCH_PRESS';
      if (/\bdecline\b/.test(name)) return 'DECLINE_DUMBBELL_BENCH_PRESS';
      return 'DUMBBELL_BENCH_PRESS';
    }
  }
  if (/\bromanian\s*deadlift|\brdl\b/.test(name) && region==='upper legs') {
    if (equipment==='barbell') return 'BARBELL_ROMANIAN_DEADLIFT';
    if (equipment==='dumbbell') return 'DUMBBELL_ROMANIAN_DEADLIFTS';
    if (equipment==='cable') return 'CABLE_RDL';
    return 'ROMANIAN_DEADLIFTS';
  }
  if (/\bdeadlift\b/.test(name) && (region==='upper legs'||region==='back')) {
    // A single-leg deadlift is biomechanically distinct from the standard
    // bilateral lift; preserve that distinction instead of assigning a
    // falsely precise BARBELL_DEADLIFT or DUMBBELL_DEADLIFT label.
    if (/\b(?:one|single)\s*leg\b/.test(name))
      return /\bstraight\s*leg\b/.test(name) ? 'SINGLE_LEG_STRAIGHT_LEG_DEADLIFT' : 'DEADLIFT_GENERIC';
    if (equipment==='trap bar') return 'TRAP_BAR_DEADLIFT';
    if (equipment==='barbell') return 'BARBELL_DEADLIFT';
    if (equipment==='dumbbell') return 'DUMBBELL_DEADLIFT';
  }
  if (/\b(?:hack\s*squat)\b/.test(name) && region==='upper legs' && /machine|lever/.test(equipment+' '+name))
    return 'MACHINE_HACK_SQUAT';
  if (/\bleg\s*press\b/.test(name) && region==='upper legs') {
    if (/\bsingle\s*leg\b/.test(name) && /machine/.test(equipment)) return 'MACHINE_SINGLE_LEG_PRESS';
    return /machine/.test(equipment) ? 'MACHINE_LEG_PRESS' : 'LEG_PRESS';
  }
  if (/\bleg\s*extension\b/.test(name) && region==='upper legs' && /machine/.test(equipment+' '+name)) return 'MACHINE_LEG_EXTENSION';
  if (/\bsquat\b/.test(name) && region==='upper legs') {
    if (equipment==='smith machine') return 'SMITH_MACHINE_SQUAT';
    if (equipment==='barbell') {
      if (/\bfront\b/.test(name)) return 'BARBELL_FRONT_SQUAT';
      if (/\b(?:back|high\s*bar|low\s*bar)\b/.test(name)) return 'BARBELL_BACK_SQUAT';
      if (/\bbox\b/.test(name)) return 'BARBELL_BOX_SQUAT';
      return 'BARBELL_SQUAT';
    }
    if (/\bgoblet\b/.test(name)) return 'GOBLET_SQUAT';
  }
  if (/\bhip\s*thrust\b/.test(name) && region==='upper legs') {
    if (equipment==='barbell') return 'BARBELL_HIP_THRUST';
    if (equipment==='dumbbell') return 'DUMBBELL_HIP_THRUST';
    if (equipment==='weight plate') return 'PLATE_HIP_THRUST';
    return 'HIP_THRUST';
  }
  if (/\b(?:hammer\s*curl)\b/.test(name) && region==='upper arms' && equipment==='dumbbell') return 'DUMBBELL_HAMMER_CURL';
  if (/\b(?:bicep\s*curl|curl)\b/.test(name) && region==='upper arms') {
    if (/\breverse\b/.test(name)) {
      if (equipment==='barbell' && !/\bwrist\b/.test(name)) return 'BARBELL_REVERSE_CURL';
      if (equipment==='cable' && !/\bwrist\b/.test(name)) return 'REVERSE_CABLE_CURLS';
      return 'CURL_GENERIC';
    }
    if (/\bconcentration\b/.test(name)) return 'CONCENTRATION_CURL';
    if (/\bspider\b/.test(name)) return 'SPIDER_CURL';
    if (/\bpreacher\b/.test(name)) return 'CURL_GENERIC';
    if (equipment==='dumbbell' && /\bincline\b/.test(name)) return 'INCLINE_DUMBBELL_BICEPS_CURL';
    if (equipment==='cable') return 'CABLE_BICEPS_CURL';
    if (equipment==='barbell') return 'BARBELL_BICEPS_CURL';
    if (equipment==='dumbbell') return /\b(?:seated|prone)\b/.test(name) ? 'CURL_GENERIC' : 'STANDING_DUMBBELL_BICEPS_CURL';
  }
  if (/\b(?:face\s*pull)\b/.test(name) && region==='shoulders') return 'FACE_PULL';
  if (/\b(?:triceps?|tricep)\s*(?:pushdown|pressdown|push\s*down)\b/.test(name) && region==='upper arms')
    return 'CABLE_TRICEPS_PUSHDOWN';
  if (/\b(?:side|lateral)\s*(?:raise|raises)\b/.test(name) && region==='shoulders' && equipment==='cable')
    return 'CABLE_LATERAL_RAISE';
  if (/\b(?:shoulder|overhead)\s*press\b/.test(name) && region==='shoulders') {
    if (equipment==='smith machine') return 'SMITH_MACHINE_OVERHEAD_PRESS';
    if (equipment==='leverage machine') return 'MACHINE_SEATED_SHOULDER_PRESS';
    if (equipment==='dumbbell') return /\bseated\b/.test(name) ? 'SEATED_DUMBBELL_SHOULDER_PRESS' : 'OVERHEAD_DUMBBELL_PRESS';
    if (equipment==='barbell') return /\bseated\b/.test(name) ? 'SEATED_BARBELL_PRESS' : 'STANDING_BARBELL_PRESS';
  }
  if (/\b(?:calf\s*raise)\b/.test(name) && region==='lower legs') {
    if (/\bseated\b/.test(name)) return 'SEATED_CALF_RAISE';
    if (/\bstanding\b/.test(name)) return 'STANDING_CALF_RAISE';
  }
  return null;
}

const sanitize = type => type && STRAVA_SUPPORTED_EXERCISES.has(type) ? type : null;
export function stravaExerciseMapping(ex) {
  if (!ex) return {type:null,kind:'unsupported'};
  const id = ex.id == null ? null : String(ex.id);
  const builtIn = id == null ? null : LIB_BY_ID.get(id);
  const name = normalizedExerciseName(builtIn?.n || ex.name);
  const explicit = id && (LEGACY_ID[id] || EXPLICIT_ID[id]);
  if (explicit) return {type:sanitize(explicit),kind:'exact'};
  if (!name) return {type:null,kind:'unsupported'};
  const candidates = new Set();
  for (const key of candidateNames(name)) {
    const type = SUPPORTED_BY_NAME.get(key);
    if (type) candidates.add(type);
  }
  if (candidates.size === 1) return {type:[...candidates][0],kind:'exact'};
  if (candidates.size > 1) return {type:null,kind:'unsupported'};
  const equivalent = CANONICAL_LEGACY_ALIASES.get(name) || CANONICAL_EQUIVALENTS.get(name);
  if (equivalent) return {type:sanitize(equivalent),kind:'equivalent'};
  // For custom exercises, don't infer a movement from an arbitrary label.
  // Exact documented names and curated synonyms are supported above.
  if (!builtIn) return {type:null,kind:'unsupported'};
  if (UNSAFE.test(name)) {
    // Strava has an exact generic stretching type, but never falsely classify
    // a yoga pose or rehab movement as a strength lift.
    if (/\bstretch(?:ing)?\b/.test(name) && !/\b(?:yoga|pose|massage|foam\s*roll)\b/.test(name))
      return {type:'STRETCH',kind:'generic'};
    return {type:null,kind:'unsupported'};
  }
  if (HYBRID.test(name)) return {type:null,kind:'unsupported'};
  const preferred = preferredVariant(name,builtIn);
  if (preferred) return {type:sanitize(preferred),kind:'equivalent'};
  for (const {regions,re,type} of MATCHERS) {
    if (regions.includes(builtIn.bp) && re.test(name))
      return {type:sanitize(type),kind:'generic'};
  }
  return {type:null,kind:'unsupported'};
}
export const stravaExerciseType = ex => stravaExerciseMapping(ex).type;
