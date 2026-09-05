import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
if(!process.argv[2]) throw Error('Usage: node scripts/check-contract.mjs /path/to/docs/openapi/similarweb.json');
const snapshot=JSON.parse(await readFile(new URL('../docs/upstream-snapshot.json',import.meta.url),'utf8'));
const live=JSON.parse(await readFile(process.argv[2],'utf8'));
let changed=false;
for(const [path,operation] of Object.entries(snapshot.operations)) if(!isDeepStrictEqual(operation,live.paths?.[path]?.get)){console.error(`Changed operation: ${path}`);changed=true;}
if(changed)process.exitCode=1;else console.log('All four upstream operation definitions match the pinned snapshot.');
