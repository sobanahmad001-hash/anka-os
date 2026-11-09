export function eligiblePlanServiceIds(group, services) {
 const eligible = new Set(services.filter(row => ['planned', 'active'].includes(row.status)).map(row => row.service_id))
 if (group?.kind !== 'website' || !group.pipeline_group_id || !group.definition_publication_id) return eligible
 for (const contribution of group.contributions || []) {
  if (contribution.quantity !== 1 || contribution.status !== 'active' || !contribution.engagement_service_id || !contribution.scope_service_id) continue
  if (services.some(row => row.status === 'active' && row.id === contribution.engagement_service_id && row.service_id === contribution.scope_service_id)) {
   eligible.add(contribution.service_id)
  }
 }
 return eligible
}

export function planStageDefaults(group,services=[]){
 const eligible=eligiblePlanServiceIds(group,services),quantities={},actions={}
 for(const step of group.stages||[]){if(!step.selected_service||!eligible.has(step.service_id))continue;const contribution=group.contributions.find(x=>x.service_id===step.service_id);if(contribution?.status==='completed')continue;const n=step.planned_quantity;if(Number.isInteger(n)&&n>0&&n<=50){quantities[step.key]=String(n);actions[step.key]='run'}}
 // This is an editable batch suggestion. Approval/reuse/input choices are never manufactured.
 return {quantities,actions}
}
export function inspectServicePlan(data){
 const draft=data?.draft;if(!draft)return {changes:[],groups:[],unmapped:[],canApply:false}
 return {...draft,canApply:draft.can_manage===true&&draft.contributions.length>0&&draft.changes.length>0&&!draft.groups.some(g=>g.choose_group)}
}
