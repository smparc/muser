// Owner context: facts a Muse gathers about its owner from its own connected apps (Google, Facebook, …) and posts
// to its room. Only sources the owner authorized are accepted (see lib/consent.mjs), and facts are filtered by the current
// authorization when read, so turning a source off removes its facts everywhere. The owner (or the room host) can hide any fact.
// A hidden fact stays hidden when the Muse re-posts the same text, so a periodic re-sync never undoes the owner's choice.
import {NOW,id,digest,fail,stmt,one,all,str,only,object} from './http.mjs';
import {authorizedSources} from './consent.mjs';
import {describeSources,sourceLabel} from './sources.mjs';

export const CONTEXT_CATEGORIES=['interest','work','skill','experience','seeking','offering','activity','other'];
export const MAX_FACTS=40,MAX_FACT_TEXT=300,MAX_SOURCE=40;
// Contact details of anyone (the owner or third parties) never belong in a room; reject them outright.
const EMAIL=/[^\s@]+@[^\s@]+\.[a-z]{2,}/i,PHONE=/(?:\+?\d[\s().-]*){9,}/;

export const CONTEXT_PROMPT='Refresh your owner\'s Muser context. Call get_connection to see the sources your owner authorized (authorized_sources) and what each may be used for. Using only those sources, gather facts that help people in this room find common ground with your owner: interests, current projects and work, skills, experience, what they are looking for, what they could offer, and recurring activities. Post them with set_context, each with its category and its source ID. Sources your owner did not authorize are refused. Everyone in the room can read the facts immediately, and that is the point: your owner authorized sharing them. Email addresses and phone numbers are refused. Then reply here with a one-line summary of what you posted.';

const normalize=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
function factFields(f,i,allowed){
 object(f);only(f,['category','text','source']);
 const label=`facts[${i}]`;
 if(!CONTEXT_CATEGORIES.includes(f.category))fail(422,'invalid_category',`${label}.category must be one of: ${CONTEXT_CATEGORIES.join(', ')}.`);
 const text=str(f.text,`${label}.text`,MAX_FACT_TEXT).replace(/\s+/g,' ');
 const source=str(f.source,`${label}.source`,MAX_SOURCE);
 if(!allowed.includes(source))fail(403,'source_not_authorized',allowed.length?`${label}.source "${source}" is not authorized by your owner. Authorized sources: ${allowed.join(', ')}.`:'Your owner has not authorized any sources. Ask them to choose sources in Muser (Profile, What your Muse may use).');
 if(EMAIL.test(text)||PHONE.test(text))fail(422,'contact_details',`${label} looks like it contains an email address or phone number. Leave contact details out of the room.`);
 return {category:f.category,text,source};
}

const publicFact=r=>({id:r.id,category:r.category,text:r.text,source:r.source,source_label:sourceLabel(r.source),updated_at:r.updated_at});
// A fact is shown only while its owner still authorizes its source.
const AUTHORIZED='EXISTS (SELECT 1 FROM owner_consents oc, json_each(oc.sources_json) j WHERE oc.owner_id=f.owner_id AND j.value=f.source)';

