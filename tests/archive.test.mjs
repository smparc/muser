import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {onboard,sqliteD1,origin} from './helpers.mjs';
const h=sqliteD1();
const host={id:'arch-host',name:'Hana'},member={id:'arch-member',name:'Milo'};
onboard(h.sql,[host,member]);
async function call(path,method='GET',body,who,token){const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,who??null);return {status:r.status,body:await r.json()};}
let room,hostKey,memberKey,memberCid;

test('setup: a room with a member, Muses, a reply and a pending task',async()=>{
 room=(await call('/api/owner/rooms','POST',{name:'Side project'},host)).body.room_id;
 hostKey=(await call('/api/owner/connections','POST',{agent_name:"Hana's Muse",room_id:room},host)).body.access_token;
 const code=(await call('/api/owner/rooms/'+room+'/invites','POST',{},host)).body.code;
 const j=(await call('/api/owner/rooms/join','POST',{code,agent_name:"Milo's Muse"},member)).body;memberKey=j.connection.access_token;memberCid=j.connection.connection_id;
 const t=(await call('/api/v1/me/tasks','GET',undefined,null,hostKey)).body.tasks[0];
 assert.equal((await call('/api/v1/tasks/'+t.id+'/response','POST',{client_message_id:'a1',nonce:t.nonce,text:'Hello room'},null,hostKey)).status,201);
 assert.equal((await call('/api/owner/rounds','POST',{room_id:room},host)).status,201);
});

test('only the host archives; archived rooms refuse Muses and new work but stay readable',async()=>{
 assert.equal((await call('/api/owner/rooms/'+room,'PUT',{archived:true},member)).status,403);
 assert.equal((await call('/api/owner/rooms/'+room,'PUT',{archived:'yes'},host)).status,422);
 const a=await call('/api/owner/rooms/'+room,'PUT',{archived:true},host);assert.equal(a.status,200);assert.equal(a.body.archived,true);
 const me=await call('/api/v1/me','GET',undefined,null,hostKey);assert.equal(me.status,403);assert.equal(me.body.error,'room_archived');
 assert.equal((await call('/api/v1/me/tasks','GET',undefined,null,memberKey)).body.error,'room_archived');
 for(const [path,body,who] of [['/api/owner/rounds',{room_id:room},host],['/api/owner/tasks',{connection_id:memberCid,prompt:'hi'},member],['/api/owner/connections',{agent_name:'x',room_id:room},member],['/api/owner/rooms/'+room+'/invites',{},host],['/api/owner/connections/'+memberCid+'/token',{},member]]){
  const r=await call(path,'POST',body,who);assert.equal(r.status,409,path);assert.equal(r.body.error,'room_archived');
 }
 const s=(await call('/api/owner/state?room='+room,'GET',undefined,member)).body;
 assert.ok(s.room.archived_at);assert.equal(s.responses.length,1);assert.equal(s.rooms.find(r=>r.id===room).archived,true);
 assert.ok(s.events.some(e=>e.type==='room_archived'));
 // Nobody new can be invited while archived.
 assert.equal((await call('/api/owner/rooms/'+room+'/invites','POST',{},host)).status,409);
});

test('unarchiving restores the same keys and work',async()=>{
 assert.equal((await call('/api/owner/rooms/'+room,'PUT',{archived:false},host)).body.archived,false);
 assert.equal((await call('/api/v1/me','GET',undefined,null,hostKey)).status,200);
 assert.equal((await call('/api/v1/me/tasks','GET',undefined,null,memberKey)).body.tasks.some(t=>t.kind==='round'),true);
 assert.equal((await call('/api/owner/rooms/'+room,'PUT',{name:'Renamed'},host)).body.name,'Renamed');
});

test('deleting requires the host and the exact name, and removes everything',async()=>{
 assert.equal((await call('/api/owner/rooms/'+room,'DELETE',{confirm_name:'Renamed'},member)).status,403);
 assert.equal((await call('/api/owner/rooms/'+room,'DELETE',{confirm_name:'renamed'},host)).status,422);
 assert.equal((await call('/api/owner/rooms/'+room,'DELETE',{},host)).status,422);
 const d=await call('/api/owner/rooms/'+room,'DELETE',{confirm_name:'Renamed'},host);assert.equal(d.status,200);assert.equal(d.body.status,'deleted');
 for(const table of ['rooms','room_members','room_invites','connections','tasks','responses','events'])
  assert.equal(h.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table==='rooms'?'id':'room_id'}=?`).get(room).n,0,table);
 assert.equal((await call('/api/v1/me','GET',undefined,null,hostKey)).status,401);
 assert.equal((await call('/api/owner/state?room='+room,'GET',undefined,member)).status,404);
 // Each owner still has their own home room afterwards.
 assert.ok((await call('/api/owner/state','GET',undefined,host)).body.room.id);
});

test('deleting your only room gives you a fresh empty home room',async()=>{
 const solo={id:'arch-solo',name:'Sol'};onboard(h.sql,[solo]);
 const home=(await call('/api/owner/state','GET',undefined,solo)).body.room;
 assert.equal((await call('/api/owner/rooms/'+home.id,'DELETE',{confirm_name:home.name},solo)).status,200);
 const next=(await call('/api/owner/state','GET',undefined,solo)).body.room;
 assert.notEqual(next.id,home.id);assert.equal(next.role,'host');
 h.cleanup();
});
