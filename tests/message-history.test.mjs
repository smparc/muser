import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';
import {sqliteD1,origin,onboard} from './helpers.mjs';

test('room history pages through timestamp ties and keeps latest replies in state',async()=>{
 const h=sqliteD1(),owner={id:'history-owner',name:'History'},stranger={id:'other-owner',name:'Other'};
 onboard(h.sql,[owner,stranger]);
 const request=async(path,who=owner,method='GET',body)=>{
  const response=await handle(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),h.db,who);
  return {status:response.status,...await response.json()};
 };
 try{
  const initial=await request('/api/owner/state'),room=initial.room.id;
  const connection=await request('/api/owner/connections',owner,'POST',{agent_name:'History Muse'});
  for(let i=0;i<255;i++){
   const suffix=String(i).padStart(3,'0'),id='history-'+suffix;
   h.sql.prepare("INSERT INTO tasks (id,room_id,connection_id,prompt,nonce,kind,status,created_at,available_at,expires_at) VALUES (?,?,?,?,?,'question','completed',1,1,9999999999999)").run(id,room,connection.connection_id,'Hello','nonce-'+suffix);
   h.sql.prepare('INSERT INTO responses (id,room_id,task_id,connection_id,client_id,text,nonce,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,room,id,connection.connection_id,id,'Reply '+suffix,'nonce-'+suffix,1000+Math.floor(i/10));
  }
  const state=await request('/api/owner/state');
  assert.equal(state.responses.length,200);assert.equal(state.responses[0].id,'history-055');assert.equal(state.responses.at(-1).id,'history-254');
  let cursor='',ids=[];
  do{
   const page=await request('/api/owner/messages?room='+room+(cursor?'&before='+cursor:''));
   assert.equal(page.status,200);assert.ok(page.messages.length<=50);
   ids=[...page.messages.map(r=>r.id),...ids];
   cursor=page.has_more?page.messages[0].id:'';
  }while(cursor);
  assert.equal(ids.length,255);assert.equal(new Set(ids).size,255);assert.deepEqual(ids,[...ids].sort());
  assert.equal((await request('/api/owner/messages?room='+room,stranger)).status,404);
  assert.equal((await request('/api/owner/messages?room='+room,null)).status,401);
  assert.equal((await request('/api/owner/messages?room='+room+'&before=missing')).status,404);
  const otherRoom=(await request('/api/owner/state',stranger)).room.id;
  assert.equal((await request('/api/owner/messages?room='+otherRoom+'&before=history-010',stranger)).status,404);
  const invite=await request('/api/owner/rooms/'+room+'/invites',owner,'POST',{max_uses:1});
  await request('/api/owner/rooms/join',stranger,'POST',{code:invite.code});
  assert.equal((await request('/api/owner/messages?room='+room,stranger)).messages.length,50);
 }finally{h.cleanup();}
});
