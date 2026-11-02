// Read-only authorized source context. Plan mutation remains the existing
// createProjectDeliverySetupRepository review/apply/recover contract.
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
export function createProjectDefaultPlanRepository(client){
 return Object.freeze({async readContext(scope,{limit=25,offset=0,signal}={}){
  if(signal?.aborted)throw Error('Default plan context changed')
  if(![scope.organizationId,scope.projectId,scope.engagementId].every(uuid)||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000)throw Error('Exact scoped source page required')
  let query=client.rpc('get_project_default_plan_context',{p_organization_id:scope.organizationId,p_project_id:scope.projectId,p_engagement_id:scope.engagementId,p_limit:limit,p_offset:offset})
  if(signal&&query.abortSignal)query=query.abortSignal(signal)
  const {data,error}=await query
  if(signal?.aborted)throw Error('Default plan context changed')
  if(error)throw Object.assign(Error(error.message),{code:error.code})
  if(data?.schema_version!==1||data.organization_id!==scope.organizationId||data.project_id!==scope.projectId||data.engagement_id!==scope.engagementId||!uuid(data.brand_id)||!sha(data.source_page_token)||!Array.isArray(data.approved_sources)||data.limit!==limit||data.offset!==offset||!Number.isSafeInteger(data.source_total)||data.source_total<0||data.approved_sources.length>limit||data.has_more!==(offset+data.approved_sources.length<data.source_total))throw Error('Default plan source response differs from its exact page')
  for(const row of data.approved_sources){
   if(row.organization_id!==scope.organizationId||row.project_id!==scope.projectId||row.brand_id!==data.brand_id||![row.artifact_id,row.version_id,row.approval_id,row.approved_by].every(uuid)||!sha(row.checksum)||!row.approved_at||!Array.isArray(row.eligible_roles)||!row.eligible_roles.length||row.eligible_roles.some(role=>!['written','visual'].includes(role))||Object.hasOwn(row,'content'))throw Error('Canonical approved source identity changed')
  }
  return data
 }})
}
