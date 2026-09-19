import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import worker from '../worker/index.mjs';import {onboard,sqliteD1,origin} from './helpers.mjs';

const h=sqliteD1(),owner={id:'qr-owner',name:'Quinn'},other={id:'qr-other',name:'Olly'};
onboard(h.sql,[owner,other],['linkedin']);
async function call(path,method='GET',body,who){const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,who??null);return {status:r.status,body:await r.json()};}
const page=async url=>{const r=await worker.fetch(new Request(url),{DB:h.db,ASSETS:{fetch:async()=>new Response('')}});return {status:r.status,text:await r.text()};};
const code=url=>url.split('/s/')[1];
let room,link;

test('the owner creates a one-time setup link for a QR code; only its hash is stored',async()=>{
 room=(await call('/api/owner/state','GET',undefined,owner)).body.room.id;
 assert.equal((await call('/api/owner/setup-links','POST',{agent_name:"Quinn's Muse"})).status,401);
 const r=await call('/api/owner/setup-links','POST',{agent_name:"Quinn's Muse"},owner);
 assert.equal(r.status,201);assert.match(r.body.url,new RegExp('^'+origin+'/s/[a-f0-9]{32}$'));assert.equal(r.body.status,'waiting');
 link=r.body;
 assert.ok(!JSON.stringify(h.sql.prepare('SELECT * FROM setup_links').all()).includes(code(link.url)));
 assert.equal((await call('/api/owner/setup-links/'+link.setup_id,'GET',undefined,other)).status,404);
});

test('opening the link shows instructions and does not use it up',async()=>{
 for(let i=0;i<2;i++){
  const p=await page(link.url);
  assert.equal(p.status,200);assert.match(p.text,/Quinn's Muse/);assert.ok(p.text.includes(`POST ${origin}/api/v1/setup/${code(link.url)}/claim`));
  assert.ok(!/cr_[a-f0-9]{64}/.test(p.text),'no key on the page');
 }
 assert.equal((await call('/api/owner/setup-links/'+link.setup_id,'GET',undefined,owner)).body.status,'waiting');
});

test('the Muse claims its package once and connects with the key it received',async()=>{
 const r=await call(`/api/v1/setup/${code(link.url)}/claim`,'POST');
 assert.equal(r.status,201);assert.match(r.body.access_token,/^cr_[a-f0-9]{64}$/);assert.equal(r.body.room.id,room);
 assert.equal(r.body.connector.openapi_spec,origin+'/openapi.json');
 assert.deepEqual(r.body.authorized_sources.map(s=>s.id),['linkedin']);
 assert.ok(r.body.instructions.some(i=>/LinkedIn/.test(i)));
 assert.equal((await call('/api/owner/setup-links/'+link.setup_id,'GET',undefined,owner)).body.status,'claimed');
 const me=await handle(new Request(origin+'/api/v1/me',{headers:{Authorization:'Bearer '+r.body.access_token}}),h.db);
 assert.equal(me.status,200);
 assert.equal((await call('/api/owner/setup-links/'+link.setup_id,'GET',undefined,owner)).body.status,'connected');
 // Single use: a second claim fails and the page says so.
 assert.equal((await call(`/api/v1/setup/${code(link.url)}/claim`,'POST')).body.error,'setup_code_used');
 assert.equal((await page(link.url)).status,410);
 assert.ok((await call('/api/owner/state','GET',undefined,owner)).body.events.some(e=>e.type==='setup_link_claimed'));
});

test('invalid and expired codes are refused',async()=>{
 assert.equal((await call('/api/v1/setup/'+'0'.repeat(32)+'/claim','POST')).status,404);
 assert.equal((await call('/api/v1/setup/not-a-code/claim','POST')).status,404);
 const l=(await call('/api/owner/setup-links','POST',{agent_name:'Late Muse'},owner)).body;
 h.sql.prepare('UPDATE setup_links SET expires_at=1 WHERE id=?').run(l.setup_id);
 assert.equal((await call(`/api/v1/setup/${code(l.url)}/claim`,'POST')).body.error,'setup_code_expired');
 assert.equal((await call('/api/owner/setup-links/'+l.setup_id,'GET',undefined,owner)).body.status,'expired');
});

test('a claim that cannot connect releases the code; deleting the room removes its links',async()=>{
 const l=(await call('/api/owner/setup-links','POST',{agent_name:'Paused Muse'},owner)).body;
 await call('/api/owner/rooms/'+room,'PUT',{archived:true},owner);
 assert.equal((await call('/api/owner/setup-links','POST',{agent_name:'x'},owner)).body.error,'room_archived');
 assert.equal((await call(`/api/v1/setup/${code(l.url)}/claim`,'POST')).body.error,'room_archived');
 assert.equal(h.sql.prepare('SELECT claimed_at FROM setup_links WHERE id=?').get(l.setup_id).claimed_at,null);
 await call('/api/owner/rooms/'+room,'PUT',{archived:false},owner);
 assert.equal((await call(`/api/v1/setup/${code(l.url)}/claim`,'POST')).status,201);
 const name=(await call('/api/owner/state','GET',undefined,owner)).body.room.name;
 assert.equal((await call('/api/owner/rooms/'+room,'DELETE',{confirm_name:name},owner)).status,200);
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM setup_links WHERE room_id=?').get(room).n,0);
 h.cleanup();
});

test('joining a room, then connecting by QR: the Muse lands in the joined room as the member\'s own',async()=>{
 const h2=sqliteD1(),host={id:'qj-host',name:'Hana'},member={id:'qj-member',name:'Milo'};onboard(h2.sql,[host,member]);
 const c=async(path,method='GET',body,who)=>{const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h2.db,who??null);return {status:r.status,body:await r.json()};};
 try{
  const room=(await c('/api/owner/state','GET',undefined,host)).body.room.id;
  const invite=(await c('/api/owner/rooms/'+room+'/invites','POST',{},host)).body.code;
  // Not a member yet: no QR link for that room.
  assert.equal((await c('/api/owner/setup-links','POST',{agent_name:"Milo's Muse",room_id:room},member)).status,404);
  const joined=await c('/api/owner/rooms/join','POST',{code:invite},member);assert.equal(joined.status,201);assert.equal(joined.body.connection,null);
  const link=(await c('/api/owner/setup-links','POST',{agent_name:"Milo's Muse",room_id:room},member)).body;
  const pkg=(await c(`/api/v1/setup/${link.url.split('/s/')[1]}/claim`,'POST')).body;
  assert.equal(pkg.room.id,room);
  const s=(await c('/api/owner/state?room='+room,'GET',undefined,host)).body;
  const muse=s.connections.find(x=>x.name==="Milo's Muse");assert.ok(muse);assert.equal(muse.mine,false);assert.equal(muse.owner_name,'Milo');
  // Only the member can follow their own link's status.
  assert.equal((await c('/api/owner/setup-links/'+link.setup_id,'GET',undefined,host)).status,404);
  assert.equal((await c('/api/owner/setup-links/'+link.setup_id,'GET',undefined,member)).body.status,'claimed');
 }finally{h2.cleanup();}
});
