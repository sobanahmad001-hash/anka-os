export function planStageDefaults(group,services=[]){
 const eligible=new Set(services.filter(x=>['planned','active'].includes(x.status)).map(x=>x.service_id)),quantities={},actions={}
 for(const step of group.stages||[]){if(!step.selected_service||!eligible.has(step.service_id))continue;const contribution=group.contributions.find(x=>x.service_id===step.service_id);if(contribution?.status==='completed')continue;const n=step.planned_quantity;if(Number.isInteger(n)&&n>0&&n<=50){quantities[step.key]=String(n);actions[step.key]='run'}}
 // This is an editable batch suggestion. Approval/reuse/input choices are never manufactured.
 return {quantities,actions}
}
export function inspectServicePlan(data){
 const draft=data?.draft;if(!draft)return {changes:[],groups:[],unmapped:[],canApply:false}
 return {...draft,canApply:draft.can_manage===true&&draft.contributions.length>0&&draft.changes.length>0&&!draft.groups.some(g=>g.choose_group)}
}
