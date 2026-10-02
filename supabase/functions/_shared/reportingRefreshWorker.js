import {reportingRefreshIdentity,reportingRefreshPolicy} from './reportingRefreshPolicy.js'
import {validateReportingIngestionPage} from './reportingIngestion.js'

// Server-only orchestration. Callers supply an explicitly installed adapter registry
// and trusted RPC transport. No adapter, credential, provider URL or cadence defaults.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const exactId=value=>{if(typeof value!=='string'||!UUID.test(value))throw new TypeError('Exact original refresh identity required');return value}
const knownFailures=new Set(['rate_limited','temporary_failure','permission_denied','disconnected'])
export class ReportingProviderFailure extends Error {
 constructor(reason,retryAfter=null){
  super('Reporting provider read did not complete');this.name='ReportingProviderFailure'
  if(!knownFailures.has(reason)||retryAfter!==null&&(typeof retryAfter!=='string'||!Number.isFinite(Date.parse(retryAfter))))throw new TypeError('Explicit adapter failure category required')
  this.reason=reason;this.retryAfter=retryAfter
 }
}
export function reportingRefreshRpcStore(client){
 if(typeof client?.rpc!=='function')throw new TypeError('Trusted server RPC client required')
 const invoke=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error){const fault=new Error('Reporting store operation failed');fault.code=error.code;throw fault}return data}
 return Object.freeze({
  claim:(jobId,claimId)=>invoke('claim_project_reporting_refresh',{p_job_id:jobId,p_claim_id:claimId}),
  commit:(jobId,claimId,page)=>invoke('commit_project_reporting_refresh_page',{p_job_id:jobId,p_claim_id:claimId,p_page:page}),
  fail:(jobId,claimId,reason,retryAfter=null)=>invoke('fail_project_reporting_refresh',{p_job_id:jobId,p_claim_id:claimId,p_reason:reason,p_retry_after:retryAfter}),
  recover:(jobId,claimId)=>invoke('get_project_reporting_refresh_claim',{p_job_id:jobId,p_claim_id:claimId}),
 })
}
export async function runReportingRefreshJob({jobId,claimId,store,adapters,now=()=>Date.now()}){
 exactId(jobId);exactId(claimId)
 for(const method of ['claim','commit','fail','recover'])if(typeof store?.[method]!=='function')throw new TypeError('Complete trusted reporting store required')
 if(!Array.isArray(adapters))throw new TypeError('Explicit installed adapter registry required')
 const unknown=()=>({state:'outcome_unknown',job_id:jobId,claim_id:claimId,dispatch_authorized:false,automatic_retry:false})
 const recover=async()=>{try{const receipt=await store.recover(jobId,claimId);return receipt?.original_result?{...receipt.original_result,dispatch_authorized:false,recovered:true}:unknown()}catch{return unknown()}}
 let claim
 try{claim=await store.claim(jobId,claimId)}catch{return recover()}
 if(claim?.dispatch_authorized!==true)return claim??unknown()
 const fail=async(reason,retryAfter=null)=>{try{return await store.fail(jobId,claimId,reason,retryAfter)}catch{return recover()}}
 let identity,policy,adapter,leaseRemaining
 try{
  if(claim.job_id!==jobId||claim.claim_id!==claimId)throw new TypeError('Original claimed job changed')
  const c=claim.context
  identity=reportingRefreshIdentity({organization_id:c.organization_id,project_id:c.project_id,binding_id:c.binding_id,binding_revision_number:c.binding_revision_number,context_checksum:c.context_checksum,provider:c.provider,resource_kind:c.resource_kind,resource_key:c.resource_key,source_contract:claim.source_contract,period_start:claim.period_start,period_end:claim.period_end,reporting_time_zone:claim.reporting_time_zone}).identity
  policy=reportingRefreshPolicy(claim.limits)
  leaseRemaining=Date.parse(claim.lease_expires_at)-now()
  if(!Number.isFinite(leaseRemaining)||leaseRemaining<=0||leaseRemaining>policy.lease_seconds*1000)throw new TypeError('Current bounded worker lease required')
  const matches=adapters.filter(a=>a.sourceContract===identity.source_contract&&a.manifestSha256===claim.manifest_sha256&&a.provider===identity.provider&&a.resourceKind===identity.resource_kind)
  if(matches.length!==1||typeof matches[0].fetchPage!=='function')return fail('disconnected')
  adapter=matches[0]
 }catch{return fail('uncertain')}
 const controller=new AbortController();let timer;let page
 try{
  // The abort is still honored when an adapter is slow. Even if it ignores the signal,
  // the worker never commits a late unobserved response or issues a second request.
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Original lease elapsed'))},Math.min(leaseRemaining,2147483647))})
  page=await Promise.race([adapter.fetchPage({identity,limits:policy,cursor:claim.cursor,signal:controller.signal}),expired])
  validateReportingIngestionPage({identity,policy,metricDefinitions:adapter.metricDefinitions,page})
 }catch(error){
  if(error instanceof ReportingProviderFailure)return fail(error.reason,error.retryAfter)
  return fail('uncertain')
 }finally{clearTimeout(timer)}
 try{return await store.commit(jobId,claimId,page)}catch(error){
  const recovered=await recover()
  if(recovered.recovered)return recovered
  // Native transaction errors are known rejections; retain the original attempted
  // read as uncertain for review. Lost acknowledgements use read-only recovery only.
  if(typeof error?.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)&&!error.code.startsWith('PGRST'))return fail('uncertain')
  return recovered
 }
}
