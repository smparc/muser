// Standalone Cloudflare Worker entry: static dashboard assets, owner sign-in, the agent REST API and the MCP adapter.
// Owner identity comes only from the session cookie; agent identity only from the bearer key.
import {handle,mediaResponse} from '../lib/api.mjs';
import {handleAuth,ownerFromSession} from '../lib/owner-auth.mjs';
import {handleMcp} from '../lib/mcp.mjs';
import {openapiSpec} from '../lib/openapi.mjs';
import {setupPage} from '../lib/setup-links.mjs';
import {masterRuntime} from '../lib/master-runtime.mjs';

const PUBLIC_HEADERS={'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};

export default {
 async fetch(req,env,ctx){
  // Behind a tunnel or proxy the Worker sees an internal URL; PUBLIC_ORIGIN makes the spec, guide and same-origin checks use the public one.
  if(env.PUBLIC_ORIGIN){const inner=new URL(req.url),pub=new URL(env.PUBLIC_ORIGIN);if(inner.origin!==pub.origin)req=new Request(new URL(inner.pathname+inner.search,pub.origin),req);}
  const url=new URL(req.url),path=url.pathname;
  if(path==='/openapi.json')return Response.json(openapiSpec(url.origin),{headers:PUBLIC_HEADERS});
  if(path==='/agent-guide.md'){
   const asset=await env.ASSETS.fetch(new Request(new URL('/agent-guide.md',url)));
   return new Response((await asset.text()).replaceAll('{{ORIGIN}}',url.origin),{headers:{...PUBLIC_HEADERS,'Content-Type':'text/markdown; charset=utf-8'}});
  }
  const runtime=masterRuntime(env.DB,env,ctx?.waitUntil?work=>ctx.waitUntil(work):undefined);
  // A QR setup link: instructions for the Muse that scanned it (reading does not use the code).
  const setup=path.match(/^\/s\/([^/]+)$/);
  if(setup&&(req.method==='GET'||req.method==='HEAD')){const p=await setupPage(env.DB,setup[1],url.origin);return new Response(p.text,{status:p.status,headers:{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'}});}
  if(path==='/mcp'||path==='/mcp/')return handleMcp(req,env.DB,runtime);
  if(path.startsWith('/api/auth/'))return handleAuth(req,env.DB,env);
  if(path.startsWith('/api/')){
   const owner=path.startsWith('/api/owner')?await ownerFromSession(req,env.DB):null;
   return handle(req,env.DB,owner,runtime,env);
  }
  if(path.startsWith('/media/social/'))return mediaResponse(req,env.DB,env);
  if(path==='/')return Response.redirect(new URL('/room3d.html',url),302);
  const res=await env.ASSETS.fetch(req);
  const headers=new Headers(res.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');
  return new Response(res.body,{status:res.status,headers});
 },
};
