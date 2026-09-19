import test from 'node:test';
import assert from 'node:assert/strict';
import {handle,digest} from '../lib/api.mjs';
import {id,secret} from '../lib/http.mjs';
import {sqliteD1,origin,onboard} from './helpers.mjs';

const owner={id:'social-owner',name:'Social Owner'};
const token='cr_'+secret();
const bucket=new Map();
const env={MEDIA:{async put(key,value){bucket.set(key,value)},async get(key){const body=bucket.get(key);return body?{body}:null}}};
const h=sqliteD1();
const db=h.db;
onboard(h.sql,[owner]);
const now=Date.now(),room='room_social',connection='agent_social';
h.sql.prepare("INSERT INTO owners (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)").run(owner.id,'social@example.test',owner.name,'x','x',now);
h.sql.prepare("INSERT INTO rooms (id,owner_id,created_at) VALUES (?,?,?)").run(room,owner.id,now);
h.sql.prepare("INSERT INTO room_members (id,room_id,owner_id,owner_name,role,joined_at) VALUES (?,?,?,?,?,?)").run(id('mem'),room,owner.id,owner.name,'host',now);
h.sql.prepare("INSERT INTO connections (id,owner_id,room_id,name,token_hash,created_at,expires_at,source) VALUES (?,?,?,?,?,?,?,'connector')").run(connection,owner.id,room,'Muse',await digest(token),now,now+86400000);

async function call(path,method='GET',value,who=owner,extraEnv=env,authToken=token){
 const headers=new Headers();if(value instanceof Uint8Array||value instanceof ArrayBuffer){headers.set('Content-Type','image/png')}else if(value!==undefined)headers.set('Content-Type','application/json');
 if(method!=='GET')headers.set('Origin',origin);
 if(path.startsWith('/api/v1'))headers.set('Authorization','Bearer '+authToken);
 const req=new Request(origin+path,{method,headers,body:value===undefined?undefined:(value instanceof Uint8Array||value instanceof ArrayBuffer?value:JSON.stringify(value))});
 const res=await handle(req,db,who,{env:extraEnv},extraEnv);const body=res.headers.get('Content-Type')?.startsWith('image/')?new Uint8Array(await res.arrayBuffer()):await res.json();return {status:res.status,body,headers:res.headers};
}

test('social posts require an owner, R2 upload, Muse caption, and explicit approval',async()=>{
 const created=await call('/api/owner/social/posts','POST',{content_type:'image/png',byte_size:4,room_id:room});
 assert.equal(created.status,201);
 assert.equal(created.body.caption_task,null);
 assert.equal((await call('/api/social/feed')).body.posts.length,0);
 const uploaded=await call(created.body.upload_url,'PUT',new Uint8Array([1,2,3,4]));
 assert.equal(uploaded.status,200);
 const task=uploaded.body.caption_task;
 assert.ok(task);
 assert.match(task.prompt,/\/api\/v1\/social\/posts\/.+\/image/);
 assert.match(task.prompt,/Fetch and review/);
 const reply=await call(`/api/v1/tasks/${task.id}/response`,'POST',{client_message_id:'caption-1',nonce:task.nonce,text:'A safe generated caption'});
 assert.equal(reply.status,201);
 assert.equal((await call('/api/owner/social/posts/'+created.body.id+'/approve','POST',{})).status,200);
 const feed=await call('/api/social/feed');
 assert.equal(feed.body.posts.length,1);
 assert.match(feed.body.posts[0].image_url,/\/media\/social\//);
});

test('only the selected Muse can fetch a pending uploaded image',async()=>{
 const created=await call('/api/owner/social/posts','POST',{content_type:'image/png',byte_size:3,room_id:room});
 const before=await call('/api/v1/me/tasks');
 assert.equal(before.body.tasks.filter(task=>task.kind==='social_caption').length,0);
 const uploaded=await call(created.body.upload_url,'PUT',new Uint8Array([7,8,9]));
 const image=await call(`/api/v1/social/posts/${created.body.id}/image`);
 assert.equal(image.status,200);
 assert.deepEqual([...image.body],[7,8,9]);
 assert.equal(image.headers.get('Content-Type'),'image/png');
 assert.equal(image.headers.get('Content-Disposition'),'inline');
 assert.equal(image.headers.get('X-Content-Type-Options'),'nosniff');
 assert.ok(uploaded.body.caption_task);
 const other='cr_'+secret(), otherId='agent_social_other';
 h.sql.prepare("INSERT INTO connections (id,owner_id,room_id,name,token_hash,created_at,expires_at,source) VALUES (?,?,?,?,?,?,?,'connector')").run(otherId,owner.id,room,'Other',await digest(other),now,now+86400000);
 const denied=await call(`/api/v1/social/posts/${created.body.id}/image`,'GET',undefined,null,env,other);
 assert.equal(denied.status,404);
});

test('media configuration and ownership are enforced',async()=>{
 onboard(h.sql,[{id:'other'}]);
 const created=await call('/api/owner/social/posts','POST',{content_type:'image/png',byte_size:1,room_id:room});
 assert.equal((await call(created.body.upload_url,'PUT',new Uint8Array([1]),owner,{})).status,503);
 assert.equal((await call('/api/owner/social/posts/'+created.body.id+'/approve','POST',{}, {id:'other',name:'Other'})).status,404);
 assert.equal((await call('/api/owner/social/posts','POST',{content_type:'text/plain',byte_size:1,room_id:room})).status,422);
});

test.after(()=>h.cleanup());
