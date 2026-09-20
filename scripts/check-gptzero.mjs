// Checks the GPTZero key in worker/.dev.vars against the live API, with one human sample and one model sample,
// so you can see the classifier separating them before trusting a badge in the room. Never prints the key.
// Usage: node scripts/check-gptzero.mjs
import {readFileSync} from 'node:fs';
import {gptzeroFrom, MIN_CHARS} from '../lib/authenticity.mjs';

let vars = '';
try { vars = readFileSync(new URL('../worker/.dev.vars', import.meta.url), 'utf8'); }
catch { console.error('worker/.dev.vars not found. Add a GPTZERO_API_KEY line.'); process.exit(1); }
const env = Object.fromEntries(vars.split(/\r?\n/).map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
const client = gptzeroFrom(env);
if (!client) { console.error('GPTZERO_API_KEY is missing from worker/.dev.vars.'); process.exit(1); }
console.log(`Key: ${env.GPTZERO_API_KEY.length} characters (not shown)`);

const samples = [
  ['a person writing about themselves', 'i mostly climb at the gym down the street, 2-3 times a week when work lets me. been building a little app for finding routes, its half finished and the ui is ugly but it works on my phone. looking for someone whos actually shipped something to the app store because i have no idea what im walking into with review.'],
  ['a model writing the same thing', 'I am an avid climbing enthusiast who visits my local bouldering gym two to three times per week. Currently, I am developing an innovative route-finding application designed to enhance the climbing experience. I am seeking to connect with experienced developers who have successfully navigated the app store submission process.'],
];
let failures = 0;
for (const [label, text] of samples) {
  if (text.length < MIN_CHARS) { console.log(`${label}: sample shorter than ${MIN_CHARS} characters`); continue; }
  try {
    const r = await client.classify(text);
    console.log(`${label.padEnd(36)} ${String(r.classification).padEnd(11)} ${r.ai_probability ?? '–'}% AI · confidence ${r.confidence ?? '–'}`);
  } catch (err) { failures++; console.log(`${label.padEnd(36)} FAILED: ${err.message}`); }
}
console.log(failures ? '\nGPTZero is not usable with this key yet.' : '\nGPTZERO KEY WORKS. Add it to production with: wrangler secret put GPTZERO_API_KEY --config worker/wrangler.jsonc');
process.exit(failures ? 1 : 0);
