import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1,onboard,origin} from './helpers.mjs';
import {speakReply} from '../lib/room-audio.mjs';
import {handle} from '../lib/api.mjs';
import {AudioReplyQueue,createRoomAudio} from '../public/room-audio.js';
const env={ELEVENLABS_API_KEY:'test-secret',ELEVENLABS_VOICE_IDS:'voice0000001,voice0000002'};
function fixture(t){
 const h=sqliteD1();t.after(h.cleanup);const {sql}=h;const now=Date.now();
 sql.prepare('INSERT INTO rooms(id,owner_id,created_at) VALUES (?,?,?)').run('room','owner1',now);
 for(let i=1;i<=2;i++){
  sql.prepare('INSERT INTO room_members(id,room_id,owner_id,owner_name,role,joined_at) VALUES (?,?,?,?,?,?)').run('member'+i,'room','owner'+i,'Owner '+i,i===1?'host':'member',now);
  sql.prepare('INSERT INTO connections(id,owner_id,room_id,name,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run('c'+i,'owner'+i,'room','Muse '+i,'hash'+i,now,now+86400000);
  sql.prepare('INSERT INTO tasks(id,room_id,connection_id,prompt,nonce,kind,status,created_at,available_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('t'+i,'room','c'+i,'Question','nonce','conversation','completed',now,now,now+10000);
  sql.prepare('INSERT INTO responses(id,room_id,task_id,connection_id,client_id,text,nonce,created_at) VALUES (?,?,?,?,?,?,?,?)').run('r'+i,'room','t'+i,'c'+i,'client'+i,'A useful reply.','nonce',now);
 }
 onboard(sql,[{id:'owner1'},{id:'outsider'}]);return h;
}
test('voices stay distinct; cached audio replays without synthesis or additional usage',async t=>{
 const h=fixture(t),calls=[];const fetcher=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});};
 for(const id of ['r1','r2','r1'])assert.deepEqual([...new Uint8Array(await (await speakReply(h.db,{id:'room'},id,env,{fetcher})).arrayBuffer())],[1,2,3]);
 assert.equal(calls.length,2);assert.notEqual(calls[0].url,calls[1].url);assert.equal(calls[0].body.text,'A useful reply.');
 assert.equal(h.sql.prepare('SELECT characters FROM audio_usage').get().characters,30);
 h.sql.exec('DELETE FROM responses');assert.equal(h.sql.prepare('SELECT characters FROM audio_usage').get().characters,30);
});
test('pending requests deduplicate, failures cannot bill again, and budget caps synthesis',async t=>{
 const h=fixture(t);let release,started;const ready=new Promise(r=>started=r);const gate=new Promise(r=>release=r);let calls=0;
 const fetcher=async()=>{calls++;started();await gate;return new Response('failed',{status:500});};
 const first=speakReply(h.db,{id:'room'},'r1',env,{fetcher});const rejected=assert.rejects(first,e=>e.code==='audio_failed');await ready;
 await assert.rejects(speakReply(h.db,{id:'room'},'r1',env,{fetcher}),e=>e.code==='audio_pending');release();await rejected;
 await assert.rejects(speakReply(h.db,{id:'room'},'r1',env,{fetcher}),e=>e.code==='audio_failed');
 await assert.rejects(speakReply(h.db,{id:'room'},'r2',{...env,ELEVENLABS_DAILY_CHARACTER_LIMIT:20},{fetcher}),e=>e.code==='audio_budget');assert.equal(calls,1);
});
test('audio route enforces authentication, membership, origin and stored text only',async t=>{
 const h=fixture(t);const request=(owner,method='GET',body,site=origin)=>handle(new Request(origin+'/api/owner/rooms/room/audio',{method,headers:{Origin:site,'Content-Type':'application/json'},body:body&&JSON.stringify(body)}),h.db,owner,{},env);
 assert.equal((await request(null)).status,401);assert.equal((await request({id:'outsider',name:'Out'})).status,404);
 const owner={id:'owner1',name:'Owner'};assert.equal((await request(owner,'POST',{message_id:'r1'},'https://evil.test')).status,403);
 assert.equal((await request(owner,'POST',{message_id:'r1',text:'Injected'})).status,422);
 const status=await (await request(owner)).json();assert.equal(status.available,true);assert.equal(JSON.stringify(status).includes('test-secret'),false);
 h.sql.exec("UPDATE connections SET revoked_at=1 WHERE id='c1'");await assert.rejects(speakReply(h.db,{id:'room'},'r1',env),e=>e.code==='reply_unavailable');
});
test('queue skips history, deduplicates polls, bounds backlog and clears on mute or room change',()=>{
 const q=new AudioReplyQueue(),state={room:{id:'room'},responses:[{id:'old',kind:'conversation',created_at:1}]};
 q.update(state);q.enabled=true;q.update(state);assert.equal(q.items.length,0);
 state.responses.push(...Array.from({length:12},(_,i)=>({id:'r'+i,kind:'conversation',created_at:i+2})));q.update(state);q.update(state);assert.equal(q.items.length,8);
 q.stop();assert.equal(q.items.length,0);q.enabled=true;q.update(state);assert.equal(q.items.length,0);
 q.update({...state,room:{id:'other'}});assert.equal(q.enabled,false);
});
test('audio controls play new replies sequentially and stop on mute and hidden tab',async t=>{
 const original={document:globalThis.document,window:globalThis.window,addEventListener:globalThis.addEventListener,fetch:globalThis.fetch};t.after(()=>Object.assign(globalThis,original));
 const elements=Object.fromEntries(['roomAudioToggle','roomAudioStatus','roomAudioVolume'].map(id=>[id,{value:'.8',textContent:'',setAttribute(k,v){this[k]=v;}}]));
 const listeners={},sources=[],requests=[],speakers=[];
 globalThis.document={hidden:false,getElementById:id=>elements[id],addEventListener:(k,v)=>listeners[k]=v};globalThis.addEventListener=()=>{};
 globalThis.window={AudioContext:class{destination={};createGain(){return {gain:{},connect(){}};}async resume(){}async decodeAudioData(){return {};}createBufferSource(){const source={connect(){},start(){sources.push(this);},stop(){this.onended?.();}};return source;}}};
 globalThis.fetch=async(url,opts={})=>{requests.push(opts.method||'GET');return opts.method==='POST'?new Response(new Uint8Array([1])):Response.json({available:true,daily_character_limit:10000});};
 const audio=createRoomAudio({onSpeaker:s=>speakers.push(s)}),state={room:{id:'room'},connections:[{id:'c',name:'Muse'}],responses:[]};
 await elements.roomAudioToggle.onclick();assert.match(elements.roomAudioStatus.textContent,/room has not loaded/);assert.equal(requests.length,0);
 audio.update(state);await elements.roomAudioToggle.onclick();assert.equal(elements.roomAudioToggle.textContent,'Mute room');assert.match(elements.roomAudioStatus.textContent,/Waiting for a new Muse reply/);
 state.responses=[{id:'r1',connection_id:'c',kind:'conversation',created_at:1},{id:'r2',connection_id:'c',kind:'conversation',created_at:2}];audio.update(state);
 const tick=()=>new Promise(r=>setTimeout(r,5));await tick();assert.equal(sources.length,1);assert.deepEqual(requests,['GET','POST']);assert.equal(speakers.at(-1).connectionId,'c');
 sources[0].onended();await tick();assert.equal(sources.length,2);await elements.roomAudioToggle.onclick();await tick();assert.equal(speakers.at(-1),null);assert.equal(elements.roomAudioToggle['aria-pressed'],'false');
 await elements.roomAudioToggle.onclick();document.hidden=true;listeners.visibilitychange();assert.equal(elements.roomAudioToggle['aria-pressed'],'false');
});
