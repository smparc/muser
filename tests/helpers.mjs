// Test harness: a D1-compatible adapter over node:sqlite with every migration in the Drizzle journal applied.
import {DatabaseSync} from 'node:sqlite';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
export const migrations=()=>JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8')).entries.map(e=>readFileSync(new URL('../drizzle/'+e.tag+'.sql',import.meta.url),'utf8'));
export function sqliteD1(){
 const dir=mkdtempSync(join(tmpdir(),'commonroom-tests-')),file=join(dir,'db.sqlite');
 const h={sql:new DatabaseSync(file)};h.sql.exec('PRAGMA foreign_keys=ON');for(const m of migrations())h.sql.exec(m);
 function statement(query,args=[]){return {bind(...a){return statement(query,a)},async first(){return h.sql.prepare(query).get(...args)??null},async all(){return {results:h.sql.prepare(query).all(...args)}},async run(){const r=h.sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}}}
 h.db={prepare:statement,async batch(list){h.sql.exec('BEGIN IMMEDIATE');try{let result=[];for(const s of list)result.push(await s.run());h.sql.exec('COMMIT');return result}catch(e){h.sql.exec('ROLLBACK');throw e}}};
 h.reopen=()=>{h.sql.close();h.sql=new DatabaseSync(file);h.sql.exec('PRAGMA foreign_keys=ON');};
 h.cleanup=()=>{try{h.sql.close();}catch{}rmSync(dir,{recursive:true,force:true});};
 return h;
}
export const origin='https://commonroom.test';
// Marks owners as having finished onboarding (every source authorized unless given), as the welcome flow would.
import {SOURCE_IDS} from '../lib/sources.mjs';
export function onboard(sql,owners,sources=SOURCE_IDS){const n=Date.now();for(const o of owners)sql.prepare('INSERT OR REPLACE INTO owner_consents (owner_id,sources_json,authorized_at,onboarding_completed_at,updated_at) VALUES (?,?,?,?,?)').run(o.id,JSON.stringify(sources),n,n,n);}
