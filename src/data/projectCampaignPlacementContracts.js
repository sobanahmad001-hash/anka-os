// Advisory business contracts. Native commands must independently recheck current
// project/service authority, exact canonical approvals and selected resource grants.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=(value,label)=>{if(typeof value!=='string' || !UUID.test(value))throw new TypeError(`${label} must be an exact UUID`);return value}
const object=value=>value && typeof value==='object' && !Array.isArray(value)
const exact=(value,fields,label)=>{if(!object(value) || Object.keys(value).some(key=>!fields.includes(key)) || fields.some(key=>!(key in value)))throw new TypeError(`Complete named ${label} fields required`)}
const text=(value,max,label)=>{if(typeof value!=='string' || value!==value.trim() || value.length>max || /[\u0000-\u001f\u007f]/.test(value))throw new TypeError(`${label} must be bounded plain text`);return value}
const required=(value,max,label)=>{text(value,max,label);if(!value)throw new TypeError(`${label} is required`);return value}
export const CAMPAIGN_PLACEMENT_STATES=Object.freeze(['draft','planned','paused','cancelled','recorded_published'])
export function serializeCampaignRecordedUrl(value,label='Recorded URL'){
 if(value===null)return null;text(value,2048,label)
 let parsed;try{parsed=new URL(value)}catch{throw new TypeError(`${label} must be an absolute HTTP(S) URL`)}
 if(!['http:','https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || value.includes('\\') || /\s/.test(value) || /\/(?:\.|%2e)(?:\.|%2e)?(?:\/|$)/i.test(value))throw new TypeError(`${label} must omit credentials, whitespace and traversal`)
 return parsed.href
}
export function serializeCampaignSchedule(scheduledAt,timeZone){
 if(scheduledAt===null && timeZone===null)return {scheduled_at:null,time_zone:null}
 if(typeof scheduledAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(scheduledAt))throw new TypeError('Schedule must use an explicit UTC instant and IANA timezone')
 const parsed=new Date(scheduledAt);if(!Number.isFinite(parsed.getTime()) || parsed.toISOString()!==scheduledAt.replace(/Z$/,scheduledAt.includes('.') ? 'Z' : '.000Z'))throw new TypeError('Schedule must use an actual calendar instant')
 required(timeZone,120,'Timezone');try{new Intl.DateTimeFormat('en',{timeZone}).format(parsed)}catch{throw new TypeError('Choose an explicit supported IANA timezone')}
 return {scheduled_at:parsed.toISOString(),time_zone:timeZone}
}
export function serializeCampaignContribution(value){
 if(value===null)return null;exact(value,['kind','id'],'existing contribution')
 if(!['project_task','engagement_work_item'].includes(value.kind))throw new TypeError('Choose an existing Project Task or Engagement Work Item')
 return {kind:value.kind,id:id(value.id,'Existing contribution')}
}
const FIELDS=['asset_id','variant_id','campaign_plan_version_id','marketing_service_id','channel','account_binding_id','mode','scheduled_at','time_zone','cta','external_id','recorded_url','publication_state','contribution']
export function serializeCampaignPlacement(value){
 exact(value,FIELDS,'placement')
 if(!['organic','paid'].includes(value.mode) || !CAMPAIGN_PLACEMENT_STATES.includes(value.publication_state))throw new TypeError('Explicit placement mode and planning/publication record state required')
 exact(value.cta,['label','url'],'call to action')
 const result={asset_id:id(value.asset_id,'Shared canonical asset'),variant_id:value.variant_id===null ? null : id(value.variant_id,'Exact variant'),campaign_plan_version_id:id(value.campaign_plan_version_id,'Exact campaign plan version'),marketing_service_id:id(value.marketing_service_id,'Current Marketing service'),channel:required(value.channel,120,'Channel'),account_binding_id:value.account_binding_id===null ? null : id(value.account_binding_id,'Selected account binding'),mode:value.mode,...serializeCampaignSchedule(value.scheduled_at,value.time_zone),cta:{label:text(value.cta.label,240,'Call to action'),url:serializeCampaignRecordedUrl(value.cta.url,'Call to action URL')},external_id:value.external_id===null ? null : required(value.external_id,500,'External publication ID'),recorded_url:serializeCampaignRecordedUrl(value.recorded_url),publication_state:value.publication_state,contribution:serializeCampaignContribution(value.contribution)}
 if(result.publication_state==='recorded_published' && !result.external_id && !result.recorded_url)throw new TypeError('A manually recorded publication needs its exact external ID or URL')
 return result
}
export function reconcileCampaignAssetSource(asset,source,{organizationId,projectId}){
 id(organizationId,'Organization');id(projectId,'Project');id(asset?.id,'Shared canonical asset')
 if(!source || !['artifact_version','deliverable_version'].includes(source.kind) || asset.organization_id!==organizationId || source.organization_id!==organizationId || asset.project_id!==projectId || source.project_id!==projectId || asset.source_kind!==source.kind || asset.source_version_id!==source.version_id || asset.source_root_id!==source.root_id)throw new TypeError('Shared source must retain its exact same-project canonical root and version')
 id(source.version_id,'Exact canonical source version');id(source.root_id,'Canonical source root')
 return Object.freeze({asset_id:asset.id,source_kind:source.kind,source_root_id:source.root_id,source_version_id:source.version_id})
}
export function campaignPlacementReadiness(placement,{organizationId,projectId,campaignId,campaign,plan,asset,variant=null,source,service,account=null}){
 const data=serializeCampaignPlacement(placement),binding=reconcileCampaignAssetSource(asset,source,{organizationId,projectId});id(campaignId,'Campaign')
 if(!campaign || campaign.id!==campaignId || campaign.organization_id!==organizationId || campaign.project_id!==projectId || !UUID.test(campaign.brand_id || '') || !UUID.test(campaign.engagement_id || '') || asset.brand_id!==campaign.brand_id || (source.kind==='artifact_version' && source.brand_id!==campaign.brand_id))throw new TypeError('Exact campaign and shared asset brand/project scope required')
 if(!plan || plan.id!==data.campaign_plan_version_id || plan.organization_id!==organizationId || plan.project_id!==projectId || plan.campaign_id!==campaignId || plan.engagement_id!==campaign.engagement_id || plan.brand_id!==campaign.brand_id)throw new TypeError('Exact same-campaign immutable plan version required')
 const reasons=[]
 if(data.asset_id!==binding.asset_id)throw new TypeError('Placement changed its shared source asset')
 if(data.variant_id!==null && (!variant || variant.id!==data.variant_id || variant.asset_id!==asset.id || variant.organization_id!==organizationId || variant.project_id!==projectId || (variant.source_kind==='artifact_version' && variant.brand_id!==campaign.brand_id) || !['artifact_version','deliverable_version'].includes(variant.source_kind) || !UUID.test(variant.source_version_id || '') || !UUID.test(variant.source_root_id || '')))throw new TypeError('Exact variant must belong to this same shared asset and project')
 if(!service || service.id!==data.marketing_service_id || service.organization_id!==organizationId || service.project_id!==projectId || service.engagement_id!==campaign.engagement_id || service.department_id!=='marketing' || service.status!=='active' || service.catalog_active!==true)reasons.push('marketing_service_unavailable')
 if(source.approval_state!=='approved')reasons.push(source.approval_state==='unapproved' ? 'source_unapproved' : 'source_approval_unavailable')
 if(data.variant_id && variant.approval_state!=='approved')reasons.push(variant.approval_state==='unapproved' ? 'variant_unapproved' : 'variant_approval_unavailable')
 if(!data.account_binding_id)reasons.push('account_binding_missing')
 else if(!account || account.id!==data.account_binding_id || account.organization_id!==organizationId || account.project_id!==projectId || account.status!=='verified' || account.resource_available!==true)reasons.push('account_binding_unavailable')
 // Reporting permission never becomes publication/spend permission. Readiness only
 // describes internal planning; no value here can authorize an external operation.
 return Object.freeze({asset:binding,campaign_id:campaignId,placement:data,internal_ready:reasons.length===0,blocking_reasons:Object.freeze(reasons),external_operation_requested:false,external_write_authorized:false})
}
