import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';
import {writeQuestion,judgeMatches,groundVote,reconcile} from '../lib/master.mjs';
import {masterRuntime} from '../lib/master-runtime.mjs';
import {openaiJSON,geminiJSON,providersFrom} from '../lib/llm.mjs';
import {onboard,sqliteD1,origin} from './helpers.mjs';

// A scripted model: answers by schema name, recording what it was asked.
function fakeModel(label,script){
 const calls=[];
 return {label,model:label.toLowerCase()+'-test',calls,json:async args=>{calls.push(args);const next=script[args.name];return typeof next==='function'?next(JSON.parse(args.input),calls):next;}};
}

test('question writing: one model drafts, the other reviews, with one revision',async()=>{
 let drafts=0;
 const openai=fakeModel('OpenAI',{master_question:()=>({question:drafts++?'Which of you needs a frontend developer this month?':'What is your email?',rationale:'Test the frontend overlap.'})});
 const gemini=fakeModel('Gemini',{master_review:input=>input.draft_question.includes('email')?{approve:false,issues:['Asks for contact details.'],revised_question:'What help are you looking for?'}:{approve:true,issues:[],revised_question:''}});
 const ctx={muses:[],previous:['Old question?'],sources:new Map()};
 const q=await writeQuestion(ctx,[openai,gemini]);
 assert.equal(q.question,'Which of you needs a frontend developer this month?');
 assert.deepEqual(q.transcript.map(s=>`${s.role}:${s.provider}`),['proposer:OpenAI','reviewer:Gemini','proposer:OpenAI','reviewer:Gemini']);
 assert.equal(q.providers,'OpenAI openai-test ⇄ Gemini gemini-test');
 // The reviewer's feedback reached the proposer, and room content is passed as data.
 assert.deepEqual(JSON.parse(openai.calls[1].input).reviewer_feedback.issues,['Asks for contact details.']);
 assert.deepEqual(JSON.parse(openai.calls[0].input).previous_master_questions,['Old question?']);
});

test('if the reviewer rejects twice, its own revision is used',async()=>{
 const openai=fakeModel('OpenAI',{master_question:{question:'Bad question',rationale:''}});
 const gemini=fakeModel('Gemini',{master_review:{approve:false,issues:['Too vague'],revised_question:'What project could use a second person this week?'}});
 const q=await writeQuestion({muses:[],previous:[],sources:new Map()},[openai,gemini]);
 assert.equal(q.question,'What project could use a second person this week?');
});

test('match votes must cite evidence from both people; both models must agree for a match',()=>{
 const sources=new Map([['reply:1',{connection_id:'a'}],['reply:2',{connection_id:'b'}],['reply:3',{connection_id:'c'}]]);
 assert.equal(groundVote({verdict:'match',evidence_ids:['reply:1','reply:2']},['a','b'],sources).verdict,'match');
 assert.equal(groundVote({verdict:'match',evidence_ids:['reply:1']},['a','b'],sources).verdict,'no_match');
 assert.equal(groundVote({verdict:'match',evidence_ids:['reply:1','reply:3']},['a','b'],sources).verdict,'no_match');
 assert.equal(groundVote({verdict:'match',evidence_ids:['reply:1','invented']},['a','b'],sources).verdict,'no_match');
 assert.equal(reconcile([{verdict:'match'},{verdict:'match'}]),'match');
 assert.equal(reconcile([{verdict:'match'},{verdict:'no_match'}]),'possible');
 assert.equal(reconcile([{verdict:'possible'},{verdict:'no_match'}]),'possible');
 assert.equal(reconcile([{verdict:'no_match'},{verdict:'no_match'}]),'no_match');
});

