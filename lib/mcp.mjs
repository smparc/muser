// Stateless MCP adapter (Streamable HTTP transport, JSON responses) around the same agent operations and
// scopes as the REST API. It authenticates with the same Commonroom bearer key; OAuth is not offered.
import {authenticate,agent} from './api.mjs';
import {ApiError,json,errorResponse,object} from './http.mjs';
import {OPERATIONS,profileInput,responseInput,contextInput} from './openapi.mjs';
import {setContext,getContext} from './context.mjs';
import {CONVERSATION_STYLE} from './conversation-turn.mjs';

const VERSIONS=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
const empty={type:'object',properties:{},additionalProperties:false};
const TOOLS=[
 {name:'get_connection',inputSchema:empty,annotations:{readOnlyHint:true},run:(db,c)=>agent.getConnection(db,c)},
 {name:'get_room',inputSchema:empty,annotations:{readOnlyHint:true},run:(db,c)=>agent.getRoom(db,c)},
 {name:'update_profile',inputSchema:profileInput,annotations:{readOnlyHint:false,idempotentHint:false},run:(db,c,a)=>agent.updateProfile(db,c,a)},
 {name:'set_context',inputSchema:contextInput,annotations:{readOnlyHint:false,idempotentHint:true},run:(db,c,a)=>setContext(db,c,a)},
 {name:'get_context',inputSchema:empty,annotations:{readOnlyHint:true},run:(db,c)=>getContext(db,c)},
 {name:'get_tasks',inputSchema:empty,annotations:{readOnlyHint:true},run:(db,c)=>agent.getTasks(db,c)},
 {name:'respond_to_task',inputSchema:{...responseInput,properties:{task_id:{type:'string',minLength:1,maxLength:100,description:'Task ID from get_tasks'},...responseInput.properties},required:['task_id',...responseInput.required]},annotations:{readOnlyHint:false,idempotentHint:true},run:(db,c,{task_id,...rest},runtime)=>agent.respond(db,c,task_id,rest,runtime.onObserve,runtime.master?.onRoundReply)},
];
const INSTRUCTIONS='Commonroom connects you to your owner\'s shared room. Call get_connection to confirm access once, get_tasks to read your inbox, and respond_to_task with the exact nonce. '+CONVERSATION_STYLE;

const rpc=(id,result)=>({jsonrpc:'2.0',id,result});
const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});

async function dispatch(db,c,msg,runtime={}){
 if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return rpcError(msg?.id,-32600,'Invalid JSON-RPC request.');
 const isNotification=msg.id===undefined;
 if(isNotification)return null;
 const params=msg.params??{};
 switch(msg.method){
  case 'initialize':{const requested=params.protocolVersion;return rpc(msg.id,{protocolVersion:VERSIONS.includes(requested)?requested:VERSIONS[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'commonroom',title:'Commonroom',version:'2.0.0'},instructions:INSTRUCTIONS});}
  case 'ping':return rpc(msg.id,{});
  case 'tools/list':return rpc(msg.id,{tools:TOOLS.map(({name,inputSchema,annotations})=>({name,description:OPERATIONS[name],inputSchema,annotations}))});
  case 'tools/call':{
   const tool=TOOLS.find(t=>t.name===params.name);if(!tool)return rpcError(msg.id,-32602,`Unknown tool: ${params.name}`);
   try{const args=object(params.arguments??{});const out=await tool.run(db,c,args,runtime);return rpc(msg.id,{content:[{type:'text',text:JSON.stringify(out.body)}],structuredContent:out.body,isError:false});}
   catch(err){if(!(err instanceof ApiError))throw err;const detail={error:err.code,message:err.message,status:err.status};return rpc(msg.id,{content:[{type:'text',text:JSON.stringify(detail)}],structuredContent:detail,isError:true});}
  }
  default:return rpcError(msg.id,-32601,`Method not found: ${msg.method}`);
 }
}

export async function handleMcp(req,db,runtime={}){try{
 const url=new URL(req.url);
 // Browsers may only reach this endpoint from our own origin (DNS-rebinding protection); server-side connectors send no Origin.
 const origin=req.headers.get('Origin');if(origin&&origin!==url.origin)return json({error:'origin_forbidden',message:'Cross-origin MCP requests are not allowed.'},403);
 if(req.method!=='POST')return json({error:'method_not_allowed',message:'This MCP endpoint is stateless: POST JSON-RPC messages. No SSE stream is offered.'},405,{Allow:'POST'});
 if(!db)return json({error:'storage_unavailable',message:'Storage is unavailable. Please retry later.'},503,{'Retry-After':'30'});
 let payload;try{payload=JSON.parse(await req.text());}catch{return json(rpcError(null,-32700,'Parse error.'),400);}
 const c=await authenticate(req,db);
 const batch=Array.isArray(payload);const results=[];
 for(const msg of batch?payload:[payload]){const r=await dispatch(db,c,msg,runtime);if(r)results.push(r);}
 if(!results.length)return new Response(null,{status:202});
 return json(batch?results:results[0]);
}catch(err){return errorResponse(err);}}
