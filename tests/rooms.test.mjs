import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {sqliteD1,origin} from './helpers.mjs';
const h=sqliteD1();
const host={id:'owner-host',name:'Hayden'},guest={id:'owner-guest',name:'Sam'},stranger={id:'owner-stranger',name:'Eve'};
async function req(path,method='GET',body,owner,token){const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,owner??null);return {status:r.status,body:await r.json()};}
const state=(owner,room)=>req('/api/owner/state'+(room?'?room='+room:''),'GET',undefined,owner).then(r=>r.body);
let room,code,inviteId,guestKey,guestCid,hostKey;

test('host creates a named room invite code; members cannot',async()=>{
 const s=await state(host);room=s.room.id;assert.equal(s.room.role,'host');assert.equal(s.room.name,"Hayden's room");
 assert.equal((await req('/api/owner/rooms/'+room,'PUT',{name:'HTN builders'},host)).status,200);
 const r=await req('/api/owner/rooms/'+room+'/invites','POST',{label:'Team',max_uses:2},host);
 assert.equal(r.status,201);assert.match(r.body.code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
 code=r.body.code;inviteId=r.body.invite_id;
 assert.ok(!JSON.stringify(h.sql.prepare('SELECT * FROM room_invites').all()).includes(code.replace(/-/g,'')));
 assert.equal((await state(host)).invites.length,1);
 assert.equal((await req('/api/owner/rooms/'+room+'/invites','POST',{},stranger)).status,404);
 assert.equal((await req('/api/owner/rooms/'+room+'/invites','POST',{max_uses:0},host)).status,422);
});

test('another owner joins with the code (case and dashes ignored) and sees the shared room',async()=>{
 assert.equal((await req('/api/owner/rooms/join','POST',{code:'AAAA-AAAA-AAAA'},guest)).status,404);
 assert.equal((await req('/api/owner/rooms/join','POST',{code:'short'},guest)).status,422);
 const j=await req('/api/owner/rooms/join','POST',{code:code.toLowerCase().replace(/-/g,' ')},guest);
 assert.equal(j.status,201);assert.equal(j.body.room_id,room);assert.equal(j.body.name,'HTN builders');assert.equal(j.body.role,'member');
 const again=await req('/api/owner/rooms/join','POST',{code},guest);assert.equal(again.body.already_member,true);
 assert.equal(h.sql.prepare('SELECT uses FROM room_invites WHERE id=?').get(inviteId).uses,1);
 const s=await state(guest,room);
 assert.equal(s.room.role,'member');assert.deepEqual(s.members.map(m=>m.name),['Hayden','Sam']);assert.equal(s.invites.length,0);
 assert.deepEqual(s.rooms.map(r=>r.role).sort(),['host','member']);
 assert.equal((await state(host)).events.some(e=>e.type==='member_joined'&&e.detail.name==='Sam'),true);
 // A non-member cannot read the room by ID.
 assert.equal((await req('/api/owner/state?room='+room,'GET',undefined,stranger)).status,404);
});

test('members connect their own Muse into the shared room; agents see each other',async()=>{
 hostKey=(await req('/api/owner/connections','POST',{agent_name:"Hayden's Muse"},host)).body.access_token;
 const g=await req('/api/owner/connections','POST',{agent_name:"Sam's Muse",room_id:room},guest);
 assert.equal(g.status,201);assert.equal(g.body.room_id,room);guestKey=g.body.access_token;guestCid=g.body.connection_id;
 assert.equal((await req('/api/owner/connections','POST',{agent_name:'x',room_id:room},stranger)).status,404);
 const agentRoom=(await req('/api/v1/room','GET',undefined,null,guestKey)).body;
 assert.equal(agentRoom.room_id,room);assert.equal(agentRoom.members.length,2);
 const hs=await state(host);const gc=hs.connections.find(c=>c.id===guestCid);
 assert.equal(gc.mine,false);assert.equal(gc.owner_name,'Sam');
});

test('permissions: members manage only their own connections; host moderates',async()=>{
 const hostCid=(await state(host)).connections.find(c=>c.mine).id;
 assert.equal((await req('/api/owner/connections/'+hostCid+'/token','POST',{},guest)).status,404);
 assert.equal((await req('/api/owner/connections/'+hostCid,'DELETE',undefined,guest)).status,404);
 assert.equal((await req('/api/owner/tasks','POST',{connection_id:hostCid,prompt:'hi'},guest)).status,404);
 assert.equal((await req('/api/owner/tasks','POST',{connection_id:guestCid,prompt:'own muse'},guest)).status,201);
 assert.equal((await req('/api/owner/rounds','POST',{room_id:room},guest)).status,403);
 assert.equal((await req('/api/owner/rooms/'+room,'PUT',{name:'mine now'},guest)).status,403);
 // The host may queue work for and revoke a member's connection, but never receives its key.
 assert.equal((await req('/api/owner/tasks','POST',{connection_id:guestCid,prompt:'from host'},host)).status,201);
 assert.equal((await req('/api/owner/connections/'+guestCid+'/token','POST',{},host)).status,404);
 const round=await req('/api/owner/rounds','POST',{},host);assert.equal(round.status,201);assert.equal(round.body.tasks.length,2);
});

test('invite limits: use cap and revocation',async()=>{
 const other={id:'owner-3',name:'Third'},fourth={id:'owner-4',name:'Fourth'};
 assert.equal((await req('/api/owner/rooms/join','POST',{code},other)).status,201);
 assert.equal((await req('/api/owner/rooms/join','POST',{code},fourth)).status,409);
 const r2=(await req('/api/owner/rooms/'+room+'/invites','POST',{},host)).body;
 assert.equal((await req('/api/owner/rooms/'+room+'/invites/'+r2.invite_id,'DELETE',undefined,guest)).status,403);
 assert.equal((await req('/api/owner/rooms/'+room+'/invites/'+r2.invite_id,'DELETE',undefined,host)).status,200);
 assert.equal((await req('/api/owner/rooms/join','POST',{code:r2.code},fourth)).status,410);
 const r3=(await req('/api/owner/rooms/'+room+'/invites','POST',{},host)).body;
 h.sql.prepare('UPDATE room_invites SET expires_at=1 WHERE id=?').run(r3.invite_id);
 assert.equal((await req('/api/owner/rooms/join','POST',{code:r3.code},fourth)).status,410);
});

test('removing a member revokes their agents; members can leave; host cannot',async()=>{
 const s=await state(host);const sam=s.members.find(m=>m.name==='Sam'),hayden=s.members.find(m=>m.role==='host');
 assert.equal((await req('/api/owner/rooms/'+room+'/members/'+hayden.id,'DELETE',undefined,guest)).status,403);
 assert.equal((await req('/api/owner/rooms/'+room+'/members/'+hayden.id,'DELETE',undefined,host)).status,409);
 assert.equal((await req('/api/owner/rooms/'+room+'/members/'+sam.id,'DELETE',undefined,host)).status,200);
 assert.equal((await req('/api/v1/me','GET',undefined,null,guestKey)).status,401);
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM tasks WHERE connection_id=? AND status='pending'").get(guestCid).n,0);
 assert.equal((await req('/api/owner/state?room='+room,'GET',undefined,guest)).status,404);
 assert.equal((await req('/api/v1/me','GET',undefined,null,hostKey)).status,200);
 const third=(await state({id:'owner-3',name:'Third'},room)).room;
 assert.equal((await req('/api/owner/rooms/'+room+'/members/'+third.member_id,'DELETE',undefined,{id:'owner-3',name:'Third'})).body.status,'left');
 assert.equal((await state(host)).members.length,1);
 h.cleanup();
});
