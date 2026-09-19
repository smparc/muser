import test from 'node:test';import assert from 'node:assert/strict';
import {handle,cleanReplyText} from '../lib/api.mjs';import {sqliteD1,origin} from './helpers.mjs';

test('protocol IDs are stripped from chat text; ordinary words are kept',()=>{
 const N='1c189da86386a89a';
 const cases=[
  ['Hi there!\n\nNonce: '+N,'Hi there!'],
  ['Nonce: '+N+'\nHayden loves climbing.','Hayden loves climbing.'],
  ['Hayden loves climbing (nonce: '+N+').','Hayden loves climbing.'],
  ['Reached Commonroom. Task ID: task_4f1e2d3c-aaaa-bbbb, nonce='+N,'Reached Commonroom.'],
  ['Replying with nonce `'+N+'` — Hayden is into robotics.','Replying with — Hayden is into robotics.'],
  ['The tokens '+N+' appear raw','The tokens appear raw'],
  ['I love the word nonce itself.','I love the word nonce itself.'],
  ['Message id: abc','Message id: abc'],
  ['Hi, Hayden! How are you?','Hi, Hayden! How are you?'],
  ['Answer: yes. (Nonce '+N+')','Answer: yes.'],
 ];
 for(const [input,want] of cases)assert.equal(cleanReplyText(input,[N]),want,input);
});

test('replies are stored clean, retries still replay, and old rows are cleaned on display',async()=>{
 const h=sqliteD1(),owner={id:'clean-owner',name:'Cleo'};
 const call=async(path,method='GET',body,token)=>{const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(token)headers.set('Authorization','Bearer '+token);const r=await handle(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),h.db,token?null:owner);return {status:r.status,body:await r.json()};};
 try{
  const key=(await call('/api/owner/connections','POST',{agent_name:"Cleo's Muse"})).body.access_token;
  const t=(await call('/api/v1/me/tasks','GET',undefined,key)).body.tasks[0];
  const url='/api/v1/tasks/'+t.id+'/response';
  assert.equal((await call(url,'POST',{client_message_id:'c0',nonce:t.nonce,text:'Nonce: '+t.nonce},key)).body.error,'empty_reply');
  const raw={client_message_id:'c1',nonce:t.nonce,text:`Reached Commonroom!\nNonce: ${t.nonce}`};
  assert.equal((await call(url,'POST',raw,key)).status,201);
  assert.equal(h.sql.prepare('SELECT text FROM responses WHERE task_id=?').get(t.id).text,'Reached Commonroom!');
  assert.equal((await call(url,'POST',raw,key)).body.replayed,true);
  // A row saved before cleaning existed is cleaned when the room or dashboard reads it.
  h.sql.prepare('UPDATE responses SET text=? WHERE task_id=?').run('Legacy hello (nonce: '+t.nonce+')',t.id);
  assert.equal((await call('/api/v1/room','GET',undefined,key)).body.messages[0].text,'Legacy hello');
  assert.equal((await call('/api/owner/state')).body.responses[0].text,'Legacy hello');
 }finally{h.cleanup();}
});
