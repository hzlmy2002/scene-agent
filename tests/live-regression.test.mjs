import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ApiClient} from '../dist/api.js';
import {execute} from '../dist/tools.js';
const recorded=JSON.parse(await readFile(new URL('./fixtures/live-2026-09-05.json',import.meta.url),'utf8'));
const api=new ApiClient('fixture-key',async url=>{
 const trace=recorded.requests.find(r=>r.url===String(url));
 assert.ok(trace,`No recorded response for ${url}`);
 return Response.json(trace.body,{status:trace.status});
});
for(const tool of recorded.tools) test(`live response replay: ${tool.name}`,async()=>{
 const result=await execute(tool.name,tool.args,api);
 assert.ok(result.data.length>0);
 assert.deepEqual(result.completeness.failures,[]);
 if(tool.args.domains?.includes('estk.me')){
  assert.equal(result.completeness.status,'partial');
  assert.ok(result.warnings.some(w=>w.includes('estk.me: Similarweb has no data')));
 }
});
test('single-domain real no-data response becomes empty success, not authentication or route error',async()=>{
 const result=await execute('AIsa_geography',{domains:['estk.me']},api);
 assert.equal(result.completeness.status,'empty');assert.deepEqual(result.data,[]);
 assert.equal(result.provenance[0].status,'empty');
 assert.equal(result.provenance[0].reported_scope.start_date,'2026-07-01');
});