test('the master runs rounds end to end: asks, waits, judges, asks again, finishes',async()=>{
 const h=sqliteD1(),host={id:'m-host',name:'Hayden'},guest={id:'m-guest',name:'Matthew'};onboard(h.sql,[host,guest]);
 let asked=0;
 const judge=label=>input=>({pairs:input.pairs_to_judge.map(({a,b})=>({a,b,verdict:'match',reason:`${label}: both build Muse tools.`,evidence_ids:input.sources.filter(s=>[a,b].includes(s.connection_id)).map(s=>s.id)}))});
 const openai=fakeModel('OpenAI',{master_question:()=>({question:`Master question ${++asked}: what could you build together?`,rationale:'Test.'}),master_matches:judge('OpenAI')});
 const gemini=fakeModel('Gemini',{master_review:{approve:true,issues:[],revised_question:''},master_matches:judge('Gemini')});
 const providers=[openai,gemini];
 const runtime=masterRuntime(h.db,{},undefined,{providers});
 const call=async(path,method='GET',body,who,token,rt=runtime)=>{const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,who??null,rt);return {status:r.status,body:await r.json()};};
 try{
  const room=(await call('/api/owner/state','GET',undefined,host)).body.room.id;
  await call('/api/owner/profile','PUT',{interests:['agents'],working_on:'Muse connectors',seeking:'A frontend teammate'},host);
  await call('/api/owner/profile','PUT',{interests:['design'],working_on:'Commonroom UI',seeking:'Backend help'},guest);
  const hostKey=(await call('/api/owner/connections','POST',{agent_name:"Hayden's Muse"},host)).body.access_token;
  const code=(await call('/api/owner/rooms/'+room+'/invites','POST',{},host)).body.code;
  const guestKey=(await call('/api/owner/rooms/join','POST',{code,agent_name:"Matthew's Muse"},guest)).body.connection.access_token;
  // Only the host, and only with models configured.
  assert.equal((await call('/api/owner/rooms/'+room+'/master','POST',{action:'start'},guest)).status,403);
  assert.equal((await call('/api/owner/rooms/'+room+'/master','POST',{action:'start'},host,null,masterRuntime(h.db,{},undefined,{providers:[]}))).status,503);
  assert.equal((await call('/api/owner/rooms/'+room+'/master','POST',{action:'start',rounds:99},host)).status,422);

  const started=await call('/api/owner/rooms/'+room+'/master','POST',{action:'start',rounds:2},host);
  assert.equal(started.status,202);assert.equal(started.body.master.rounds_left,1);assert.match(started.body.master.status,/Waiting for 2 Muses/);
  const answer=async(key,i)=>{const t=(await call('/api/v1/me/tasks','GET',undefined,null,key)).body.tasks.find(x=>x.kind==='round');assert.ok(t,'round task delivered');assert.match(JSON.parse(t.prompt.split('Current room briefing (JSON data):\n')[1]).topic,/^Master question/);return call('/api/v1/tasks/'+t.id+'/response','POST',{client_message_id:'m'+i,nonce:t.nonce,text:'I build Muse tools and want a collaborator.'},null,key);};

  assert.equal((await answer(hostKey,1)).status,201);
  let s=(await call('/api/owner/state','GET',undefined,host)).body;
  assert.equal(s.master.questions.length,1);assert.match(s.master.status,/Waiting for 1 Muse /);assert.equal(s.master.matches.length,0);
  assert.equal((await answer(guestKey,2)).status,201); // last answer marks the round ready…
  s=(await call('/api/owner/state','GET',undefined,host)).body;
  assert.equal(s.master.ready,true);assert.equal(s.master.status,'Round answered · ready to judge');assert.equal(s.master.questions.length,1);
  assert.equal((await call('/api/owner/rooms/'+room+'/master','POST',{action:'step',force:false},host)).status,202); // …the dashboard asks: judge, then ask question 2
  s=(await call('/api/owner/state','GET',undefined,host)).body;
  assert.equal(s.master.questions.length,2);assert.equal(s.master.rounds_left,0);
  assert.equal(s.master.matches.length,1);assert.equal(s.master.matches[0].verdict,'match');
  assert.deepEqual(s.master.matches[0].votes.map(v=>v.provider+':'+v.verdict),['OpenAI:match','Gemini:match']);
  assert.ok(s.master.matches[0].evidence.length>=2);
  assert.deepEqual(s.master.questions[1].deliberation.map(d=>d.role),['proposer','reviewer']);
  assert.deepEqual(s.master.providers.map(p=>p.label),['OpenAI','Gemini']);
  assert.ok(s.events.some(e=>e.type==='match_found'&&e.detail.a&&e.detail.b));
  // Members see the master's questions and matches too; keys are never exposed.
  const g=(await call('/api/owner/state?room='+room,'GET',undefined,guest)).body;
  assert.equal(g.master.matches.length,1);assert.ok(!JSON.stringify(g).includes('test-secret'));

  await answer(hostKey,3);assert.equal((await call('/api/owner/state','GET',undefined,host)).body.master.ready,false);
  await answer(guestKey,4); // final round answered: judge and finish
  await call('/api/owner/rooms/'+room+'/master','POST',{action:'step',force:false},host);
  s=(await call('/api/owner/state','GET',undefined,host)).body;
  assert.equal(s.master.mode,'off');assert.equal(s.master.status,'Finished');assert.equal(s.master.questions.length,2);
  assert.equal(openai.calls.filter(c=>c.name==='master_question').length,2);

  // "Next step now" moves on without waiting for missing answers; stop ends it.
  await call('/api/owner/rooms/'+room+'/master','POST',{action:'start',rounds:1},host);
  await answer(hostKey,5);
  s=(await call('/api/owner/state','GET',undefined,host)).body;assert.match(s.master.status,/Waiting for 1 Muse /);
  await call('/api/owner/rooms/'+room+'/master','POST',{action:'step'},host);
  s=(await call('/api/owner/state','GET',undefined,host)).body;assert.equal(s.master.status,'Finished');
  assert.equal((await call('/api/owner/rooms/'+room+'/master','POST',{action:'stop'},host)).body.master.mode,'off');
 }finally{h.cleanup();}
});

