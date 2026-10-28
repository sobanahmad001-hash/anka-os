import {appendWorkshopNavigation,WORKSHOP_DESTINATIONS} from './workshopNavigation.js'
import {projectWorkCard} from './projectWorkCard.js'
import {workRecordPath} from './workItemExperience.js'
import {CONTENT_ARTIFACT_TYPES} from './contentStudio.js'

const departments=Object.keys(WORKSHOP_DESTINATIONS)
const closed=(kind,status)=>status==='done'||kind==='project_task'&&status==='cancelled'
const relation=x=>Array.isArray(x)?x[0]:x
export function projectDeliveryContext(workspace){
 const root=workspace?.project
 if(!root?.id||!root.organization_id)throw Error('Exact authorized project required')
 const same=r=>r?.organization_id===root.organization_id&&r.project_id===root.id
 const engagement=same(workspace.engagement)?workspace.engagement:null
 const base={organizationId:root.organization_id,projectId:root.id,clientId:root.client_id||'',engagementId:engagement?.id||'',brandId:engagement?.brand_id||'',origin:`/sphere/workspace/projects/${encodeURIComponent(root.id)}?tab=discussion`,originTab:'discussion'}
 const services=(workspace.activeServices||[]).filter(r=>r.organization_id===root.organization_id&&r.engagement_id===engagement?.id&&r.status==='active')
 const editor=(department,extra={})=>{
  if(!departments.includes(department)||!engagement)return ''
  const options=services.filter(r=>relation(r.service_catalog)?.department_id===department)
  // When several services match, leave their exact selection to the owning Workshop.
  if(!options.length)return ''
  return appendWorkshopNavigation(WORKSHOP_DESTINATIONS[department],{...base,activeServiceId:options.length===1?options[0].id:'',...(department==='content'?{workshopTab:'writer'}:{}),...extra})
 }
 const outputs=(workspace.workshopArtifacts||[]).filter(a=>same(a)&&a.engagement_id===engagement?.id).map(a=>({...a,versions:(a.versions||[]).filter(v=>v.organization_id===root.organization_id&&v.artifact_id===a.id)}))
 const records=[['project_task',workspace.projectTasks||[]],['engagement_work_item',workspace.engagementWorkItems||[]]].flatMap(([kind,rows])=>rows.filter(r=>same(r)&&!r.archived_at&&!r.deleted_at&&(kind==='project_task'||r.engagement_id===engagement?.id)).map(row=>{
  const artifact=kind==='engagement_work_item'?outputs.find(a=>a.id===row.linked_artifact_id):null
  const workshop=editor(row.department_id,{workRecord:{kind,id:row.id},stageId:row.linked_engagement_stage_instance_id||''})
  const next=projectWorkCard(workspace,kind,row.id,workshop)
  return {kind,id:row.id,title:row.title,status:row.status,department:row.department_id,owner:row.owner,closed:closed(kind,row.status),rowVersion:row.row_version,linkedVersionId:row.linked_artifact_version_id,recordPath:workRecordPath(kind,row.id),workshop,artifact,next:next?.next,dependencies:next?.dependencies||[],unavailable:next?.unavailable||0}
 }))
 const library=(a,v)=>{if(!CONTENT_ARTIFACT_TYPES.includes(a.artifact_type))return '';const path=editor('content',{workshopTab:'library'});if(!path)return '';const u=new URL(path,'https://anka.invalid');u.searchParams.set('artifact',a.id);u.searchParams.set('version',v.id);return u.pathname+u.search}
 return {projectId:root.id,organizationId:root.organization_id,engagementId:engagement?.id||null,records,services:services.map(s=>({id:s.id,name:relation(s.service_catalog)?.name||'Active service',department:relation(s.service_catalog)?.department_id})).filter(s=>['content','marketing','development'].includes(s.department)),outputs:outputs.map(a=>({...a,versions:a.versions.map(v=>({...v,path:library(a,v)}))})),workshops:departments.map(department=>({department,path:editor(department)})),stages:(workspace.journey||[]).filter(r=>r.organization_id===root.organization_id&&r.engagement_id===engagement?.id),counts:{total:records.length,complete:records.filter(r=>r.closed).length,blocked:records.filter(r=>r.status==='blocked'||r.unavailable||r.dependencies.some(d=>d.status!=='done')).length}}
}

// Local suggestions route to a fixed domain surface. Neither user nor model text is a write command.
export function projectDeliveryIntent(text){
 if(typeof text!=='string'||text.length>8000)return null
 if(/\b(set\s*up|services?|pipeline|scope)\b/i.test(text))return 'planning'
 if(/\b(review|approve|handoff|hand off)\b/i.test(text))return 'review'
 if(/\b(website|copy|content|write|sitemap)\b/i.test(text))return 'content'
 if(/\b(design|layout|visual|image)\b/i.test(text))return 'design'
 if(/\b(marketing|campaign|social|seo)\b/i.test(text))return 'marketing'
 if(/\b(develop|development|build|wordpress|staging|recover|retry)\b/i.test(text))return 'development'
 if(/\b(progress|status|work|task|result)\b/i.test(text))return 'progress'
 return null
}
