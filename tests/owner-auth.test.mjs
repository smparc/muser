import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';import {sqliteD1,origin} from './helpers.mjs';
const h=sqliteD1();
const assets={fetch:async r=>new URL(r.url).pathname==='/agent-guide.md'?new Response('Base origin: {{ORIGIN}}'):new Response('static',{headers:{'Content-Type':'text/html'}})};
const env=(extra={})=>({DB:h.db,ASSETS:assets,...extra});
async function call(path,method='GET',body,{cookie,originHeader=origin,token,envExtra}={}){const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(method!=='GET')headers.Origin=originHeader;if(cookie)headers.Cookie=cookie;if(token)headers.Authorization='Bearer '+token;const r=await worker.fetch(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env(envExtra));const text=await r.text();let json;try{json=JSON.parse(text);}catch{}return {status:r.status,headers:r.headers,body:json??text};}
const cookieOf=r=>r.headers.get('Set-Cookie').split(';')[0];
let alice,bob;
// The welcome flow: choose sources (none here), then finish onboarding.
const finishOnboarding=async cookie=>{assert.equal((await call('/api/owner/sources','PUT',{sources:[]},{cookie})).status,200);assert.equal((await call('/api/owner/onboarding/complete','POST',{},{cookie})).status,200);};

test('sign-up creates a session cookie that unlocks only owner routes',async()=>{
 assert.equal((await call('/api/auth/session')).body.owner,null);
 assert.equal((await call('/api/owner/state')).status,401);
 assert.equal((await call('/api/auth/signup','POST',{email:'alice@example.com',password:'short'})).status,422);
 assert.equal((await call('/api/auth/signup','POST',{email:'alice@example.com',password:'correct horse battery'},{originHeader:'https://evil.test'})).status,403);
 const r=await call('/api/auth/signup','POST',{email:'Alice@Example.com',password:'correct horse battery',name:'Alice'});
 assert.equal(r.status,200);assert.match(r.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax/);alice=cookieOf(r);
 assert.equal((await call('/api/auth/signup','POST',{email:'alice@example.com',password:'another password'})).status,409);
 assert.equal((await call('/api/auth/session','GET',undefined,{cookie:alice})).body.owner.name,'Alice');
 assert.equal((await call('/api/owner/state','GET',undefined,{cookie:alice})).body.error,'onboarding_required');
 await finishOnboarding(alice);
 assert.equal((await call('/api/owner/state','GET',undefined,{cookie:alice})).status,200);
 const stored=h.sql.prepare('SELECT password_hash,password_salt FROM owners').get();assert.notEqual(stored.password_hash,'correct horse battery');
 assert.ok(!h.sql.prepare('SELECT id_hash FROM sessions').all().some(s=>alice.includes(s.id_hash)));
});

test('login, lockout-free failure, logout',async()=>{
 assert.equal((await call('/api/auth/login','POST',{email:'alice@example.com',password:'wrong password!'})).status,401);
 assert.equal((await call('/api/auth/login','POST',{email:'nobody@example.com',password:'wrong password!'})).status,401);
 const r=await call('/api/auth/login','POST',{email:'alice@example.com',password:'correct horse battery'});assert.equal(r.status,200);
 const second=cookieOf(r);
 assert.equal((await call('/api/auth/logout','POST',{},{cookie:second})).status,200);
 assert.equal((await call('/api/owner/state','GET',undefined,{cookie:second})).status,401);
 assert.equal((await call('/api/owner/state','GET',undefined,{cookie:alice})).status,200);
});

test('repeated failures lock the account',async()=>{
 await call('/api/auth/signup','POST',{email:'lock@example.com',password:'correct horse battery'});
 for(let i=0;i<10;i++)await call('/api/auth/login','POST',{email:'lock@example.com',password:'bad password '+i});
 const r=await call('/api/auth/login','POST',{email:'lock@example.com',password:'correct horse battery'});
 assert.equal(r.status,429);assert.ok(r.headers.get('Retry-After'));
});

test('owners are isolated; keys and cookies are not interchangeable',async()=>{
 bob=cookieOf(await call('/api/auth/signup','POST',{email:'bob@example.com',password:'another long password'}));await finishOnboarding(bob);
 const issued=await call('/api/owner/connections','POST',{agent_name:"Alice's Muse"},{cookie:alice});
 assert.equal(issued.status,201);const key=issued.body.access_token,cid=issued.body.connection_id;
 assert.equal((await call('/api/owner/connections/'+cid+'/token','POST',{},{cookie:bob})).status,404);
 assert.equal((await call('/api/owner/connections/'+cid,'DELETE',undefined,{cookie:bob})).status,404);
 assert.equal((await call('/api/owner/state','GET',undefined,{cookie:bob})).body.connections.length,0);
 assert.equal((await call('/api/v1/me','GET',undefined,{cookie:alice})).status,401);
 assert.equal((await call('/api/owner/state','GET',undefined,{token:key})).status,401);
 assert.equal((await call('/api/v1/me','GET',undefined,{token:key})).status,200);
 assert.equal((await call('/api/owner/connections','POST',{agent_name:'x'},{cookie:alice,originHeader:'https://evil.test'})).status,403);
});

test('optional sign-up code gates new owners',async()=>{
 const envExtra={OWNER_SIGNUP_CODE:'htn-2026'};
 assert.equal((await call('/api/auth/session','GET',undefined,{envExtra})).body.signup_requires_code,true);
 assert.equal((await call('/api/auth/signup','POST',{email:'c@example.com',password:'correct horse battery'},{envExtra})).status,403);
 assert.equal((await call('/api/auth/signup','POST',{email:'c@example.com',password:'correct horse battery',signup_code:'htn-2026'},{envExtra})).status,200);
});

test('worker serves live-origin spec and guide, and redirects the root',async()=>{
 const spec=await call('/openapi.json');assert.equal(spec.body.servers[0].url,origin);
 assert.equal((await call('/agent-guide.md')).body,'Base origin: '+origin);
 const root=await worker.fetch(new Request(origin+'/'),env());assert.equal(root.status,302);
 h.cleanup();
});

test('PUBLIC_ORIGIN rewrites the origin seen behind a tunnel',async()=>{
 const h2=sqliteD1();const pub='https://room.example.com';
 const e={DB:h2.db,ASSETS:assets,PUBLIC_ORIGIN:pub};
 const spec=await (await worker.fetch(new Request('http://127.0.0.1:8787/openapi.json'),e)).json();assert.equal(spec.servers[0].url,pub);
 const r=await worker.fetch(new Request('http://127.0.0.1:8787/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json',Origin:pub},body:JSON.stringify({email:'t@example.com',password:'correct horse battery'})}),e);
 assert.equal(r.status,200);assert.match(r.headers.get('Set-Cookie'),/Secure/);
 h2.cleanup();
});
