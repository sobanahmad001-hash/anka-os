const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function id(value){if(typeof value!=='string'||!UUID.test(value))throw Error('Exact Website identity required');return value}
function scope(value){return {p_organization_id:id(value.organizationId),p_project_id:id(value.projectId),p_engagement_id:id(value.engagementId)}}
export function createWebsiteNativeRepository(client){
 async function rpc(name,args,signal){if(signal?.aborted)throw Error('Website context changed');let query=client.rpc(name,args);if(signal&&query.abortSignal)query=query.abortSignal(signal);const{data,error}=await query;if(error)throw Object.assign(new Error(error.message),{code:error.code});return data}
 async function save(action,input,{signal}={}){
  if(signal?.aborted)throw Error('Website context changed')
  const{data,error}=await client.functions.invoke('website-native-design',{body:{action,...input},signal})
  let details=data;if(error?.context?.clone)try{details=await error.context.clone().json()}catch{/* Unknown outcomes require recovery. */}
  if(error||details?.error)throw Object.assign(new Error(details?.error||error?.message||'Website draft save could not be verified'),{knownRollback:details?.rollback_verified===true,code:details?.code})
  if(!data?.data||data.data.organization_id!==input.organization_id||data.data.project_id!==input.project_id||data.data.engagement_id!==input.engagement_id||data.data.request_id!==input.request_id)throw Error('Website save receipt differs; recover the original request')
  return data.data
 }
 return Object.freeze({
  async workspace(value,{signal}={}){const data=await rpc('get_website_native_workspace',{...scope(value),p_page_id:value.pageId?id(value.pageId):null,p_request_id:value.requestId?id(value.requestId):null},signal);if(!data||!Array.isArray(data.sites)||!Array.isArray(data.designs)||[...data.sites,...data.designs].some(row=>row.organization_id!==value.organizationId||row.project_id!==value.projectId||row.engagement_id!==value.engagementId))throw Error('Website history response belongs to another context');return data},
  async source(value,{signal}={}){const data=await rpc('get_website_native_source',{...scope(value),p_page_id:id(value.pageId),p_architecture_version_id:id(value.architectureVersionId),p_content_version_id:id(value.contentVersionId),p_brief_version_id:id(value.briefVersionId),p_site_version_id:id(value.siteVersionId)},signal);if(data?.scope?.organization_id!==value.organizationId||data?.scope?.project_id!==value.projectId||data?.scope?.engagement_id!==value.engagementId||data?.scope?.page_id!==value.pageId||data?.architecture?.artifact_version_id!==value.architectureVersionId||data?.content_version?.id!==value.contentVersionId||data?.brief_version?.id!==value.briefVersionId||data?.site_version?.id!==value.siteVersionId)throw Error('Website source response differs from the selected exact context');return data},
  async design(value,{signal}={}){const data=await rpc('get_website_native_design',{...scope(value),p_design_id:id(value.designId)},signal);if(data?.organization_id!==value.organizationId||data?.project_id!==value.projectId||data?.engagement_id!==value.engagementId||data?.design_id!==value.designId)throw Error('Saved Website design response belongs to another context');return data},
  saveSite:(input,options)=>save('save_site',input,options),saveDesign:(input,options)=>save('save_design',input,options),
 })
}
