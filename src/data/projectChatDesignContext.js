// Visible prerequisites only. The native source RPC independently validates authority.
export function chatDesignPrerequisites(workspace,handoff,history,pages){
 const content=workspace.versions.find(v=>v.id===handoff.output.artifact_version_id&&v.artifact_id===handoff.output.artifact_id&&v.content_checksum===handoff.output.content_checksum)
 if(!content)throw Error('The exact handed-off Content version is unavailable.')
 const architectureId=handoff.selection?.partition.kind==='website_page'?handoff.selection.partition.architecture_version_id:content.content?.source_architecture_version_id
 if(!architectureId)throw Error('Choose a registered Website page through the Content handoff before preparing native Design.')
 const eligiblePages=(pages?.pages||[]).filter(p=>p.page_id&&(handoff.selection?.partition.kind==='website_page'?p.page_id===handoff.selection.partition.id:p.source?.page_key===content.content?.target_page_key))
 const briefs=(workspace.creativeBriefs||[]).filter(b=>b.organization_id===handoff.organization_id&&b.engagement_id===handoff.engagement_id&&b.visibility==='official'&&b.engagement_service_id===handoff.handoff.receiving_service_id&&b.engagement_work_item_id===handoff.handoff.receiving_work_item_id&&!b.project_task_id&&b.current_version_id===b.frozen_version_id).flatMap(b=>(workspace.creativeBriefVersions||[]).filter(v=>v.id===b.frozen_version_id&&v.creative_brief_id===b.id&&v.content?.output_type==='website'&&v.validation_snapshot?.valid===true))
 const sites=(history.sites||[]).filter(s=>s.organization_id===handoff.organization_id&&s.project_id===handoff.project_id&&s.engagement_id===handoff.engagement_id)
 return {content,architectureId,pages:eligiblePages,briefs,sites}
}
export function currentDesignWork(relation,id){
 const subject=relation?.subject
 if(subject?.id!==id||!Number.isSafeInteger(subject.row_version)||subject.row_version<1)throw Error('Current source and receiving Work versions are required. Refresh the original handoff.')
 return {id,row_version:subject.row_version}
}
