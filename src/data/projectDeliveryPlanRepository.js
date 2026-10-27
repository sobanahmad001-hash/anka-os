const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=x=>{if(typeof x!=='string'||!UUID.test(x))throw Error('Exact project plan identity required');return x}
export function createProjectDeliveryPlanRepository(client){
 async function call(name,args,signal){if(signal?.aborted)throw Error('Project plan context changed');let query=client.rpc(name,args);if(query.abortSignal&&signal)query=query.abortSignal(signal);const {data,error}=await query;if(error)throw Object.assign(Error(error.message),{knownRollback:['22023','42501','40001','55000','23505','54000'].includes(error.code),code:error.code});if(signal?.aborted)throw Error('Project plan context changed');return data}
 const scope=s=>({p_organization_id:id(s.organizationId),p_project_id:id(s.projectId),p_engagement_id:s.engagementId?id(s.engagementId):null})
 function same(data,s){return data?.organization_id===s.organizationId&&data?.project_id===s.projectId&&(!s.engagementId||data.engagement_id===s.engagementId)}
 return Object.freeze({
  async read(s,{choices={},requestId=null,versionId=null,signal}={}){const data=await call('get_project_delivery_plan',{...scope(s),p_group_choices:choices,p_request_id:requestId?id(requestId):null,p_version_id:versionId?id(versionId):null},signal);if(!same(data,s)||!Array.isArray(data.history)||[data.latest,data.selected].filter(Boolean).some(v=>!same(v,s)||!same(v.snapshot,s))||data.draft&&!same(data.draft,s)||data.engagements?.some(e=>e.organization_id!==s.organizationId||e.project_id!==s.projectId))throw Error('Project plan response belongs to another exact context');return data},
  async apply(s,{requestId,reviewSha256,choices={},signal}){if(!s.engagementId||!/^[a-f0-9]{64}$/.test(reviewSha256||''))throw Error('Review the current exact project plan');const data=await call('apply_project_delivery_plan',{...scope(s),p_request_id:id(requestId),p_review_sha256:reviewSha256,p_group_choices:choices},signal);if(!same(data,s)||data.request_id!==requestId||!same(data.snapshot,s))throw Error('Saved plan receipt differs; recover the original request');return data}
 })
}
