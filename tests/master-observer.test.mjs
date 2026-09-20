import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';
import {observeConversation,groundedObservation} from '../lib/master-observer.mjs';
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
  const scheduled=[];
  for(const [i,c] of [a,b].entries()){
   const t=(await call('/api/v1/me/tasks','GET',undefined,c.access_token)).body.tasks.find(x=>x.kind==='conversation');
   assert.equal((await call(`/api/v1/tasks/${t.id}/response`,'POST',{client_message_id:`final-${i}`,nonce:t.nonce,text:'Comparing robot sensor notes would be a useful first step.'},c.access_token,{onObserve:(...args)=>scheduled.push(args)})).status,201);
  }
  assert.equal(scheduled.at(-1)[1],4);
  const final=await observeConversation(h.db,started.conversation_id,4,{provider:{json:async request=>{
   const input=JSON.parse(request.input);assert.equal(input.status,'completed');assert.equal(input.participants.length,2);assert.equal(input.participants[0].owner_name,'Host');
   return {summary:'Both owners are exploring robotics.',overlaps:[{claim:'A shared robotics interest',evidence_ids:expectedIds}],action_items:[{action:'Exchange one page of sensor notes and choose a prototype to compare.',why:'Both discussed robotics prototypes.',participant_ids:[a.connection_id,b.connection_id],evidence_ids:expectedIds}]};
  }}});
  assert.equal(final.final,true);assert.equal(final.action_items.length,1);assert.equal(final.action_items[0].owners.length,2);
  const cached=await observeConversation(h.db,started.conversation_id,4,{provider:{json:()=>{throw Error('Should reuse the final review');}}});assert.deepEqual(cached,final);
 }finally{h.cleanup();}
});

test('owner actions require completed conversation, known owners and evidence from both Muses',()=>{
 const sources=new Map([['a',{connection_id:'a'}],['b',{connection_id:'b'}]]),participants=[{connection_id:'a',owner_name:'Alex'},{connection_id:'b',owner_name:'Sam'}];
 const action={action:'Compare notes.',why:'Shared project interests.',participant_ids:['a','b'],evidence_ids:['a','b']};
 const raw={overlaps:[{claim:'Shared interests',evidence_ids:['a','b']}],action_items:[action,{...action,participant_ids:['outsider']},{...action,evidence_ids:['a','invented']}]};
 assert.equal(groundedObservation(raw,sources,{participants}).action_items.length,0);
 assert.equal(groundedObservation(raw,sources,{completed:true,participants}).action_items.length,1);
 assert.equal(groundedObservation({...raw,overlaps:[]},sources,{completed:true,participants}).action_items.length,0);
});
