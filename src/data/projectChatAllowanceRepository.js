const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=value=>{if(typeof value!=='string'||!uuid.test(value))throw Error('Exact allowance scope is required.');return value}
const bounded=(cap,seconds)=>{if(!Number.isSafeInteger(cap)||cap<1||cap>1000000||!Number.isSafeInteger(seconds)||seconds<60||seconds>86400)throw Error('Choose an explicit allowance up to $1 and an expiry within 24 hours.')}
export function createProjectChatAllowanceRepository(client,{organizationId,projectId,modelConfigurationId}){
 const scope={p_org:id(organizationId),p_project:id(projectId),p_model:id(modelConfigurationId)}
 async function rpc(name,args){const{data,error}=await client.rpc(name,args);if(error)throw error;if(!data||typeof data!=='object'||Array.isArray(data))throw Error('The scoped allowance could not be verified.');return data}
 return{
  read(){return rpc('read_owned_project_chat_allowance',scope)},
  preview({capMicrousd,durationSeconds}){bounded(capMicrousd,durationSeconds);return rpc('preview_project_chat_allowance',{...scope,p_cap:capMicrousd,p_seconds:durationSeconds})},
  apply({requestId,review}){
   id(requestId)
   if(!review||review.organization_id!==organizationId||review.project_id!==projectId||review.model_configuration_id!==modelConfigurationId
    ||typeof review.review_hash!=='string'||!/^[0-9a-f]{64}$/.test(review.review_hash)||review.historical_costs_unresolved!==true
    ||review.historical_charge_may_exceed_estimate!==true)throw Error('Review the exact current project allowance before applying it.')
   bounded(review.cap_microusd,review.duration_seconds)
   return rpc('apply_project_chat_allowance',{...scope,p_request:requestId,p_action:'activate',p_cap:review.cap_microusd,
    p_seconds:review.duration_seconds,p_review_hash:review.review_hash,p_policy:null})
  },
  revoke({requestId,policyId}){return rpc('apply_project_chat_allowance',{p_org:scope.p_org,p_request:id(requestId),p_action:'revoke',
   p_project:null,p_model:null,p_cap:null,p_seconds:null,p_review_hash:null,p_policy:id(policyId)})},
 }
}
