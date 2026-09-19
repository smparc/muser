import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {openapiSpec} from '../lib/openapi.mjs';import {sqliteD1,origin} from './helpers.mjs';
const h=sqliteD1();
const hostA={id:'owner-host',name:'Host'},hostB={id:'owner-other',name:'Other host'};
async function req(path,method='GET',body,opts={}){const headers=new Headers();if(body!==undefined)headers.set('Content-Type','application/json');if(opts.owner)headers.set('Origin',opts.origin??origin);if(opts.token)headers.set('Authorization',opts.auth??'Bearer '+opts.token);else if(opts.auth)headers.set('Authorization',opts.auth);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,opts.owner??null);return {status:r.status,headers:r.headers,body:await r.json()};}
const connect=(owner=hostA,name="Hayden's Muse")=>req('/api/owner/connections','POST',{agent_name:name},{owner});
const state=(owner=hostA)=>req('/api/owner/state','GET',undefined,{owner}).then(r=>r.body);
const connection=async(id,owner=hostA)=>(await state(owner)).connections.find(c=>c.id===id);
let key,cid,task;

test('owner issues a connector key without any pairing',async()=>{
 const r=await connect();
 assert.equal(r.status,201);
 assert.equal(r.headers.get('Cache-Control'),'no-store');
 assert.match(r.body.connection_id,/^agent_/);
 assert.match(r.body.access_token,/^cr_[a-f0-9]{64}$/);
 assert.equal(r.body.token_type,'Bearer');
 assert.equal(typeof r.body.expires_at,'number');
 assert.ok(Math.abs(r.body.expires_at-(Date.now()+7*86400000))<60000);
 assert.deepEqual(r.body.scopes,['profile:write','tasks:read:own','responses:write:own','room:read']);
 key=r.body.access_token;cid=r.body.connection_id;
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM pairings').get().n,0);
 const row=h.sql.prepare('SELECT token_hash,source FROM connections WHERE id=?').get(cid);
 assert.notEqual(row.token_hash,key);assert.match(row.token_hash,/^[a-f0-9]{64}$/);assert.equal(row.source,'connector');
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM tasks WHERE connection_id=? AND kind='onboarding'").get(cid).n,1);
 const s=await state();
 assert.ok(!JSON.stringify(s).includes(key));
 assert.equal(s.connections[0].status,'awaiting_first_request');
});

test('issuance requires a signed-in same-origin owner and ignores body-supplied ownership',async()=>{
 assert.equal((await req('/api/owner/connections','POST',{agent_name:'x'})).status,401);
 assert.equal((await req('/api/owner/connections','POST',{agent_name:'x'},{owner:hostA,origin:'https://evil.test'})).status,403);
 assert.equal((await req('/api/owner/connections','POST',{agent_name:'x',room_id:'room_x'},{owner:hostA})).status,422);
 assert.equal((await req('/api/owner/connections','POST',{agent_name:'x',owner_id:hostB.id},{owner:hostA})).status,422);
 assert.equal((await req('/api/owner/connections','POST',{agent_name:''},{owner:hostA})).status,422);
 assert.equal((await req('/api/owner/connections','POST',{agent_name:'x'.repeat(61)},{owner:hostA})).status,422);
 // An agent key never authorizes owner routes.
 assert.equal((await req('/api/owner/state','GET',undefined,{token:key})).status,401);
});

test('first authenticated request marks the connection connected exactly once',async()=>{
 const me=await req('/api/v1/me','GET',undefined,{token:key});
 assert.equal(me.status,200);assert.equal(me.body.connection_id,cid);assert.equal(me.body.expires_at,(await connection(cid)).expires_at);
 await req('/api/v1/me','GET',undefined,{token:key});
 const c=await connection(cid);
 assert.equal(c.status,'connected');assert.ok(c.first_used_at);assert.equal(c.last_inbox_at,null);
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM events WHERE connection_id=? AND type='connected'").get(cid).n,1);
});

test('authorization header mistakes get specific 401s',async()=>{
 const bad=async auth=>(await req('/api/v1/me','GET',undefined,{auth})).body.error;
 assert.equal(await bad('Bearer Bearer '+key),'duplicate_bearer_prefix');
 assert.equal(await bad(key),'bearer_prefix_missing');
 assert.equal(await bad('Bearer sk-not-ours'),'unauthorized');
 assert.equal((await req('/api/v1/me','GET',undefined,{auth:'bearer '+key})).status,200);
 const r=await req('/api/v1/me');assert.equal(r.status,401);assert.match(r.headers.get('WWW-Authenticate'),/^Bearer/);
});

test('inbox check is recorded separately and tasks move from queued to fetched',async()=>{
 assert.equal((await state()).tasks[0].state,'queued');
 const r=await req('/api/v1/me/tasks','GET',undefined,{token:key});
 assert.equal(r.status,200);assert.equal(r.body.tasks.length,1);task=r.body.tasks[0];
 assert.equal(task.kind,'onboarding');
 const s=await state();
 assert.equal(s.tasks.find(t=>t.id===task.id).state,'fetched');
 assert.ok(s.connections.find(c=>c.id===cid).last_inbox_at);
 assert.equal(s.inbox_checks.filter(e=>e.connection_id===cid).length,1);
 assert.ok(s.events.some(e=>e.type==='tasks_fetched'&&e.detail.task_ids.includes(task.id)));
 await req('/api/v1/me/tasks','GET',undefined,{token:key});
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM events WHERE connection_id=? AND type='tasks_fetched'").get(cid).n,1);
});

