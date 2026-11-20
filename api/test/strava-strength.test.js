/* Structured Strava strength uploads. Match api/test/strava.test.js style:
 * node:test + assert/strict, fake HTTP, no real Strava credentials or network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strengthJson, strengthSets, stravaExerciseType, deliverStructuredStrength } from '../integrations/providers/strava-strength.js';

const workout = {
  id:'watch-1795106827521', name:'Friday Full Body', unit:'kg',
  startedAt:'2026-11-19T16:47:08.000Z', durationMin:44.8,
  exercises:[
    { id:'0289', name:'dumbbell bench press', sets:[{ weight:40,reps:10 },{ weight:40,reps:10 }] },
    { id:'4948', name:'cable kneeling one arm lat pulldown', sets:[
      { sides:{ left:{weight:25,reps:12}, right:{weight:25,reps:12} } }] },
    { id:'custom', name:'unmapped exercise', sets:[{weight:60,reps:4}] },
    { id:'5609', name:'face pull', sets:[{warmup:true,weight:5,reps:20},{weight:20,reps:10}] },
  ],
};
const act = { name:'Friday Full Body', description:'Exercise detail text' };
const reply = (status, body) => ({ status, json:async () => body });

test('supported exercises become ordered sets; warmups and unknown names are never mislabeled', () => {
  const { sets, unmapped } = strengthSets(workout);
  assert.equal(sets.length,5);
  assert.deepEqual(sets.slice(2,4).map(s => s.repetitions),[12,12]);
  assert.equal(unmapped.length,1);
  assert.equal(stravaExerciseType({name:'totally made-up exercise'}),null);
  assert.equal(sets[0].weight,40,'never guess dumbbell per-hand vs combined weight');
});
test('Friday in NZDT, winter in NZST: correct historical offset and Strava schema', () => {
  const { json } = strengthJson(workout,{timezone:'Pacific/Auckland'});
  assert.equal(json.version,'1.0');
  assert.equal(json.start_time,workout.startedAt);
  assert.equal(json.elapsed_time,Math.round(workout.durationMin*60));
  assert.equal(json.utc_offset,46800);
  assert.equal(json.sets.length,5);
  const winter = strengthJson({...workout,startedAt:'2026-07-01T00:00:00Z'},{timezone:'Pacific/Auckland'});
  assert.equal(winter.json.utc_offset,43200);
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
test('documented Strava identifiers for Friday and Monday routines', () => {
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
  assert.deepEqual(await deliverStructuredStrength(job,'token',workout,act,{fetchFn:mock,timezone:'Pacific/Auckland'}),{defer:15000});
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

test('existing Strava Integration Test routine maps all five programmed working sets', () => {
  const { sets, unmapped } = strengthSets({unit:'kg',exercises:[
    {id:'0025',name:'barbell bench press',sets:[{reps:10,weight:40},{reps:10,weight:40}]},
    {id:'0294',name:'dumbbell biceps curl',sets:[{reps:12,weight:10},{reps:12,weight:10}]},
    {id:'0043',name:'barbell full squat',sets:[{reps:8,weight:60}]},
  ]});
  assert.deepEqual(unmapped,[]);
  assert.deepEqual(sets.map(s=>s.exercise_type),[
    'BARBELL_BENCH_PRESS','BARBELL_BENCH_PRESS',
    'STANDING_DUMBBELL_BICEPS_CURL','STANDING_DUMBBELL_BICEPS_CURL','BARBELL_SQUAT'
  ]);
  assert.deepEqual(sets.map(s=>s.weight),[40,40,10,10,60]);
});
