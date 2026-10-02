import test from 'node:test'
import assert from 'node:assert/strict'
import {createFacebookReportingAdapter} from '../../supabase/functions/_shared/reportingFacebookAdapter.js'
import {reportingHttpRequestAudit} from '../../supabase/functions/_shared/reportingHttpRequests.js'
import {runReportingVerification} from '../../supabase/functions/_shared/reportingVerificationWorker.js'
import {runReportingRefreshJob} from '../../supabase/functions/_shared/reportingRefreshWorker.js'
const id=n=>`99999999-9999-4999-8999-${String(n).padStart(12,'0')}`,now=()=>Date.parse('2026-10-02T12:00:00Z')
function fixture(kind='verification',{lostRecord=false,lostSecondPermit=false,denied=false}={}){
 const http=[],rpc=[],records=[],claimId=id(1),jobId=id(2),challengeId=id(3),page='123456789012345'
 const context={organization_id:id(901),project_id:id(974),binding_id:id(410),connection_id:id(411),binding_revision_number:1,context_checksum:'b'.repeat(64),provider:'meta',resource_kind:'meta_facebook_page',resource_key:page,provider_http_claim:{kind,claim_id:claimId,request_budget:2}}
 const receipt=()=>({claim_kind:kind,claim_id:claimId,reserved_requests:2,dispatch_authorized:false,requests:records})
 const client={rpc:async(name,a)=>{rpc.push(name)
  if(name==='claim_project_reporting_http_request'){
   records.push({ordinal:a.p_ordinal,permit_id:a.p_permit,outcome:null,evidence_sha256:null,valid_until:null})
   if(lostSecondPermit&&a.p_ordinal===2)throw new Error('lost permit')
   return {data:{claim_kind:kind,claim_id:claimId,ordinal:a.p_ordinal,permit_id:a.p_permit,dispatch_authorized:true}}
  }
  if(name==='record_project_reporting_http_outcome'){
   const row=records.find(x=>x.permit_id===a.p_permit);Object.assign(row,{outcome:a.p_outcome,evidence_sha256:a.p_evidence_sha256,valid_until:a.p_valid_until})
   if(lostRecord&&row.ordinal===1)throw new Error('lost original outcome acknowledgement')
   return {data:receipt()}
  }
  if(name==='get_project_reporting_http_claim')return {data:receipt()}
  throw new Error('Unexpected native RPC')
 }}
 const adapter=createFacebookReportingAdapter({manifestSha256:'a'.repeat(64),now,getCredential:async()=>({token:'PAGE_SECRET',facebookPageId:page,expiresAt:'2026-10-03T00:00:00Z'}),getVerifierCredential:()=>({appId:'543210',token:'DEBUG_SECRET'}),getRequestAudit:c=>reportingHttpRequestAudit({client,context:c}),fetcher:async url=>{http.push(url);return new Response(JSON.stringify(http.length===1?{data:{is_valid:!denied,app_id:'543210',profile_id:page,user_id:'987654',issued_at:Math.floor(now()/1000)-100,expires_at:Math.floor(now()/1000)+3600,data_access_expires_at:Math.floor(now()/1000)+3600,scopes:['read_insights','pages_read_engagement'],granular_scopes:[{scope:'read_insights'},{scope:'pages_read_engagement'}]}}:{data:[{name:'page_media_view',id:page+'/insights/page_media_view/day',period:'day',values:[{value:0,end_time:'2026-10-01T07:00:00+0000'}]}]}))}})
 const limits={cadence_seconds:3600,history_days:30,stale_after_seconds:7200,manual_min_interval_seconds:60,daily_request_limit:4,backoff_seconds:1,max_backoff_seconds:2,max_period_days:7,max_observations:25,lease_seconds:60}
 const claim={challenge_id:challengeId,job_id:jobId,claim_id:claimId,dispatch_authorized:true,context,source_contract:adapter.sourceContract,manifest_sha256:adapter.manifestSha256,limits,claimed_at:'2026-10-02T12:00:00Z',lease_expires_at:'2026-10-02T12:01:00Z',period_start:'2026-10-01',period_end:'2026-10-01',reporting_time_zone:'UTC',cursor:null}
 const completed=[],store={claim:async()=>claim,complete:async(_q,_c,result)=>{completed.push(result);return {state:'completed',dispatch_authorized:false}},commit:async(_j,_c,page)=>{completed.push(page);return {state:'succeeded',dispatch_authorized:false}},fail:async(_j,_c,reason)=>({state:reason,dispatch_authorized:false}),recover:async()=>null}
 return {claim,records,http,rpc,completed,run:()=>kind==='verification'?runReportingVerification({challengeId,claimId,store,adapters:[adapter],now}):runReportingRefreshJob({jobId,claimId,store,adapters:[adapter],now})}
}
test('original verification worker performs exactly two permitted audited calls and completes original proof',async()=>{
 const s=fixture();assert.equal((await s.run()).state,'completed');assert.equal(s.http.length,2);assert.deepEqual(s.records.map(x=>x.outcome),['validated','validated']);assert.equal(s.completed[0].source_evidence_sha256,s.records[1].evidence_sha256);assert.doesNotMatch(JSON.stringify(s.completed),/SECRET/)
})
test('original refresh worker ingests exact zero plus missing metric unknown after two permits',async()=>{
 const s=fixture('refresh');assert.equal((await s.run()).state,'succeeded');assert.equal(s.http.length,2);assert.equal(s.completed[0].observations[0].metric_value,0);assert.equal(s.completed[0].observations[1].value_state,'unknown');assert.equal(s.completed[0].observations[1].metric_value,null)
})
test('claim replay and absent reservation never execute HTTP or complete proof',async()=>{
 for(const mode of ['replay','unreserved']){const s=fixture();if(mode==='replay')s.claim.dispatch_authorized=false;else delete s.claim.context.provider_http_claim;await s.run();assert.equal(s.http.length,0);assert.equal(s.completed.length,0)}
})
test('lost first outcome acknowledgement uses exact read recovery before second HTTP without repeat write',async()=>{
 const s=fixture('verification',{lostRecord:true});assert.equal((await s.run()).state,'completed');assert.equal(s.http.length,2);assert.deepEqual(s.rpc,['claim_project_reporting_http_request','record_project_reporting_http_outcome','get_project_reporting_http_claim','claim_project_reporting_http_request','record_project_reporting_http_outcome'])
})
test('lost second permit acknowledgement never dispatches or retries the second request',async()=>{
 const s=fixture('verification',{lostSecondPermit:true});assert.equal((await s.run()).state,'outcome_unknown');assert.equal(s.http.length,1);assert.equal(s.completed.length,0);assert.equal(s.rpc.filter(x=>x==='claim_project_reporting_http_request').length,2)
})
test('exact debug denial completes negative verification or native refresh failure without ingestion',async()=>{
 let s=fixture('verification',{denied:true});assert.equal((await s.run()).state,'completed');assert.equal(s.completed[0].observed_reporting_grant,false);assert.equal(s.http.length,1)
 s=fixture('refresh',{denied:true});assert.equal((await s.run()).state,'permission_denied');assert.equal(s.completed.length,0);assert.equal(s.http.length,1);assert.equal(s.records[0].outcome,'denied')
})
