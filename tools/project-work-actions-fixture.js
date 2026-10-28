import {actor} from './direct-chat-fixture.js'
export function installWorkActionsFixture(preview){
 const w=preview.projectWorkspace,commands=[],receipts=new Map(),state={lost:false};let number=0
 w.activeServices.forEach(s=>{s.service_catalog.name=s.service_catalog.department_id+' service'})
 w.engagementWorkItems.forEach(r=>{r.row_version=1})
 globalThis.__workActions={state,commands,actor:async()=>actor,
  apply:async(scope,id,command)=>{commands.push({scope,id,command});if(receipts.has(id))return receipts.get(id);let item
   if(command.action==='create'){const department=w.activeServices.find(s=>s.id===scope.activeServiceId).service_catalog.department_id;item={id:`b0000000-0000-4000-8000-${String(++number).padStart(12,'0')}`,organization_id:scope.organizationId,project_id:scope.projectId,engagement_id:scope.engagementId,department_id:department,title:command.title,description:command.description,status:'not_started',assignee_id:null,row_version:1};w.engagementWorkItems.push(item)}
   else {item=w.engagementWorkItems.find(r=>r.id===command.work_item_id);if(item.row_version!==command.row_version)throw Error('Record changed');item.linked_artifact_version_id=command.artifact_version_id;item.linked_artifact_id=w.workshopArtifacts.find(a=>a.versions.some(v=>v.id===command.artifact_version_id)).id;item.row_version++}
   const result={work_item:structuredClone(item),request_id:id};receipts.set(id,result);if(state.lost){state.lost=false;throw Error('Synthetic response lost after commit')}return result
  },recover:async(_scope,id)=>{commands.push({recovery:true,id});return receipts.get(id)||{status:'not_applied'}}
 }
}