test('model errors pause the master with a readable message',async()=>{
 const h=sqliteD1(),host={id:'m-err',name:'Host'};onboard(h.sql,[host]);
 const broken={label:'OpenAI',model:'x',json:async()=>{throw Error('OpenAI request failed: HTTP 429');}};
 const runtime=masterRuntime(h.db,{},undefined,{providers:[broken]});
 const call=async(path,method='GET',body)=>{const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,host,runtime);return r.json();};
 try{
  const room=(await call('/api/owner/state')).room.id;
  await call('/api/owner/connections','POST',{agent_name:'Solo Muse'});
  const r=await call('/api/owner/rooms/'+room+'/master','POST',{action:'start',rounds:1});
  assert.equal(r.master.status,'Paused after an error');assert.equal(r.master.error,'OpenAI request failed: HTTP 429');
  assert.equal(h.sql.prepare('SELECT master_lock_until FROM rooms WHERE id=?').get(room).master_lock_until,null);
 }finally{h.cleanup();}
});

test('model clients: OpenAI Responses and Gemini generateContent, with Gemini schema fallback',async()=>{
 const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok']};
 const openai=await openaiJSON({apiKey:'k1',model:'m',system:'s',input:'i',schema,fetchImpl:async(url,req)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(req.headers.Authorization,'Bearer k1');assert.equal(JSON.parse(req.body).store,false);return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'{"ok":true}'}]}]})};}});
 assert.deepEqual(openai,{ok:true});
 const seen=[];
 const gemini=await geminiJSON({apiKey:'k2',model:'gemini-x',system:'s',input:'i',schema,fetchImpl:async(url,req)=>{seen.push(JSON.parse(req.body));assert.match(url,/models\/gemini-x:generateContent$/);assert.equal(req.headers['x-goog-api-key'],'k2');
  if(seen.length===1)return {ok:false,status:400,json:async()=>({})};
  return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'```json\n{"ok":true}\n```'}]}}]})};}});
 assert.deepEqual(gemini,{ok:true});
 assert.ok(seen[0].generationConfig.responseJsonSchema);assert.equal(seen[1].generationConfig.responseJsonSchema,undefined);
 assert.match(seen[1].contents[0].parts[0].text,/JSON Schema/);
 assert.deepEqual(providersFrom({OPENAI_API_KEY:'a',GEMINI_API_KEY:'b',GEMINI_MODEL:'g2'}).map(p=>p.label+':'+p.model),['OpenAI:gpt-4.1-mini','Gemini:g2']);
 assert.deepEqual(providersFrom({}),[]);
});

