const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=(value,label)=>{if(typeof value!=='string' || !UUID.test(value))throw new TypeError(`${label} must be an exact UUID`);return value}
const scope=value=>({p_organization_id:id(value.organizationId,'Organization'),p_project_id:id(value.projectId,'Project')})
const registration=value=>{
 const keys=['command_kind','campaign_id','plan_version_id','marketing_service_id','source_kind','source_version_id','asset_id','label']
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==keys.length || keys.some(key=>!(key in value)) || !['register_asset','register_variant'].includes(value.command_kind) || !['artifact_version','deliverable_version'].includes(value.source_kind))throw new TypeError('Complete named canonical source/variant registration required')
 const input={command_kind:value.command_kind,campaign_id:id(value.campaign_id,'Campaign'),plan_version_id:id(value.plan_version_id,'Exact plan version'),marketing_service_id:id(value.marketing_service_id,'Marketing service'),source_kind:value.source_kind,source_version_id:id(value.source_version_id,'Exact source version'),asset_id:null,label:null}
 if(value.command_kind==='register_asset'){if(value.asset_id!==null || value.label!==null)throw new TypeError('Original source registration cannot silently create a variant')}
 else{input.asset_id=id(value.asset_id,'Original shared asset');if(typeof value.label!=='string' || value.label!==value.label.trim() || !value.label || value.label.length>240 || /[\u0000-\u001f\u007f]/.test(value.label))throw new TypeError('An explicit bounded variant label is required');input.label=value.label}
 return input
}
async function result(query,signal){if(signal && query.abortSignal)query=query.abortSignal(signal);const {data,error}=await query;if(error)throw Object.assign(new Error(error.message),{code:error.code,knownRollback:['22023','42501','40001','55000','23505'].includes(error.code)});return data}
export function createProjectCampaignAssetsRepository(client){
 if(!client?.rpc)throw new TypeError('RPC client required')
 const call=(name,args,options)=>result(client.rpc(name,args),options?.signal)
 return Object.freeze({
  preview(value,options){return call('preview_project_campaign_asset',{...scope(value),p_input:registration(value.input)},options)},
  async confirm(value,options){if(value.confirmed!==true || !/^[0-9a-f]{64}$/.test(value.reviewSha256 || ''))throw new TypeError('Confirm the exact native source review checksum');const input=registration(value.input),response=await call('confirm_project_campaign_asset',{...scope(value),p_input:input,p_review_sha256:value.reviewSha256,p_request_id:id(value.requestId,'Original operation')},options);if(!UUID.test(response?.asset_id || '') || response.source_version_id!==input.source_version_id || response.campaign_id!==input.campaign_id || response.plan_version_id!==input.plan_version_id || (input.command_kind==='register_variant' && (response.asset_id!==input.asset_id || !UUID.test(response.variant_id || ''))))throw new Error('Original canonical registration result identity changed');return response},
  list(value,options){const {assetId=null,query='',offset=0,limit=25}=value;if(typeof query!=='string' || query.length>120 || /[\u0000-\u001f\u007f]/.test(query) || !Number.isSafeInteger(offset) || offset<0 || offset>10000 || !Number.isSafeInteger(limit) || limit<1 || limit>50)throw new TypeError('Choose bounded canonical registry paging');return call('list_project_campaign_assets',{...scope(value),p_campaign_id:id(value.campaignId,'Campaign'),p_plan_version_id:id(value.planVersionId,'Exact plan version'),p_marketing_service_id:id(value.marketingServiceId,'Marketing service'),p_asset_id:assetId===null ? null : id(assetId,'Shared asset'),p_query:query,p_offset:offset,p_limit:limit},options)},
  recover(value,options){return call('get_project_campaign_asset_operation',{...scope(value),p_request_id:id(value.requestId,'Original operation')},options)},
 })
}
