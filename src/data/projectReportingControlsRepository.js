import {reportingRefreshPolicy} from '../../supabase/functions/_shared/reportingRefreshPolicy.js'
import {reportingPeriod} from './projectStoredReportingContracts.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA=/^[a-f0-9]{64}$/
const id=(v,k)=>{if(typeof v!=='string'||!UUID.test(v))throw new TypeError(`Exact ${k} UUID required`);return v}
const text=(v,k,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new TypeError(`Explicit ${k} required`);return v}
const scope=v=>({p_organization_id:id(v.organizationId,'organization'),p_project_id:id(v.projectId,'project')})
const actions=['configure','verify','refresh'],rollbackCodes=['22023','42501','40001','55000','23505']
export function reportingConfigurationInput(input){
 const keys=['source_contract','reporting_time_zone','limits','enabled','binding_revision_number','context_checksum']
 if(!input||Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k))||typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.binding_revision_number)||input.binding_revision_number<1||!SHA.test(input.context_checksum||''))throw new TypeError('Complete exact reporting settings required')
 text(input.source_contract,'source contract',240);text(input.reporting_time_zone,'reporting timezone',120);reportingPeriod('2000-01-01','2000-01-01',input.reporting_time_zone)
 return {...input,limits:reportingRefreshPolicy(input.limits)}
}
export function createProjectReportingControlsRepository(client){
 async function rpc(name,args,options){let query=client.rpc(name,args);if(options?.signal&&query.abortSignal)query=query.abortSignal(options.signal);const {data,error}=await query;if(error)throw Object.assign(new Error(error.message),{code:error.code,knownRollback:rollbackCodes.includes(error.code)});return data}
 return Object.freeze({
  async read(v,options){
   const data=await rpc('get_project_reporting_controls',{...scope(v),p_binding_id:id(v.bindingId,'binding')},options),p=data?.configuration?.policy,s=data?.status
   if(data?.organization_id!==v.organizationId||data.project_id!==v.projectId||data.binding_id!==v.bindingId||data.dispatch_authorized!==false||data.provider_request_made!==false||typeof data.can_configure!=='boolean'||!Number.isSafeInteger(data.binding_revision_number)||data.binding_revision_number<1||!SHA.test(data.context_checksum||'')||s?.binding?.id!==v.bindingId||s.binding.organization_id!==v.organizationId||s.binding.project_id!==v.projectId||s.provider_request_made!==false||s.external_write_authorized!==false||typeof s.current_authorized!=='boolean'||typeof s.refresh?.eligible!=='boolean'||typeof s.refresh?.queued!=='boolean'||data.configuration?.dispatch_authorized!==false||data.configuration?.provider_request_made!==false)throw Error('Exact current reporting control scope changed')
   if(p!==null){id(p?.id,'policy');if(!Number.isSafeInteger(p.revision_number)||p.revision_number<1)throw Error('Exact policy revision required');reportingConfigurationInput(Object.fromEntries(['source_contract','reporting_time_zone','limits','enabled','binding_revision_number','context_checksum'].map(k=>[k,p[k]])));if(s.refresh.policy_id!==p.id||s.refresh.policy_revision!==p.revision_number)throw Error('Current policy identity changed')}
   if(!Array.isArray(data.adapters)||data.adapters.length>25||data.adapters.some(a=>typeof a.source_contract!=='string'||!a.source_contract||a.source_contract.length>240||!SHA.test(a.manifest_sha256||'')||typeof a.enabled!=='boolean')||new Set(data.adapters.map(a=>a.source_contract)).size!==data.adapters.length)throw Error('Bounded installed reporting adapter list required')
   return data
  },
  async configure(v,options){
   if(v.confirmed!==true||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0)throw TypeError('Review and confirm exact reporting settings')
   const input=reportingConfigurationInput(v.input),data=await rpc('configure_project_reporting_refresh',{...scope(v),p_binding_id:id(v.bindingId,'binding'),p_expected_revision:v.expectedRevision,p_input:input,p_request_id:id(v.requestId,'original operation')},options)
   if(!UUID.test(data?.policy_id||'')||data.revision_number!==v.expectedRevision+1||data.enabled!==input.enabled||data.dispatch_authorized!==false||typeof data.replayed!=='boolean')throw Error('Original settings result identity changed')
   return data
  },
  async dispatch(v,options){
   if(v.confirmed!==true||!['verify','refresh'].includes(v.action))throw TypeError('Review the exact resource action before dispatch')
   scope(v);const body={action:v.action,organization_id:v.organizationId,project_id:v.projectId,binding_id:id(v.bindingId,'binding'),policy_id:id(v.policyId,'policy'),request_id:id(v.requestId,'original operation')}
   if(v.action==='refresh'){reportingPeriod(v.startDate,v.endDate,v.timeZone);body.period_start=v.startDate;body.period_end=v.endDate}
   const {data,error}=await client.functions.invoke('reporting-worker',{body,signal:options?.signal})
   if(error){let native;try{if(error.context?.status===403){const raw=await error.context.text();if(raw.length<=16384)native=JSON.parse(raw)}}catch{/* Unreadable response remains uncertain. */}
    throw Object.assign(new Error(native?.error||error.message||'Original reporting response unavailable'),{knownRollback:rollbackCodes.includes(native?.code),code:native?.code})}
   if(data?.dispatch_authorized!==false)throw Error('Original reporting response unavailable; recover its saved operation')
   return data
  },
  async recover(v,options){
   if(!actions.includes(v.action))throw TypeError('Exact original reporting action required')
   const data=await rpc('get_project_reporting_control_operation',{...scope(v),p_action:v.action,p_request_id:id(v.requestId,'original operation')},options)
   if(data?.organization_id!==v.organizationId||data.project_id!==v.projectId||data.request_id!==v.requestId||data.action!==v.action||data.dispatch_authorized!==false||data.provider_request_made!==false)throw Error('Original control operation scope changed')
   const r=data.result;if(r===null)return {...data,settled:false}
   if(!r||r.dispatch_authorized!==false)throw Error('Recovery cannot authorize another dispatch')
   if(v.action==='configure'){id(r.policy_id,'original policy');id(r.binding_id,'original binding');if(r.state!=='completed'||typeof r.enabled!=='boolean'||!Number.isSafeInteger(r.revision_number)||r.revision_number<1)throw Error('Original configuration receipt changed')}
   if(v.action==='verify'){
    if(r.challenge_id!==v.requestId||!['not_found','unclaimed','claimed','uncertain','expired','completed'].includes(r.state)||r.automatic_retry!==false)throw Error('Original verification receipt changed')
    if(r.state==='completed'&&(r.original_result?.challenge_id!==v.requestId||typeof r.original_result.resource_verified!=='boolean'||r.original_result.dispatch_authorized!==false))throw Error('Exact original verification result required')
   }
   if(v.action==='refresh'){id(r.job_id,'original job');id(r.binding_id,'original binding');id(r.policy_id,'original policy');if(!['queued','running','retry','uncertain','succeeded','denied','failed'].includes(r.state))throw Error('Original refresh state required')}
   return {...data,settled:v.action==='configure'||(v.action==='verify'?['completed','expired'].includes(r.state):['succeeded','denied','failed'].includes(r.state))}
  },
 })
}
