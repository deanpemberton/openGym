import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY, LIB_BY_ID } from '../coach/core/library.js';
import { STRAVA_EXERCISE_TYPES } from '../integrations/providers/strava-exercises.js';
import { normalizedExerciseName, stravaExerciseMapping, stravaExerciseType } from '../integrations/providers/strava-exercise-map.js';

test('complete Strava vocabulary has unique documented identifiers', () => {
  assert(STRAVA_EXERCISE_TYPES.length >= 500);
  assert.equal(new Set(STRAVA_EXERCISE_TYPES).size, STRAVA_EXERCISE_TYPES.length);
  for (const type of STRAVA_EXERCISE_TYPES) assert.match(type,/^[A-Z0-9_]+$/);
});
test('all openGym catalogue exercises have deterministic supported or explicit unmapped outcomes', () => {
  assert(LIBRARY.length >= 5600);
  const seen = new Set(), supported = new Set(STRAVA_EXERCISE_TYPES);
  const totals = {exact:0,equivalent:0,generic:0,unsupported:0};
  for (const entry of LIBRARY) {
    assert(!seen.has(entry.id),'duplicate catalogue ID '+entry.id);
    seen.add(entry.id);
    const first = stravaExerciseMapping({id:entry.id});
    const translated = stravaExerciseMapping({id:entry.id,name:'localized display label'});
    assert.deepEqual(first,translated,'stable IDs ignore translated display names: '+entry.id);
    assert(['exact','equivalent','generic','unsupported'].includes(first.kind));
    totals[first.kind]++;
    if(first.type) assert(supported.has(first.type),entry.id+' invalid Strava type '+first.type);
    else assert.equal(first.kind,'unsupported');
  }
  const mapped = totals.exact + totals.equivalent + totals.generic;
  assert(mapped>200,'catalogue-wide coverage should exceed a hand-picked list');
  assert(totals.unsupported>0,'do not force every yoga/mobility exercise into a strength movement');
  // Print one reviewable, low-volume coverage line in the upstream API CI log.
  console.log('STRAVA_CATALOGUE_COVERAGE '+JSON.stringify({catalogue:LIBRARY.length,mapped,percent:(mapped/LIBRARY.length*100).toFixed(1),...totals}));
});
test('exact, translated, versioned, generic and unsupported movements', () => {
  assert.equal(stravaExerciseType({id:'0025',name:'French translation'}),'BARBELL_BENCH_PRESS');
  assert.equal(stravaExerciseType({id:'0294',name:'Japanese translation'}),'STANDING_DUMBBELL_BICEPS_CURL');
  assert.equal(stravaExerciseType({name:'barbell bench press',id:'user-custom'}),'BARBELL_BENCH_PRESS');
  assert.equal(stravaExerciseType({name:'totally custom exercise',id:'user-custom'}),null);
  assert.equal(stravaExerciseType({name:'squat with bands and flying kick',id:'user-custom'}),null);
  assert.equal(stravaExerciseType({name:'dumbbell deadlift',id:'user-custom'}),'DUMBBELL_DEADLIFT');
  assert.equal(stravaExerciseType({id:'9698'}),'CHEST_SUPPORTED_ROW');
  assert.equal(stravaExerciseType({id:'11251'}),'CABLE_WOODCHOP');
  assert.equal(stravaExerciseMapping({id:'6444'}).type,null,'yoga pose is never called a strength squat');
  assert.equal(normalizedExerciseName('Dumbbell Press (male) v. 2'),'dumbbell press');
});
test('catalogue-linked uncommon variants resolve to a supported class, never fabricated tokens', () => {
  const supported = new Set(STRAVA_EXERCISE_TYPES);
  for (const id of ['2290','7550','9698','4732','2291','2337','3400','0007','3293','3294']) {
    const entry=LIB_BY_ID.get(id);
    if(!entry) continue;
    const val=stravaExerciseMapping({id});
    if(val.type) assert(supported.has(val.type),entry.n);
  }
});

test('unusual variants do not inherit misleading equipment or posture labels', () => {
  const expected = {
    '0033':'BENCH_PRESS_GENERIC', // decline barbell press isn't a flat bench press
    '0297':'CONCENTRATION_CURL',
    '0315':'INCLINE_DUMBBELL_BICEPS_CURL',
    '0318':'INCLINE_DUMBBELL_BICEPS_CURL',
    '0206':'REVERSE_CABLE_CURLS',
    '1756':'DEADLIFT_GENERIC', // a single-leg deadlift isn't bilateral
  };
  for(const [id,type] of Object.entries(expected))
    assert.equal(stravaExerciseType({id}),type,id+' needs a safe mapping');
});
