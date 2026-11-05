import {readOnlyChatRequest} from './readOnlyChatRequest.js'
import {projectStagePlan,PROJECT_STAGE_PHASES} from './projectStagePlan.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH=/^[a-f0-9]{64}$/
const id=v=>{if(typeof v!=='string'||!UUID.test(v))throw Error('Exact stage-plan identifier required');return v}
const scope=s=>({p_organization_id:id(s.organizationId),p_project_id:id(s.projectId),p_engagement_id:id(s.engagementId)})
const same=(d,s)=>d?.organization_id===s.organizationId&&d?.project_id===s.projectId&&d?.engagement_id===s.engagementId
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Stage context changed','AbortError')}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
const exactPartition=p=>{
 if(!p||Object.keys(p).some(k=>!['kind','id','architecture_version_id'].includes(k))||!['engagement','website_page','campaign_asset','recurring_occurrence'].includes(p.kind))throw Error('Exact canonical stage partition required')
 const result={kind:p.kind,id:id(p.id)}
 if(p.kind==='website_page')result.architecture_version_id=id(p.architecture_version_id)
 else if('architecture_version_id'in p)throw Error('Architecture belongs only to a registered page')
 return result
}
export function projectStageBindings(rows){
 if(!Array.isArray(rows)||rows.length>200)throw Error('Choose at most 200 exact phase bindings')
 const seen=new Set()
 return rows.map(b=>{
  if(!b||Object.keys(b).sort().join(',')!=='group_id,phase,publication_id,step_key'||typeof b.step_key!=='string'||b.step_key.length<1||b.step_key.length>120||!PROJECT_STAGE_PHASES.some(p=>p.key===b.phase))throw Error('Exact published step and supported phase required')
  const row={group_id:id(b.group_id),publication_id:id(b.publication_id),step_key:b.step_key,phase:b.phase},key=row.group_id+':'+row.step_key
  if(seen.has(key))throw Error('A published step can map to only one phase')
  seen.add(key);return row
 }).sort((a,b)=>a.group_id.localeCompare(b.group_id)||a.step_key.localeCompare(b.step_key))
}
export function createProjectStagePlanRepository(client){
 if(!client?.rpc)throw Error('Stage-plan RPC client required')
 const invoke=async(name,args,signal)=>{
  abort(signal);let request=client.rpc(name,args);if(signal&&request.abortSignal)request=request.abortSignal(signal)
  const {data,error}=await request;abort(signal)
  if(error)throw Object.assign(new Error(error.message||'Stage-plan request failed'),{code:error.code,cause:error,knownRollback:['22023','42501','40001','55000','23505','54000'].includes(error.code)})
  return data
 }
 const read=async(name,args,{signal,timeoutMs}={})=>{
  try{return await readOnlyChatRequest(child=>invoke(name,args,child),{signal,timeoutMs})}
  catch(error){if(error.code==='CHAT_READ_TIMEOUT')throw Object.assign(new Error('Stage progress check timed out. Your existing work and draft are kept; refresh this view when ready.'),{code:'PROJECT_STAGE_READ_TIMEOUT'});throw error}
 }
 const requireScope=(d,s)=>{if(!same(d,s))throw Error('Stage response belongs to another exact scope');return d}
 const requirePlan=(d,s,planId,groupId)=>{requireScope(d,s);if(d.plan_id!==planId||groupId&&d.group_id!==groupId)throw Error('Stage response belongs to another exact plan or group');return d}
 const api={
  async read(s,options){const data=requireScope(await read('read_project_stage_plan',scope(s),options),s);projectStagePlan(data);return freeze(data)},
  async listPartitions(s,{planId,groupId,kind,offset=0,limit=25,...options}){
   if(!['engagement','website_page','campaign_asset','recurring_occurrence'].includes(kind)||!Number.isSafeInteger(offset)||offset<0||offset>10000||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Choose bounded canonical partition paging')
   const data=requirePlan(await read('list_project_stage_partitions',{...scope(s),p_plan_id:id(planId),p_group_id:id(groupId),p_kind:kind,p_offset:offset,p_limit:limit},options),s,planId,groupId)
   if(data.kind!==kind||data.offset!==offset||data.limit!==limit||!Number.isSafeInteger(data.total)||data.total<0||!Array.isArray(data.items)||data.items.length>limit||data.items.some(x=>exactPartition(x.partition).kind!==kind)||new Set(data.items.map(x=>x.partition.id)).size!==data.items.length)throw Error('Partition paging response differs from exact selection')
   return freeze(data)
  },
  async readPartition(s,{planId,groupId,partition,...options}){
   const selected=exactPartition(partition)
   const data=requirePlan(await read('read_project_stage_partition',{...scope(s),p_plan_id:id(planId),p_group_id:id(groupId),p_partition:selected},options),s,planId,groupId)
   if(JSON.stringify(exactPartition(data.partition))!==JSON.stringify(selected)||!Array.isArray(data.steps)||!['current','unconfigured','source_unavailable_or_changed','temporarily_unavailable'].includes(data.state)||data.state==='current'&&!HASH.test(data.context_sha256||''))throw Error('Stage material response differs from exact partition')
   return freeze(data)
  },
  async reviewBindings(s,{planId,bindings,...options}){
   const data=requireScope(await read('review_project_stage_bindings',{...scope(s),p_expected_plan_id:id(planId),p_bindings:projectStageBindings(bindings)},options),s)
   if(data.parent_version_id!==planId||!HASH.test(data.review_sha256||'')||!Array.isArray(data.bindings))throw Error('Stage binding review differs from exact saved plan')
   return freeze({...data,bindings:projectStageBindings(data.bindings)})
  },
  async applyBindings(s,{requestId,review,confirmed=false,signal}){
   if(confirmed!==true||!same(review,s)||!HASH.test(review.review_sha256||'')||review.changed!==true)throw Error('Explicit exact stage binding review required')
   const data=await invoke('apply_project_stage_bindings',{...scope(s),p_expected_plan_id:id(review.parent_version_id),p_request_id:id(requestId),p_review_sha256:review.review_sha256,p_bindings:projectStageBindings(review.bindings)},signal)
   if(!same(data,s)||data.request_id!==requestId||data.parent_version_id!==review.parent_version_id||!same(data.snapshot,s))throw Error('Applied plan response differs; preserve the original request for read-only recovery')
   return freeze(data)
  },
  async recoverBindings(s,{requestId,...options}){
   const data=requireScope(await read('recover_project_stage_bindings',{...scope(s),p_request_id:id(requestId)},options),s)
   if(!['applied','not_found'].includes(data.status)||data.read_only!==true||data.status==='applied'&&(!same(data.original_result,s)||data.original_result.request_id!==requestId||!same(data.original_result.snapshot,s)))throw Error('Original stage request recovery differs from exact scope')
   return freeze(data)
  },
  async refreshSelection(s,selection,options={}){
   if(!same(selection,s)||selection.version!==1||!PROJECT_STAGE_PHASES.some(p=>p.key===selection.phase)||!HASH.test(selection.context_sha256||''))throw Error('Exact selected stage context required')
   const data=await api.readPartition(s,{planId:selection.plan_id,groupId:selection.group_id,partition:selection.partition,...options})
   if(data.state!=='current'||data.context_sha256!==selection.context_sha256||!data.steps.some(step=>step.phase===selection.phase))throw Error('Selected stage changed; refresh and explicitly choose its current context')
   return data
  },
 }
 return Object.freeze(api)
}
