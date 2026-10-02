import test from 'node:test'
import assert from 'node:assert/strict'
import {createFacebookReportingAdapter,FACEBOOK_REPORTING_CONTRACT} from '../../supabase/functions/_shared/reportingFacebookAdapter.js'
import {validateReportingIngestionPage} from '../../supabase/functions/_shared/reportingIngestion.js'
const id=n=>`99999999-9999-4999-8999-${String(n).padStart(12,'0')}`
const NOW=Date.parse('2026-10-02T12:00:00Z'),pageId='123456789012345',appId='543210'
const identity={organization_id:id(901),project_id:id(974),binding_id:id(7612),binding_revision_number:1,context_checksum:'a'.repeat(64),provider:'meta',resource_kind:'meta_facebook_page',resource_key:pageId,source_contract:FACEBOOK_REPORTING_CONTRACT.sourceContract,period_start:'2026-09-28',period_end:'2026-09-29',reporting_time_zone:'UTC'}
const policy={cadence_seconds:3600,history_days:366,stale_after_seconds:7200,manual_min_interval_seconds:60,daily_request_limit:4,backoff_seconds:1,max_backoff_seconds:2,max_period_days:90,max_observations:20,lease_seconds:60}
function fixture({data=null,denied=false,paging=false,endTime='2026-09-29T07:00:00+0000'}={}){
 const calls=[],events=[],context={...identity};const adapter=createFacebookReportingAdapter({manifestSha256:'b'.repeat(64),now:()=>NOW,getCredential:async()=>({facebookPageId:pageId,token:'PAGE_SECRET',expiresAt:'2026-10-03T00:00:00Z'}),getVerifierCredential:()=>({appId,token:'DEBUG_SECRET'}),getRequestAudit:()=>({claim:async ordinal=>({ordinal,permitId:crypto.randomUUID()}),record:async(p,outcome)=>events.push({ordinal:p.ordinal,outcome})}),fetcher:async(url)=>{calls.push(url);return new Response(JSON.stringify(calls.length===1?{data:{is_valid:!denied,app_id:appId,profile_id:pageId,user_id:'987654321',issued_at:Math.floor(NOW/1000)-100,expires_at:Math.floor(NOW/1000)+5000,data_access_expires_at:Math.floor(NOW/1000)+5000,scopes:['read_insights','pages_read_engagement'],granular_scopes:[{scope:'read_insights'},{scope:'pages_read_engagement'}]}}:{data:data??FACEBOOK_REPORTING_CONTRACT.metricDefinitions.map((m,i)=>({name:m.metric_key,id:`${pageId}/insights/${m.metric_key}/day`,period:'day',values:[{value:i?7:0,end_time:endTime}]})),paging:paging?{next:'https://other.invalid/?access_token=SECRET'}:{}}))}})
 return {adapter,context,calls,events,read:input=>adapter.fetchPage({identity,context,limits:policy,cursor:null,...input})}
}
test('Facebook bounded output passes native ingestion transport schema while retaining request-window versus native-bucket provenance',async()=>{
 const s=fixture(),page=await s.read(),parsed=validateReportingIngestionPage({identity,policy,metricDefinitions:s.adapter.metricDefinitions,page});assert.equal(parsed.observations.length,2);assert.equal(parsed.observations[0].metric_value,0);assert.equal(parsed.observations[1].aggregation,'non_additive');assert.equal(parsed.observations[0].aggregation,'unknown');assert.equal(page.complete,true);assert.equal(page.next_cursor,null)
 for(const row of page.observations){assert.equal(row.dimensions.provider_end_time,'2026-09-29T07:00:00+0000');assert.equal(row.dimensions.provider_bucket_time_zone,null);assert.equal(row.dimensions.bucket_start,null);assert.equal(row.dimensions.request_time_zone,'UTC');assert.equal(row.dimensions.until_inclusivity,'unknown');assert.equal(row.data_through,null);assert.equal(row.completeness,'unknown')}
 assert.equal(page.observations[0].dimensions.request_since,'2026-09-28T00:00:00.000Z');assert.equal(page.observations[0].dimensions.request_until,'2026-09-30T00:00:00.000Z');assert.equal(s.calls.length,2);assert.doesNotMatch(JSON.stringify(page),/SECRET|impressions|reach/)
})
test('empty unavailable metrics become explicit unknown records rather than zero or successful-empty absence',async()=>{
 const s=fixture({data:[]}),page=await s.read(),parsed=validateReportingIngestionPage({identity,policy,metricDefinitions:s.adapter.metricDefinitions,page});assert.equal(parsed.result_state,'complete');assert.equal(parsed.observations.length,2);assert.ok(parsed.observations.every(x=>x.value_state==='unknown'&&x.metric_value===null&&x.dimensions.coverage==='metric_not_returned'))
})
test('partial transport never follows provider URLs or hides partial source coverage',async()=>{
 const s=fixture({paging:true}),page=await s.read();assert.ok(page.observations.every(x=>x.completeness==='partial'));assert.equal(page.complete,true);assert.equal(s.calls.length,2);assert.doesNotMatch(JSON.stringify(page),/other.invalid|SECRET/)
})
test('owner timezone controls request boundaries only, including DST, without relabelling provider buckets',async()=>{
 let s=fixture(),page=await s.read({identity:{...identity,reporting_time_zone:'Asia/Karachi'}});assert.equal(page.observations[0].dimensions.request_since,'2026-09-27T19:00:00.000Z');assert.equal(page.observations[0].dimensions.provider_end_time,'2026-09-29T07:00:00+0000');assert.equal(page.observations[0].dimensions.provider_bucket_time_zone,null)
 s=fixture({endTime:'2026-03-08T07:00:00+0000'});page=await s.read({identity:{...identity,period_start:'2026-03-07',period_end:'2026-03-09',reporting_time_zone:'America/New_York'}});assert.equal(page.observations[0].dimensions.request_since,'2026-03-07T05:00:00.000Z');assert.equal(page.observations[0].dimensions.request_until,'2026-03-10T04:00:00.000Z')
})
test('current partial day is bounded at actual retrieval window, not future midnight or claimed complete provider coverage',async()=>{
 const s=fixture({endTime:'2026-10-02T07:00:00+0000'}),page=await s.read({identity:{...identity,period_start:'2026-10-02',period_end:'2026-10-02'}});assert.equal(page.observations[0].dimensions.request_until,'2026-10-02T12:00:00.000Z');assert.equal(page.observations[0].completeness,'unknown')
})
test('foreign identity, unbounded period, cursor or unsupported provider rejects without HTTP',async()=>{
 for(const input of [{identity:{...identity,context_checksum:'c'.repeat(64)}},{identity:{...identity,binding_id:id(1234)}},{identity:{...identity,source_contract:'legacy-impressions'}},{identity:{...identity,period_start:'2026-01-01'}},{cursor:'next'},{identity:{...identity,resource_kind:'meta_instagram_account'}}]){const s=fixture();await assert.rejects(s.read(input));assert.equal(s.calls.length,0)}
})
test('provider denial becomes native permission failure and never ingests values',async()=>{
 const s=fixture({denied:true});await assert.rejects(s.read(),e=>e.reason==='permission_denied');assert.equal(s.calls.length,1);assert.deepEqual(s.events,[{ordinal:1,outcome:'denied'}])
})
test('explicit unknown rows remain bounded by original observation allowance',async()=>{
 const s=fixture({data:[]});await assert.rejects(s.read({limits:{...policy,max_observations:1}}),/original row bound/);assert.equal(s.calls.length,2)
})

test('present metrics with empty arrays remain explicit unknown observations',async()=>{
 const s=fixture({data:FACEBOOK_REPORTING_CONTRACT.metricDefinitions.map(m=>({name:m.metric_key,id:`${pageId}/insights/${m.metric_key}/day`,period:'day',values:[]}))}),page=await s.read();assert.equal(page.observations.length,2);assert.ok(page.observations.every(x=>x.value_state==='unknown'&&x.metric_value===null))
})
