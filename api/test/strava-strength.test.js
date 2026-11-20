/* Structured Strava strength uploads. Match api/test/strava.test.js style:
 * node:test + assert/strict, fake HTTP, no real Strava credentials or network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strengthJson, strengthSets, stravaExerciseType, deliverStructuredStrength } from '../integrations/providers/strava-strength.js';
import { STRAVA_EXERCISE_GROUPS, STRAVA_EXERCISE_TYPES } from '../integrations/providers/strava-exercises.js';
import { EXERCISES as OPENGYM_EXERCISES } from '../coach/core/library-data.js';

const workout = {
  id:'fixture-session-001', name:'Illustrative Strength Session', unit:'kg',
  startedAt:'2025-01-15T16:47:08.000Z', durationMin:44.8,
  exercises:[
    { id:'0289', name:'dumbbell bench press', sets:[{ weight:17,reps:9 },{ weight:17,reps:9 }] },
    { id:'4948', name:'cable kneeling one arm lat pulldown', sets:[
      { sides:{ left:{weight:13,reps:11}, right:{weight:13,reps:11} } }] },
    { id:'custom', name:'unmapped exercise', sets:[{weight:24,reps:7}] },
    { id:'5609', name:'face pull', sets:[{warmup:true,weight:4,reps:6},{weight:9,reps:8}] },
  ],
};
const act = { name:'Illustrative Strength Session', description:'Exercise detail text' };
const reply = (status, body) => ({ status, json:async () => body });

test('supported exercises become ordered sets; warmups and unknown names are never mislabeled', () => {
  const { sets, unmapped } = strengthSets(workout);
  assert.equal(sets.length,5);
  assert.deepEqual(sets.slice(2,4).map(s => s.repetitions),[11,11]);
  assert.equal(unmapped.length,1);
  assert.equal(stravaExerciseType({name:'totally made-up exercise'}),null);
  assert.equal(sets[0].weight,17,'never guess dumbbell per-hand vs combined weight');
});
test('standard and daylight time offsets in example timezone, plus Strava schema', () => {
  const { json } = strengthJson(workout,{timezone:'America/New_York'});
  assert.equal(json.version,'1.0');
  assert.equal(json.start_time,workout.startedAt);
  assert.equal(json.elapsed_time,Math.round(workout.durationMin*60));
  assert.equal(json.utc_offset,-18000);
  assert.equal(json.sets.length,5);
  const summer = strengthJson({...workout,startedAt:'2025-07-01T00:00:00Z'},{timezone:'America/New_York'});
  assert.equal(summer.json.utc_offset,-14400);
});
test('lb to kg conversion, missing load, timed sets and odd unilateral repetitions', () => {
  assert.deepEqual(strengthSets({unit:'lb',exercises:[{id:'0289',sets:[{weight:100,reps:5},{reps:8}]}]}).sets,
    [{exercise_type:'DUMBBELL_BENCH_PRESS',repetitions:5,weight:45.359},
      {exercise_type:'DUMBBELL_BENCH_PRESS',repetitions:8}]);
  assert.deepEqual(strengthSets({unit:'kg',exercises:[{id:'2130',sets:[{seconds:30,weight:10}]}]}).sets,
    [{exercise_type:'WEIGHTED_DECLINE_CRUNCH',duration:30,weight:10}]);
  assert.deepEqual(strengthSets({unit:'kg',exercises:[{id:'4948',sets:[{reps:25,weight:20}]}]}).sets.map(s=>s.repetitions),[25]);
  assert.deepEqual(strengthSets({unit:'kg',exercises:[{id:'4948',sets:[{reps:26,weight:20}]}]}).sets.map(s=>s.repetitions),[13,13]);
});
test('invalid timestamps, duration, and unmapped-only exercise lists fail closed', () => {
  assert.equal(strengthJson({...workout,startedAt:null}).json,null);
  assert.equal(strengthJson({...workout,durationMin:0}).json,null);
  assert.equal(strengthJson({...workout,exercises:[{id:'unknown',sets:[{reps:8}]}]}).json,null);
});
test('documented Strava identifiers across representative sample movements', () => {
  const expected = {
    '0025':'BARBELL_BENCH_PRESS','0294':'STANDING_DUMBBELL_BICEPS_CURL',
    '0043':'BARBELL_SQUAT',
    '0289':'DUMBBELL_BENCH_PRESS','0405':'SEATED_DUMBBELL_SHOULDER_PRESS',
    '9698':'CHEST_SUPPORTED_ROW','1204':'SINGLE_ARM_LAT_PULLDOWN',
    '4948':'SINGLE_ARM_LAT_PULLDOWN','0577':'MACHINE_CHEST_PRESS',
    '11251':'CABLE_WOODCHOP','5609':'FACE_PULL','0868':'CABLE_CURL',
    '0201':'CABLE_TRICEPS_PUSHDOWN','7384':'HIP_THRUST',
    '5516':'MACHINE_HACK_SQUAT','2130':'WEIGHTED_DECLINE_CRUNCH',
  };
  for(const [id,name] of Object.entries(expected)) assert.equal(stravaExerciseType({id}),name);
});
test('POST once, then polling uses the persisted upload ID', async () => {
  const job={key:'test'}, calls=[];
  let polls=0;
  const mock=async(url,opts)=>{
    calls.push({url,method:opts.method});
    if(opts.method==='POST'){
      assert.equal(opts.body.get('data_type'),'json');
      assert.equal(opts.body.get('sport_type'),'WeightTraining');
      assert.equal(opts.body.get('external_id'),'opengym-'+workout.id);
      const file=JSON.parse(await opts.body.get('file').text());
      assert.equal(file.sets.length,5);
      return reply(201,{id_str:'12345',id:12345});
    }
    polls++;
    return reply(200,polls===1?{id:12345,activity_id:null}:{id:12345,activity_id:987});
  };
  assert.deepEqual(await deliverStructuredStrength(job,'token',workout,act,{fetchFn:mock,timezone:'America/New_York'}),{defer:15000});
  assert.equal(job.stravaUploadId,'12345');
  assert.equal((await deliverStructuredStrength(job,'token',workout,act,{fetchFn:mock})).activityId,'987');
  assert.equal(calls.filter(x=>x.method==='POST').length,1);
});
test('ambiguous POST outcome never automatically retries and risks duplication', async () => {
  const job={key:'uncertain'};
  const res=await deliverStructuredStrength(job,'token',workout,act,{fetchFn:async()=>{throw Error('network dropped')}});
  assert.equal(res.retry,false);
  assert.equal(job.stravaUploadId,undefined);
});
test('429/5xx retry, 400/401 refusal, and polling errors are explicit',async()=>{
  for(const status of [400,401,429,503]){
    const res=await deliverStructuredStrength({key:'x'},'token',workout,act,{fetchFn:async()=>reply(status,{})});
    assert.equal(res.ok,false);
    assert.equal(res.status,status);
    assert.equal(res.retry,status===429); // a 5xx after upload POST is ambiguous
  }
  const job={key:'poll-failed',stravaUploadId:'77'};
  const res=await deliverStructuredStrength(job,'token',workout,act,{fetchFn:async()=>reply(429,{})});
  assert.equal(res.retry,true);
  assert.equal(job.stravaUploadId,'77');
});

test('a synthetic three-movement fixture maps five working sets', () => {
  const { sets, unmapped } = strengthSets({unit:'kg',exercises:[
    {id:'0025',name:'barbell bench press',sets:[{reps:7,weight:32},{reps:7,weight:32}]},
    {id:'0294',name:'dumbbell biceps curl',sets:[{reps:9,weight:8},{reps:9,weight:8}]},
    {id:'0043',name:'barbell full squat',sets:[{reps:6,weight:43}]},
  ]});
  assert.deepEqual(unmapped,[]);
  assert.deepEqual(sets.map(s=>s.exercise_type),[
    'BARBELL_BENCH_PRESS','BARBELL_BENCH_PRESS',
    'STANDING_DUMBBELL_BICEPS_CURL','STANDING_DUMBBELL_BICEPS_CURL','BARBELL_SQUAT'
  ]);
  assert.deepEqual(sets.map(s=>s.weight),[32,32,8,8,43]);
});

test('a completed sub-minute workout uses exact start/end seconds, not rounded durationMin=0', () => {
  const start = '2025-01-15T01:22:14.000Z';
  const end = '2025-01-15T01:22:26.000Z';
  const actual = strengthJson({...workout,startedAt:start,endedAt:end,durationMin:0}, {timezone:'America/New_York'});
  assert.equal(actual.reason,undefined);
  assert.equal(actual.json.elapsed_time,12);
  assert.equal(actual.json.utc_offset,-18000);
  assert.equal(strengthJson({...workout,startedAt:start,endedAt:start,durationMin:0}).json,null,
    'zero length without a positive fallback must still fail closed');
  assert.equal(strengthJson({...workout,startedAt:start,endedAt:'not-a-date',durationMin:0}).json,null);
  assert.equal(strengthJson({...workout,startedAt:start,endedAt:'not-a-date',durationMin:1}).json.elapsed_time,60);
});

test('complete documented Strava vocabulary is unique, uppercase and directly resolvable', () => {
  assert.equal(Object.keys(STRAVA_EXERCISE_GROUPS).length,31);
  assert.equal(STRAVA_EXERCISE_TYPES.length,572);
  assert.equal(new Set(STRAVA_EXERCISE_TYPES).size,572);
  for (const type of STRAVA_EXERCISE_TYPES) {
    assert.match(type,/^[A-Z0-9_]+$/);
    assert.equal(stravaExerciseType({id:'custom',name:type}),type);
    assert.equal(stravaExerciseType({id:'custom',name:type.toLowerCase().replaceAll('_',' ')}),type);
  }
});
test('built-in openGym catalogue resolves deterministic matches without guessing unknowns', () => {
  assert.equal(OPENGYM_EXERCISES.length,5632);
  const matches = OPENGYM_EXERCISES.map(ex => ({ex, type:stravaExerciseType({id:ex.id,name:ex.n})}))
    .filter(x => x.type);
  assert.ok(matches.length>=190, 'exercise mapping coverage regressed: ' + matches.length);
  const supported = new Set(STRAVA_EXERCISE_TYPES);
  for (const {ex,type} of matches) assert.ok(supported.has(type),ex.id + ' -> ' + type);
  assert.equal(stravaExerciseType({id:'custom',name:'unknown custom movement'}),null);
  assert.equal(stravaExerciseType({id:'custom',name:'band bench press'}),null,
    'different equipment must not become a barbell/dumbbell bench press');
  assert.equal(stravaExerciseType({id:'custom',name:'machine pec fly crossover variation'}),null,
    'no fuzzy substitution of distinct exercises');
});
test('machine, Smith, postural and common gym nomenclature resolve conservatively', () => {
  const examples = {
    'lever chest press':'MACHINE_CHEST_PRESS',
    'lever incline chest press':'MACHINE_INCLINE_CHEST_PRESS',
    'lever hack squat':'MACHINE_HACK_SQUAT',
    'lever seated shoulder press':'MACHINE_SEATED_SHOULDER_PRESS',
    'cable kneeling woodchop v. 3':'CABLE_WOODCHOP',
    'smith squat':'SMITH_MACHINE_SQUAT',
    'smith incline bench press':'SMITH_MACHINE_INCLINE_BENCH_PRESS',
    'cable one arm tricep pushdown':'CABLE_SINGLE_ARM_TRICEPS_PUSHDOWN',
    'barbell full squat':'BARBELL_SQUAT',
    'barbell incline bench press':'INCLINE_BARBELL_BENCH_PRESS',
    'dumbbell fly':'DUMBBELL_FLYE',
    'sit-up':'SIT_UP_GENERIC',
    'plank':'PLANK_GENERIC',
    'barbell split squat v. 2':'BARBELL_SPLIT_SQUAT',
    'dumbbell biceps curl':'STANDING_DUMBBELL_BICEPS_CURL',
    'cable standing face pull':'FACE_PULL',
    'rope cable curl':'ROPE_CABLE_CURL',
  };
  for(const [name,type] of Object.entries(examples))
    assert.equal(stravaExerciseType({id:'custom',name}),type,name);
});
test('all documented types can become valid sets; warmups and unknowns still excluded', () => {
  const names = STRAVA_EXERCISE_TYPES.filter(x=>!x.endsWith('_GENERIC')).slice(0,25);
  const obj = {unit:'kg',exercises:[
    ...names.map((name,i)=>({id:'custom'+i,name,sets:[{reps:8,weight:20},{warmup:true,reps:5,weight:10}]})),
    {id:'unmapped',name:'nonexistent acrobatic manoeuvre',sets:[{reps:10,weight:20}]},
  ]};
  const {sets,unmapped}=strengthSets(obj);
  assert.equal(sets.length,25);
  assert.deepEqual(sets.map(x=>x.exercise_type),names);
  assert.equal(unmapped.length,1);
});
