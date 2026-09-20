import {one,stmt,digest,fail,json} from './http.mjs';

const MAX_AUDIO_BYTES=1024*1024;
const DAY=86400000;
let catalog=null;
const VOICE_ID=/^[A-Za-z0-9_]{10,100}$/;
const STOCK=new Set(['premade','default']);
const limit=env=>Math.max(0,Math.min(1000000,Number(env.ELEVENLABS_DAILY_CHARACTER_LIMIT??10000)||0));
export const audioSettings=env=>({available:!!env.ELEVENLABS_API_KEY,provider:'ElevenLabs',daily_character_limit:limit(env),model:env.ELEVENLABS_MODEL_ID||'eleven_multilingual_v2'});
// Every voice this Muser may use, with names, so the owner can be offered a real menu.
// The operator can narrow it with ELEVENLABS_VOICE_IDS; otherwise it is whatever the account
// can reach, including its own cloned voices.
export async function voiceCatalog(env,fetcher=fetch){
 if(!env.ELEVENLABS_API_KEY)fail(503,'audio_not_configured','Muse voices are not switched on for this Muser. Text chat is ready.');
 const allow=String(env.ELEVENLABS_VOICE_IDS||'').split(',').map(v=>v.trim()).filter(Boolean);
 if(allow.some(v=>!VOICE_ID.test(v)))fail(503,'audio_configuration','Muse voices are not set up correctly on this Muser. Ask whoever runs it to take a look.');
 const key=await digest(env.ELEVENLABS_API_KEY);
 if(catalog?.key===key&&Date.now()-catalog.at<300000)return catalog.list;
 let list=[];
 try{
  const response=await fetcher('https://api.elevenlabs.io/v2/voices?page_size=100',{headers:{'xi-api-key':env.ELEVENLABS_API_KEY},signal:AbortSignal.timeout(15000)});
  if(response.ok){
   const data=await response.json();
   list=(data.voices||[]).filter(v=>VOICE_ID.test(v.voice_id||'')).map(v=>({id:v.voice_id,name:v.name||v.voice_id,category:v.category||'custom'}));
  }
 }catch{/* fall through to whatever the operator configured */}
 // A configured list stays authoritative even when the catalog call fails.
 if(allow.length){
  const named=new Map(list.map(v=>[v.id,v]));
  list=allow.map(id=>named.get(id)||{id,name:id,category:'custom'});
 }
 if(!list.length)fail(503,'voice_catalog_unavailable','Muse voices are unavailable right now. Text chat still works; try audio again later.');
 list.sort((a,b)=>a.name.localeCompare(b.name));
 catalog={key,list,at:Date.now()};return list;
}
// The pool automatic assignment draws from: stock voices, unless the operator named a set.
async function voices(env,fetcher){
 const list=await voiceCatalog(env,fetcher);
 const configured=String(env.ELEVENLABS_VOICE_IDS||'').split(',').map(v=>v.trim()).filter(Boolean);
 const ids=(configured.length?list:list.filter(v=>STOCK.has(v.category))).map(v=>v.id).sort();
 if(!ids.length)fail(503,'no_room_voices','No Muse voices are available on this Muser yet. Ask whoever runs it to finish setting up audio.');
 return ids;
}
async function assignedVoice(db,room,owner,museId,ids){
 const chosen=museId&&await one(db,'SELECT voice_id FROM muse_voices WHERE muse_id=?',museId);
 if(chosen)return chosen.voice_id;
 const existing=await one(db,'SELECT voice_id FROM room_voices WHERE room_id=? AND owner_id=?',room,owner);
 if(existing)return existing.voice_id;
 for(const voice of ids){
  await stmt(db,'INSERT OR IGNORE INTO room_voices (room_id,owner_id,voice_id) VALUES (?,?,?)',room,owner,voice).run();
  const assigned=await one(db,'SELECT voice_id FROM room_voices WHERE room_id=? AND owner_id=?',room,owner);
  if(assigned)return assigned.voice_id;
 }
 fail(503,'voices_exhausted','All room voices are assigned. Add more voice IDs to give this Muse a distinct voice.');
}
const audioResponse=bytes=>new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function boundedAudio(response){
 if(!response.body)throw Error('empty_audio');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_AUDIO_BYTES)throw Error('audio_too_large');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 if(!size)throw Error('empty_audio');
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}

