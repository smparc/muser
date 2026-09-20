// Hybrid search (BM25 + ELSER semantic, blended with reciprocal rank fusion) over the room-visible evidence the
// master reasons about. D1 stays the source of truth: the index is rebuilt from it before each master step, so
// hidden facts, revoked Muses and sources an owner turned off simply stop being there.
// Document _id is the evidence's citation ID (fact:…, reply:…, muse:…, person:…), so retrieval changes nothing
// about how the models cite or how the server grounds their claims.
const TIMEOUT_MS=8000,INDEX='commonroom-evidence';
// ELSER's preconfigured endpoint: '.elser-2-elastic' on serverless, '.elser-2-elasticsearch' on stateful deployments.
// GET _inference lists what a deployment has; override with ELASTIC_INFERENCE_ID.
export const DEFAULT_INFERENCE_ID='.elser-2-elastic';

// The mapping the index needs. semantic_text runs ELSER on ingest and at query time; no embedding code here.
export const mappingFor=(inferenceId=DEFAULT_INFERENCE_ID)=>({mappings:{properties:{
 room_id:{type:'keyword'},connection_id:{type:'keyword'},owner_id:{type:'keyword'},kind:{type:'keyword'},source:{type:'keyword'},
 created_at:{type:'date'},text:{type:'text',copy_to:'semantic'},
 semantic:{type:'semantic_text',inference_id:inferenceId},
}}});
export const MAPPING=mappingFor();

/** @returns {null|{sync:Function,search:Function,ensureIndex:Function,url:string}} null when the deployment is not configured. */
export function elasticFrom(env,{fetchImpl=fetch,index=INDEX}={}){
 const inferenceId=env?.ELASTIC_INFERENCE_ID||DEFAULT_INFERENCE_ID;
 const url=env?.ELASTIC_URL?.replace(/\/$/,''),apiKey=env?.ELASTIC_API_KEY;
 if(!url||!apiKey)return null;
 const auth={Authorization:`ApiKey ${apiKey}`};
 const call=(path,body,{method='POST',contentType='application/json'}={})=>fetchImpl(url+path,{method,headers:{...auth,'Content-Type':contentType},body:body===undefined?undefined:(typeof body==='string'?body:JSON.stringify(body)),signal:AbortSignal.timeout(TIMEOUT_MS)});
 const ok=async(r,what)=>{if(!r.ok)throw Error(`Elastic ${what} failed: HTTP ${r.status}`);return r.json();};

 return {
  url,index,inferenceId,
  // The inference endpoint the existing index actually uses, or null when there is no index yet.
  async indexInferenceId(){
   const r=await fetchImpl(`${url}/${index}/_mapping`,{headers:auth,signal:AbortSignal.timeout(TIMEOUT_MS)});
   if(r.status===404)return null;
   const body=await ok(r,'mapping read');
   return body[index]?.mappings?.properties?.semantic?.inference_id??null;
  },
  // Creates the index if it is missing. Safe to call repeatedly; an existing index is left alone.
  // recreate:true drops it first, which is safe because every document is rebuilt from D1 on the next sync.
  async ensureIndex({recreate=false}={}){
   const head=await fetchImpl(`${url}/${index}`,{method:'HEAD',headers:auth,signal:AbortSignal.timeout(TIMEOUT_MS)});
   if(head.status===200&&!recreate)return false;
   if(head.status===200)await ok(await call(`/${index}`,undefined,{method:'DELETE'}),'index delete');
   await ok(await call(`/${index}`,mappingFor(inferenceId),{method:'PUT'}),'index create');
   return true;
  },
  // Mirrors one room's evidence: upserts everything given, then removes anything else still indexed for that room.
  async sync(roomId,docs){
   const n=new Date().toISOString();
   const lines=docs.flatMap(d=>[{index:{_index:index,_id:d.id}},{room_id:roomId,connection_id:d.connection_id,owner_id:d.owner_id??null,kind:d.kind,source:d.source??null,text:d.text,created_at:d.created_at?new Date(d.created_at).toISOString():n}]);
   if(lines.length){
    const res=await ok(await call('/_bulk?refresh=true',lines.map(l=>JSON.stringify(l)).join('\n')+'\n',{contentType:'application/x-ndjson'}),'bulk');
    const failed=(res.items??[]).map(i=>i.index??i.create).find(i=>i?.error);
    if(failed)throw Error(`Elastic bulk rejected a document: ${failed.error.type} – ${failed.error.reason}`);
   }
   const stale={query:{bool:{filter:[{term:{room_id:roomId}}],...(docs.length?{must_not:[{ids:{values:docs.map(d=>d.id)}}]}:{})}}};
   await ok(await call(`/${index}/_delete_by_query?refresh=true&conflicts=proceed`,stale),'delete_by_query');
   return docs.length;
  },
  // One hybrid query, always scoped to a single room (and optionally to particular Muses).
  async search(roomId,query,{size=12,connectionIds,excludeIds}={}){
   const filter=[{term:{room_id:roomId}}];
   if(connectionIds?.length)filter.push({terms:{connection_id:connectionIds}});
   const base=extra=>({bool:{filter,...(excludeIds?.length?{must_not:[{ids:{values:excludeIds}}]}:{}),...extra}});
   const body={size,_source:['connection_id','kind','text','source'],retriever:{rrf:{rank_window_size:Math.max(size*4,50),retrievers:[
    {standard:{query:base({must:{match:{text:{query,operator:'or'}}}})}},
    {standard:{query:base({must:{semantic:{field:'semantic',query}}})}},
   ]}}};
   const res=await ok(await call(`/${index}/_search`,body),'search');
   return (res.hits?.hits??[]).map(h=>({id:h._id,score:h._score,...h._source}));
  },
 };
}
