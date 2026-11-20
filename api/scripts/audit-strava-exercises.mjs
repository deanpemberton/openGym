/* Run: node scripts/audit-strava-exercises.mjs [--json|--csv]
 * Reports every built-in exercise against Strava's documented exercise taxonomy.
 * Unmapped exercises stay in the activity description; they are never mislabeled.
 */
import { LIBRARY } from '../coach/core/library.js';
import { STRAVA_EXERCISE_TYPES } from '../integrations/providers/strava-exercises.js';
import { stravaExerciseMapping } from '../integrations/providers/strava-exercise-map.js';

const count = { exact:0, equivalent:0, generic:0, unsupported:0 };
const byRegion = {};
const csv = [['opengym_id','exercise_name','body_part','equipment','match_kind','strava_exercise_type']];
const esc = x => '"'+String(x??'').replaceAll('"','""')+'"';
const unsupportedSamples = [];
const invalid = [];
for (const entry of LIBRARY) {
  const result = stravaExerciseMapping({id:entry.id, name:entry.n});
  count[result.kind] = (count[result.kind] || 0) + 1;
  csv.push([entry.id,entry.n,entry.bp,entry.eq,result.kind,result.type||'']);
  byRegion[entry.bp] ||= {total:0,mapped:0,unsupported:0};
  byRegion[entry.bp].total++;
  if(result.type) byRegion[entry.bp].mapped++;
  else {
    byRegion[entry.bp].unsupported++;
    if(unsupportedSamples.length<30) unsupportedSamples.push([entry.id,entry.n]);
  }
  if(result.type && !STRAVA_EXERCISE_TYPES.includes(result.type))
    invalid.push([entry.id,entry.n,result.type]);
}
const report = {
  total_openGym_exercises:LIBRARY.length,
  documented_strava_types:new Set(STRAVA_EXERCISE_TYPES).size,
  coverage:count,
  mapped:count.exact+count.equivalent+count.generic,
  mapped_percent:Math.round(10000*(count.exact+count.equivalent+count.generic)/LIBRARY.length)/100,
  by_region:byRegion,
  invalid_strava_identifiers:invalid,
  first_unmapped:unsupportedSamples,
};
if(process.argv.includes('--csv')) console.log(csv.map(row=>row.map(esc).join(',')).join('\n'));
else console.log(JSON.stringify(report,null,process.argv.includes('--json')?0:2));
if(invalid.length) process.exitCode=1;
