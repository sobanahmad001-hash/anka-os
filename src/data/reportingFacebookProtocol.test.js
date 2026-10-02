import test from 'node:test'
import assert from 'node:assert/strict'
import {createFacebookPageReportingProtocol,FACEBOOK_PAGE_METRICS} from '../../supabase/functions/_shared/reportingFacebookProtocol.js'
const pageId='123456789012345',appId='543210',userId='987654321'
const context={provider:'meta',resource_kind:'meta_facebook_page',resource_key:pageId}
const NOW=Date.parse('2026-10-02T12:00:00Z'),window={since:'2026-09-28T00:00:00Z',until:'2026-09-30T00:00:00Z'}
const debug=()=>({data:{is_valid:true,app_id:appId,profile_id:pageId,user_id:userId,issued_at:Math.floor(NOW/1000)-1000,expires_at:Math.floor(NOW/1000)+5000,data_access_expires_at:Math.floor(NOW/1000)+6000,scopes:['read_insights','pages_read_engagement'],granular_scopes:[{scope:'read_insights',target_ids:[pageId]},{scope:'pages_read_engagement'}]}})
const report=()=>({data:FACEBOOK_PAGE_METRICS.map((m,i)=>({id:`${pageId}/insights/${m.metric_key}/day`,name:m.metric_key,period:'day',values:[{value:i?7:0,end_time:'2026-09-29T07:00:00+0000'}]})),paging:{}})
function setup({debugBody=debug(),pageBody=report(),responses=null,credential=null,verifier=null,fetchError=null,afterFetch=null}={}){
 let clock=NOW;const calls=[]
 const adapter=createFacebookPageReportingProtocol({now:()=>clock,getCredential:async()=>credential??{token:'PAGE_SECRET',facebookPageId:pageId,expiresAt:'2026-10-03T00:00:00Z'},getVerifierCredential:()=>verifier??{appId,token:'DEBUG_SECRET'},fetcher:async(url,options)=>{calls.push({url,options});if(fetchError)throw fetchError;if(afterFetch)afterFetch(calls.length,()=>{clock+=7000*1000});return responses?.[calls.length-1]??new Response(JSON.stringify(calls.length===1?debugBody:pageBody),{status:200})}})
 return {adapter,calls,read:(input={})=>adapter.readPageInsights({context,window,maxValues:20,...input})}
}
test('Facebook v26 uses exactly one debug then one Page request and retains zero/native boundaries without timezone invention',async()=>{
 const s=setup(),r=await s.read();assert.equal(s.calls.length,2);assert.equal(r.request_count,2);assert.equal(r.resource_matches,true);assert.equal(r.observed_reporting_grant,true)
 assert.equal(s.adapter.maxRequestsPerDispatch,2);assert.equal(new URL(s.calls[0].url).pathname,'/v26.0/debug_token');assert.equal(new URL(s.calls[0].url).searchParams.get('input_token'),'PAGE_SECRET');assert.equal(s.calls[0].options.headers.Authorization,'Bearer DEBUG_SECRET')
 const u=new URL(s.calls[1].url);assert.equal(u.pathname,`/v26.0/${pageId}/insights`);assert.equal(u.searchParams.get('metric'),'page_media_view,page_total_media_view_unique');assert.equal(u.searchParams.get('period'),'day');assert.equal(u.searchParams.get('since'),String(Date.parse(window.since)/1000));assert.equal(u.searchParams.get('until'),String(Date.parse(window.until)/1000));assert.equal(s.calls[1].options.headers.Authorization,'Bearer PAGE_SECRET')
 for(const c of s.calls){assert.equal(c.options.method,'GET');assert.equal(c.options.redirect,'error');assert.equal(c.options.cache,'no-store')}
 assert.equal(r.rows[0].metric_value,0);assert.equal(r.rows[1].metric_value,7);assert.equal(r.rows[0].provider_end_time,'2026-09-29T07:00:00+0000');assert.equal(r.rows[0].provider_bucket_time_zone,null);assert.equal(r.rows[0].bucket_start,null);assert.equal(r.coverage,'unknown');assert.equal(r.data_through,null);assert.deepEqual(r.requested_window,window)
 assert.equal(FACEBOOK_PAGE_METRICS[1].aggregation,'non_additive');assert.equal(FACEBOOK_PAGE_METRICS[0].aggregation,'unknown');assert.doesNotMatch(JSON.stringify(r),/SECRET|impressions|reach/)
})
test('verification returns exactly the original four receipt fields and queries only documented Page metrics',async()=>{
 const s=setup(),r=await s.adapter.verifyResource({context});assert.deepEqual(Object.keys(r).sort(),['observed_at','observed_reporting_grant','resource_matches','source_evidence_sha256']);assert.match(r.source_evidence_sha256,/^[a-f0-9]{64}$/);assert.equal(new URL(s.calls[1].url).searchParams.get('date_preset'),'yesterday')
})
test('observed invalid/foreign/expired or revoked token never dispatches Page insights',async()=>{
 const edits=[d=>{d.is_valid=false},d=>{d.app_id='444444'},d=>{d.profile_id='555555'},d=>{d.expires_at=Math.floor(NOW/1000)},d=>{d.data_access_expires_at=Math.floor(NOW/1000)},d=>{d.scopes=['read_insights']},d=>{d.granular_scopes[0].target_ids=['888888']},d=>{d.granular_scopes[0].target_ids=[]}]
 for(const edit of edits){const d=debug();edit(d.data);const s=setup({debugBody:d}),r=await s.read();assert.equal(s.calls.length,1);assert.equal(r.observed_reporting_grant,false);assert.equal(r.resource_matches,false);assert.equal(r.coverage,'unavailable')}
})
test('missing/ambiguous validation metadata fails closed without fabricating a negative receipt',async()=>{
 const edits=[d=>{delete d.is_valid},d=>{delete d.profile_id},d=>{delete d.user_id},d=>{delete d.scopes},d=>{delete d.granular_scopes},d=>{d.expires_at=0},d=>{d.data_access_expires_at=0},d=>{d.issued_at=Math.floor(NOW/1000)+1},d=>{d.granular_scopes[0].target_ids=null},d=>{d.granular_scopes[0].target_ids=[9007199254740992]},d=>{d.granular_scopes.push(d.granular_scopes[0])},d=>{d.scopes.push('read_insights')}]
 for(const edit of edits){const d=debug();edit(d.data);const s=setup({debugBody:d});await assert.rejects(s.read(),/evidence unavailable/);assert.equal(s.calls.length,1)}
})
test('documented safe integer granular targets and omitted all-targets are accepted without unsafe coercion',async()=>{
 const d=debug();d.data.granular_scopes[0].target_ids=[Number(pageId)];const r=await setup({debugBody:d}).read();assert.equal(r.observed_reporting_grant,true)
})
test('missing metrics and empty datasets remain unavailable observations, never invented zero rows',async()=>{
 let r=await setup({pageBody:{data:[]}}).read();assert.equal(r.rows.length,0);assert.equal(r.missing_metrics.length,2);assert.equal(r.coverage,'unknown')
 const p=report();p.data=p.data.slice(0,1);r=await setup({pageBody:p}).read();assert.equal(r.rows.length,1);assert.deepEqual(r.missing_metrics,['page_total_media_view_unique'])
})
test('paging is bounded and never followed or exposed, even if it contains tokens or another host',async()=>{
 const p=report();p.paging.next='https://other.example/next?access_token=PAGE_SECRET';const s=setup({pageBody:p}),r=await s.read();assert.equal(s.calls.length,2);assert.equal(r.has_next,true);assert.equal(r.coverage,'partial');assert.doesNotMatch(JSON.stringify(r),/other.example|PAGE_SECRET|access_token/)
})
test('malformed, foreign, duplicate, deprecated and out-of-envelope rows cannot be normalized',async()=>{
 const edits=[p=>{p.data[0].name='page_impressions'},p=>{p.data[0].id='999999/insights/page_media_view/day'},p=>{p.data[0].period='week'},p=>{p.data[0].values[0].value=null},p=>{p.data[0].values[0].value='0'},p=>{p.data[0].values[0].value=-1},p=>{p.data[0].values[0].value=1.5},p=>{p.data[0].values[0].value=9007199254740992},p=>{p.data[0].values[0].end_time='2026-02-30T00:00:00Z'},p=>{p.data[0].values[0].end_time='2026-09-29T07:00:00+0300'},p=>{p.data[0].values[0].end_time='2026-09-01T00:00:00Z'},p=>{p.data[0].values.push(p.data[0].values[0])},p=>{p.data[1]=p.data[0]},p=>{p.paging.next=123}]
 for(const edit of edits){const p=report();edit(p);const s=setup({pageBody:p});await assert.rejects(s.read(),/evidence unavailable/);assert.equal(s.calls.length,2)}
})
test('bounded window and row policy reject before reads or before returning oversized observations',async()=>{
 for(const w of [{since:'2026-01-01T00:00:00Z',until:'2026-09-30T00:00:00Z'},{since:'2024-09-01T00:00:00Z',until:'2024-09-02T00:00:00Z'},{since:'2026-10-03T00:00:00Z',until:'2026-10-04T00:00:00Z'},{since:window.until,until:window.since},{...window,timezone:'UTC'}]){const s=setup();await assert.rejects(s.read({window:w}));assert.equal(s.calls.length,0)}
 const s=setup();await assert.rejects(s.read({maxValues:1}));assert.equal(s.calls.length,2)
})
test('wrong resource type, credential Page, or missing verifier configuration cannot dispatch',async()=>{
 let s=setup();await assert.rejects(s.read({context:{...context,resource_kind:'meta_instagram_account'}}));assert.equal(s.calls.length,0)
 for(const options of [{credential:{token:'PAGE_SECRET',facebookPageId:'555555',expiresAt:'2026-10-03T00:00:00Z'}},{verifier:{}},{verifier:{appId,token:'PAGE_SECRET'}},{credential:{token:'PAGE_SECRET',facebookPageId:pageId,expiresAt:'invalid'}}]){s=setup(options);await assert.rejects(s.read());assert.equal(s.calls.length,0)}
})
test('documented provider failures use explicit categories with no retries and sanitised errors',async()=>{
 for(const [code,reason]of [[190,'disconnected'],[104,'disconnected'],[200,'permission_denied'],[80001,'rate_limited']]){
  const s=setup({responses:[new Response(JSON.stringify({error:{code,message:'SECRET_URL'}}),{status:400,headers:{'retry-after':'60'}})]});await assert.rejects(s.read(),e=>{assert.equal(e.reason,reason);assert.doesNotMatch(String(e),/SECRET_URL/);if(code===80001)assert.equal(e.retryAfter,new Date(NOW+60000).toISOString());return true});assert.equal(s.calls.length,1)
 }
 for(const code of [100,3001,2500]){const s=setup({responses:[new Response(JSON.stringify({error:{code}}),{status:400})]});await assert.rejects(s.read(),/evidence unavailable/);assert.equal(s.calls.length,1)}
})
test('Page endpoint observed denial yields negative proof; rate and unknown errors do not',async()=>{
 for(const code of [190,200]){const s=setup({responses:[new Response(JSON.stringify(debug())),new Response(JSON.stringify({error:{code}}),{status:400})]}),r=await s.read();assert.equal(r.resource_matches,false);assert.equal(r.observed_reporting_grant,false);assert.equal(s.calls.length,2)}
 const s=setup({responses:[new Response(JSON.stringify(debug())),new Response(JSON.stringify({error:{code:80001}}),{status:400})]});await assert.rejects(s.read(),e=>e.reason==='rate_limited');assert.equal(s.calls.length,2)
})
test('network exception URLs, oversized bodies and malformed JSON never leak or become permission proof',async()=>{
 let s=setup({fetchError:new Error('https://graph.facebook.com/debug_token?input_token=PAGE_SECRET')});await assert.rejects(s.read(),e=>!String(e).includes('SECRET')&&!String(e).includes('https://'))
 for(const raw of ['{',' '.repeat(262145)]){s=setup({responses:[new Response(raw)]});await assert.rejects(s.read(),/evidence unavailable/);assert.equal(s.calls.length,1)}
})
test('cancellation and token expiry between reads deny completion and prevent further HTTP dispatch',async()=>{
 const controller=new AbortController();controller.abort();let s=setup();await assert.rejects(s.read({signal:controller.signal}));assert.equal(s.calls.length,0)
 s=setup({afterFetch:(n,advance)=>{if(n===1)advance()}});const r=await s.read();assert.equal(r.observed_reporting_grant,false);assert.equal(s.calls.length,1)
 s=setup({afterFetch:(n,advance)=>{if(n===2)advance()}});await assert.rejects(s.read(),e=>e.reason==='disconnected');assert.equal(s.calls.length,2)
})
