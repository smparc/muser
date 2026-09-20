import {observeConversation} from './master-observer.mjs';
import {providersFrom} from './llm.mjs';
import {elasticFrom} from './elastic.mjs';
import {runMasterStep,noteRoundReply} from './master.mjs';

// providers can be injected (tests); by default they come from GEMINI_API_KEY (and OPENAI_API_KEY if set).
export function masterRuntime(db,env,waitUntil,{providers=providersFrom(env),elastic=elasticFrom(env)}={}){
 const master={
  providers,
  // Optional: Elastic hybrid search narrows the evidence each model call sees. Without it the master sends everything.
  elastic,
  // Model calls take 5–25 s, longer than background work (waitUntil) may run, so a step is always awaited by the
  // host's request. A Muse's reply only marks the round ready; the host's dashboard then asks for the next step.
  step:(roomId,opts)=>runMasterStep(db,roomId,providers,{...opts,elastic}),
  onRoundReply:(roomId,roundId)=>noteRoundReply(db,roomId,roundId),
 };
 // The conversation observer uses the configured model (Gemini); an OPENAI_API_KEY alone still works as before.
 const apiKey=env?.OPENAI_API_KEY,provider=providers[0];
 if(!provider&&!apiKey)return {masterEnabled:false,master};
 const observeNow=(id,turn)=>observeConversation(db,id,turn,provider?{provider}:{apiKey,model:env.OPENAI_OBSERVER_MODEL||undefined});
 // Only as real background work: a Muse's reply never waits for a model call. Where background work is unavailable
 // (Sites) or dropped (local dev), the host's open dashboard requests the analysis instead.
 const onObserve=(id,turn)=>{
  if(!waitUntil)return;
  waitUntil(observeNow(id,turn).catch(err=>console.error('Master observation failed',err?.name)));
 };
 return {masterEnabled:true,observeNow,onObserve,master};
}
