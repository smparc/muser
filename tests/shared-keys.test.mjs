import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {handleMcp} from '../lib/mcp.mjs';import {onboard,sqliteD1,origin} from './helpers.mjs';
// One key per Muse: rooms after the first reuse it (no new key to paste), and it stays valid while the Muse checks in.
const h=sqliteD1();
const sam={id:'owner-sam',name:'Sam'},host={id:'owner-host',name:'Hayden'};
onboard(h.sql,[sam,host]);
async function req(path,method='GET',body,owner,token){const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,owner??null);return {status:r.status,body:await r.json()};}
const state=(owner,room)=>req('/api/owner/state'+(room?'?room='+room:''),'GET',undefined,owner).then(r=>r.body);
const row=cid=>h.sql.prepare('SELECT * FROM connections WHERE id=?').get(cid);
let key,samHome,firstCid,hostRoom,linkCid,thirdRoom;

test('the first room issues a key; a second room brings the same Muse without a new key',async()=>{
 const s=await state(sam);samHome=s.room.id;
 const c=await req('/api/owner/connections','POST',{agent_name:"Sam's Muse"},sam);
 assert.equal(c.status,201);key=c.body.access_token;firstCid=c.body.connection_id;
 h.sql.prepare("INSERT INTO muse_context (id,room_id,connection_id,owner_id,text_hash,category,text,position,source,created_at,updated_at) VALUES ('f1',?,?,?,'h1','interest','Climbs on weekends',1,'',1,1)").run(samHome,firstCid,sam.id);
 h.sql.prepare("INSERT INTO muse_context (id,room_id,connection_id,owner_id,text_hash,category,text,position,source,created_at,updated_at,hidden_at,hidden_by) VALUES ('f2',?,?,?,'h2','interest','Secret hobby',2,'',1,1,1,'owner')").run(samHome,firstCid,sam.id);
 assert.equal((await state(sam)).my_muses.length,1);

 hostRoom=(await state(host)).room.id;
 const code=(await req('/api/owner/rooms/'+hostRoom+'/invites','POST',{},host)).body.code;
 const j=await req('/api/owner/rooms/join','POST',{code,link:firstCid},sam);
 assert.equal(j.status,201);
 assert.equal(j.body.connection.linked,true);assert.equal(j.body.connection.access_token,undefined);
 linkCid=j.body.connection.connection_id;
 assert.equal(row(linkCid).key_of,firstCid);assert.equal(row(linkCid).name,"Sam's Muse");
 assert.ok(!/^[a-f0-9]{64}$/.test(row(linkCid).token_hash),'a linked connection has no key of its own');
 // Visible facts come along; hidden ones do not.
 assert.deepEqual(h.sql.prepare('SELECT text FROM muse_context WHERE connection_id=?').all(linkCid).map(f=>f.text),['Climbs on weekends']);
 // Bringing it again is a no-op.
 const again=await req('/api/owner/connections','POST',{link:firstCid,room_id:hostRoom},sam);
 assert.equal(again.body.already_here,true);assert.equal(again.body.connection_id,linkCid);
 const mine=(await state(sam,hostRoom)).my_muses[0];assert.equal(mine.rooms,2);assert.equal(mine.here,linkCid);
 // Another person's Muse cannot be brought in.
 assert.equal((await req('/api/owner/connections','POST',{link:firstCid,room_id:hostRoom},host)).status,404);
});

