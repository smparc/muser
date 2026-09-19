// Writes the static connector spec. The standalone Worker also serves /openapi.json dynamically with its live origin.
// Usage: COMMONROOM_ORIGIN=https://your-deployment.example node scripts/write-openapi.mjs
import {writeFileSync} from 'node:fs';
import {openapiSpec} from '../lib/openapi.mjs';
const origin=(process.argv[2]??process.env.COMMONROOM_ORIGIN??'https://commonroom.example').replace(/\/$/,'');
writeFileSync(new URL('../public/openapi.json',import.meta.url),JSON.stringify(openapiSpec(origin),null,2)+'\n');
console.log('Wrote public/openapi.json for',origin);
