// Standalone Cloudflare Worker entry: static dashboard assets, owner sign-in, the agent REST API and the MCP adapter.
// Owner identity comes only from the session cookie; agent identity only from the bearer key.
import {handle} from '../lib/api.mjs';
import {handleAuth,ownerFromSession} from '../lib/owner-auth.mjs';
import {handleMcp} from '../lib/mcp.mjs';
import {openapiSpec} from '../lib/openapi.mjs';

const PUBLIC_HEADERS={'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};

export default {
 async fetch(req,env){
  const url=new URL(req.url),path=url.pathname;
  if(path==='/openapi.json')return Response.json(openapiSpec(url.origin),{headers:PUBLIC_HEADERS});
  if(path==='/agent-guide.md'){
   const asset=await env.ASSETS.fetch(new Request(new URL('/agent-guide.md',url)));
   return new Response((await asset.text()).replaceAll('{{ORIGIN}}',url.origin),{headers:{...PUBLIC_HEADERS,'Content-Type':'text/markdown; charset=utf-8'}});
  }
  if(path==='/mcp'||path==='/mcp/')return handleMcp(req,env.DB);
  if(path.startsWith('/api/auth/'))return handleAuth(req,env.DB,env);
  if(path.startsWith('/api/')){
   const owner=path.startsWith('/api/owner')?await ownerFromSession(req,env.DB):null;
   return handle(req,env.DB,owner);
  }
  if(path==='/')return Response.redirect(new URL('/connect.html',url),302);
  const res=await env.ASSETS.fetch(req);
  const headers=new Headers(res.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');
  return new Response(res.body,{status:res.status,headers});
 },
};
