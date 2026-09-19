import { env } from 'cloudflare:workers';
import { getChatGPTUser, getChatGPTIdentityStatus } from '../../chatgpt-auth';
import { handle } from '../../../lib/api.mjs';
export const dynamic = 'force-dynamic';
// Owner identity comes only from Sites dispatch headers; agent requests authenticate with their bearer key inside handle().
async function route(request:Request){
  const path=new URL(request.url).pathname;
  if(path==='/api/auth/session'){
    const owner=await getChatGPTUser();
    return Response.json({mode:'chatgpt',owner:owner?{name:owner.displayName,email:owner.email}:null},{headers:{'Cache-Control':'no-store'}});
  }
  if(path.startsWith('/api/owner/') && await getChatGPTIdentityStatus()==='incomplete') {
    return Response.json({error:'identity_unavailable',message:'ChatGPT returned incomplete account information. Your room remains locked until the hosting service provides your account ID.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
  const owner=path.startsWith('/api/owner/')?await getChatGPTUser():null;
  return handle(request,env.DB,owner?{id:owner.userId,name:owner.displayName}:null);
}
export const GET=route;export const POST=route;export const PUT=route;export const DELETE=route;
