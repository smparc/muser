import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';
import {onboard,sqliteD1,origin} from './helpers.mjs';

test('two Muses alternate replies in one room and stop at the turn limit',async()=>{
 const h=sqliteD1(),owner={id:'conversation-owner',name:'Host'};onboard(h.sql,[owner]);
 const observed=[];
 async function call(path,method='GET',data,token,asOwner=owner){
  const headers=new Headers();if(data!==undefined)headers.set('Content-Type','application/json');
  if(path.startsWith('/api/owner/'))headers.set('Origin',origin);
  if(token)headers.set('Authorization','Bearer '+token);
  const response=await handle(new Request(origin+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),h.db,path.startsWith('/api/owner/')?asOwner:null,{onObserve:(id,turn)=>observed.push([id,turn])});
  return {status:response.status,body:await response.json()};
 }
 try{
  const a=(await call('/api/owner/connections','POST',{agent_name:'Muse A'})).body;
  const b=(await call('/api/owner/connections','POST',{agent_name:'Muse B'})).body;
  assert.equal((await call('/api/owner/conversations','POST',{first_connection_id:a.connection_id,second_connection_id:a.connection_id,topic:'test'})).status,422);
  const start=await call('/api/owner/conversations','POST',{first_connection_id:a.connection_id,second_connection_id:b.connection_id,topic:'Shared projects',max_turns:4});
  assert.equal(start.status,201);
  for(let turn=0;turn<4;turn++){
   const speaker=turn%2===0?a:b,listener=turn%2===0?b:a;
   const tasks=(await call('/api/v1/me/tasks','GET',undefined,speaker.access_token)).body.tasks.filter(t=>t.kind==='conversation');
   assert.equal(tasks.length,1);
   const t=tasks[0];
   if(turn)assert.match(t.prompt,new RegExp(`Message ${turn-1}`));
   const reply={client_message_id:`conversation-${turn}`,nonce:t.nonce,text:`Message ${turn}`};
   assert.equal((await call(`/api/v1/tasks/${t.id}/response`,'POST',reply,speaker.access_token)).status,201);
   assert.equal((await call(`/api/v1/tasks/${t.id}/response`,'POST',reply,speaker.access_token)).body.replayed,true);
   const waiting=(await call('/api/v1/me/tasks','GET',undefined,listener.access_token)).body.tasks.filter(x=>x.kind==='conversation');
   assert.equal(waiting.length,turn<3?1:0);
  }
  const state=(await call('/api/owner/state')).body;
  assert.equal(state.conversations[0].turn_count,4);
  assert.equal(state.conversations[0].status,'completed');
  assert.equal(state.responses.filter(r=>r.text.startsWith('Message ')).length,4);
  assert.deepEqual(observed.map(x=>x[1]),[2,4]);
 }finally{h.cleanup();}
});
