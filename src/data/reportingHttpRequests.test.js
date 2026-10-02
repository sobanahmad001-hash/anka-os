import test from 'node:test'
import assert from 'node:assert/strict'
import {reportingHttpRequestAudit} from '../../supabase/functions/_shared/reportingHttpRequests.js'
const claim='11111111-1111-4111-8111-111111111111',permitId='22222222-2222-4222-8222-222222222222'
const context={provider_http_claim:{kind:'verification',claim_id:claim,request_budget:2}}
function fixture({permitReply=null,recordError=false,receiptEdit=null}={}){
 const calls=[];let original=null
 const receipt=()=>{const r={claim_kind:'verification',claim_id:claim,dispatch_authorized:false,reserved_requests:2,requests:original?[{ordinal:1,permit_id:permitId,outcome:original.p_outcome,evidence_sha256:original.p_evidence_sha256,valid_until:original.p_valid_until}]:[]};receiptEdit?.(r);return r}
 const audit=reportingHttpRequestAudit({context,newId:()=>permitId,client:{rpc:async(name,args)=>{calls.push({name,args});if(name==='claim_project_reporting_http_request')return {data:permitReply??{claim_kind:'verification',claim_id:claim,ordinal:1,permit_id:permitId,dispatch_authorized:true}};if(name==='record_project_reporting_http_outcome'){original=args;if(recordError)throw new Error('Lost original outcome');return {data:receipt()}}return {data:receipt()}}}})
 return {audit,calls}
}
test('exact original reservation and ordinal produce one scoped permit RPC',async()=>{
 const s=fixture(),p=await s.audit.claim(1);assert.deepEqual(p,{ordinal:1,permitId});assert.deepEqual(s.calls,[{name:'claim_project_reporting_http_request',args:{p_kind:'verification',p_claim:claim,p_ordinal:1,p_permit:permitId}}])
})
test('replayed, broadened or foreign native permits never authorize a request',async()=>{
 for(const change of [{dispatch_authorized:false},{claim_kind:'refresh'},{claim_id:permitId},{ordinal:2},{permit_id:claim}]){const s=fixture({permitReply:{claim_kind:'verification',claim_id:claim,ordinal:1,permit_id:permitId,dispatch_authorized:true,...change}});await assert.rejects(s.audit.claim(1));assert.equal(s.calls.length,1)}
})
test('lost permit acknowledgement is never retried or recovered into a dispatch grant',async()=>{
 let n=0;const a=reportingHttpRequestAudit({context,newId:()=>permitId,client:{rpc:async()=>{n++;throw new Error('lost')}}});await assert.rejects(a.claim(1));assert.equal(n,1)
})
test('lost outcome acknowledgement reads original exact evidence once without repeating the write',async()=>{
 const s=fixture({recordError:true});await s.audit.record({ordinal:1,permitId},'validated','a'.repeat(64),'2026-10-03T00:00:00Z');assert.deepEqual(s.calls.map(x=>x.name),['record_project_reporting_http_outcome','get_project_reporting_http_claim']);assert.equal(s.calls[1].args.p_claim,claim)
})
test('altered or unknown outcome receipts stay blocked even during read-only recovery',async()=>{
 for(const edit of [r=>{r.requests=[]},r=>{r.claim_id=permitId},r=>{r.dispatch_authorized=true},r=>{r.reserved_requests=1},r=>{r.requests[0].outcome='uncertain'},r=>{r.requests[0].evidence_sha256='b'.repeat(64)},r=>{r.requests.push(r.requests[0])},r=>{r.requests[0].valid_until=null}]){const s=fixture({recordError:true,receiptEdit:edit});await assert.rejects(s.audit.record({ordinal:1,permitId},'validated','a'.repeat(64),'2026-10-03T00:00:00Z'));assert.equal(s.calls.length,2)}
})
test('missing, one-call or caller-altered reservation does not construct a two-call transport',()=>{
 for(const c of [{},{provider_http_claim:{...context.provider_http_claim,request_budget:1}},{provider_http_claim:{...context.provider_http_claim,kind:'arbitrary'}},{provider_http_claim:{...context.provider_http_claim,claim_id:'x'}}])assert.throws(()=>reportingHttpRequestAudit({context:c,client:{rpc(){assert.fail()}}}))
})
test('unbounded ordinal or malformed audit evidence rejected before any RPC',async()=>{
 const s=fixture();await assert.rejects(s.audit.claim(3));await assert.rejects(s.audit.record({ordinal:1,permitId},'success','a'.repeat(64)));await assert.rejects(s.audit.record({ordinal:1,permitId},'validated','provider payload'));assert.equal(s.calls.length,0)
})
