import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {onboard,sqliteD1,origin} from './helpers.mjs';

// Regression: a fact the owner hid must stay hidden after its source is turned off and on again and the Muse re-syncs.
test('hidden facts stay hidden across turning a source off and on; their text is not kept meanwhile',async()=>{
 const h=sqliteD1(),owner={id:'hf-owner',name:'Hana'};onboard(h.sql,[owner],['google_calendar','linkedin']);
 const call=async(path,method='GET',body,token)=>{const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,token?null:owner);return {status:r.status,body:await r.json()};};
 try{
  const room=(await call('/api/owner/state')).body.room.id;
  const key=(await call('/api/owner/connections','POST',{agent_name:"Hana's Muse"})).body.access_token;
  const facts=[{category:'activity',text:'Therapy on Thursdays',source:'google_calendar'},{category:'interest',text:'Plays tennis',source:'google_calendar'},{category:'work',text:'Designs robots',source:'linkedin'}];
  const sync=()=>call('/api/v1/me/context','PUT',{facts,sharing_confirmed:true},key);
  assert.equal((await sync()).status,201);
  const therapy=(await call('/api/owner/state')).body.context.find(f=>f.text==='Therapy on Thursdays');
  assert.equal((await call('/api/owner/context/'+therapy.id,'PUT',{hidden:true})).status,200);

  // Turn Google Calendar off: visible Calendar facts are deleted; the hidden one keeps only its fingerprint.
  assert.equal((await call('/api/owner/sources','PUT',{sources:['linkedin'],authorized:true})).status,200);
  const rows=h.sql.prepare('SELECT text,hidden_at FROM muse_context WHERE source=?').all('google_calendar');
  assert.deepEqual(rows.map(r=>[r.text,!!r.hidden_at]),[['',true]]);
  assert.ok(!(await call('/api/v1/me/context','GET',undefined,key)).body.hidden.some(f=>f.text===''));

  // Turn it back on and let the Muse re-sync the same facts: therapy stays hidden, tennis comes back.
  assert.equal((await call('/api/owner/sources','PUT',{sources:['google_calendar','linkedin'],authorized:true})).status,200);
  assert.equal((await sync()).status,201);
  const shown=(await call('/api/v1/room','GET',undefined,key)).body.context.flatMap(c=>c.facts.map(f=>f.text));
  assert.ok(!shown.includes('Therapy on Thursdays'),'hidden fact must not reappear');
  assert.ok(shown.includes('Plays tennis')&&shown.includes('Designs robots'));
  assert.equal((await call('/api/owner/state?room='+room)).body.context.find(f=>f.text==='Therapy on Thursdays').hidden,true);
 }finally{h.cleanup();}
});
