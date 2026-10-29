import {uuid} from '../../supabase/functions/_shared/websiteStagingContracts.js'
const id=value=>{if(!uuid(value))throw Error('Exact publication identity required');return value}
export function createWebsitePublicationRepository(client){
 const same=(row,s)=>row?.organization_id===s.organizationId&&row?.project_id===s.projectId&&row?.engagement_id===s.engagementId
 const reviewed=(row,s,kind)=>{if(row.kind!==kind||!uuid(row.review_id)||!/^[a-f0-9]{64}$/.test(row.review_sha256||'')||!same(row.snapshot?.scope,s))throw Error('Exact live review belongs to another source or context');return row}
 async function invoke(scope,action,fields={},signal){
  if(signal?.aborted)throw Error('Publication context changed')
  const {data,error}=await client.functions.invoke('website-publication',{body:{action,organization_id:id(scope.organizationId),project_id:id(scope.projectId),engagement_id:id(scope.engagementId),...fields},signal})
  let detail=data;if(error?.context?.clone)try{detail=await error.context.clone().json()}catch{/* Unknown original outcome remains pending. */}
  if(error||detail?.error)throw Error(detail?.error||'Original publication outcome is unverified; recover without resending')
  if(signal?.aborted)throw Error('Publication context changed')
  const row=detail?.data
  if(!row||typeof row!=='object')throw Error('Publication response unavailable')
  if(row.organization_id!==undefined&&(row.organization_id!==scope.organizationId||row.project_id!==scope.projectId||row.engagement_id!==scope.engagementId))throw Error('Publication response belongs to another context')
  return row
 }
 return Object.freeze({
  workspace:async(s,{signal}={})=>{const row=await invoke(s,'workspace',{},signal);if(!same(row,s)||['connections','targets','choices','history'].some(k=>!Array.isArray(row[k])))throw Error('Publication workspace belongs to another context');return row},
  recoverBinding:async(s,requestId,{signal}={})=>{const row=await invoke(s,'workspace',{},signal);if(!same(row,s)||!Array.isArray(row.targets))throw Error('Binding recovery context differs');return row.targets.find(target=>target.request_id===requestId&&target.created_by===s.actorId)||null},
  inspect:(s,connectionId,{signal}={})=>invoke(s,'inspect',{connection_id:id(connectionId)},signal),
  bind:(s,inspection,requestId,{signal}={})=>invoke(s,'bind',{connection_id:id(inspection.inspection.connection_id),inspection:inspection.inspection,inspection_sha256:inspection.inspection_sha256,confirmed:true,request_id:id(requestId)},signal),
  inventory:(s,targetId,{signal}={})=>invoke(s,'inventory',{target_id:id(targetId)},signal),
  review:async(s,targetId,pages,themeChange,{signal}={})=>{const row=reviewed(await invoke(s,'review',{target_id:id(targetId),pages,theme_change:themeChange,request_id:crypto.randomUUID()},signal),s,'publication');if(row.snapshot.target.target_id!==targetId)throw Error('Publication target differs');return row},
  reviewRollback:async(s,requestId,themeChange,{signal}={})=>{const row=reviewed(await invoke(s,'review-rollback',{publication_request_id:id(requestId),theme_change:themeChange,request_id:crypto.randomUUID()},signal),s,'rollback');if(row.snapshot.retained.published_head!==requestId)throw Error('Original rollback publication differs');return row},
  execute:async(s,review,requestId,{confirmed=false,signal}={})=>{if(!confirmed)throw Error('Confirm this exact live operation');const row=await invoke(s,review.kind==='rollback'?'rollback':'publish',{review_id:id(review.review_id),review_sha256:review.review_sha256,confirmed:true,request_id:id(requestId)},signal);if(row.request_id!==requestId)throw Error('Original publication response differs');return row},
  recover:async(s,requestId,{signal}={})=>{const row=await invoke(s,'recover',{request_id:id(requestId)},signal);if(row.request_id!==requestId)throw Error('Original recovery response differs');return row},
 })
}
