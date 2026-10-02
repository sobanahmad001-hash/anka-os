import {reportingRefreshPolicy} from '../../supabase/functions/_shared/reportingRefreshPolicy.js'
import {reportingPeriod,storedReportingMetric} from './projectStoredReportingContracts.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=(v,label)=>{if(typeof v!=='string'||!UUID.test(v))throw new TypeError(`${label} must be an exact UUID`);return v}
const scope=v=>({p_organization_id:id(v.organizationId,'Organization'),p_project_id:id(v.projectId,'Project'),p_binding_id:id(v.bindingId,'Binding')})
function context(data,v){
 const b=data?.binding,r=data?.refresh
 if(!b||b.id!==v.bindingId||b.project_id!==v.projectId||b.organization_id!==v.organizationId||typeof data.current_authorized!=='boolean'||data.provider_resource_verified!==data.current_authorized||data.external_write_authorized!==false||data.provider_request_made!==false||typeof r?.eligible!=='boolean'||typeof r.queued!=='boolean'||typeof r.reason!=='string')throw new Error('Exact native stored report scope or provider gate changed')
 if(r.limits==null){
  if(data.current_authorized||r.eligible||r.queued||r.reason!=='configuration_and_resource_verification_required')throw new Error('Unconfigured reporting cannot authorize metrics or refresh')
  for(const key of ['cadence_seconds','history_days','stale_after_seconds','manual_min_interval_seconds','daily_request_limit','backoff_seconds'])if(r[key]!==null)throw new Error('Unapproved reporting configuration changed')
 }else{
  const limits=reportingRefreshPolicy(r.limits);id(r.policy_id,'Refresh policy')
  if(!Number.isSafeInteger(r.policy_revision)||r.policy_revision<1||typeof r.enabled!=='boolean'||typeof r.source_contract!=='string'||!r.source_contract.trim()||r.source_contract.length>240)throw new Error('Exact current native refresh policy required')
  reportingPeriod('2000-01-01','2000-01-01',r.reporting_time_zone)
  for(const key of ['cadence_seconds','history_days','stale_after_seconds','manual_min_interval_seconds','daily_request_limit','backoff_seconds'])if(r[key]!==limits[key])throw new Error('Native refresh policy summary changed')
  if(r.eligible&&(!data.current_authorized||!r.enabled)||r.queued!==Boolean(r.job))throw new Error('Current resource and refresh state required')
  if(r.job&&(r.job.binding_id!==v.bindingId||r.job.dispatch_authorized!==false||!['queued','running','retry','uncertain'].includes(r.job.state)))throw new Error('Original active resource job required')
 }
 if(data.current_authorized){
  const c=data.current_context
  if(!Number.isSafeInteger(data.revision_number)||data.revision_number<1||data.reason!=='verified_resource_access'||data.verified_source_contract!==r.source_contract||!c||c.organization_id!==v.organizationId||c.project_id!==v.projectId||c.provider!==b.provider||c.resource_kind!==b.resource_kind||c.resource_key!==b.resource_key||!/^[a-f0-9]{64}$/.test(c.context_checksum||''))throw new Error('Exact current resource verification required')
 }
 if(!Number.isSafeInteger(data.stored_observations)||data.stored_observations<0||typeof data.reason!=='string')throw new Error('Explicit bounded reporting status required')
 return data
}
export function createProjectStoredReportingRepository(client){
 if(!client?.rpc)throw new TypeError('RPC client required')
 async function call(name,args,options){let query=client.rpc(name,args);if(options?.signal&&query.abortSignal)query=query.abortSignal(options.signal);const {data,error}=await query;if(error)throw Object.assign(new Error(error.message),{code:error.code});return data}
 return Object.freeze({
  async status(v,options){return context(await call('get_project_stored_reporting_status',scope(v),options),v)},
  async list(v,options){
   reportingPeriod(v.startDate,v.endDate,v.timeZone);const {offset=0,limit=25,metricKey=''}=v
   if(!Number.isSafeInteger(offset)||offset<0||offset>10000||!Number.isSafeInteger(limit)||limit<1||limit>50||typeof metricKey!=='string'||metricKey.length>240||/[\u0000-\u001f\u007f]/.test(metricKey))throw new TypeError('Choose bounded exact stored report selection')
   const data=await call('list_project_stored_reporting_observations',{...scope(v),p_start_date:v.startDate,p_end_date:v.endDate,p_metric_key:metricKey,p_offset:offset,p_limit:limit},options)
   context(data?.context,v)
   if(!Array.isArray(data.items)||data.items.length>limit||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.matching)||data.matching<0||data.matching>data.total||data.offset!==offset||data.has_more!==(offset+data.items.length<data.matching)||data.collection_start_date!==v.startDate||data.collection_end_date!==v.endDate||data.provider_request_made!==false||data.causal_claim!==false||data.attribution_claim!==false)throw new Error('Bounded exact stored reporting result changed')
   for(const input of data.items){
    const row=storedReportingMetric(input)
    if(row.organization_id!==v.organizationId||row.project_id!==v.projectId||row.binding_id!==v.bindingId||row.provider!==data.context.binding.provider||row.resource_kind!==data.context.binding.resource_kind||row.resource_key!==data.context.binding.resource_key||row.fixture_only!==false||row.period_start<v.startDate||row.period_end>v.endDate||(metricKey&&row.metric_key!==metricKey))throw new Error('Current exact resource metric scope changed')
    if(row.value_state==='withheld'){
     if(row.current_authorized!==false||row.dimensions!==null||row.metric_value_text!==null)throw new Error('Withheld metric payload must remain closed')
    }else{
     if(!data.context.current_authorized||row.current_authorized!==true||row.original_context_matches_current!==true||row.source_acceptance!=='verified'||row.source_contract!==data.context.verified_source_contract||row.binding_revision_number!==data.context.revision_number||!/^[a-f0-9]{64}$/.test(row.source_record_sha256||'')||!row.dimensions||typeof row.dimensions!=='object'||Array.isArray(row.dimensions))throw new Error('Exact verified original source required for visible metric')
     if(row.value_state==='available'?(typeof row.metric_value_text!=='string'||!row.metric_value_text.trim()||row.metric_value_text.length>256||Number(row.metric_value_text)!==row.metric_value):row.metric_value_text!==null)throw new Error('Exact native numeric representation required')
    }
   }
   return data
  },
 })
}
