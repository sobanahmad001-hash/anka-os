// Coordinates existing domain actions. Progress is read from their original receipts.
export const WEBSITE_BUILD_SERVICES=new Set(['staging_production_builds','setup_development_website_page_build','setup_development_theme_setup'])
export function websiteExecutionAccess(workspace,membership,owner){
 const p=workspace?.project,e=workspace?.engagement,relation=x=>Array.isArray(x)?x[0]:x
 const same=Boolean(membership?.member_kind!=='client'&&(!membership?.status||membership.status==='active')&&p?.id&&e?.project_id===p.id&&e?.organization_id===p.organization_id&&membership?.organizationId===p.organization_id)
 const service=same&&(workspace.activeServices||[]).some(s=>{const c=relation(s.service_catalog);return s.organization_id===p.organization_id&&s.engagement_id===e.id&&s.status==='active'&&c?.is_active!==false&&c?.department_id==='development'&&WEBSITE_BUILD_SERVICES.has(c.slug)})
 const development=['system_owner','operations_admin','executive'].includes(membership?.role)||[membership?.department_id,membership?.departmentId].includes('development')
 return {canExecute:Boolean(owner&&same&&service&&development),canBind:Boolean(owner&&same&&['system_owner','operations_admin'].includes(membership?.role)),service:Boolean(service)}
}
export function websiteExecutionProgress(build,staging,jobId){
 const job=build?.jobs?.find(j=>j.id===jobId),packageReady=job?.status==='complete'&&!job.stale_sources?.length
 const currentTargets=staging?.targets?.filter(t=>t.current)||[]
 const runs=(staging?.runs||[]).filter(r=>r.job_id===jobId)
 const pending=runs.filter(r=>['processing','uncertain'].includes(r.status))
 const previews=runs.filter(r=>r.status==='staged'&&!r.stale_sources?.length&&currentTargets.some(t=>t.id===r.target_id)&&r.evidence?.environment==='staging'&&r.evidence?.published===false)
 return {job,packageReady,currentTargets,pending,previews,next:pending.length?'recover':!jobId?'select_package':!job?'package_not_loaded':!packageReady?'review_package':!currentTargets.length?'connect_staging':previews.length?'review_preview':'review_staging'}
}
export function guardWebsiteExecutionRepositories({build,staging,getState,actor}){
 async function guard(action,scope,write=false){
  const before=getState()
  function check(s){if(s.signal?.aborted||s.disabled||scope.organizationId!==s.organizationId||scope.projectId!==s.projectId||scope.engagementId!==s.engagementId)throw Error('Website execution context changed; refresh before continuing')
   if(s.actorId!==before.actorId||(scope.actorId!==undefined&&scope.actorId!==s.actorId))throw Error('Website execution actor changed')
   if(s.draftDirty&&action==='build')throw Error('Save or clear the retained staging revision note before building')
   if(write&&(!s.owner||(action==='bind'?!s.canBind:!s.canExecute)))throw Error('Current authority and active Website implementation service required')}
  check(before)
  if(write){if(await actor()!==before.actorId)throw Error('Signed-in actor changed; preserve the original request');check(getState())}
  return check
 }
 const wrap=(repository,names)=>Object.freeze(Object.fromEntries(names.map(([name,action,write])=>[name,async(scope,...args)=>{const check=await guard(action,scope,write);check(getState());return repository[name](scope,...args)}])))
 return {build:wrap(build,[['workspace','read',false],['review','read',false],['build','build',true],['download','read',false]]),staging:wrap(staging,[['workspace','read',false],['inspect','bind',true],['bind','bind',true],['dryRun','stage',true],['deploy','stage',true],['recover','read',false],['issue','stage',true],['linkWorkspace','read',false],['linkSave','bind',true],['linkRecover','read',false],['qaReview','stage',true],['qaSave','stage',true],['qaRecover','read',false]])}
}
