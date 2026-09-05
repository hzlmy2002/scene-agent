import test from 'node:test';
import assert from 'node:assert/strict';
import {execute} from '../dist/tools.js';
import {ApiClient, ApiError, paths} from '../dist/api.js';
import {domain, output} from '../dist/schema.js';
const envelope = data => ({meta: {status: 'success', last_updated: '2026-08-01'}, data});
const kwArgs = {target_domain: 'target.com', competitor_domains: ['rival.com'], month: '2026-06'};
test('traffic aligns holes and preserves partial data with a total cap', async () => {
  const calls = [];
  const api = {async get(p,q,cap) { calls.push({p,q,cap}); if(q.domain === 'bad.com') throw new ApiError('forbidden','Access denied'); return envelope([{date:'2026-04-01',visits:0,bounce_rate:.4},{date:'2026-06-01',visits:20,bounce_rate:.3}]); }};
  const r = output.parse(await execute('AIsa_traffic_engagement',{domains:['https://GOOD.com/path','bad.com'],start_month:'2026-04',end_month:'2026-06',max_price_usd:.1},api));
  assert.equal(r.completeness.status,'partial'); assert.equal(r.data.length,3);
  assert.equal(r.data[1].visits,null); assert.equal(r.derived.find(x=>x.metric==='visits').relative_change,null);
  assert.deepEqual(calls.map(c=>c.cap),[.05,.05]); assert.equal(calls[0].q.domain,'good.com');
  assert.equal(r.completeness.failures[0].domain,'bad.com');
});
test('invalid domains, unknown parameters, duplicate domains and bad windows never call API',async()=>{
  const api={get(){assert.fail('must not call');}};
  for(const d of ['http://localhost','127.0.0.1','http://user:pass@site.com','http://site.com:8000','[::1]']) assert.equal(domain.safeParse(d).success,false);
  for(const args of [{domains:['site.com'],start_month:'2026-06',end_month:'2026-04'},{domains:['site.com','https://site.com/'],start_month:'2026-04',end_month:'2026-06'},{domains:['site.com'],start_month:'2025-01',end_month:'2026-06'}]) await assert.rejects(execute('AIsa_traffic_engagement',args,api),/unique|1–12/);
  await assert.rejects(execute('AIsa_website_keywords',{domain:'site.com',month:'2026-06',traffic_source:'Organic'},api),/Unrecognized/);
});
test('keyword gap handles grouped samples, normalization, thresholds, no difficulty fabrication',async()=>{
 const api={async get(p,q){return envelope(q.domain==='target.com' ? [[{keyword:' AI ',position:12}]] : [{keyword:'ai',position:2,clicks:100,competition:80},{keyword:'new',position:1}]);}};
 const r=await execute('AIsa_keyword_gap',kwArgs,api);
 assert.equal(r.data.find(r=>r.normalized_keyword==='ai').category,'target_weaker');
 assert.equal(r.data.find(r=>r.normalized_keyword==='new').category,'competitor_only_in_sample');
 assert.equal(r.data.find(r=>r.normalized_keyword==='ai').evidence[1].row.competition,80);
 assert.ok(!JSON.stringify(r.data).includes('difficulty'));
});
test('failed and empty targets never establish a keyword absence',async()=>{
 for(const failed of [true,false]){
 const r=await execute('AIsa_keyword_gap',kwArgs,{async get(p,q){if(q.domain==='target.com'){if(failed) throw new ApiError('upstream_error','failed');return envelope([]);}return envelope([{keyword:'new',position:1}]);}});
 assert.equal(r.data[0].category,'insufficient_data'); assert.equal(r.completeness.status,'partial');
 }
});
test('similar-sites uses exactly three months and applies sample limit',async()=>{
 const r=await execute('AIsa_similar_sites',{domain:'site.com',end_month:'2026-01',limit:1},{async get(p,q){assert.equal(q.start_date,'2025-11');assert.equal(q.end_date,'2026-01');return envelope([{domain:'rival.com',affinity:.8},{domain:'other.com'}]);}});
 assert.equal(r.data.length,1); assert.equal(r.data[0].seed_domain,'site.com');
});
test('geography preserves latest reported scope without exposing arbitrary metadata',async()=>{
 const r=await execute('AIsa_geography',{domains:['site.com']},{async get(p,q){assert.deepEqual(q,{domain:'site.com'});return {meta:{start_date:'2026-06',secret:'do-not-return'},data:{countries:[{country_code:'us',share:.4,visits:200}]}};}});
 assert.equal(r.data[0].share,.4); assert.equal(r.provenance[0].reported_scope.start_date,'2026-06'); assert.ok(!JSON.stringify(r).includes('do-not-return'));
});
test('scope mismatch rejected rather than comparing incompatible data',async()=>{
 await assert.rejects(execute('AIsa_website_keywords',{domain:'site.com',month:'2026-06',country:'us'},{async get(){return {meta:{request:{country:'ww'}},data:[]};}}),/different scope/);
});
test('Bearer is sent only to fixed AIsa API, limit is forwarded, no redirects',async()=>{
 const api=new ApiClient('test-secret',async(url,opts)=>{assert.equal(url.origin,'https://api.aisa.one');assert.equal(url.searchParams.get('domain'),'site.com');assert.equal(opts.headers.Authorization,'Bearer test-secret');assert.equal(opts.headers['X-AISA-Max-Price-USD'],'0.1');assert.equal(opts.redirect,'error');return Response.json(envelope([]));});
 await api.get(paths.keywords,{domain:'site.com'},.1);
});
test('missing key, HTTP errors, body errors, oversized and malformed responses are safe',async()=>{
 await assert.rejects(new ApiClient('').get(paths.keywords,{}),e=>e.code==='missing_credentials');
 for(const [status,code] of [[401,'unauthorized'],[402,'payment_required'],[403,'forbidden'],[429,'upstream_rate_limited'],[503,'upstream_unavailable']]){
 let count=0;const api=new ApiClient('test-secret',async()=>{count++;return new Response('test-secret',{status});});
 await assert.rejects(api.get(paths.keywords,{}),e=>e.code===code&&!e.message.includes('test-secret'));assert.equal(count,1);
 }
 for(const body of [{meta:{status:'error'},data:[]},{oops:true}]) await assert.rejects(new ApiClient('test-secret',async()=>Response.json(body)).get(paths.keywords,{}));
 await assert.rejects(new ApiClient('test-secret',async()=>new Response('a'.repeat(2_000_001))).get(paths.keywords,{}),e=>e.code==='response_too_large');
});
test('concurrency is capped at three and every domain retains its input order',async()=>{
 let active=0,max=0;
 const r=await execute('AIsa_geography',{domains:['a.com','b.com','c.com','d.com','e.com']},{async get(){active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,10));active--;return {data:{countries:[{country_code:'us'}]}};}});
 assert.equal(max,3);assert.deepEqual(r.data.map(x=>x.domain),['a.com','b.com','c.com','d.com','e.com']);
});
test('404 distinguishes explicit gateway route errors from unknown provider/resource errors',async()=>{
 for(const [body,code] of [[{error:'api endpoint not found'},'unavailable_operation'],[{error:{code:'provider_404',message:'test-secret'}},'not_found'],[{message:'no data for domain'},'not_found']]){
 const api=new ApiClient('test-secret',async()=>Response.json(body,{status:404}));
 await assert.rejects(api.get(paths.geography,{domain:'estk.me'}),e=>e.code===code&&e.status===404&&!e.message.includes('test-secret'));
 }
 await assert.rejects(new ApiClient('test-secret',async()=>new Response('x'.repeat(20_000),{status:404})).get(paths.geography,{}),e=>e.code==='not_found');
});
test('live-observed budget rejection is not mislabeled as subscription or balance failure',async()=>{
 const api=new ApiClient('test-secret',async()=>Response.json({error:{code:'estimated_price_exceeds_max_price',message:'The estimated request price exceeds the configured maximum.',retryable:false}},{status:402}));
 await assert.rejects(api.get(paths.geography,{domain:'estk.me'},.1),e=>e.code==='cost_limit_exceeded'&&e.status===402&&!e.retryable);
});