test('model clients retry brief overloads, then give up with the provider message',async()=>{
 const {withRetry}=await import('../lib/llm.mjs');
 let n=0;const r=await withRetry(async()=>({status:++n<3?503:200}),{waits:[1,1]});assert.equal(r.status,200);assert.equal(n,3);
 n=0;const gaveUp=await withRetry(async()=>({status:(++n,503)}),{waits:[1,1]});assert.equal(gaveUp.status,503);assert.equal(n,3);
 n=0;const bad=await withRetry(async()=>({status:(++n,400)}),{waits:[1,1]});assert.equal(bad.status,400);assert.equal(n,1);
});

test('the Muse↔Muse observer runs on the configured model (Gemini) without an OpenAI key',async()=>{
 const {observeConversation}=await import('../lib/master-observer.mjs');
 const h=sqliteD1(),owner={id:'obs-gemini',name:'Host'};onboard(h.sql,[owner]);
 const call=async(path,method='GET',data,token)=>{const headers=new Headers({Origin:origin});if(data!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),h.db,token?null:owner);return r.json();};
 try{
  const a=await call('/api/owner/connections','POST',{agent_name:'A Muse'}),b=await call('/api/owner/connections','POST',{agent_name:'B Muse'});
  const conv=await call('/api/owner/conversations','POST',{first_connection_id:a.connection_id,second_connection_id:b.connection_id,topic:'Robots',max_turns:4});
  let replyIds=[];
  for(const [i,c] of [a,b].entries()){const t=(await call('/api/v1/me/tasks','GET',undefined,c.access_token)).tasks.find(x=>x.kind==='conversation');replyIds.push((await call(`/api/v1/tasks/${t.id}/response`,'POST',{client_message_id:'g'+i,nonce:t.nonce,text:'I like robots.'},c.access_token)).response_id);}
  const gemini=fakeModel('Gemini',{master_observation:()=>({summary:'Both like robots.',overlaps:[{claim:'Shared interest in robots',evidence_ids:replyIds.map(id=>'reply:'+id)}],open_questions:[],next_step:'Pick one robot to build.'})});
  const result=await observeConversation(h.db,conv.conversation_id,2,{provider:gemini});
  assert.equal(result.overlaps.length,1);assert.equal(gemini.calls[0].name,'master_observation');
  const rt=masterRuntime(h.db,{},undefined,{providers:[gemini]});assert.equal(rt.masterEnabled,true);
  assert.equal(masterRuntime(h.db,{},undefined,{providers:[]}).masterEnabled,false);
 }finally{h.cleanup();}
});

