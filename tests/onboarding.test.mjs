import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {SOURCE_IDS} from '../lib/sources.mjs';import {sqliteD1,origin} from './helpers.mjs';
const h=sqliteD1();
const ana={id:'ob-ana',name:'Ana'},ben={id:'ob-ben',name:'Ben'};
async function req(path,method='GET',body,owner,token){const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,owner??null);return {status:r.status,body:await r.json()};}
const put=(key,facts)=>req('/api/v1/me/context','PUT',{facts,sharing_confirmed:true},null,key);
let key,cid,room;

test('a new owner must finish onboarding before anything else',async()=>{
 const blocked=await req('/api/owner/state','GET',undefined,ana);assert.equal(blocked.status,403);assert.equal(blocked.body.error,'onboarding_required');
 assert.equal((await req('/api/owner/connections','POST',{agent_name:'Early'},ana)).body.error,'onboarding_required');
 assert.equal((await req('/api/owner/rooms/join','POST',{code:'AAAA-BBBB-CCCC'},ana)).body.error,'onboarding_required');
 // The onboarding steps themselves are open.
 const o=(await req('/api/owner/onboarding','GET',undefined,ana)).body;
 assert.equal(o.completed,false);assert.deepEqual(o.sources,[]);assert.deepEqual(o.catalog.map(s=>s.id),SOURCE_IDS);
 assert.ok(o.catalog.every(s=>s.label&&s.may_use&&s.group));
 assert.equal((await req('/api/owner/profile','PUT',{interests:['climbing'],working_on:'A climbing app',seeking:''},ana)).status,200);
 assert.equal((await req('/api/owner/onboarding/complete','POST',{},ana)).body.error,'sources_required');
});

test('sources must be known, and choosing any requires explicit authorization',async()=>{
 assert.equal((await req('/api/owner/sources','PUT',{sources:['myspace'],authorized:true},ana)).body.error,'invalid_sources');
 assert.equal((await req('/api/owner/sources','PUT',{sources:['gmail']},ana)).body.error,'authorization_required');
 assert.equal((await req('/api/owner/sources','PUT',{sources:['gmail'],authorized:false},ana)).body.error,'authorization_required');
 assert.equal((await req('/api/owner/sources','PUT',{sources:['gmail'],authorized:true,extra:1},ana)).body.error,'unknown_field');
 const r=await req('/api/owner/sources','PUT',{sources:['linkedin','google_calendar','linkedin'],authorized:true},ana);
 assert.equal(r.status,200);assert.deepEqual(r.body.sources,['google_calendar','linkedin']); // catalog order, de-duplicated
 assert.equal(r.body.sync_tasks_queued,0); // no Muse yet, and onboarding is not finished
 assert.equal((await req('/api/owner/onboarding/complete','POST',{},ana)).status,200);
 assert.equal((await req('/api/owner/state','GET',undefined,ana)).status,200);
 // Choosing none is a valid, explicit choice.
 assert.equal((await req('/api/owner/sources','PUT',{sources:[]},ben)).status,200);
 assert.equal((await req('/api/owner/onboarding/complete','POST',{},ben)).status,200);
 assert.equal((await req('/api/owner/onboarding','GET',undefined,ben)).body.completed,true);
});

test('the Muse is told exactly what its owner authorized',async()=>{
 const issued=(await req('/api/owner/connections','POST',{agent_name:"Ana's Muse"},ana)).body;key=issued.access_token;cid=issued.connection_id;room=issued.room_id;
 const me=(await req('/api/v1/me','GET',undefined,null,key)).body;
 assert.deepEqual(me.authorized_sources.map(s=>s.id),['google_calendar','linkedin']);assert.ok(me.authorized_sources.every(s=>s.may_use));
 const onboarding=(await req('/api/v1/me/tasks','GET',undefined,null,key)).body.tasks.find(t=>t.kind==='onboarding');
 assert.match(onboarding.prompt,/Google Calendar \(google_calendar\), LinkedIn \(linkedin\)/);
 assert.deepEqual((await req('/api/v1/me/context','GET',undefined,null,key)).body.authorized_sources.map(s=>s.id),['google_calendar','linkedin']);
 assert.deepEqual((await req('/api/owner/state','GET',undefined,ana)).body.sources.map(s=>s.id),['google_calendar','linkedin']);
 // An owner who authorized nothing: the first task says not to post context.
 const benKey=(await req('/api/owner/connections','POST',{agent_name:"Ben's Muse"},ben)).body.access_token;
 assert.match((await req('/api/v1/me/tasks','GET',undefined,null,benKey)).body.tasks[0].prompt,/has not authorized any sources/);
 assert.equal((await put(benKey,[{category:'interest',text:'Chess',source:'owner'}])).body.error,'source_not_authorized');
});

test('facts from unauthorized sources are refused',async()=>{
 const bad=await put(key,[{category:'work',text:'Product designer',source:'linkedin'},{category:'interest',text:'Reads a lot',source:'gmail'}]);
 assert.equal(bad.status,403);assert.equal(bad.body.error,'source_not_authorized');assert.match(bad.body.message,/google_calendar, linkedin/);
 assert.equal((await req('/api/v1/me/context','GET',undefined,null,key)).body.facts.length,0); // nothing partial was stored
 const ok=await put(key,[{category:'work',text:'Product designer at a fintech',source:'linkedin'},{category:'activity',text:'Bouldering on Tuesdays',source:'google_calendar'}]);
 assert.equal(ok.status,201);assert.deepEqual(ok.body.facts.map(f=>f.source_label),['LinkedIn','Google Calendar']);
});

test('turning a source off deletes its facts everywhere; turning one on asks Muses to sync',async()=>{
 const r=await req('/api/owner/sources','PUT',{sources:['linkedin','gmail'],authorized:true},ana);
 assert.deepEqual(r.body.removed,['google_calendar']);assert.deepEqual(r.body.added,['gmail']);assert.equal(r.body.sync_tasks_queued,1);
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM muse_context WHERE owner_id=? AND source='google_calendar'").get(ana.id).n,0);
 assert.deepEqual((await req('/api/v1/room','GET',undefined,null,key)).body.context[0].facts.map(f=>f.source),['linkedin']);
 const tasks=(await req('/api/v1/me/tasks','GET',undefined,null,key)).body.tasks;assert.ok(tasks.some(t=>t.kind==='context_sync'));
 const s=(await req('/api/owner/state','GET',undefined,ana)).body;
 const ev=s.events.find(e=>e.type==='sources_changed');assert.deepEqual(ev.detail,{added:['Gmail'],removed:['Google Calendar']});
 // Removing only (no additions) queues nothing.
 assert.equal((await req('/api/owner/sources','PUT',{sources:['linkedin'],authorized:true},ana)).body.sync_tasks_queued,0);
});

test('facts are also filtered by current authorization when read',async()=>{
 // Even if a row slipped past the write checks, it is not shown once its source is not authorized.
 h.sql.prepare("INSERT INTO muse_context (id,room_id,connection_id,owner_id,text_hash,category,text,position,source,created_at,updated_at) VALUES ('fact_x',?,?,?,'h','interest','Smuggled','9','instagram',1,1)").run(room,cid,ana.id);
 assert.ok(!(await req('/api/v1/room','GET',undefined,null,key)).body.context[0].facts.some(f=>f.text==='Smuggled'));
 assert.ok(!(await req('/api/owner/state','GET',undefined,ana)).body.context.some(f=>f.text==='Smuggled'));
 assert.ok(!(await req('/api/v1/me/context','GET',undefined,null,key)).body.facts.some(f=>f.text==='Smuggled'));
 h.cleanup();
});