test('reply is stored once; wrong nonces and other connections fail',async()=>{
 const reply={client_message_id:'msg-1',nonce:task.nonce,text:'Reached Commonroom. My owner approved sharing an interest in climbing.'};
 assert.equal((await req('/api/v1/tasks/'+task.id+'/response','POST',{...reply,nonce:'wrong'},{token:key})).status,422);
 const other=(await connect(hostA,'Second Muse')).body.access_token;
 assert.equal((await req('/api/v1/tasks/'+task.id+'/response','POST',reply,{token:other})).status,404);
 const outsider=(await connect(hostB,'Outside Muse')).body.access_token;
 assert.equal((await req('/api/v1/tasks/'+task.id+'/response','POST',reply,{token:outsider})).status,404);
 const first=await req('/api/v1/tasks/'+task.id+'/response','POST',reply,{token:key});
 assert.equal(first.status,201);assert.equal(first.body.replayed,false);
 const retries=await Promise.all([1,2,3].map(()=>req('/api/v1/tasks/'+task.id+'/response','POST',reply,{token:key})));
 assert.ok(retries.every(r=>r.status===200&&r.body.replayed&&r.body.response_id===first.body.response_id));
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM responses WHERE task_id=?').get(task.id).n,1);
 assert.equal((await req('/api/v1/tasks/'+task.id+'/response','POST',{...reply,text:'Different'},{token:key})).status,409);
 const s=await state();
 assert.equal(s.tasks.find(t=>t.id===task.id).state,'answered');
 assert.equal(s.responses.find(r=>r.task_id===task.id).text,reply.text);
 assert.ok(s.connections.find(c=>c.id===cid).last_reply_at);
 assert.equal(s.events.filter(e=>e.type==='reply_posted'&&e.connection_id===cid).length,1);
});

test('room reads are confined to the connection room',async()=>{
 const room=(await req('/api/v1/room','GET',undefined,{token:key})).body;
 assert.equal(room.messages.length,1);assert.equal(room.messages[0].in_reply_to_prompt.length>0,true);
 assert.equal(room.members.length,2);
 const outsider=(await connect(hostB,'Another outsider')).body.access_token;
 const theirs=(await req('/api/v1/room','GET',undefined,{token:outsider})).body;
 assert.equal(theirs.messages.length,0);assert.ok(theirs.members.every(m=>m.id!==cid));
 assert.equal((await state(hostB)).responses.length,0);
});

test('room rounds queue one task per active connection',async()=>{
 const r=await req('/api/owner/rounds','POST',{},{owner:hostA});
 assert.equal(r.status,201);assert.equal(r.body.tasks.length,2);
 assert.match(r.body.prompt,/useful connection/);
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM tasks WHERE round_id=? AND kind='round'").get(r.body.round_id).n,2);
 assert.equal((await req('/api/owner/rounds','POST',{delay_seconds:99999},{owner:hostA})).status,422);
 assert.equal((await req('/api/owner/rounds','POST',{},{owner:{id:'owner-empty',name:'Empty'}})).status,409);
});

test('key replacement kills the old key and preserves the connection',async()=>{
 const path='/api/owner/connections/'+cid+'/token';
 assert.equal((await req(path,'POST',{},{owner:hostB})).status,404);
 assert.equal((await req(path,'POST',{},{owner:hostA,origin:'https://evil.test'})).status,403);
 const r=await req(path,'POST',{},{owner:hostA});
 assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.body.connection_id,cid);
 assert.equal((await req('/api/v1/me','GET',undefined,{token:key})).status,401);
 key=r.body.access_token;
 assert.equal((await req('/api/v1/me','GET',undefined,{token:key})).status,200);
 assert.equal((await state()).responses.length,1);
});

test('expired keys fail and can be renewed by the owner',async()=>{
 h.sql.prepare('UPDATE connections SET expires_at=? WHERE id=?').run(Date.now()-1,cid);
 assert.equal((await req('/api/v1/me/tasks','GET',undefined,{token:key})).status,401);
 assert.equal((await connection(cid)).status,'expired');
 const r=await req('/api/owner/connections/'+cid+'/token','POST',{},{owner:hostA});
 assert.equal(r.status,200);key=r.body.access_token;
 assert.equal((await req('/api/v1/me','GET',undefined,{token:key})).status,200);
});

test('revoked keys fail; other owners cannot revoke; a fresh connection is the way back',async()=>{
 assert.equal((await req('/api/owner/connections/'+cid,'DELETE',undefined,{owner:hostB})).status,404);
 assert.equal((await req('/api/owner/connections/'+cid,'DELETE',undefined,{owner:hostA})).status,200);
 assert.equal((await req('/api/v1/me','GET',undefined,{token:key})).status,401);
 assert.equal((await req('/api/owner/connections/'+cid+'/token','POST',{},{owner:hostA})).status,404);
 assert.equal((await connection(cid)).status,'revoked');
 assert.equal((await connect(hostA,"Hayden's Muse")).status,201);
});

test('data survives a restart',async()=>{
 h.reopen();
 const s=await state();
 assert.equal(s.responses.length,1);assert.ok(s.events.some(e=>e.type==='revoked'));
});

test('connector spec exposes only agent operations',()=>{
 const spec=openapiSpec('https://commonroom.example');
 assert.equal(spec.servers[0].url,'https://commonroom.example');
 assert.deepEqual(spec.components.securitySchemes.bearerAuth,{...spec.components.securitySchemes.bearerAuth,type:'http',scheme:'bearer'});
 const ops=Object.values(spec.paths).flatMap(p=>Object.values(p).map(o=>o.operationId)).sort();
 assert.deepEqual(ops,['get_connection','get_room','get_tasks','respond_to_task','update_profile']);
 assert.ok(Object.keys(spec.paths).every(p=>p.startsWith('/api/v1/')&&!p.includes('pairings')));
 h.cleanup();
});
