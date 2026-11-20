/* Integration-level structured Strava tests. Run the actual OAuth hub and durable
 * outbox with a pretend Strava, following api/test/strava.test.js conventions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIntegrations } from '../integrations/index.js';
import { TOKEN_URL, ACTIVITY_URL } from '../integrations/providers/strava.js';
import { STRUCTURED_UPLOAD_URL } from '../integrations/providers/strava-strength.js';

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'gym-strava-structured-'));
const SECRET='b'.repeat(64);
const env=(enabled=true)=>({INTEGRATIONS:'strava',STRAVA_CLIENT_ID:'42',STRAVA_CLIENT_SECRET:'dummy',
  TZ:'Pacific/Auckland',...(enabled?{STRAVA_STRUCTURED_STRENGTH:'1'}:{})});
const NOW=Date.now();
const workout={id:'w-structured',name:'Friday Strength',d:new Date(NOW).toISOString().slice(0,10),
  start:NOW+60000,end:NOW+3660000,entries:[
    {id:'0289',sets:[{w:40,r:10,done:true},{w:40,r:8,done:true}]}
  ]};
const doc={unit:'kg',workouts:[workout]};
const reply=(status,data)=>({status,json:async()=>data});
function mockStrava(){
  const s={calls:[],uploads:[],polls:0};
  s.fetchFn=async(url,opts)=>{
    s.calls.push({url,method:opts.method});
    if(url===TOKEN_URL) return reply(200,{access_token:'access',refresh_token:'refresh',
      expires_at:Math.floor(Date.now()/1000)+3600,athlete:{id:7}});
    if(url===STRUCTURED_UPLOAD_URL && opts.method==='POST'){
      s.uploads.push({form:opts.body,json:JSON.parse(await opts.body.get('file').text())});
      return reply(201,{id:123,id_str:'123'});
    }
    if(url.startsWith(STRUCTURED_UPLOAD_URL+'/')&&opts.method==='GET'){
      s.polls++;
      return reply(200,s.polls===1?{id:123,activity_id:null}:{id:123,activity_id:987});
    }
    if(url===ACTIVITY_URL) return reply(201,{id:77});
    return reply(404,{});
  };
  return s;
}
async function connect(h,strength=true){
  const url=h.oauthStart('u1','strava','https://gym.example.com/api/integrations/oauth/callback');
  const c=await h.oauthFinish({state:new URL(url).searchParams.get('state'),code:'yes',
    scope:'activity:write'},'u1');
  if(strength) h.update('u1',c.connection.id,{strength:true});
  return c.connection.id;
}
test('opt-in uses existing OAuth, uploads one JSON file and polls across an outbox restart',async()=>{
  const dir=tmp(),s=mockStrava();
  try{
    const h=createIntegrations({dataDir:dir,secret:SECRET,env:env(),fetchFn:s.fetchFn});
    await connect(h);
    assert.equal(h.onStateWrite('u1',{workouts:[]},doc),1);
    await h._outbox().run();
    assert.equal(s.uploads.length,1);
    assert.equal(s.uploads[0].form.get('data_type'),'json');
    assert.equal(s.uploads[0].form.get('sport_type'),'WeightTraining');
    assert.equal(s.uploads[0].json.sets[0].exercise_type,'DUMBBELL_BENCH_PRESS');
    assert.equal(s.uploads[0].json.sets.length,2);
    assert.equal(h._outbox().snapshot().jobs[0].stravaUploadId,'123');
    assert.equal(s.calls.filter(x=>x.url===ACTIVITY_URL).length,0,'no duplicate manual activity');
    assert.equal(h.onStateWrite('u1',{workouts:[workout]},doc),0);
    const restarted=createIntegrations({dataDir:dir,secret:SECRET,env:env(),
      fetchFn:s.fetchFn,now:()=>Date.now()+30000});
    await restarted._outbox().run();
    assert.equal(s.uploads.length,1,'restarted outbox only polls, never re-POSTs');
    assert.equal(restarted._outbox().snapshot().jobs.length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('feature flag off preserves original manual-activity Strava workflow',async()=>{
  const dir=tmp(),s=mockStrava();
  try{
    const h=createIntegrations({dataDir:dir,secret:SECRET,env:env(false),fetchFn:s.fetchFn});
    await connect(h);
    h.onStateWrite('u1',{workouts:[]},doc);
    await h._outbox().run();
    assert.equal(s.uploads.length,0);
    assert.equal(s.calls.filter(x=>x.url===ACTIVITY_URL).length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('strength off still means no strength activity, even with structured flag on',async()=>{
  const dir=tmp(),s=mockStrava();
  try{
    const h=createIntegrations({dataDir:dir,secret:SECRET,env:env(),fetchFn:s.fetchFn});
    await connect(h,false);
    h.onStateWrite('u1',{workouts:[]},doc);
    await h._outbox().run();
    assert.equal(s.uploads.length,0);
    assert.equal(s.calls.filter(x=>x.url===ACTIVITY_URL).length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('all-unsupported strength session falls back to a manual activity instead of disappearing',async()=>{
  const dir=tmp(),s=mockStrava();
  try{
    const h=createIntegrations({dataDir:dir,secret:SECRET,env:env(),fetchFn:s.fetchFn});
    await connect(h,true);
    const session={...workout,id:'w-unsupported',name:'Unmapped strength session',entries:[
      {id:'custom-unmapped-strength-movement',sets:[{w:20,r:8,done:true}]},
    ]};
    assert.equal(h.onStateWrite('u1',{workouts:[]},{unit:'kg',workouts:[session]}),1);
    await h._outbox().run();
    assert.equal(s.uploads.length,0,'unsupported strength must not attempt a JSON upload');
    const manual=s.calls.filter(c=>c.url===ACTIVITY_URL);
    assert.equal(manual.length,1,'manual activity fallback must preserve the workout');
    assert.equal(h._outbox().snapshot().jobs.length,0,'successful manual fallback clears the queue');
    assert.equal(h._outbox().snapshot().failed.length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
