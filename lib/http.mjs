// Shared request, response and storage helpers for the REST API, owner sign-in and MCP adapter.
export const NOW=()=>Date.now();
const HEX=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export const secret=(n=32)=>HEX(crypto.getRandomValues(new Uint8Array(n)));
export const id=prefix=>prefix+'_'+crypto.randomUUID();
export const digest=async value=>HEX(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
export class ApiError extends Error{constructor(status,code,message,headers={}){super(message);this.status=status;this.code=code;this.headers=headers;}}
export const fail=(status,code,message,headers)=>{throw new ApiError(status,code,message,headers)};
const BASE_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{...BASE_HEADERS,...headers}});
// Retry guidance for clients: rate limits and transient failures carry Retry-After.
const RETRY_AFTER={429:'60',500:'5',503:'30'};
export function errorResponse(err){
 if(err instanceof ApiError){const headers={...err.headers};if(RETRY_AFTER[err.status])headers['Retry-After']??=RETRY_AFTER[err.status];return json({error:err.code,message:err.message},err.status,headers);}
 console.error('Commonroom request failed',err?.name);
 return json({error:'internal_error',message:'Request failed. Retry safely using the same client_message_id for a reply.'},500,{'Retry-After':RETRY_AFTER[500]});
}
export const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export const one=(db,sql,...args)=>stmt(db,sql,...args).first();
export const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results;
export function str(value,label,max=1000){if(typeof value!=='string'||!value.trim()||value.length>max)fail(422,'invalid_input',`${label} must be nonempty text up to ${max} characters.`);return value.trim();}
export function only(b,keys){if(Object.keys(b).some(k=>!keys.includes(k)))fail(422,'unknown_field','Unexpected field in request.');}
export function object(b){if(!b||Array.isArray(b)||typeof b!=='object')fail(422,'invalid_input','JSON object required.');return b;}
export async function body(req){if(!req.headers.get('Content-Type')?.includes('application/json'))fail(415,'json_required','Use Content-Type: application/json.');let bytes=0,chunks=[];const reader=req.body?.getReader();if(!reader)fail(400,'invalid_json','JSON body required.');while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16000){await reader.cancel();fail(413,'body_too_large','Maximum JSON body is 16 KB.');}chunks.push(value);}let b;try{const buf=new Uint8Array(bytes);let off=0;for(const c of chunks){buf.set(c,off);off+=c.length;}b=JSON.parse(new TextDecoder().decode(buf));}catch{fail(400,'invalid_json','Malformed JSON.');}return object(b);}
// Browser mutations must come from this origin; agents never use cookie-authenticated routes.
export function sameOrigin(req){const url=new URL(req.url);if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.get('Origin')!==url.origin)fail(403,'origin_required','Owner mutations require the same-origin browser.');}
