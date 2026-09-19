// Owner consent: which sources a person's Muses may gather facts from, and whether they finished onboarding.
// Every owner must finish onboarding before using Commonroom; until then only the onboarding routes answer.
import {NOW,id,fail,stmt,one,all,only} from './http.mjs';
import {SOURCES,SOURCE_IDS,describeSources,sourceLabel} from './sources.mjs';

export async function consentOf(db,ownerId){
 const r=await one(db,'SELECT sources_json,authorized_at,onboarding_completed_at FROM owner_consents WHERE owner_id=?',ownerId);
 return {sources:r?JSON.parse(r.sources_json):[],authorized_at:r?.authorized_at??null,completed_at:r?.onboarding_completed_at??null};
}
export const authorizedSources=async(db,ownerId)=>(await consentOf(db,ownerId)).sources;
export const onboarded=async(db,ownerId)=>!!(await consentOf(db,ownerId)).completed_at;

// Saves the person's choice. Sources they turn off are purged from every room at once: visible facts from them are deleted,
// and hidden ones lose their text but keep their fingerprint, so a later re-sync of the same fact stays hidden.
// Returns the IDs that were added, so callers can ask the person's Muses to sync.
export async function setSources(db,ownerId,b){
 only(b,['sources','authorized']);
 if(!Array.isArray(b.sources)||b.sources.some(s=>!SOURCE_IDS.includes(s)))fail(422,'invalid_sources',`sources must be a list drawn from: ${SOURCE_IDS.join(', ')}.`);
 const sources=SOURCE_IDS.filter(s=>b.sources.includes(s));
 if(sources.length&&b.authorized!==true)fail(422,'authorization_required','Confirm that you authorize your Muse to gather and share facts from these sources.');
 const before=await authorizedSources(db,ownerId),n=NOW();
 const removed=before.filter(s=>!sources.includes(s)),added=sources.filter(s=>!before.includes(s));
 const writes=[stmt(db,'INSERT INTO owner_consents (owner_id,sources_json,authorized_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET sources_json=excluded.sources_json,authorized_at=excluded.authorized_at,updated_at=excluded.updated_at',ownerId,JSON.stringify(sources),n,n)];
 if(removed.length){
  const inRemoved=`source IN (${removed.map(()=>'?').join(',')})`;
  writes.push(stmt(db,`DELETE FROM muse_context WHERE owner_id=? AND hidden_at IS NULL AND ${inRemoved}`,ownerId,...removed));
  writes.push(stmt(db,`UPDATE muse_context SET text='' WHERE owner_id=? AND hidden_at IS NOT NULL AND ${inRemoved}`,ownerId,...removed));
 }
 // Rooms the person is in get a record of the change (labels only; no facts).
 if(added.length||removed.length)for(const r of await all(db,'SELECT room_id FROM room_members WHERE owner_id=?',ownerId))
  writes.push(stmt(db,'INSERT INTO events (id,room_id,connection_id,type,detail,created_at) VALUES (?,?,?,?,?,?)',id('evt'),r.room_id,null,'sources_changed',JSON.stringify({added:added.map(sourceLabel),removed:removed.map(sourceLabel)}),n));
 await db.batch(writes);
 return {sources,added,removed};
}

export async function completeOnboarding(db,ownerId){
 const r=await one(db,'SELECT onboarding_completed_at FROM owner_consents WHERE owner_id=?',ownerId);
 if(!r)fail(409,'sources_required','Choose what your Muse may use (you can choose none) before finishing.');
 const n=r.onboarding_completed_at??NOW();
 if(!r.onboarding_completed_at)await stmt(db,'UPDATE owner_consents SET onboarding_completed_at=? WHERE owner_id=?',n,ownerId).run();
 return n;
}

export async function onboardingState(db,ownerId){
 const c=await consentOf(db,ownerId);
 const profile=await one(db,'SELECT profile_json,updated_at FROM owner_profiles WHERE owner_id=?',ownerId);
 const muses=(await one(db,'SELECT count(*) AS n FROM connections WHERE owner_id=? AND revoked_at IS NULL',ownerId)).n;
 return {completed:!!c.completed_at,completed_at:c.completed_at,sources:c.sources,authorized_at:c.authorized_at,catalog:SOURCES,
  profile:profile?{...JSON.parse(profile.profile_json),updated_at:profile.updated_at}:null,muses,authorized:describeSources(c.sources)};
}
