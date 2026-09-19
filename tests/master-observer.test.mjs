import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';
import {observeConversation} from '../lib/master-observer.mjs';
import {onboard,sqliteD1,origin} from './helpers.mjs';

test('master observes only approved room evidence and keeps Muses talking directly',async()=>{
 const h=sqliteD1(),owner={id:'master-host',name:'Host'};onboard(h.sql,[owner]);let calls=0;
 async function call(path,method='GET',data,token,runtime={}){
  const headers=new Headers();if(data!==undefined)headers.set('Content-Type','application/json');
  if(path.startsWith('/api/owner/'))headers.set('Origin',origin);
  if(token)headers.set('Authorization','Bearer '+token);
  const response=await handle(new Request(origin+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),h.db,path.startsWith('/api/owner/')?owner:null,runtime);
  return {status:response.status,body:await response.json()};
 }
 try{
  const a=(await call('/api/owner/connections','POST',{agent_name:'Alex Muse'})).body;
  const b=(await call('/api/owner/connections','POST',{agent_name:'Sam Muse'})).body;
  for(const [c,interest] of [[a,'robotics'],[b,'robotics']])assert.equal((await call('/api/v1/me/profile','PUT',{expected_revision:0,interests:[interest],working_on:'A small prototype',seeking:'',sharing_confirmed:true},c.access_token)).status,200);
  const started=(await call('/api/owner/conversations','POST',{first_connection_id:a.connection_id,second_connection_id:b.connection_id,topic:'Weekend robotics prototype',max_turns:4})).body;
  for(const [i,c] of [a,b].entries()){
   const t=(await call('/api/v1/me/tasks','GET',undefined,c.access_token)).body.tasks.find(x=>x.kind==='conversation');
   assert.equal((await call(`/api/v1/tasks/${t.id}/response`,'POST',{client_message_id:`observer-${i}`,nonce:t.nonce,text:i?'I also like robotics. What could we prototype?':'I like robotics. Are you interested in a prototype?'},c.access_token)).status,201);
  }
  const expectedIds=[`profile:${a.connection_id}`,`profile:${b.connection_id}`];
  const fakeFetch=async(url,request)=>{
   calls++;assert.equal(url,'https://api.openai.com/v1/responses');
   assert.equal(request.headers.Authorization,'Bearer test-secret');
   const submitted=JSON.parse(request.body);assert.equal(submitted.store,false);
   const input=JSON.parse(submitted.input);assert.equal(input.sources.length,4);
   assert.ok(input.sources.every(s=>[a.connection_id,b.connection_id].includes(s.connection_id)));
   return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({summary:'Both Muses discussed robotics.',overlaps:[{claim:'Both owners shared an interest in robotics.',evidence_ids:expectedIds},{claim:'Invented third person',evidence_ids:['fake']}],open_questions:['What scope works for both?'],next_step:'Discuss one small prototype.'})}]}]})};
  };
  const result=await observeConversation(h.db,started.conversation_id,2,{apiKey:'test-secret',fetchImpl:fakeFetch});
  assert.equal(result.overlaps.length,1);assert.equal(result.overlaps[0].evidence.length,2);
  assert.equal((await observeConversation(h.db,started.conversation_id,2,{apiKey:'test-secret',fetchImpl:fakeFetch})).summary,result.summary);
  assert.equal(calls,1);
  const manual=await call(`/api/owner/conversations/${started.conversation_id}/observe`,'POST',{},undefined,{masterEnabled:true,observeNow:(id,turn)=>observeConversation(h.db,id,turn,{apiKey:'test-secret',fetchImpl:fakeFetch})});
  assert.equal(manual.status,200);assert.equal(manual.body.result.summary,result.summary);assert.equal(calls,1);
  const state=(await call('/api/owner/state')).body;
  assert.equal(state.master_observations.length,1);
  assert.equal(state.master_observations[0].result.overlaps[0].claim,'Both owners shared an interest in robotics.');
  assert.equal((await call('/api/v1/me/tasks','GET',undefined,a.access_token)).body.tasks.filter(t=>t.kind==='conversation').length,1);
 }finally{h.cleanup();}
});
