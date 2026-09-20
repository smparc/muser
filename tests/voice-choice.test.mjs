import test from 'node:test';
import assert from 'node:assert/strict';
import {handle,digest} from '../lib/api.mjs';
import {speakReply,voiceCatalog,setMuseVoice} from '../lib/room-audio.mjs';
import {id,secret} from '../lib/http.mjs';
import {sqliteD1,origin,onboard} from './helpers.mjs';

const HAYDEN='whtn8K2jpyL49m4VzNGr';
const CATALOG={voices:[
 {voice_id:'21m00Tcm4TlvDq8ikWAM',name:'Rachel',category:'premade'},
 {voice_id:'AZnzlk1XvdvUeBnXmlld',name:'Domi',category:'premade'},
 {voice_id:HAYDEN,name:"Hayden's voice",category:'cloned'},
]};
// Distinct keys per case: the catalog is cached by a digest of the provider key.
const envFor=key=>({ELEVENLABS_API_KEY:key,ELEVENLABS_DAILY_CHARACTER_LIMIT:'100000'});
const catalogFetcher=async()=>({ok:true,json:async()=>CATALOG});

test('the menu offers the account\'s own cloned voices, with names',async()=>{
 const list=await voiceCatalog(envFor('k-catalog'),catalogFetcher);
 const mine=list.find(v=>v.id===HAYDEN);
 assert.ok(mine,'a cloned voice must be selectable');
 assert.equal(mine.name,"Hayden's voice");
});

test('a voice the provider does not offer is refused',async()=>{
 await assert.rejects(()=>setMuseVoice({},'owner','muse','no_such_voice_here',envFor('k-reject'),catalogFetcher),
  e=>e.code==='unknown_voice'&&e.status===422);
});

test('an operator-configured list stays authoritative',async()=>{
 const list=await voiceCatalog({...envFor('k-allow'),ELEVENLABS_VOICE_IDS:HAYDEN},catalogFetcher);
 assert.deepEqual(list.map(v=>v.id),[HAYDEN]);
});

test('a Muse speaks with the voice its owner chose, in every room',async()=>{
 const h=sqliteD1(),db=h.db,owner={id:'voice-owner',name:'Hayden'};
 onboard(h.sql,[owner]);
 const now=Date.now(),token='cr_'+secret();
 h.sql.prepare('INSERT INTO owners (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)').run(owner.id,'v@example.test',owner.name,'x','x',now);
 const rooms=['room_voice_a','room_voice_b'],muse='agent_voice_root';
 for(const [i,room] of rooms.entries()){
  h.sql.prepare('INSERT INTO rooms (id,owner_id,created_at) VALUES (?,?,?)').run(room,owner.id,now);
  h.sql.prepare('INSERT INTO room_members (id,room_id,owner_id,owner_name,role,joined_at) VALUES (?,?,?,?,?,?)').run(id('mem'),room,owner.id,owner.name,'host',now);
  // One Muse, one key: the second room is a link whose key_of points at the root.
  const cid=i?'agent_voice_link':muse;
  h.sql.prepare("INSERT INTO connections (id,owner_id,room_id,name,token_hash,created_at,expires_at,source,key_of) VALUES (?,?,?,?,?,?,?,'connector',?)")
   .run(cid,owner.id,room,"Hayden's Muse",await digest(i?'cr_'+secret():token),now,now+86400000,i?muse:null);
  const task=id('task');
  h.sql.prepare("INSERT INTO tasks (id,room_id,connection_id,prompt,nonce,kind,status,created_at,available_at,expires_at) VALUES (?,?,?,?,?,'question','completed',?,?,?)")
   .run(task,room,cid,'q','n'+i,now,now,now+86400000);
  h.sql.prepare('INSERT INTO responses (id,task_id,room_id,connection_id,text,client_id,nonce,created_at) VALUES (?,?,?,?,?,?,?,?)')
   .run('reply_'+i,task,room,cid,'Hello from the room.','c'+i,'n'+i,now);
 }

 const owned=await setMuseVoice(db,owner.id,muse,HAYDEN,envFor('k-speak'),catalogFetcher);
 assert.equal(owned,HAYDEN);

 const used=[];
 const speechFetcher=async(url,init)=>{
  if(String(url).includes('/v2/voices'))return {ok:true,json:async()=>CATALOG};
  used.push(String(url));
  return {ok:true,headers:new Headers({'Content-Type':'audio/mpeg'}),body:new Blob([new Uint8Array([1,2,3])]).stream()};
 };
 for(const [i,room] of rooms.entries()){
  const res=await speakReply(db,{id:room,archived_at:null},'reply_'+i,envFor('k-speak'),{fetcher:speechFetcher});
  assert.equal(res.status,200);
 }
 assert.equal(used.length,2);
 for(const url of used)assert.ok(url.includes(HAYDEN),`expected the chosen voice in ${url}`);

 // Clearing it hands the Muse back to automatic assignment.
 assert.equal(await setMuseVoice(db,owner.id,muse,null,envFor('k-speak'),catalogFetcher),null);
 const row=h.sql.prepare('SELECT count(*) AS n FROM muse_voices WHERE muse_id=?').get(muse);
 assert.equal(row.n,0);
 h.cleanup();
});
