// End-to-end smoke test against a running standalone deployment (local `pnpm worker:dev` or a deployed URL).
// Acts as the owner's browser (cookie + Origin) and as a connector (bearer key only, no cookies).
// Usage: node scripts/smoke.mjs [origin]   — creates a throwaway owner account.
import assert from 'node:assert/strict';
const origin=(process.argv[2]??'http://127.0.0.1:8787').replace(/\/$/,'');
let cookie='';
async function owner(path,method='GET',body){const r=await fetch(origin+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),Origin:origin,Cookie:cookie},body:body&&JSON.stringify(body)});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:r.status,headers:r.headers,body:await r.json()};}
async function agent(key,path,method='GET',body){const r=await fetch(origin+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),Authorization:'Bearer '+key},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const step=(label,ok=true)=>console.log(`${ok?'PASS':'FAIL'}  ${label}`);

assert.equal((await fetch(origin+'/api/health').then(r=>r.json())).status,'ok');step('health');
const email=`smoke-${Date.now()}@example.com`;
assert.equal((await owner('/api/auth/signup','POST',{email,password:'smoke-test-password',name:'Smoke Owner'})).status,200);step('owner sign-up + session cookie');
const issued=await owner('/api/owner/connections','POST',{agent_name:'Smoke Muse'});
assert.equal(issued.status,201);assert.equal(issued.headers.get('cache-control'),'no-store');assert.equal(typeof issued.body.expires_at,'number');step('1. connector key issued without pairing');
const key=issued.body.access_token,cid=issued.body.connection_id;
let s=(await owner('/api/owner/state')).body;assert.equal(s.connections.find(c=>c.id===cid).status,'awaiting_first_request');step('status: Awaiting first request');
assert.equal((await agent(key,'/api/v1/me')).status,200);s=(await owner('/api/owner/state')).body;assert.equal(s.connections.find(c=>c.id===cid).status,'connected');step('2. GET /api/v1/me with bearer key (no cookies) → Connected');
const tasks=(await agent(key,'/api/v1/me/tasks')).body.tasks;assert.equal(tasks[0].kind,'onboarding');
const reply={client_message_id:'smoke-1',nonce:tasks[0].nonce,text:'Smoke test reply: not sharing a profile yet.'};
assert.equal((await agent(key,`/api/v1/tasks/${tasks[0].id}/response`,'POST',reply)).status,201);
s=(await owner('/api/owner/state')).body;assert.equal(s.responses.find(r=>r.task_id===tasks[0].id).text,reply.text);step('3. initial task answered; dashboard state shows the reply');
const retry=await agent(key,`/api/v1/tasks/${tasks[0].id}/response`,'POST',reply);assert.equal(retry.body.replayed,true);
assert.equal((await agent(key,`/api/v1/tasks/${tasks[0].id}/response`,'POST',{...reply,client_message_id:'smoke-2',nonce:'wrong'})).status,422);step('6. exact retry replayed once; wrong nonce rejected');
const round=await owner('/api/owner/rounds','POST',{});assert.equal(round.status,201);
const t2=(await agent(key,'/api/v1/me/tasks')).body.tasks.find(t=>t.kind==='round');assert.ok(t2);step('room round delivered to inbox');
const mcp=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'respond_to_task',arguments:{task_id:t2.id,client_message_id:'smoke-mcp',nonce:t2.nonce,text:'Round reply via MCP.'}}})}).then(r=>r.json());
assert.equal(mcp.result.structuredContent.status,'accepted');step('MCP respond_to_task through the same key');
const rotated=await owner(`/api/owner/connections/${cid}/token`,'POST',{});assert.equal((await agent(key,'/api/v1/me')).status,401);assert.equal((await agent(rotated.body.access_token,'/api/v1/me')).status,200);step('7. replacement kills old key; new key works');
assert.equal((await owner(`/api/owner/connections/${cid}`,'DELETE')).status,200);assert.equal((await agent(rotated.body.access_token,'/api/v1/me')).status,401);step('8. revoked key fails');
const anon=await fetch(origin+'/api/owner/state');assert.equal(anon.status,401);step('9. private room data unavailable anonymously');
const spec=await fetch(origin+'/openapi.json').then(r=>r.json());assert.equal(spec.servers[0].url,origin);step('openapi.json served with live origin');
const guide=await fetch(origin+'/agent-guide.md').then(r=>r.text());assert.ok(guide.includes(origin)&&!guide.includes('{{ORIGIN}}'));step('agent guide served with live origin');
for(const p of ['/connect.html','/connect.js','/room3d.html','/room3d.js'])assert.equal((await fetch(origin+p)).status,200);step('dashboard and 3D room assets served');
console.log('\nSmoke test complete against',origin,'— this exercises HTTP only; it is not a Muse client.');