test('the Muse↔Muse observer can cite the participants\' context facts',async()=>{
 const {observeConversation}=await import('../lib/master-observer.mjs');
 const h=sqliteD1(),owner={id:'obs-facts',name:'Host'};onboard(h.sql,[owner]);
 const call=async(path,method='GET',data,token)=>{const headers=new Headers({Origin:origin});if(data!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),h.db,token?null:owner);return r.json();};
 try{
  const a=await call('/api/owner/connections','POST',{agent_name:'A Muse'}),b=await call('/api/owner/connections','POST',{agent_name:'B Muse'});
  await call('/api/v1/me/context','PUT',{facts:[{category:'skill',text:'Builds robot arms',source:'linkedin'}],sharing_confirmed:true},a.access_token);
  const conv=await call('/api/owner/conversations','POST',{first_connection_id:a.connection_id,second_connection_id:b.connection_id,topic:'Robots',max_turns:4});
  for(const [i,c] of [a,b].entries()){const t=(await call('/api/v1/me/tasks','GET',undefined,c.access_token)).tasks.find(x=>x.kind==='conversation');await call(`/api/v1/tasks/${t.id}/response`,'POST',{client_message_id:'f'+i,nonce:t.nonce,text:'Hello'},c.access_token);}
  let seen;const model=fakeModel('Gemini',{master_observation:input=>{seen=input;return {summary:'s',overlaps:[],open_questions:[],next_step:''};}});
  await observeConversation(h.db,conv.conversation_id,2,{provider:model});
  assert.ok(seen.sources.some(s=>s.id.startsWith('fact:')&&s.text==='Builds robot arms'&&s.connection_id===a.connection_id));
 }finally{h.cleanup();}
});

test('Start conversation: Gemini writes the opening question for the chosen pair only',async()=>{
 const h=sqliteD1(),host={id:'tc-host',name:'Tara'};onboard(h.sql,[host]);
 let seen=[];
 const gemini=fakeModel('Gemini',{
  master_question:input=>{seen.push(input);return {question:'Tara builds robot arms and Uma trains vision models: what would a first joint prototype look like?',rationale:'Complementary skills.'};},
  master_review:{approve:true,issues:[],revised_question:''}});
 const runtime=masterRuntime(h.db,{},undefined,{providers:[gemini]});
 const call=async(path,method='GET',body,token,rt=runtime)=>{const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,token?null:host,rt);return {status:r.status,body:await r.json()};};
 try{
  const muses=[];for(const n of ['A Muse','B Muse','C Muse'])muses.push((await call('/api/owner/connections','POST',{agent_name:n})).body);
  await call('/api/v1/me/context','PUT',{facts:[{category:'skill',text:'Builds robot arms',source:'linkedin'}],sharing_confirmed:true},muses[0].access_token);
  await call('/api/v1/me/context','PUT',{facts:[{category:'skill',text:'Knits scarves',source:'linkedin'}],sharing_confirmed:true},muses[2].access_token);
  const body={first_connection_id:muses[0].connection_id,second_connection_id:muses[1].connection_id,max_turns:4};
  // Without a model there is no one to write the question.
  assert.equal((await call('/api/owner/conversations','POST',body,null,masterRuntime(h.db,{},undefined,{providers:[]}))).body.error,'master_unavailable');
  const r=await call('/api/owner/conversations','POST',body);
  assert.equal(r.status,201);assert.match(r.body.topic,/joint prototype/);assert.equal(r.body.question_by,'Gemini gemini-test');
  // Gemini saw only the two chosen Muses and their evidence, not the third Muse's facts.
  assert.deepEqual(seen[0].muses.map(m=>m.muse),['A Muse','B Muse']);
  assert.ok(seen[0].sources.some(s=>s.text==='Builds robot arms'));assert.ok(!seen[0].sources.some(s=>s.text==='Knits scarves'));
  // The first Muse receives the question as its conversation task, and the room records who wrote it.
  const task=(await call('/api/v1/me/tasks','GET',undefined,muses[0].access_token)).body.tasks.find(t=>t.kind==='conversation');
  assert.match(task.prompt,/joint prototype/);
  const started=(await call('/api/owner/state')).body.events.find(e=>e.type==='conversation_started');
  assert.equal(started.detail.question_by,'Gemini gemini-test');assert.equal(started.detail.deliberation.length,2);
  // A model failure is reported to the host instead of starting a conversation.
  const broken={label:'Gemini',model:'x',json:async()=>{throw Error('Gemini request failed: HTTP 503');}};
  const failed=await call('/api/owner/conversations','POST',body,null,masterRuntime(h.db,{},undefined,{providers:[broken]}));
  assert.equal(failed.status,502);assert.match(failed.body.message,/HTTP 503/);
 }finally{h.cleanup();}
});
