// Standalone owner sign-in for deployments outside Sites. Owners authenticate with email and password;
// the browser holds an HttpOnly session cookie whose SHA-256 hash is stored. Agents never use this path.
import {NOW,secret,id,digest,fail,json,errorResponse,stmt,one,str,only,body,sameOrigin} from './http.mjs';

const COOKIE='cr_session',SESSION_TTL=30*86400000;
const ITERATIONS=100000; // Workers' PBKDF2 ceiling.
const MAX_FAILURES=10,LOCK_MS=15*60000;

async function hashPassword(password,saltHex){
 const salt=Uint8Array.from(saltHex.match(/../g),h=>parseInt(h,16));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},key,256);
 return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
function equal(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
const email=v=>{const e=str(v,'email',200).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))fail(422,'invalid_email','Enter a valid email address.');return e;};
function password(v){if(typeof v!=='string'||v.length<10||v.length>200)fail(422,'weak_password','Password must be 10–200 characters.');return v;}
function cookieFor(req,value,maxAge){const secure=new URL(req.url).protocol==='https:'?'; Secure':'';return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;}
const sessionToken=req=>(req.headers.get('Cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);

async function startSession(req,db,owner){
 const token=secret(),n=NOW();
 await stmt(db,'INSERT INTO sessions (id_hash,owner_id,created_at,expires_at) VALUES (?,?,?,?)',await digest(token),owner.id,n,n+SESSION_TTL).run();
 return json({mode:'password',owner:{name:owner.name,email:owner.email}},200,{'Set-Cookie':cookieFor(req,token,SESSION_TTL/1000)});
}

export async function ownerFromSession(req,db){
 const token=sessionToken(req);if(!token||!/^[a-f0-9]{64}$/.test(token)||!db)return null;
 const row=await one(db,'SELECT o.id,o.name,o.email FROM sessions s JOIN owners o ON o.id=s.owner_id WHERE s.id_hash=? AND s.expires_at>?',await digest(token),NOW());
 return row?{id:row.id,name:row.name,email:row.email}:null;
}

// env.OWNER_SIGNUP_CODE, when set, is required to create an owner account.
export async function handleAuth(req,db,env={}){try{
 const path=new URL(req.url).pathname.replace(/\/$/,''),method=req.method;
 if(!db)fail(503,'storage_unavailable','Storage is unavailable. Please retry later.');
 if(path==='/api/auth/session'&&method==='GET'){const owner=await ownerFromSession(req,db);return json({mode:'password',owner:owner?{name:owner.name,email:owner.email}:null,signup_requires_code:!!env.OWNER_SIGNUP_CODE});}
 sameOrigin(req);
 if(path==='/api/auth/signup'&&method==='POST'){
  const b=await body(req);only(b,['email','password','name','signup_code']);
  if(env.OWNER_SIGNUP_CODE&&!equal(String(b.signup_code??''),String(env.OWNER_SIGNUP_CODE)))fail(403,'signup_code_required','A valid sign-up code is required for this deployment.');
  const e=email(b.email),pw=password(b.password),name=str(b.name??e.split('@')[0],'name',80);
  if(await one(db,'SELECT id FROM owners WHERE email=?',e))fail(409,'email_taken','An account with this email already exists. Sign in instead.');
  const salt=secret(16),owner={id:id('owner'),email:e,name};
  const created=await stmt(db,'INSERT OR IGNORE INTO owners (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)',owner.id,e,name,await hashPassword(pw,salt),salt,NOW()).run();
  if(!created.meta.changes)fail(409,'email_taken','An account with this email already exists. Sign in instead.');
  return startSession(req,db,owner);
 }
 if(path==='/api/auth/login'&&method==='POST'){
  const b=await body(req);only(b,['email','password']);const e=email(b.email);
  if(typeof b.password!=='string'||!b.password)fail(422,'invalid_input','Password required.');
  const o=await one(db,'SELECT * FROM owners WHERE email=?',e);const n=NOW();
  if(o?.locked_until&&o.locked_until>n)fail(429,'locked','Too many failed attempts. Try again in 15 minutes.',{'Retry-After':String(Math.ceil((o.locked_until-n)/1000))});
  // Hash even for unknown emails so response time does not reveal which accounts exist.
  const hash=await hashPassword(b.password,o?.password_salt??'00'.repeat(16));
  if(!o||!equal(hash,o.password_hash)){if(o)await stmt(db,'UPDATE owners SET failed_logins=failed_logins+1,locked_until=CASE WHEN failed_logins+1>=? THEN ? ELSE locked_until END WHERE id=?',MAX_FAILURES,n+LOCK_MS,o.id).run();fail(401,'invalid_login','Email or password is incorrect.');}
  await stmt(db,'UPDATE owners SET failed_logins=0,locked_until=NULL WHERE id=?',o.id).run();
  return startSession(req,db,o);
 }
 if(path==='/api/auth/logout'&&method==='POST'){
  const token=sessionToken(req);if(token)await stmt(db,'DELETE FROM sessions WHERE id_hash=?',await digest(token)).run();
  return json({status:'signed_out'},200,{'Set-Cookie':cookieFor(req,'',0)});
 }
 fail(404,'not_found','Auth endpoint not found.');
}catch(err){return errorResponse(err);}}
