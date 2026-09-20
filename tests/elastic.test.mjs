import test from 'node:test';import assert from 'node:assert/strict';
import {elasticFrom,MAPPING} from '../lib/elastic.mjs';
import {syncEvidence,focusSources,focusPair,judgeMatches,writeQuestion} from '../lib/master.mjs';

const env={ELASTIC_URL:'https://es.example.com/',ELASTIC_API_KEY:'test-key'};
// Records every call and answers with whatever the test queued.
function fakeElastic(handler){const calls=[];const fetchImpl=async(url,init)=>{calls.push({url,init,body:init.body,json:init.headers['Content-Type']==='application/json'&&init.body?JSON.parse(init.body):null});return handler(url,init,calls.length);};return {calls,client:elasticFrom(env,{fetchImpl})};}
const okJson=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
const hits=ids=>okJson({hits:{hits:ids.map((id,i)=>({_id:id,_score:1/(i+1),_source:{connection_id:id.split('|')[1]??'a',kind:'fact',text:'t'}}))}});

const source=(id,connection_id,text,kind='fact the Muse gathered from LinkedIn (work)')=>({id,connection_id,kind,text});
const ctx=()=>({agents:[{id:'a'},{id:'b'}],muses:[{connection_id:'a',muse:'A Muse',represents:'Ana'},{connection_id:'b',muse:'B Muse',represents:'Ben'}],previous:['What are you building?'],pairs:[['a','b']],
 sources:new Map([
  ['fact:1|a',source('fact:1|a','a','Looking for a backend co-founder')],
  ['fact:2|a',source('fact:2|a','a','Designs climbing apps')],
  ['fact:3|b',source('fact:3|b','b','TypeScript, Postgres, Expo')],
  ['person:b',{id:'person:b',connection_id:'b',kind:'profile the person wrote',text:'Ben, backend engineer'}],
 ])});

test('no deployment configured means no client, and the master behaves exactly as before',async()=>{
 assert.equal(elasticFrom({}),null);
 assert.equal(elasticFrom({ELASTIC_URL:'https://es.example.com'}),null);
 const c=ctx();
 assert.equal(await syncEvidence(null,'room_1',c),0);
 assert.deepEqual((await focusSources(null,'room_1',c,'anything')).length,4); // everything, unnarrowed
 assert.equal(await focusPair(null,'room_1',c,['a','b']),null);
});

test('sync upserts every evidence item by its citation id and removes what is gone',async()=>{
 const {calls,client}=fakeElastic((url)=>url.includes('_bulk')?okJson({errors:false,items:[]}):okJson({deleted:2}));
 const c=ctx();
 assert.equal(await syncEvidence(client,'room_1',c),4);
 const bulk=calls.find(x=>x.url.includes('_bulk'));
 assert.equal(bulk.init.headers['Content-Type'],'application/x-ndjson');
 assert.equal(bulk.init.headers.Authorization,'ApiKey test-key');
 const lines=bulk.body.trim().split('\n').map(l=>JSON.parse(l));
 assert.deepEqual(lines.filter((_,i)=>i%2===0).map(l=>l.index._id),['fact:1|a','fact:2|a','fact:3|b','person:b']);
 assert.equal(lines[1].room_id,'room_1');assert.equal(lines[1].text,'Looking for a backend co-founder');
 // Everything not just sent, in this room only, is deleted.
 const del=calls.find(x=>x.url.includes('_delete_by_query'));
 assert.deepEqual(del.json.query.bool.filter,[{term:{room_id:'room_1'}}]);
 assert.deepEqual(del.json.query.bool.must_not[0].ids.values,['fact:1|a','fact:2|a','fact:3|b','person:b']);
});

