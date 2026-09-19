// JSON-output clients for the master's two models. Each call returns a parsed object or throws.
// Keys come only from server environment variables and are never logged or returned to browsers.
const TIMEOUT_MS=30000;
export const DEFAULT_OPENAI_MODEL='gpt-4.1-mini';
export const DEFAULT_GEMINI_MODEL='gemini-3.6-flash'; // gemini-2.5-flash is closed to new keys
export const DEFAULT_GEMINI_FALLBACK='gemini-3.5-flash'; // used once when the main model is overloaded

// Provider overloads and rate limits are usually brief: retry them twice with a short, growing wait.
const RETRY_STATUSES=[429,500,502,503,504];
export async function withRetry(send,{waits=[1500,4000]}={}){
 for(let i=0;;i++){const r=await send();if(!RETRY_STATUSES.includes(r.status)||i>=waits.length)return r;await new Promise(res=>setTimeout(res,waits[i]));}
}
const parse=text=>JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));

export async function openaiJSON({apiKey,model,system,input,schema,name='result',maxTokens=1200,fetchImpl=fetch}){
 const r=await withRetry(()=>fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
  body:JSON.stringify({model,store:false,max_output_tokens:maxTokens,instructions:system,input,text:{format:{type:'json_schema',name,strict:true,schema}}}),signal:AbortSignal.timeout(TIMEOUT_MS)}));
 if(!r.ok)throw Error(`OpenAI request failed: HTTP ${r.status}`);
 const p=await r.json();
 const text=p.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text??p.output_text;
 if(typeof text!=='string')throw Error('OpenAI returned no text');
 return parse(text);
}

// Gemini API keys ("AIza…" or "AQ.…") use the AI Studio endpoint. Set GEMINI_ENDPOINT=vertex only for a Vertex AI setup.
export const GEMINI_ENDPOINTS={
 studio:model=>`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
 vertex:model=>`https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
};
export const geminiEndpointFor=(apiKey,override)=>GEMINI_ENDPOINTS[override]?override:'studio';

export async function geminiJSON({apiKey,model,system,input,schema,maxTokens=4096,endpoint,fetchImpl=fetch}){
 const url=GEMINI_ENDPOINTS[geminiEndpointFor(apiKey,endpoint)](model);
 const send=generationConfig=>fetchImpl(url,{method:'POST',headers:{'x-goog-api-key':apiKey,'Content-Type':'application/json'},
  body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:maxTokens,...generationConfig}}),signal:AbortSignal.timeout(TIMEOUT_MS)});
 let r=await withRetry(()=>send({responseJsonSchema:schema}));
 // Older model versions reject responseJsonSchema: retry in plain JSON mode with the schema described in the prompt.
 if(r.status===400){
  input=`${input}\n\nRespond with JSON only, matching this JSON Schema exactly:\n${JSON.stringify(schema)}`;
  r=await withRetry(()=>send({}));
 }
 if(!r.ok){
  // Google's error text explains key/project/model problems and never echoes the key.
  let detail='';try{const e=(await r.json())?.error;detail=[e?.status,e?.message].filter(Boolean).join(': ').slice(0,300);}catch{}
  throw Error(`Gemini request failed: HTTP ${r.status}${detail?` (${detail})`:''}`);
 }
 const p=await r.json();
 const text=p.candidates?.[0]?.content?.parts?.map(x=>x.text??'').join('');
 if(!text)throw Error(`Gemini returned no text${p.candidates?.[0]?.finishReason?` (${p.candidates[0].finishReason})`:''}`);
 return parse(text);
}

// The configured models. With one key the master still runs, using that model for both roles.
export function providersFrom(env={},fetchImpl=fetch){
 const list=[];
 if(env.OPENAI_API_KEY){const model=env.OPENAI_MASTER_MODEL||env.OPENAI_OBSERVER_MODEL||DEFAULT_OPENAI_MODEL;list.push({id:'openai',label:'OpenAI',model,json:args=>openaiJSON({...args,apiKey:env.OPENAI_API_KEY,model,fetchImpl})});}
 if(env.GEMINI_API_KEY){
  const model=env.GEMINI_MODEL||DEFAULT_GEMINI_MODEL,fallback=env.GEMINI_FALLBACK_MODEL??DEFAULT_GEMINI_FALLBACK;
  const call=m=>args=>geminiJSON({...args,apiKey:env.GEMINI_API_KEY,model:m,endpoint:env.GEMINI_ENDPOINT,fetchImpl});
  // When the main model is still overloaded after retries, try the fallback model once.
  list.push({id:'gemini',label:'Gemini',model,json:async args=>{try{return await call(model)(args);}catch(err){if(!fallback||fallback===model||!/HTTP (429|503)/.test(err.message))throw err;return call(fallback)(args);}}});
 }
 return list;
}
