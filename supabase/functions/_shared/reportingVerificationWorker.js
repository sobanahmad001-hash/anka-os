// Server-only original-challenge worker. Adapters must explicitly verify this resource;
// registry identity and native one-use dispatch permission are both mandatory.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH=/^[a-f0-9]{64}$/
export function reportingVerificationRpcStore(client){
 if(typeof client?.rpc!=='function')throw new TypeError('Trusted server RPC client required')
 const invoke=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error){const e=new Error('Verification store operation failed');e.code=error.code;throw e}return data}
 return Object.freeze({
  claim:(challengeId,claimId)=>invoke('claim_project_reporting_verification',{p_challenge_id:challengeId,p_claim_id:claimId}),
  complete:(challengeId,claimId,result)=>invoke('complete_project_reporting_verification',{p_challenge_id:challengeId,p_claim_id:claimId,p_manifest_sha256:result.manifest_sha256,p_observed_at:result.observed_at,p_resource_matches:result.resource_matches,p_observed_reporting_grant:result.observed_reporting_grant,p_source_evidence_sha256:result.source_evidence_sha256}),
  recover:(challengeId,claimId)=>invoke('get_project_reporting_verification_claim',{p_challenge_id:challengeId,p_claim_id:claimId}),
 })
}
export async function runReportingVerification({challengeId,claimId,store,adapters,now=()=>Date.now()}){
 if(!UUID.test(challengeId)||!UUID.test(claimId))throw new TypeError('Original challenge and claim required')
 for(const method of ['claim','complete','recover'])if(typeof store?.[method]!=='function')throw new TypeError('Complete trusted verification store required')
 if(!Array.isArray(adapters))throw new TypeError('Explicit installed adapter registry required')
 const unknown=()=>({challenge_id:challengeId,state:'outcome_unknown',dispatch_authorized:false,automatic_retry:false})
 const recover=async()=>{try{const receipt=await store.recover(challengeId,claimId);return receipt?.challenge_id===challengeId&&receipt.dispatch_authorized===false?{...receipt,recovered:true}:unknown()}catch{return unknown()}}
 let claim
 try{claim=await store.claim(challengeId,claimId)}catch{return recover()}
 if(claim?.dispatch_authorized!==true)return claim?.challenge_id===challengeId&&claim.dispatch_authorized===false?claim:unknown()
 let adapter,context,remaining,claimedAt,expiresAt
 try{
  if(claim.challenge_id!==challengeId||claim.claim_id!==claimId||!HASH.test(claim.manifest_sha256))throw new TypeError('Original dispatch changed')
  context=claim.context
  for(const key of ['organization_id','project_id','binding_id','connection_id'])if(!UUID.test(context?.[key]))throw new TypeError('Exact scoped resource identity required')
  if(!HASH.test(context.context_checksum)||!Number.isSafeInteger(context.binding_revision_number)||context.binding_revision_number<1||typeof context.resource_key!=='string'||context.resource_key.length<1||context.resource_key.length>2048)throw new TypeError('Exact current binding required')
  const matches=adapters.filter(a=>a.sourceContract===claim.source_contract&&a.manifestSha256===claim.manifest_sha256&&a.provider===context.provider&&a.resourceKind===context.resource_kind)
  if(matches.length!==1||typeof matches[0].verifyResource!=='function')return {...unknown(),state:'adapter_unavailable'}
  adapter=matches[0];claimedAt=Date.parse(claim.claimed_at);expiresAt=Date.parse(claim.lease_expires_at);remaining=expiresAt-now()
  if(!Number.isFinite(claimedAt)||!Number.isFinite(remaining)||claimedAt>now()||remaining<=0||!Number.isSafeInteger(claim.limits?.lease_seconds)||claim.limits.lease_seconds<1||claim.limits.lease_seconds>31536000||expiresAt-claimedAt>claim.limits.lease_seconds*1000)throw new TypeError('Current original lease required')
 }catch{return unknown()}
 const controller=new AbortController();let timer,result
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Original lease elapsed'))},Math.min(remaining,2147483647))})
  result=await Promise.race([adapter.verifyResource({context,signal:controller.signal}),timeout])
  const observed=Date.parse(result?.observed_at)
  if(!result||Object.keys(result).length!==4||typeof result.observed_at!=='string'||!Number.isFinite(observed)||observed<claimedAt||observed>=expiresAt||observed>now()||typeof result.resource_matches!=='boolean'||typeof result.observed_reporting_grant!=='boolean'||!HASH.test(result.source_evidence_sha256))throw new TypeError('Exact original resource observation required')
 }catch{return unknown()}finally{clearTimeout(timer)}
 // Uncertain provider results never become negative proof. Exact observed negatives
 // do, through the same guarded completion path. Lost write acknowledgements only read.
 try{return await store.complete(challengeId,claimId,{...result,manifest_sha256:claim.manifest_sha256})}catch{return recover()}
}
