// Checks that the Gemini key in worker/.dev.vars works, with one small structured-output call per endpoint.
// Prints which endpoint and model answered. Never prints the key.
// Usage: node scripts/check-gemini.mjs [model]
import {readFileSync} from 'node:fs';
import {geminiJSON,geminiEndpointFor,DEFAULT_GEMINI_MODEL} from '../lib/llm.mjs';

let vars='';
try{vars=readFileSync(new URL('../worker/.dev.vars',import.meta.url),'utf8');}catch{console.error('worker/.dev.vars not found. Add a line: GEMINI_API_KEY=<your key>');process.exit(1);}
const env=Object.fromEntries(vars.split(/\r?\n/).map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)).filter(Boolean).map(m=>[m[1],m[2]]));
const key=env.GEMINI_API_KEY;
if(!key){console.error('GEMINI_API_KEY is missing from worker/.dev.vars');process.exit(1);}
const model=process.argv[2]||env.GEMINI_MODEL||DEFAULT_GEMINI_MODEL;
const guess=geminiEndpointFor(key,env.GEMINI_ENDPOINT);
console.log(`Key: ${key.length} characters, starts with "${key.slice(0,3)}" → trying the ${guess} endpoint first. Model: ${model}`);

const schema={type:'object',properties:{ok:{type:'boolean'},question:{type:'string'}},required:['ok','question']};
await (async()=>{for(const endpoint of [guess,guess==='vertex'?'studio':'vertex']){
 const started=Date.now();
 try{
  const out=await geminiJSON({apiKey:key,model,endpoint,system:'You are a test. Reply with ok=true and one short friendly question two hackathon builders could ask each other.',input:'Health check from Commonroom.',schema,maxTokens:512});
  console.log(`✓ ${endpoint}: works (${Date.now()-started} ms). Sample question: ${JSON.stringify(out.question)}`);
  if(endpoint!==guess)console.log(`  Add GEMINI_ENDPOINT=${endpoint} to worker/.dev.vars so the server uses this endpoint.`);
  process.exitCode=0;return;
 }catch(err){console.log(`✗ ${endpoint}: ${err.message}`);}
}
console.log('Neither endpoint accepted the key/model. Check the key, that the Gemini/Vertex AI API is enabled for its project, and the model name.');
process.exitCode=1;})();
