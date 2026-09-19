import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {handleMcp} from '../lib/mcp.mjs';import {contextSources} from '../lib/context.mjs';import {openapiSpec} from '../lib/openapi.mjs';import {onboard,sqliteD1,origin} from './helpers.mjs';
const h=sqliteD1();
const host={id:'c-host',name:'Matthew'},guest={id:'c-guest',name:'Hayden'},outsider={id:'c-out',name:'Eve'};
onboard(h.sql,[host,guest,outsider]);
async function req(path,method='GET',body,owner,token){const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,owner??null);return {status:r.status,body:await r.json()};}
const state=(owner,room)=>req('/api/owner/state'+(room?'?room='+room:''),'GET',undefined,owner).then(r=>r.body);
const put=(key,facts,extra={})=>req('/api/v1/me/context','PUT',{facts,sharing_confirmed:true,...extra},null,key);
const facts=[{category:'interest',text:'Plays tennis twice a week',source:'google_calendar'},{category:'work',text:'Building a React Native app for climbers',source:'gmail'},{category:'seeking',text:'Looking for a backend co-founder',source:'facebook'}];
let room,hostKey,guestKey,guestCid;

test('setup: host room with a member, each with a Muse',async()=>{
 room=(await state(host)).room.id;
 hostKey=(await req('/api/owner/connections','POST',{agent_name:"Matthew's Muse"},host)).body.access_token;
 const code=(await req('/api/owner/rooms/'+room+'/invites','POST',{},host)).body.code;
 const j=(await req('/api/owner/rooms/join','POST',{code,agent_name:"Hayden's Muse"},guest)).body;
 guestKey=j.connection.access_token;guestCid=j.connection.connection_id;
});

test('a Muse posts context that the room sees immediately',async()=>{
 const r=await put(guestKey,facts);assert.equal(r.status,201);assert.equal(r.body.facts.length,3);
 assert.deepEqual(r.body.facts.map(f=>f.source),['google_calendar','gmail','facebook']);
 const seen=(await req('/api/v1/room','GET',undefined,null,hostKey)).body.context;
 assert.equal(seen.length,1);assert.equal(seen[0].connection_id,guestCid);assert.equal(seen[0].agent_name,"Hayden's Muse");
 assert.deepEqual(seen[0].facts.map(f=>f.text),facts.map(f=>f.text));
 assert.equal((await state(host)).context.length,3);
 assert.ok((await state(host)).events.some(e=>e.type==='context_updated'&&e.detail.facts===3));
 // The master gets them as citable evidence tied to the right connection.
 const sources=await contextSources(h.db,room);assert.equal(sources.length,3);assert.ok(sources.every(s=>s.id.startsWith('fact:')&&s.connection_id===guestCid));
});

test('validation: confirmation, categories, limits and contact details',async()=>{
 assert.equal((await req('/api/v1/me/context','PUT',{facts},null,guestKey)).status,422);
 assert.equal((await put(guestKey,[{category:'secret',text:'x',source:'owner'}])).body.error,'invalid_category');
 assert.equal((await put(guestKey,[{category:'other',text:'x'.repeat(301),source:'owner'}])).status,422);
 assert.equal((await put(guestKey,Array.from({length:41},(_,i)=>({category:'other',text:'fact '+i,source:'owner'})))).status,422);
 assert.equal((await put(guestKey,[{category:'other',text:'Email me at hayden@example.com',source:'owner'}])).body.error,'contact_details');
 assert.equal((await put(guestKey,[{category:'other',text:'Call +1 (416) 555-0199',source:'owner'}])).body.error,'contact_details');
 assert.equal((await put(guestKey,[{category:'other',text:'ok',source:'owner',extra:1}])).body.error,'unknown_field');
 assert.equal((await put(guestKey,[{category:'other',text:'no source'}])).status,422);
 assert.equal((await req('/api/v1/me/context','PUT',{facts,sharing_confirmed:true})).status,401);
 // Nothing was changed by the rejected calls.
 assert.equal((await req('/api/v1/me/context','GET',undefined,null,guestKey)).body.facts.length,3);
});

