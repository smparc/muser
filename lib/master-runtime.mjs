import {observeConversation} from './master-observer.mjs';

export function masterRuntime(db,env,waitUntil){
 const apiKey=env?.OPENAI_API_KEY;
 if(!apiKey)return {masterEnabled:false};
 const observeNow=(id,turn)=>observeConversation(db,id,turn,{apiKey,model:env.OPENAI_OBSERVER_MODEL||undefined});
 const onObserve=(id,turn)=>{
  const work=observeNow(id,turn).catch(err=>console.error('Master observation failed',err?.name));
  if(waitUntil){waitUntil(work);return;}
  return work;
 };
 return {masterEnabled:true,observeNow,onObserve};
}
