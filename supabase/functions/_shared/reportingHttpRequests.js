// Server-only original-claim RPC boundary. Never retries a dispatch permit.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const unknown=()=>new Error('Original HTTP request outcome unavailable')
export function reportingHttpRequestAudit({client,context,newId=()=>crypto.randomUUID()}){
 const claim=context?.provider_http_claim
 if(!claim||!['refresh','verification'].includes(claim.kind)||!UUID.test(claim.claim_id)||claim.request_budget!==2||typeof client?.rpc!=='function')throw unknown()
 const invoke=async(name,args)=>{let result;try{result=await client.rpc(name,args)}catch{throw unknown()}if(result?.error||!result?.data)throw unknown();return result.data}
 const recover=()=>invoke('get_project_reporting_http_claim',{p_kind:claim.kind,p_claim:claim.claim_id})
 return Object.freeze({
  async claim(ordinal){
   if(![1,2].includes(ordinal))throw unknown()
   const id=newId();if(!UUID.test(id))throw unknown()
   const r=await invoke('claim_project_reporting_http_request',{p_kind:claim.kind,p_claim:claim.claim_id,p_ordinal:ordinal,p_permit:id})
   if(r.dispatch_authorized!==true||r.claim_kind!==claim.kind||r.claim_id!==claim.claim_id||r.ordinal!==ordinal||r.permit_id!==id)throw unknown()
   return Object.freeze({ordinal,permitId:id})
  },
  async record(permit,outcome,evidence,validUntil=null){
   if(!permit||!UUID.test(permit.permitId)||![1,2].includes(permit.ordinal)||!['validated','denied','failed','uncertain'].includes(outcome)||!/^[a-f0-9]{64}$/.test(evidence)||validUntil!==null&&(typeof validUntil!=='string'||!Number.isFinite(Date.parse(validUntil))))throw unknown()
   let r
   try{r=await invoke('record_project_reporting_http_outcome',{p_permit:permit.permitId,p_outcome:outcome,p_evidence_sha256:evidence,p_valid_until:validUntil})}catch{r=await recover()}
   const rows=r.requests?.filter(x=>x.permit_id===permit.permitId&&x.ordinal===permit.ordinal)
   if(r.dispatch_authorized!==false||r.claim_kind!==claim.kind||r.claim_id!==claim.claim_id||r.reserved_requests!==2||rows?.length!==1||rows[0].outcome!==outcome||rows[0].evidence_sha256!==evidence||(validUntil===null?rows[0].valid_until!==null:Date.parse(rows[0].valid_until)!==Date.parse(validUntil)))throw unknown()
  },
 })
}