test('re-sync keeps IDs, drops missing facts, and never resurrects hidden ones',async()=>{
 const before=(await req('/api/v1/me/context','GET',undefined,null,guestKey)).body.facts;
 const tennis=before.find(f=>f.text.includes('tennis'));
 // The owner hides one fact; it disappears from the room but stays in the owner's view.
 assert.equal((await req('/api/owner/context/'+tennis.id,'PUT',{hidden:true},outsider)).status,404);
 assert.equal((await req('/api/owner/context/'+tennis.id,'PUT',{hidden:true},guest)).status,200);
 assert.equal((await req('/api/v1/room','GET',undefined,null,hostKey)).body.context[0].facts.length,2);
 assert.equal((await state(guest,room)).context.find(f=>f.id===tennis.id).hidden,true);
 // The Muse syncs again with the same tennis text (different spacing/case) plus a new fact, dropping the seeking one.
 const r=await put(guestKey,[{category:'interest',text:'plays  TENNIS twice a week',source:'google_calendar'},facts[1],{category:'skill',text:'TypeScript and Postgres',source:'google_drive'}]);
 assert.equal(r.status,201);
 assert.deepEqual(r.body.facts.map(f=>f.text).sort(),['Building a React Native app for climbers','TypeScript and Postgres']);
 assert.equal(r.body.facts.find(f=>f.text.startsWith('Building')).id,before.find(f=>f.text.startsWith('Building')).id);
 assert.equal(r.body.hidden.length,1);
 assert.equal((await req('/api/v1/room','GET',undefined,null,hostKey)).body.context[0].facts.length,2);
 // Showing it again restores it.
 assert.equal((await req('/api/owner/context/'+tennis.id,'PUT',{hidden:false},guest)).status,200);
 assert.equal((await req('/api/v1/room','GET',undefined,null,hostKey)).body.context[0].facts.length,3);
});

test('the host can hide a member fact but cannot show one the member hid',async()=>{
 const f=(await req('/api/v1/me/context','GET',undefined,null,guestKey)).body.facts[0];
 assert.equal((await req('/api/owner/context/'+f.id,'PUT',{hidden:true},host)).status,200);
 assert.equal((await state(host)).context.find(x=>x.id===f.id).hidden_by,'host');
 assert.equal((await req('/api/owner/context/'+f.id,'PUT',{hidden:false},host)).status,200);
 assert.equal((await req('/api/owner/context/'+f.id,'PUT',{hidden:true},guest)).status,200);
 assert.equal((await req('/api/owner/context/'+f.id,'PUT',{hidden:false},host)).body.error,'owner_hidden');
 // A fact the member hid disappears from the host's view entirely.
 assert.equal((await state(host)).context.some(x=>x.id===f.id),false);
 assert.equal((await req('/api/owner/context/'+f.id,'PUT',{hidden:false},guest)).status,200);
});

test('the owner can ask their own Muse to sync context; others cannot',async()=>{
 assert.equal((await req('/api/owner/connections/'+guestCid+'/context-sync','POST',{},host)).status,404);
 const r=await req('/api/owner/connections/'+guestCid+'/context-sync','POST',{},guest);assert.equal(r.status,201);assert.equal(r.body.kind,'context_sync');
 const tasks=(await req('/api/v1/me/tasks','GET',undefined,null,guestKey)).body.tasks;
 assert.ok(tasks.some(t=>t.kind==='context_sync'&&t.prompt.includes('set_context')));
});

test('MCP exposes set_context and get_context with the same rules',async()=>{
 const call=async body=>(await handleMcp(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+hostKey},body:JSON.stringify(body)}),h.db)).json();
 const tools=(await call({jsonrpc:'2.0',id:1,method:'tools/list'})).result.tools.map(t=>t.name);
 assert.ok(tools.includes('set_context')&&tools.includes('get_context'));
 const ok=await call({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'set_context',arguments:{facts:[{category:'interest',text:'Design systems',source:'linkedin'}],sharing_confirmed:true}}});
 assert.equal(ok.result.isError,false);assert.equal(ok.result.structuredContent.facts[0].source_label,'LinkedIn');
 const bad=await call({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'set_context',arguments:{facts:[]}}});
 assert.equal(bad.result.isError,true);
 assert.equal((await req('/api/v1/room','GET',undefined,null,guestKey)).body.context.length,2);
 assert.ok(openapiSpec(origin).paths['/api/v1/me/context'].put);
});

test('revoked Muses stop contributing; deleting the room removes the facts',async()=>{
 await req('/api/owner/rooms/'+room+'/members/'+(await state(guest,room)).members.find(m=>m.you).id,'DELETE',undefined,guest);
 const ctx=(await req('/api/v1/room','GET',undefined,null,hostKey)).body.context;
 assert.deepEqual(ctx.map(g=>g.agent_name),["Matthew's Muse"]);
 assert.equal((await contextSources(h.db,room)).length,1);
 const name=(await state(host)).room.name;
 assert.equal((await req('/api/owner/rooms/'+room,'DELETE',{confirm_name:name},host)).status,200);
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM muse_context WHERE room_id=?').get(room).n,0);
 h.cleanup();
});