test('search is hybrid (BM25 + semantic via RRF) and always scoped to the room',async()=>{
 const {calls,client}=fakeElastic(()=>hits(['fact:3|b']));
 const out=await client.search('room_1','backend co-founder',{size:3,connectionIds:['b']});
 assert.deepEqual(out.map(h=>h.id),['fact:3|b']);
 const q=calls[0].json,[bm25,semantic]=q.retriever.rrf.retrievers;
 assert.ok(bm25.standard.query.bool.must.match.text);
 assert.equal(semantic.standard.query.bool.must.semantic.field,'semantic');
 for(const r of [bm25,semantic]){
  assert.deepEqual(r.standard.query.bool.filter[0],{term:{room_id:'room_1'}});
  assert.deepEqual(r.standard.query.bool.filter[1],{terms:{connection_id:['b']}});
 }
 assert.equal(q.size,3);
 assert.ok(MAPPING.mappings.properties.semantic.type==='semantic_text');
});

test('focusSources narrows the evidence but keeps every Muse represented',async()=>{
 // One search per Muse, each filtered to that Muse.
 const perMuse={a:['fact:1|a'],b:['fact:3|b']};
 const {client,calls}=fakeElastic((url,init)=>hits(perMuse[JSON.parse(init.body).retriever.rrf.retrievers[0].standard.query.bool.filter[1].terms.connection_id[0]]));
 const focused=await focusSources(client,'room_1',ctx(),'who can help whom');
 assert.deepEqual(focused.map(s=>s.id).sort(),['fact:1|a','fact:3|b']);
 assert.ok(focused.every(s=>typeof s.score==='number')); // scores kept for "why this was chosen"
 assert.equal(calls.length,2);
});

test('a failing or empty Elastic falls back to the full evidence set',async()=>{
 const broken=fakeElastic(()=>new Response('nope',{status:503})).client;
 assert.equal((await focusSources(broken,'room_1',ctx(),'anything')).length,4);
 assert.equal(await syncEvidence(broken,'room_1',ctx()),0);
 assert.equal(await focusPair(broken,'room_1',ctx(),['a','b']),null);
 const empty=fakeElastic(()=>hits([])).client;
 assert.equal((await focusSources(empty,'room_1',ctx(),'anything')).length,4);
});

test('a pair is judged on what each side retrieves from the other',async()=>{
 // Ana's words retrieve Ben's stack; Ben's words retrieve Ana's ask.
 const {client,calls}=fakeElastic((url,init)=>{
  const q=JSON.parse(init.body).retriever.rrf.retrievers[0].standard.query.bool;
  return hits(q.filter[1].terms.connection_id[0]==='b'?['fact:3|b']:['fact:1|a']);
 });
 const judge={label:'Gemini',model:'test',json:async({input})=>{judge.input=JSON.parse(input);return {pairs:[{a:'a',b:'b',verdict:'match',reason:'Ben builds what Ana needs.',evidence_ids:['fact:1|a','fact:3|b']}]};}};
 const [result]=await judgeMatches(ctx(),[judge],{elastic:client,roomId:'room_1'});
 assert.equal(result.verdict,'match');
 assert.deepEqual(result.evidence.map(e=>e.id).sort(),['fact:1|a','fact:3|b']);
 assert.equal(calls.length,2); // one search per direction
 // The judge is told which evidence was retrieved for that pair, and sees the narrowed set.
 assert.deepEqual(judge.input.pairs_to_judge[0].retrieved_evidence_ids.sort(),['fact:1|a','fact:3|b']);
 assert.ok(judge.input.sources.length<4);
 assert.ok(judge.input.sources.some(s=>s.id==='person:b')); // profiles are always kept for context
});

test('question writing sends the retrieved subset, and unretrieved evidence cannot be cited',async()=>{
 const {client}=fakeElastic(()=>hits(['fact:1|a']));
 const model={label:'Gemini',model:'test',calls:[],json:async({input})=>{model.calls.push(JSON.parse(input));return {question:'Which backend problem would you hand to someone today?',rationale:'Tests the co-founder overlap.',approve:true,issues:[],revised_question:''};}};
 const q=await writeQuestion(ctx(),[model],{elastic:client,roomId:'room_1'});
 assert.match(q.question,/backend/);
 assert.deepEqual(model.calls[0].sources.map(s=>s.id),['fact:1|a']);
 assert.equal(model.calls[0].muses.length,2); // the room still sees who is in it
});