test('the one key reads tasks from both rooms and answers each as the right connection',async()=>{
 const me=await req('/api/v1/me','GET',undefined,null,key);
 assert.equal(me.status,200);assert.deepEqual(me.body.rooms.map(r=>r.connection_id).sort(),[firstCid,linkCid].sort());
 const t=await req('/api/v1/me/tasks','GET',undefined,null,key);
 const rooms=new Set(t.body.tasks.map(x=>x.room_id));assert.ok(rooms.has(samHome)&&rooms.has(hostRoom));
 const inHost=t.body.tasks.find(x=>x.room_id===hostRoom);
 const r=await req('/api/v1/tasks/'+inHost.id+'/response','POST',{client_message_id:'m1',nonce:inHost.nonce,text:'Hi, I represent Sam.'},null,key);
 assert.equal(r.status,201);
 assert.equal(h.sql.prepare('SELECT connection_id,room_id FROM responses WHERE id=?').get(r.body.response_id).connection_id,linkCid);
 assert.equal((await state(sam,hostRoom)).connections.find(c=>c.id===linkCid).status,'connected');
 // get_room picks a room; an unknown room is refused.
 assert.equal((await req('/api/v1/room?room_id='+hostRoom,'GET',undefined,null,key)).body.room_id,hostRoom);
 assert.equal((await req('/api/v1/room','GET',undefined,null,key)).body.room_id,samHome);
 assert.equal((await req('/api/v1/room?room_id=room_nope','GET',undefined,null,key)).status,404);
 // MCP get_room takes the same room_id.
 const mcp=await handleMcp(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_room',arguments:{room_id:hostRoom}}})}),h.db);
 assert.equal((await mcp.json()).result.structuredContent.room_id,hostRoom);
});

test('set_context posts facts in every room the Muse is in',async()=>{
 const r=await req('/api/v1/me/context','PUT',{sharing_confirmed:true,facts:[{category:'work',text:'Builds climbing apps',source:'owner'}]},null,key);
 assert.ok(r.status<300);assert.equal(r.body.rooms,2);
 for(const cid of [firstCid,linkCid])assert.ok(h.sql.prepare('SELECT text FROM muse_context WHERE connection_id=? AND hidden_at IS NULL').all(cid).some(f=>f.text==='Builds climbing apps'));
});

test('creating a room can bring the Muse straight in; a context sync asks the Muse once',async()=>{
 const c=await req('/api/owner/rooms','POST',{name:'Climbing crew',link:linkCid},sam);
 assert.equal(c.status,201);thirdRoom=c.body.room_id;assert.equal(row(c.body.connection.connection_id).key_of,firstCid);
 const before=h.sql.prepare("SELECT count(*) AS n FROM tasks WHERE kind='context_sync'").get().n;
 await req('/api/owner/sources','PUT',{sources:[]},sam);
 const r=await req('/api/owner/sources','PUT',{sources:['gmail'],authorized:true},sam);
 assert.equal(r.status,200);assert.equal(r.body.sync_tasks_queued,1);
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM tasks WHERE kind='context_sync'").get().n,before+1);
});

test('the key rolls forward while the Muse checks in',async()=>{
 const soon=Date.now()+2*86400000;
 h.sql.prepare('UPDATE connections SET expires_at=? WHERE id=? OR key_of=?').run(soon,firstCid,firstCid);
 assert.equal((await req('/api/v1/me/tasks','GET',undefined,null,key)).status,200);
 for(const cid of [firstCid,linkCid])assert.ok(row(cid).expires_at>Date.now()+29*86400000);
});

test('replacing the key from any room replaces the one key',async()=>{
 const r=await req('/api/owner/connections/'+linkCid+'/token','POST',{},sam);
 assert.equal(r.status,200);
 assert.equal((await req('/api/v1/me','GET',undefined,null,key)).status,401);
 key=r.body.access_token;
 assert.equal((await req('/api/v1/me','GET',undefined,null,key)).body.rooms.length,3);
});

test('when the key\'s own room goes away, the key moves to another room and keeps working',async()=>{
 // Revoking the first connection keeps the Muse in the other rooms with the same key.
 assert.equal((await req('/api/owner/connections/'+firstCid,'DELETE',undefined,sam)).status,200);
 const me=await req('/api/v1/me','GET',undefined,null,key);
 assert.equal(me.status,200);assert.ok(!me.body.rooms.some(r=>r.connection_id===firstCid));assert.equal(me.body.rooms.length,2);
 assert.equal(row(linkCid).key_of,null);
 // The host removes Sam from their room: the key moves on to the third room.
 const member=(await state(host,hostRoom)).members.find(m=>m.name==='Sam');
 assert.equal((await req('/api/owner/rooms/'+hostRoom+'/members/'+member.id,'DELETE',undefined,host)).status,200);
 const after=await req('/api/v1/me','GET',undefined,null,key);
 assert.equal(after.status,200);assert.deepEqual(after.body.rooms.map(r=>r.room_id),[thirdRoom]);
 // Deleting the last room ends the key.
 assert.equal((await req('/api/owner/rooms/'+thirdRoom,'DELETE',{confirm_name:'Climbing crew'},sam)).status,200);
 assert.equal((await req('/api/v1/me','GET',undefined,null,key)).status,401);
});

test('an archived room is skipped, not fatal, while the Muse has another room',async()=>{
 const c=await req('/api/owner/connections','POST',{agent_name:'Second Muse'},sam);
 const k=c.body.access_token;
 const room=(await req('/api/owner/rooms','POST',{name:'Side room',link:c.body.connection_id},sam)).body.room_id;
 assert.equal((await req('/api/owner/rooms/'+samHome,'PUT',{archived:true},sam)).status,200);
 const me=await req('/api/v1/me','GET',undefined,null,k);
 assert.equal(me.status,200);assert.deepEqual(me.body.rooms.map(r=>r.room_id),[room]);
});
