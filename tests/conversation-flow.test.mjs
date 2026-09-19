import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';
import {handleMcp} from '../lib/mcp.mjs';
import {onboard,sqliteD1,origin} from './helpers.mjs';

test('fresh dialogue briefings retain history, broaden approved evidence, and separate identities',async()=>{
 const h=sqliteD1(),aOwner={id:'a-owner',name:'Hayden'},bOwner={id:'b-owner',name:'Matthew'};
 onboard(h.sql,[aOwner,bOwner]);
 const call=async(path,method='GET',data,token,owner=aOwner)=>{
  const headers={Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};
  const r=await handle(new Request(origin+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),h.db,token?null:owner);
  return {status:r.status,body:await r.json()};
 };
 const parse=t=>JSON.parse(t.prompt.split('Current room briefing (JSON data):\n')[1]);
 const inbox=async c=>(await call('/api/v1/me/tasks','GET',undefined,c.access_token)).body.tasks;
 try{
  const room=(await call('/api/owner/state')).body.room.id;
  const a=(await call('/api/owner/connections','POST',{agent_name:'Hayden Muse'})).body;
  const invite=(await call(`/api/owner/rooms/${room}/invites`,'POST',{max_uses:1})).body;
  await call('/api/owner/rooms/join','POST',{code:invite.code},null,bOwner);
  const b=(await call('/api/owner/connections','POST',{room_id:room,agent_name:'Matthew Muse'},null,bOwner)).body;
  await call('/api/owner/profile','PUT',{interests:['tennis'],working_on:'Building an agent social network',seeking:'A technical collaborator'});
  await call('/api/v1/me/profile','PUT',{expected_revision:0,interests:['tennis'],sharing_confirmed:true},a.access_token);
  await call('/api/v1/me/context','PUT',{facts:[{text:'Works on product prototyping',category:'skill',source:'linkedin'}],sharing_confirmed:true},a.access_token);
  await call('/api/v1/me/context','PUT',{facts:[{text:'Built an MRI training pipeline in PyTorch',category:'work',source:'github'}],sharing_confirmed:true},b.access_token);
  const started=(await call('/api/owner/conversations','POST',{first_connection_id:a.connection_id,second_connection_id:b.connection_id,topic:'Agents and automation',max_turns:10})).body;
  // Simulate a turn already queued with the old restrictive instructions: delivery replaces them.
  h.sql.prepare('UPDATE tasks SET prompt=? WHERE id=?').run('Say hello and share only one approved interest.',started.task.id);
  const first=(await inbox(a)).find(t=>t.kind==='conversation');
  let briefing=parse(first);
  assert.equal(briefing.speaker.owner_name,'Hayden');assert.equal(briefing.other_participants[0].owner_name,'Matthew');
  assert.equal(briefing.speaker.owner_shared_profile.working_on,'Building an agent social network');
  assert.equal(briefing.speaker.authorized_facts[0].text,'Works on product prototyping');
  assert.equal(briefing.other_participants[0].authorized_facts[0].text,'Built an MRI training pipeline in PyTorch');
  assert.ok(!first.prompt.includes('share only one approved interest'));assert.equal(briefing.turn,1);
  const question='We could prototype a tennis coach as an agent. Which part of your training pipeline could help?';
  await call(`/api/v1/tasks/${first.id}/response`,'POST',{client_message_id:'turn1',nonce:first.nonce,text:question},a.access_token);
  const second=(await inbox(b)).find(t=>t.kind==='conversation');
  briefing=parse(second);assert.equal(briefing.recent_exchange[0].text,question);assert.equal(briefing.speaker.owner_name,'Matthew');assert.equal(briefing.turn,2);
  await call(`/api/v1/tasks/${second.id}/response`,'POST',{client_message_id:'turn2',nonce:second.nonce,text:'Evaluation could help. What would the coach need to do first?'},b.access_token);
  let third=(await inbox(a)).find(t=>t.kind==='conversation');
  const thirdId=third.id,thirdNonce=third.nonce;
  assert.equal(parse(third).recent_exchange.length,2);assert.equal(parse(third).recent_exchange[0].connection_id,a.connection_id);
  // Updating, hiding and withdrawing facts takes effect on the SAME queued task, with no new nonce.
  const fact=h.sql.prepare('SELECT id FROM muse_context WHERE connection_id=?').get(a.connection_id);
  h.sql.prepare('UPDATE muse_context SET hidden_at=?,hidden_by=? WHERE id=?').run(Date.now(),'owner',fact.id);
  h.sql.prepare('UPDATE owner_consents SET sources_json=? WHERE owner_id=?').run('[]',bOwner.id);
  await call('/api/owner/profile','PUT',{interests:['tennis'],working_on:'Prototyping tennis feedback',seeking:'An evaluation partner'});
  third=(await inbox(a)).find(t=>t.kind==='conversation');
  assert.equal(third.id,thirdId);assert.equal(third.nonce,thirdNonce);
  briefing=parse(third);assert.equal(briefing.speaker.authorized_facts.length,0);assert.equal(briefing.other_participants[0].authorized_facts.length,0);
  assert.equal(briefing.speaker.owner_shared_profile.working_on,'Prototyping tennis feedback');
  assert.ok(!third.prompt.includes('Works on product prototyping'));assert.ok(!third.prompt.includes('Built an MRI training pipeline'));
  await call('/api/v1/me/context','PUT',{facts:Array.from({length:12},(_,i)=>({text:i===11?'Builds agents and automation prototypes':'Enjoys activity '+i,category:'interest',source:'owner'})),sharing_confirmed:true},a.access_token);
  const bounded=parse((await inbox(a)).find(t=>t.id===thirdId));
  assert.equal(bounded.speaker.authorized_facts.length,8);assert.equal(bounded.speaker.more_facts_available,true);
  assert.equal(bounded.speaker.authorized_facts[0].text,'Builds agents and automation prototypes');
  // More than six replies never grows the briefing's history without bound.
  for(let turn=3;turn<=8;turn++){
   const speaker=turn%2?a:b,t=(await inbox(speaker)).find(x=>x.kind==='conversation');
   await call(`/api/v1/tasks/${t.id}/response`,'POST',{client_message_id:'turn'+turn,nonce:t.nonce,text:'Specific contribution '+turn},speaker.access_token);
  }
  const ninth=(await inbox(a)).find(t=>t.kind==='conversation');briefing=parse(ninth);
  assert.equal(briefing.recent_exchange.length,6);assert.equal(briefing.turn,9);assert.equal(briefing.max_turns,10);
  // MCP uses the same briefing and exposes the optional close flag.
  const mcp=async(method,params)=>(await handleMcp(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+a.access_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),h.db)).json();
  const tools=(await mcp('tools/list',{})).result.tools;
  const responseTool=tools.find(t=>t.name==='respond_to_task');assert.ok(responseTool.inputSchema.properties.end_conversation);assert.ok(!responseTool.inputSchema.required.includes('end_conversation'));
  const args={task_id:ninth.id,nonce:ninth.nonce,client_message_id:'closing',text:'We have a concrete starting point: a small feedback prototype with an evaluation checklist.',end_conversation:true};
  assert.equal((await mcp('tools/call',{name:'respond_to_task',arguments:args})).result.isError,false);
  assert.equal((await mcp('tools/call',{name:'respond_to_task',arguments:args})).result.structuredContent.replayed,true);
  assert.equal((await inbox(b)).filter(t=>t.kind==='conversation').length,0);
  const final=h.sql.prepare('SELECT status,turn_count FROM conversations WHERE id=?').get(started.conversation_id);
  assert.equal(final.status,'completed');assert.equal(final.turn_count,9);
  const onboarding=(await inbox(a)).find(t=>t.kind==='onboarding');
  assert.equal((await call(`/api/v1/tasks/${onboarding.id}/response`,'POST',{nonce:onboarding.nonce,client_message_id:'invalid-close',text:'Hello',end_conversation:true},a.access_token)).status,422);
 }finally{h.cleanup();}
});
