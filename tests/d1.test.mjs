import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import {handle} from '../lib/api.mjs';
const require=createRequire(import.meta.url);const wr=createRequire(require.resolve('wrangler/package.json'));const {Miniflare}=wr('miniflare');
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
try{const db=await mf.getD1Database('DB');const migration=readFileSync(new URL('../drizzle/0000_needy_deathbird.sql',import.meta.url),'utf8');await db.batch(migration.split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
const origin='https://commonroom.test',owner={id:'d1-test-owner',name:'Test Owner'};
const call=async(path,method='GET',body,token,asOwner=false)=>{const headers={'Content-Type':'application/json',Origin:origin};if(token)headers.Authorization='Bearer '+token;const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db,asOwner?owner:null);return {status:r.status,body:await r.json()};};
const inv=(await call('/api/owner/invites','POST',{},null,true)).body;const p=(await call('/api/v1/pairings/start','POST',{invite_code:inv.invite_code,agent_name:'D1 integration client'})).body;
assert.equal((await call('/api/owner/pairings/'+p.pairing_id+'/approve','POST',{code:p.verification_code},null,true)).status,200);
const payload={pairing_id:p.pairing_id,device_secret:p.device_secret};const exchanges=await Promise.all([call('/api/v1/pairings/token','POST',payload),call('/api/v1/pairings/token','POST',payload)]);assert.deepEqual(exchanges.map(r=>r.status).sort(),[200,409]);const c=exchanges.find(r=>r.status===200).body,token=c.access_token;
assert.equal((await call('/api/v1/me/profile','PUT',{expected_revision:0,interests:['test'],working_on:'',seeking:'',sharing_confirmed:true},token)).status,200);
const task=(await call('/api/v1/me/tasks','GET',undefined,token)).body.tasks[0],answer={client_message_id:'test-d1-1',nonce:task.nonce,text:'D1 test reply'};
const replies=await Promise.all([call('/api/v1/tasks/'+task.id+'/response','POST',answer,token),call('/api/v1/tasks/'+task.id+'/response','POST',answer,token)]);assert(replies.every(r=>[200,201].includes(r.status)));
const room=(await call('/api/v1/room','GET',undefined,token)).body;assert.equal(room.messages.length,1);assert.equal(room.profiles.length,1);
assert.equal((await call('/api/owner/connections/'+c.connection_id,'DELETE',undefined,null,true)).status,200);assert.equal((await call('/api/v1/me/tasks','GET',undefined,token)).status,401);
console.log('PASS: actual local D1 migration, owner-approved pairing, concurrent one-time redemption, profile storage, concurrent reply idempotency, room reads, revocation. No Muse client was used.');
}finally{await mf.dispose();}
