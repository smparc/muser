import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';import {handleMcp} from '../lib/mcp.mjs';import {onboard,sqliteD1,origin} from './helpers.mjs';
const h=sqliteD1(),owner={id:'owner-mcp',name:'Host'},other={id:'owner-mcp-2',name:'Other'};
onboard(h.sql,[owner,other]);
const ownerCall=async(path,method,body,who=owner)=>(await handle(new Request(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin},body:body===undefined?undefined:JSON.stringify(body)}),h.db,who)).json();
let id=0;
async function mcp(token,method,params,headers={}){const r=await handleMcp(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}),h.db);return {status:r.status,body:r.status===202?null:await r.json()};}
const call=async(token,name,args={})=>(await mcp(token,'tools/call',{name,arguments:args})).body.result;
let key,other_key;

test('MCP requires the Commonroom bearer key',async()=>{
 key=(await ownerCall('/api/owner/connections','POST',{agent_name:'MCP Muse'})).access_token;
 const r=await mcp(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}});
 assert.equal(r.status,401);
 assert.equal((await mcp('cr_'+'0'.repeat(64),'tools/list')).status,401);
 assert.equal((await mcp(key,'ping',{}, {Origin:'https://evil.test'})).status,403);
 const get=await handleMcp(new Request(origin+'/mcp',{headers:{Authorization:'Bearer '+key}}),h.db);assert.equal(get.status,405);
});

test('initialize and tools/list expose the seven agent tools',async()=>{
 const init=await mcp(key,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}});
 assert.equal(init.status,200);assert.equal(init.body.result.protocolVersion,'2025-06-18');assert.ok(init.body.result.capabilities.tools);
 const note=await handleMcp(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})}),h.db);
 assert.equal(note.status,202);
 const tools=(await mcp(key,'tools/list')).body.result.tools.map(t=>t.name).sort();
 assert.deepEqual(tools,['get_connection','get_context','get_room','get_tasks','respond_to_task','set_context','update_profile']);
 assert.equal((await mcp(key,'no/such')).body.error.code,-32601);
});

test('tools share REST behavior, scopes and idempotency',async()=>{
 const me=await call(key,'get_connection');assert.equal(me.isError,false);assert.equal(me.structuredContent.agent_name,'MCP Muse');
 const s=await ownerCall('/api/owner/state','GET');assert.equal(s.connections[0].status,'connected');
 const {tasks}=(await call(key,'get_tasks')).structuredContent;assert.equal(tasks.length,1);
 const t=tasks[0],args={task_id:t.id,client_message_id:'mcp-1',nonce:t.nonce,text:'Hello from MCP.'};
 assert.equal((await call(key,'respond_to_task',{...args,nonce:'bad'})).isError,true);
 assert.equal((await call(key,'respond_to_task',args)).structuredContent.replayed,false);
 assert.equal((await call(key,'respond_to_task',args)).structuredContent.replayed,true);
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM responses').get().n,1);
 other_key=(await ownerCall('/api/owner/connections','POST',{agent_name:'Other'},other)).access_token;
 const cross=await call(other_key,'respond_to_task',args);assert.equal(cross.isError,true);assert.equal(cross.structuredContent.status,404);
 assert.equal((await call(other_key,'get_room')).structuredContent.messages.length,0);
 const p=await call(key,'update_profile',{expected_revision:0,interests:['climbing'],sharing_confirmed:true});
 assert.equal(p.structuredContent.revision,1);
 assert.equal((await call(key,'update_profile',{expected_revision:0,interests:['x'],sharing_confirmed:true,secret_memory:'no'})).isError,true);
 h.cleanup();
});
