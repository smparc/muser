// Checks the Elastic deployment in worker/.dev.vars: creates the index if needed, indexes three sample passages,
// runs one hybrid query (BM25 + ELSER blended with RRF) and prints what came back. Never prints the key.
// The samples live in a throwaway room id and are removed again at the end.
// Pass --recreate to rebuild the index when its inference endpoint is wrong (safe: every document is rebuilt from D1).
// Usage: node scripts/check-elastic.mjs ["a search query"] [--recreate]
import {readFileSync} from 'node:fs';
import {elasticFrom} from '../lib/elastic.mjs';

let vars='';
try{vars=readFileSync(new URL('../worker/.dev.vars',import.meta.url),'utf8');}catch{console.error('worker/.dev.vars not found. Add ELASTIC_URL and ELASTIC_API_KEY lines.');process.exit(1);}
const env=Object.fromEntries(vars.split(/\r?\n/).map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const elastic=elasticFrom(env);
if(!elastic){console.error('ELASTIC_URL and/or ELASTIC_API_KEY are missing from worker/.dev.vars.');process.exit(1);}
console.log(`Deployment: ${elastic.url}\nKey: ${env.ELASTIC_API_KEY.length} characters (not shown)`);

const room='room_elastic_check';
const samples=[
 {id:'fact:check-a',connection_id:'agent_a',kind:'fact the Muse gathered from LinkedIn (seeking)',source:'linkedin',text:'Looking for a backend co-founder for a climbing app'},
 {id:'fact:check-b',connection_id:'agent_b',kind:'fact the Muse gathered from GitHub (skill)',source:'github',text:'Ships TypeScript and Postgres services, and an Expo mobile app'},
 {id:'fact:check-c',connection_id:'agent_c',kind:'fact the Muse gathered from Google Calendar (activity)',source:'google_calendar',text:'Plays tennis on Thursday evenings'},
];
const args=process.argv.slice(2),recreate=args.includes('--recreate');
const query=args.find(a=>!a.startsWith('--'))||'who could help build the server side of my app?';

try{
 const existing=await elastic.indexInferenceId();
 if(existing&&existing!==elastic.inferenceId&&!recreate){
  console.error(`✗ the index uses inference endpoint ${existing}, but this deployment is configured for ${elastic.inferenceId}.`);
  console.error('  Re-run with --recreate to rebuild the index (no data is lost: the master rebuilds it from D1).');
  process.exit(1);
 }
 const made=await elastic.ensureIndex({recreate:recreate&&!!existing});
 console.log(made?`✓ index ${existing?'recreated':'created'} (semantic_text via ${elastic.inferenceId})`:`✓ index already exists (${existing})`);
 const started=Date.now();
 await elastic.sync(room,samples);
 console.log(`✓ indexed ${samples.length} sample passages (${Date.now()-started} ms)`);
 const t=Date.now(),hits=await elastic.search(room,query,{size:3});
 console.log(`✓ hybrid search returned ${hits.length} hit(s) in ${Date.now()-t} ms for ${JSON.stringify(query)}:`);
 for(const h of hits)console.log(`   ${h.score.toFixed(4)}  ${h.id}  ${JSON.stringify(h.text)}`);
 if(hits[0]?.id==='fact:check-b')console.log('   (the semantic match won, which is the point: no word of the query appears in that passage)');
}catch(err){
 console.error('✗ '+err.message);
 console.error('  Check the deployment URL, that the API key has read/write on commonroom-evidence, and that the .elser-2-elasticsearch inference endpoint exists on this deployment.');
 process.exitCode=1;
}finally{
 await elastic.sync(room,[]).catch(()=>{}); // remove the samples
}
