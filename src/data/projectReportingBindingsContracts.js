// Advisory serialization only. Native commands recheck the current mapping,
// ownership and grants; these values cannot authorize provider work.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=(v,label)=>{if(typeof v!=='string'||!UUID.test(v))throw new TypeError(`${label} must be an exact UUID`);return v}
export const PROJECT_REPORTING_RESOURCES=Object.freeze({ga4_property:'google_analytics',gsc_site:'google_search_console',google_ads_customer:'google_ads',meta_facebook_page:'meta',meta_instagram_account:'meta'})
export function serializeProjectReportingResource(kind,key){
 if(!Object.hasOwn(PROJECT_REPORTING_RESOURCES,kind)||typeof key!=='string'||key!==key.trim()||!key||key.length>2048||/[\u0000-\u0020\u007f\\]/.test(key))throw new TypeError('Choose an explicit bounded supported reporting resource')
 if(kind==='gsc_site'){
  if(key.startsWith('sc-domain:')){if(!/^sc-domain:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(key)||key.includes('..'))throw new TypeError('Choose an exact configured GSC domain')}
  else{let u;try{u=new URL(key)}catch{throw new TypeError('Choose an exact configured GSC URL')};if(!['https:','http:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.search||u.hash||u.href!==key||/%(?:2e|2f|5c)/i.test(key)||/\/(?:\.{1,2})(?:\/|$)/.test(key))throw new TypeError('GSC URL must be canonical and omit credentials, query, fragment and traversal')}
 }else if(!(kind==='ga4_property'?/^[0-9]{4,20}$/:kind==='google_ads_customer'?/^[0-9]{10}$/:/^[0-9]{4,30}$/).test(key))throw new TypeError('Choose an exact configured numeric reporting resource')
 return {resource_kind:kind,resource_key:key,provider:PROJECT_REPORTING_RESOURCES[kind]}
}
export function serializeProjectReportingBinding(v){
 const fields=['binding_id','expected_revision','engagement_id','department_id','connection_id','resource_kind','resource_key','permitted_operations','state']
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==fields.length||fields.some(k=>!(k in v)))throw new TypeError('Complete named project reporting binding required')
 if(!Number.isSafeInteger(v.expected_revision)||v.expected_revision<0||v.expected_revision>2147483646||((v.binding_id===null)!==(v.expected_revision===0))||!['website','marketing'].includes(v.department_id)||!['enabled','paused','revoked'].includes(v.state)||!Array.isArray(v.permitted_operations)||v.permitted_operations.length!==1||v.permitted_operations[0]!=='reporting_read')throw new TypeError('Choose explicit current revision, department, state and reporting-only operation')
 const resource=serializeProjectReportingResource(v.resource_kind,v.resource_key)
 return {binding_id:v.binding_id===null?null:id(v.binding_id,'Binding'),expected_revision:v.expected_revision,engagement_id:id(v.engagement_id,'Engagement'),department_id:v.department_id,connection_id:id(v.connection_id,'Existing connector'),resource_kind:resource.resource_kind,resource_key:resource.resource_key,permitted_operations:['reporting_read'],state:v.state}
}
export function projectReportingBindingReadiness(binding,current){
 if(binding){for(const key of ['organization_id','project_id','client_id','agency_client_id','engagement_id','connection_id'])id(binding[key],key);if(!Array.isArray(binding.permitted_operations)||binding.permitted_operations.length!==1||binding.permitted_operations[0]!=='reporting_read')throw new TypeError('Explicit reporting-only operations required')}
 if(!binding||!current||binding.organization_id!==current.organization_id||binding.project_id!==current.project_id||binding.client_id!==current.project_client_id||binding.agency_client_id!==current.engagement_client_id||binding.agency_client_id!==current.brand_client_id||binding.agency_client_id!==current.agency_client_id||binding.client_id!==current.agency_canonical_client_id||binding.engagement_id!==current.engagement_id||binding.connection_id!==current.connection_id||binding.department_id!==current.department_id)throw new TypeError('Exact project/client/engagement/mapping scope required')
 const resource=serializeProjectReportingResource(binding.resource_kind,binding.resource_key),reasons=[]
 if(current.provider!==resource.provider)throw new TypeError('Existing connector provider does not match this resource')
 if(binding.state!=='enabled')reasons.push(`binding_${binding.state}`)
 if(current.mapping_current!==true||current.mapping_identity!==binding.mapping_identity)reasons.push('mapping_unavailable_or_changed')
 if(current.project_archived===true||current.client_active!==true||current.engagement_active!==true)reasons.push('project_context_unavailable')
 if(current.connection_status!=='verified'||current.connection_archived===true)reasons.push('connection_unavailable')
 if(current.selected_resource_key!==binding.resource_key)reasons.push('selected_resource_changed')
 if(current.credential_state!=='available')reasons.push(`credential_${current.credential_state||'unavailable'}`)
 if(current.grant_provenance!=='observed'||current.reporting_scope_granted!==true)reasons.push('observed_reporting_grant_missing')
 if(current.provider_resource_verified!==true||current.verified_context_checksum!==binding.context_checksum)reasons.push('resource_access_verification_pending')
 // Reporting-ready is not permission to publish, spend, configure users or fetch
 // arbitrary history. Cadence and native current gates still govern every read.
 return Object.freeze({reporting_ready:reasons.length===0,blocking_reasons:Object.freeze(reasons),permitted_operations:Object.freeze(['reporting_read']),external_write_authorized:false})
}