// Caller has already checked session, same origin, onboarding and membership.
// Never accept browser-supplied text or a voice ID for billable synthesis.
export async function speakReply(db,room,messageId,env,{fetcher=fetch}={}){
 if(!env.ELEVENLABS_API_KEY)fail(503,'audio_not_configured','Muse voices are not switched on for this Muser. Text chat is ready.');
 const reply=await one(db,`SELECT r.id,r.text,c.owner_id,c.revoked_at,c.expires_at,COALESCE(c.key_of,c.id) AS muse_id FROM responses r
  JOIN connections c ON c.id=r.connection_id JOIN room_members m ON m.room_id=r.room_id AND m.owner_id=c.owner_id
  WHERE r.id=? AND r.room_id=?`,messageId,room.id);
 if(!reply||reply.revoked_at||reply.expires_at<=Date.now())fail(404,'reply_unavailable','This Muse reply is no longer available for audio.');
 const cached=await one(db,'SELECT status,audio,created_at FROM reply_audio WHERE response_id=? AND room_id=?',reply.id,room.id);
 if(cached?.status==='ready')return audioResponse(new Uint8Array(cached.audio));
 if(cached?.status==='pending'&&Date.now()-cached.created_at<60000)fail(409,'audio_pending','This reply is already being voiced.');
 if(cached)fail(503,'audio_failed','Audio could not be generated for this reply. The text is still available.');
 if(room.archived_at)fail(409,'room_archived','This room is archived. New voice generation is paused.');
 const text=reply.text.trim();if(!text||text.length>2000)fail(422,'audio_text_limit','This reply cannot be voiced.');
 const voice=await assignedVoice(db,room.id,reply.owner_id,reply.muse_id,await voices(env,fetcher));
 const now=Date.now(),start=Math.floor(now/DAY)*DAY;
 // Atomic reservation: a reply is billed once across viewers and concurrent Workers.
 // Failed attempts remain charged against the local cap; retries never silently spend again.
 const [reserved]=await db.batch([stmt(db,`INSERT OR IGNORE INTO reply_audio (response_id,room_id,voice_id,characters,status,created_at)
  SELECT ?,?,?,?,'pending',? WHERE COALESCE((SELECT characters FROM audio_usage WHERE day=?),0)+?<=?
  AND (SELECT COUNT(*) FROM reply_audio WHERE room_id=? AND status='pending' AND created_at>?)<2`,reply.id,room.id,voice,text.length,now,start,text.length,limit(env),room.id,now-60000),
  stmt(db,`INSERT INTO audio_usage(day,characters) SELECT ?,? WHERE changes()>0
   ON CONFLICT(day) DO UPDATE SET characters=characters+excluded.characters`,start,text.length)]);
 if(!reserved.meta.changes){
  const raced=await one(db,'SELECT status,audio FROM reply_audio WHERE response_id=?',reply.id);
  if(raced?.status==='ready')return audioResponse(new Uint8Array(raced.audio));
  if(raced)fail(409,'audio_pending','This reply is already being voiced.');
  fail(429,'audio_budget','Room audio is busy or today’s character limit has been reached. Text chat remains available.');
 }
 try{
  const response=await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,{
   method:'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json',Accept:'audio/mpeg'},
   body:JSON.stringify({text,model_id:audioSettings(env).model,voice_settings:{stability:.45,similarity_boost:.75,style:.25,use_speaker_boost:true}}),signal:AbortSignal.timeout(30000)});
  if(!response.ok||!response.headers.get('Content-Type')?.startsWith('audio/'))throw Error('provider_failed');
  const bytes=await boundedAudio(response);
  await stmt(db,"UPDATE reply_audio SET status='ready',audio=? WHERE response_id=?",bytes,reply.id).run();
  return audioResponse(bytes);
 }catch{
  await stmt(db,"UPDATE reply_audio SET status='failed' WHERE response_id=?",reply.id).run();
  fail(503,'audio_failed','ElevenLabs could not voice this reply. Check the server key, credits and configured voices. Text chat is unaffected.');
 }
}

export function roomAudioStatus(env){return json(audioSettings(env));}

/** Voices this Muser offers, for the owner's menu. */
export async function voiceOptions(env,fetcher=fetch){return voiceCatalog(env,fetcher);}

/** Set (or clear, with null) the voice one Muse speaks with in every room. */
export async function setMuseVoice(db,ownerId,museId,voiceId,env,fetcher=fetch){
 if(voiceId===null){await stmt(db,'DELETE FROM muse_voices WHERE muse_id=? AND owner_id=?',museId,ownerId).run();return null;}
 const list=await voiceCatalog(env,fetcher);
 if(!list.some(v=>v.id===voiceId))fail(422,'unknown_voice','That voice is not available on this Muser. Pick one from the list.');
 await stmt(db,`INSERT INTO muse_voices (muse_id,owner_id,voice_id,updated_at) VALUES (?,?,?,?)
  ON CONFLICT(muse_id) DO UPDATE SET voice_id=excluded.voice_id,updated_at=excluded.updated_at,owner_id=excluded.owner_id`,museId,ownerId,voiceId,Date.now()).run();
 return voiceId;
}
