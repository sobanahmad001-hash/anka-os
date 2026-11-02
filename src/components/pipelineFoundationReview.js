// UI validation of the exact reader response; permissions remain server-owned.
export function inspectFoundationContext(result,scope,declared){
 if(!result||result.organization_id!==scope.organizationId||result.engagement_id!==scope.engagementId||(result.pipeline_group_id||null)!==(scope.pipelineGroupId||null)||(scope.projectId&&result.project_id!==scope.projectId)||!Array.isArray(result.blockers))throw Error('Project guidance response differs from the selected pipeline')
 const context=result.foundation_context
 if(context!==null&&(!context||context.schema_version!==1||!context.plan_version_id||!/^[a-f0-9]{64}$/.test(context.foundation_checksum||'')||!context.roles||['written','visual'].some(role=>!['approved_version','minimum'].includes(context.roles[role]?.mode))))throw Error('Exact reviewed project guidance is unavailable')
 const legacy=result.state==='legacy_unbound'&&result.legacy_configuration_allowed===true&&context===null
 if(!result.blockers.length&&context===null&&result.state!=='not_required_for_this_pipeline'&&!legacy)throw Error('Project guidance status needs a current server review')
 const blockers=result.blockers.map(row=>String(row.reason||'Review current project guidance'))
 if(context&&!declared)blockers.push('This published plan needs declared stages before its project guidance can be reviewed.')
 return {context:structuredClone(context),blockers,state:result.state,warnings:legacy?(result.warnings||[]).map(row=>String(row.reason||'This pipeline has no reviewed project guidance.')):[],canSave:blockers.length===0}
}
