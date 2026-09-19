import {createRequire} from 'node:module';import assert from 'node:assert/strict';import {handle} from '../lib/api.mjs';import {handleMcp} from '../lib/mcp.mjs';import {migrations} from './helpers.mjs';
const require=createRequire(import.meta.url);const wr=createRequire(require.resolve('wrangler/package.json'));const {Miniflare}=wr('miniflare');
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
try{const db=await mf.getD1Database('DB');for(const migration of migrations())await db.batch(migration.split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
const origin='https://commonroom.test',owner={id:'d1-test-owner',name:'Test Owner'};
const call=async(path,method='GET',body,token,asOwner=false)=>{const headers={'Content-Type':'application/json',Origin:origin};if(token)headers.Authorization='Bearer '+token;const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db,asOwner?owner:null);return {status:r.status,body:await r.json()};};

// Optional pairing flow still works.
const inv=(await call('/api/owner/invites','POST',{},null,true)).body;const p=(await call('/api/v1/pairings/start','POST',{invite_code:inv.invite_code,agent_name:'D1 integration client'})).body;
assert.equal((await call('/api/owner/pairings/'+p.pairing_id+'/approve','POST',{code:p.verification_code},null,true)).status,200);
const payload={pairing_id:p.pairing_id,device_secret:p.device_secret};const exchanges=await Promise.all([call('/api/v1/pairings/token','POST',payload),call('/api/v1/pairings/token','POST',payload)]);assert.deepEqual(exchanges.map(r=>r.status).sort(),[200,409]);const c=exchanges.find(r=>r.status===200).body,token=c.access_token;
assert.equal((await call('/api/v1/me/profile','PUT',{expected_revision:0,interests:['test'],working_on:'',seeking:'',sharing_confirmed:true},token)).status,200);
const task=(await call('/api/v1/me/tasks','GET',undefined,token)).body.tasks[0],answer={client_message_id:'test-d1-1',nonce:task.nonce,text:'D1 test reply'};
const replies=await Promise.all([call('/api/v1/tasks/'+task.id+'/response','POST',answer,token),call('/api/v1/tasks/'+task.id+'/response','POST',answer,token)]);assert(replies.every(r=>[200,201].includes(r.status)));
const room=(await call('/api/v1/room','GET',undefined,token)).body;assert.equal(room.messages.length,1);assert.equal(room.profiles.length,1);
assert.equal((await call('/api/owner/connections/'+c.connection_id,'DELETE',undefined,null,true)).status,200);assert.equal((await call('/api/v1/me/tasks','GET',undefined,token)).status,401);

// Primary flow: owner-issued connector key, first request, inbox check, concurrent replies, replacement, window-function state query.
const issued=await call('/api/owner/connections','POST',{agent_name:'D1 connector'},null,true);assert.equal(issued.status,201);const key=issued.body.access_token;
let s=(await call('/api/owner/state','GET',undefined,null,true)).body;assert.equal(s.connections.find(x=>x.id===issued.body.connection_id).status,'awaiting_first_request');
const firsts=await Promise.all([call('/api/v1/me','GET',undefined,key),call('/api/v1/me','GET',undefined,key)]);assert(firsts.every(r=>r.status===200));
const t2=(await call('/api/v1/me/tasks','GET',undefined,key)).body.tasks[0];const a2={client_message_id:'d1-connector-1',nonce:t2.nonce,text:'Connector reply'};
const r2=await Promise.all([1,2,3].map(()=>call('/api/v1/tasks/'+t2.id+'/response','POST',a2,key)));assert.equal(r2.filter(r=>r.status===201).length,1);assert(r2.every(r=>[200,201].includes(r.status)));
s=(await call('/api/owner/state','GET',undefined,null,true)).body;const conn=s.connections.find(x=>x.id===issued.body.connection_id);
assert.equal(conn.status,'connected');assert.ok(conn.last_inbox_at&&conn.last_reply_at);assert.equal(s.events.filter(e=>e.type==='connected'&&e.connection_id===conn.id).length,1);assert.equal(s.inbox_checks.filter(e=>e.connection_id===conn.id).length,1);
assert.equal(s.responses.filter(r=>r.task_id===t2.id).length,1);
const mcp=await handleMcp(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_room',arguments:{}}})}),db);assert.equal((await mcp.json()).result.structuredContent.messages.length,1);
const replaced=(await call('/api/owner/connections/'+conn.id+'/token','POST',{},null,true)).body.access_token;assert.equal((await call('/api/v1/me','GET',undefined,key)).status,401);assert.equal((await call('/api/v1/me','GET',undefined,replaced)).status,200);
console.log('PASS: local D1 with all migrations; optional pairing (concurrent one-time redemption); owner-issued connector key; single first-request event under concurrency; inbox checks; concurrent reply idempotency; MCP room read; key replacement; revocation. No Muse client was used.');
}finally{await mf.dispose();}
