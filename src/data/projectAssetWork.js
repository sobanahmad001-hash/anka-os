import {projectDeliveryContext} from './projectDeliveryContext.js'

const key=ref=>`${ref.kind}:${ref.id}`
const same=(row,scope)=>row?.organization_id===scope.organizationId&&row.project_id===scope.projectId

// A projection of existing references, never an asset registry or a relationship writer.
export function websiteAsset(row,scope,reference){
 if(!row?.page_id||!row.source?.page_key||reference?.artifact_version_id!==scope.architectureVersionId)return null
 if(row.operations&&(['organization_id','project_id'].some(k=>row.operations[k]&&row.operations[k]!==({organization_id:scope.organizationId,project_id:scope.projectId})[k])||row.operations.page_id&&row.operations.page_id!==row.page_id))return null
 return {kind:'website_page',id:row.page_id,...scope,title:row.source.title,subtitle:`/${row.source.path}`,lifecycle:row.operations?.publication_state||'planned',revision:row.operations?.revision_number??null,sourceVersionId:reference.artifact_version_id,sourceLabel:`Architecture v${reference.version_number}`,workRefs:row.work_state==='current'&&row.operations?.work_item_id?[{kind:'engagement_work_item',id:row.operations.work_item_id}]:[],unavailableRelations:row.work_state==='unavailable'?1:0,sourceRefs:[],trackedPageId:row.tracked_page_id||null,coverage:'Existing page implementation link; other work is shown only where an explicit canonical relationship exists.'}
}

export function campaignAsset(row,scope,placements=[],variants=[]){
 const r=row?.record,s=r?.source_descriptor
 if(!same(r,scope)||!same(s,scope)||s.version_id!==r.source_version_id||s.engagement_id&&s.engagement_id!==scope.engagementId)return null
 const related=placements.filter(p=>p.asset_id===r.id&&p.campaign_id===scope.campaignId&&p.data?.campaign_plan_version_id===scope.planVersionId&&p.current_reference?.context?.engagement_id===scope.engagementId&&(!p.organization_id||p.organization_id===scope.organizationId)&&(!p.project_id||p.project_id===scope.projectId))
 const available=row.source_state==='available'
 const exactVariants=variants.filter(v=>same(v.record,scope)&&v.record.asset_id===r.id&&same(v.record.source_descriptor,scope)&&v.record.source_descriptor.version_id===v.record.source_version_id)
 return {kind:'campaign_asset',id:r.id,...scope,title:s.title||'Campaign asset',subtitle:s.kind==='deliverable_version'?'Governed file source':'Canonical artifact source',lifecycle:available?'source available':'source unavailable',sourceVersionId:s.version_id,sourceLabel:`Source v${s.version_number}`,revision:null,workRefs:available?related.filter(p=>p.contribution_available&&p.current_contribution&&p.data?.contribution?.id===p.current_contribution.id&&p.data.contribution.kind===p.current_contribution.kind).map(p=>p.data.contribution):[],unavailableRelations:related.filter(p=>!p.contribution_available).length,sourceRefs:[...(available&&s.kind==='artifact_version'?[{artifactId:s.root_id,versionId:s.version_id}]:[]),...exactVariants.filter(v=>available&&v.source_state==='available'&&v.parent_source_state==='available'&&v.record.source_descriptor.kind==='artifact_version').map(v=>({artifactId:v.record.source_descriptor.root_id,versionId:v.record.source_version_id}))],variants:exactVariants.map(v=>({id:v.record.id,label:v.record.label,versionId:v.record.source_version_id,available:v.source_state==='available'&&v.parent_source_state==='available'})),placements:related.map(p=>({id:p.placement_id,channel:p.data.channel,state:p.data.publication_state,revision:p.revision_number,variantId:p.variant_id||p.data.variant_id||null})),coverage:'Work relations come from the loaded, exact campaign-plan placement results. More placements may exist on other result pages.'}
}

export function assetWorkContext(workspace,asset){
 if(!workspace?.project||!asset||workspace.project.organization_id!==asset.organizationId||workspace.project.id!==asset.projectId)return null
 if(workspace.engagement?.id!==asset.engagementId||workspace.engagement?.organization_id!==asset.organizationId||workspace.engagement?.project_id!==asset.projectId)return null
 const delivery=projectDeliveryContext(workspace),requested=new Set((asset.workRefs||[]).map(key)),records=delivery.records.filter(r=>requested.has(key(r)))
 const unavailable=(asset.unavailableRelations||0)+[...requested].filter(k=>!records.some(r=>key(r)===k)).length
 const refs=[...(asset.sourceRefs||[]),...records.filter(r=>r.artifact&&r.linkedVersionId).map(r=>({artifactId:r.artifact.id,versionId:r.linkedVersionId}))]
 const outputs=delivery.outputs.flatMap(a=>{const versions=a.versions.filter(v=>refs.some(r=>r.artifactId===a.id&&r.versionId===v.id));return versions.length?[{...a,versions}]:[]})
 const stageIds=new Set(records.map(r=>(workspace.engagementWorkItems||[]).find(w=>r.kind==='engagement_work_item'&&w.id===r.id)?.linked_engagement_stage_instance_id).filter(Boolean))
 const stages=delivery.stages.filter(s=>stageIds.has(s.id))
 const reviews=(workspace.artifactReviews||[]).filter(r=>r.organization_id===asset.organizationId&&r.engagement_id===asset.engagementId&&(!r.project_id||r.project_id===asset.projectId)&&outputs.some(a=>a.id===r.artifact_id&&a.versions.some(v=>v.id===r.artifact_version_id)))
 const history=(workspace.activity||[]).filter(e=>e.organization_id===asset.organizationId&&(!e.project_id||e.project_id===asset.projectId)&&(!e.engagement_id||e.engagement_id===asset.engagementId)&&(e.project_id===asset.projectId||e.engagement_id===asset.engagementId)&&((e.target_type===asset.kind&&e.target_id===asset.id)||(e.target_type==='work_item'&&records.some(r=>r.kind==='engagement_work_item'&&r.id===e.target_id))||(e.target_type==='task'&&records.some(r=>r.kind==='project_task'&&r.id===e.target_id))))
 return {records,unavailable,outputs,reviews,stages,history,keywordStrategies:delivery.outputs.filter(a=>a.artifact_type==='keyword_strategy'),chatPath:`/sphere/workspace/projects/${encodeURIComponent(asset.projectId)}?tab=discussion`,pipelinePath:stages.length?`/sphere/engagements?engagement=${encodeURIComponent(asset.engagementId)}&project=${encodeURIComponent(asset.projectId)}&tab=pipeline`:''}
}

export const groupWorkByStatus=records=>[...new Set(records.map(r=>r.status))].map(status=>({status,records:records.filter(r=>r.status===status)}))
