import { env } from 'cloudflare:workers';
import { getChatGPTUser, getChatGPTIdentityStatus } from '../../chatgpt-auth';
import { handle } from '../../../lib/api.mjs';
export const dynamic = 'force-dynamic';
async function route(request:Request){
  if(new URL(request.url).pathname.startsWith('/api/owner/') && await getChatGPTIdentityStatus()==='incomplete') {
    return Response.json({error:'identity_unavailable',message:'ChatGPT returned incomplete account information. Your room remains locked until the hosting service provides your account ID.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
  const owner=await getChatGPTUser();
  return handle(request,env.DB,owner?{id:owner.userId,name:owner.displayName}:null);
}
export const GET=route;export const POST=route;export const PUT=route;export const DELETE=route;