// Replaces the connection's whole fact set (a sync). Unchanged facts keep their IDs and hidden state;
// facts missing from the new set are removed, except hidden ones, which stay as a record of the owner's choice.
export async function setContext(db,c,b){
 object(b);only(b,['facts','sharing_confirmed']);
 if(b.sharing_confirmed!==true)fail(422,'sharing_required','Set sharing_confirmed to true: these facts are visible to everyone in the room.');
 if(!Array.isArray(b.facts)||b.facts.length>MAX_FACTS)fail(422,'invalid_facts',`facts must be an array of at most ${MAX_FACTS} items.`);
 const allowed=await authorizedSources(db,c.owner_id);
 const facts=b.facts.map((f,i)=>factFields(f,i,allowed));
 const byHash=new Map();for(const f of facts)byHash.set(await digest(normalize(f.text)),f); // duplicates collapse to one
 const n=NOW();
 const existing=await all(db,'SELECT id,text_hash,hidden_at FROM muse_context WHERE connection_id=?',c.id);
 const known=new Map(existing.map(r=>[r.text_hash,r]));
 const writes=[];
 let position=0;
 for(const [hash,f] of byHash){position++;
  if(known.has(hash))writes.push(stmt(db,'UPDATE muse_context SET category=?,text=?,source=?,position=?,updated_at=? WHERE id=?',f.category,f.text,f.source,position,n,known.get(hash).id));
  else writes.push(stmt(db,'INSERT INTO muse_context (id,room_id,connection_id,owner_id,text_hash,category,text,position,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id('fact'),c.room_id,c.id,c.owner_id,hash,f.category,f.text,position,f.source,n,n));
 }
 const removed=existing.filter(r=>!byHash.has(r.text_hash)&&!r.hidden_at).map(r=>r.id);
 if(removed.length)writes.push(stmt(db,`DELETE FROM muse_context WHERE id IN (${removed.map(()=>'?').join(',')})`,...removed));
 writes.push(stmt(db,'INSERT INTO events (id,room_id,connection_id,type,detail,created_at) VALUES (?,?,?,?,?,?)',id('evt'),c.room_id,c.id,'context_updated',JSON.stringify({facts:byHash.size,sources:[...new Set(facts.map(f=>f.source).filter(Boolean))]}),n));
 await db.batch(writes);
 return getContext(db,c,201);
}

export async function getContext(db,c,status=200){
 const rows=await all(db,`SELECT * FROM muse_context f WHERE connection_id=? AND ${AUTHORIZED} ORDER BY position,id`,c.id);
 const visible=rows.filter(r=>!r.hidden_at);
 return {status,body:{authorized_sources:describeSources(await authorizedSources(db,c.owner_id)),facts:visible.map(publicFact),hidden:rows.filter(r=>r.hidden_at&&r.text).map(r=>({text:r.text,category:r.category})),
  note:'Visible facts are shown to everyone in the room. Hidden facts were hidden by your owner or the room host; do not re-post them in other words.'}};
}

// Visible facts in a room, grouped by the connection that posted them (active connections only).
export async function roomContextFacts(db,roomId,n=NOW()){
 const rows=await all(db,`SELECT f.*,c.name AS agent_name FROM muse_context f JOIN connections c ON c.id=f.connection_id WHERE f.room_id=? AND f.hidden_at IS NULL AND ${AUTHORIZED} AND c.revoked_at IS NULL AND c.expires_at>? ORDER BY f.connection_id,f.position,f.id`,roomId,n);
 const groups=new Map();
 for(const r of rows){if(!groups.has(r.connection_id))groups.set(r.connection_id,{connection_id:r.connection_id,agent_name:r.agent_name,facts:[]});groups.get(r.connection_id).facts.push(publicFact(r));}
 return [...groups.values()];
}

// Evidence entries for the master (same shape as its other sources), one per visible fact.
export async function contextSources(db,roomId){
 return (await roomContextFacts(db,roomId)).flatMap(g=>g.facts.map(f=>({id:`fact:${f.id}`,connection_id:g.connection_id,kind:`fact the Muse gathered from ${f.source_label} (${f.category})`,text:f.text})));
}

// Owner view: visible facts, plus hidden ones the viewer can act on (their own, or ones the host hid, for the host).
export async function ownerContextFacts(db,roomId,ownerId,isHost){
 const rows=await all(db,`SELECT f.*,c.name AS agent_name FROM muse_context f JOIN connections c ON c.id=f.connection_id WHERE f.room_id=? AND ${AUTHORIZED} AND c.revoked_at IS NULL ORDER BY f.connection_id,f.position,f.id`,roomId);
 return rows.filter(r=>!r.hidden_at||r.owner_id===ownerId||(isHost&&r.hidden_by==='host')).map(r=>({...publicFact(r),connection_id:r.connection_id,agent_name:r.agent_name,mine:r.owner_id===ownerId,hidden:!!r.hidden_at,hidden_by:r.hidden_by}));
}

// Hide or show one fact. The fact's owner may do either; the host may hide (and re-show what they hid) in their room.
export async function setFactHidden(db,owner,factId,b,roleIn){
 only(b,['hidden']);if(typeof b.hidden!=='boolean')fail(422,'invalid_input','hidden must be true or false.');
 const f=await one(db,'SELECT * FROM muse_context WHERE id=?',factId);
 const role=f?await roleIn(f.room_id):null;
 const mine=f?.owner_id===owner.id,host=role==='host';
 if(!f||!role||!(mine||host))fail(404,'not_found','Fact not found.');
 if(!b.hidden&&!mine&&f.hidden_by!=='host')fail(403,'owner_hidden','Only the person this fact is about can show it again.');
 const n=NOW();
 await stmt(db,'UPDATE muse_context SET hidden_at=?,hidden_by=? WHERE id=?',b.hidden?n:null,b.hidden?(mine?'owner':'host'):null,f.id).run();
 return {id:f.id,hidden:b.hidden};
}
