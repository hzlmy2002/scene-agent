import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execute} from '../dist/tools.js';
import {ApiClient} from '../dist/api.js';
const snapshot=JSON.parse(await readFile(new URL('../docs/upstream-snapshot.json',import.meta.url),'utf8'));
const fixtureApi=new ApiClient('fixture-key',async url=>{
 const p=url.pathname.replace('/apis/v1','');
 return Response.json(snapshot.operations[p].responses['200'].content['application/json'].example);
});
test('docs examples decode through real HTTP client and tool transformations',async()=>{
 const traffic=await execute('AIsa_traffic_engagement',{domains:['cnn.com'],start_month:'2026-06',end_month:'2026-06',country:'us'},fixtureApi);
 assert.equal(traffic.data[0].average_visit_duration_seconds,194.8333714917004);assert.equal(traffic.completeness.status,'complete');
 const keywords=await execute('AIsa_website_keywords',{domain:'nike.com',month:'2026-06',country:'us'},fixtureApi);
 assert.equal(keywords.data[0].keyword,'nike');assert.equal(keywords.provenance[0].reported_scope.traffic_source,'all');
 const similar=await execute('AIsa_similar_sites',{domain:'cnn.com',end_month:'2026-07'},fixtureApi);assert.equal(similar.data[0].domain,'bbc.com');
 const geo=await execute('AIsa_geography',{domains:['cnn.com']},fixtureApi);assert.ok(geo.data.length>0);
});
