import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {onboard,sqliteD1,origin} from './helpers.mjs';
const h=sqliteD1();
const host={id:'p-host',name:'Matthew'},guest={id:'p-guest',name:'Hayden'},outsider={id:'p-out',name:'Eve'};
onboard(h.sql,[host,guest,outsider]);
async function req(path,method='GET',body,owner,token){const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,owner??null);return {status:r.status,body:await r.json()};}
const state=(owner,room)=>req('/api/owner/state'+(room?'?room='+room:''),'GET',undefined,owner).then(r=>r.body);
const profile={interests:['climbing','robotics'],working_on:'A hackathon agent room',seeking:'A frontend teammate'};
let room,hostKey,guestKey;

test('owners save their own profile; validation matches agent profiles',async()=>{
 assert.equal((await req('/api/owner/profile','PUT',profile)).status,401);
 assert.equal((await req('/api/owner/profile','PUT',{...profile,secret:'x'},guest)).status,422);
 assert.equal((await req('/api/owner/profile','PUT',{...profile,interests:Array(11).fill('x')},guest)).status,422);
 const r=await req('/api/owner/profile','PUT',profile,guest);assert.equal(r.status,200);assert.deepEqual(r.body.profile,profile);
 assert.deepEqual((await state(guest)).my_profile.interests,profile.interests);
});

test('joining a room shares the profile automatically with members and agents',async()=>{
 room=(await state(host)).room.id;
 hostKey=(await req('/api/owner/connections','POST',{agent_name:"Matthew's Muse"},host)).body.access_token;
 // Before joining, nothing about the guest is visible.
 assert.equal((await req('/api/v1/room','GET',undefined,null,hostKey)).body.people.length,0);
 const code=(await req('/api/owner/rooms/'+room+'/invites','POST',{},host)).body.code;
 const j=await req('/api/owner/rooms/join','POST',{code,agent_name:"Hayden's Muse"},guest);guestKey=j.body.connection.access_token;
 const s=await state(host);const g=s.members.find(m=>m.name==='Hayden');
 assert.equal(g.profile_shared,true);assert.deepEqual(g.profile.interests,profile.interests);
 const people=(await req('/api/v1/room','GET',undefined,null,hostKey)).body.people;
 assert.equal(people.length,1);assert.equal(people[0].name,'Hayden');assert.equal(people[0].seeking,profile.seeking);
 assert.deepEqual(people[0].agents.map(a=>a.agent_name),["Hayden's Muse"]);
 assert.equal(people[0].member_id,undefined);
});

test('updates propagate; sharing can be turned off per room; outsiders see nothing',async()=>{
 const r=await req('/api/owner/profile','PUT',{...profile,seeking:'Investors'},guest);assert.equal(r.body.shared_in_rooms,2); // the joined room plus Hayden's own room
 assert.equal((await req('/api/v1/room','GET',undefined,null,guestKey)).body.people[0].seeking,'Investors');
 assert.ok((await state(host)).events.some(e=>e.type==='member_profile_updated'));
 assert.equal((await req('/api/owner/rooms/'+room+'/sharing','PUT',{profile_shared:false},outsider)).status,404);
 assert.equal((await req('/api/owner/rooms/'+room+'/sharing','PUT',{profile_shared:'no'},guest)).status,422);
 assert.equal((await req('/api/owner/rooms/'+room+'/sharing','PUT',{profile_shared:false},guest)).status,200);
 assert.equal((await req('/api/v1/room','GET',undefined,null,hostKey)).body.people.length,0);
 assert.equal((await state(host)).members.find(m=>m.name==='Hayden').profile,null);
 assert.equal((await req('/api/owner/rooms/'+room+'/sharing','PUT',{profile_shared:true},guest)).status,200);
 assert.equal((await req('/api/v1/room','GET',undefined,null,hostKey)).body.people.length,1);
 // The host's own profile is shared in their room too once written.
 await req('/api/owner/profile','PUT',{interests:['design'],working_on:'',seeking:''},host);
 assert.deepEqual((await req('/api/v1/room','GET',undefined,null,guestKey)).body.people.map(p=>p.name),['Matthew','Hayden']);
 h.cleanup();
});
