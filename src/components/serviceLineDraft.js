// UI draft preparation only; server-owned validation remains in projectSetup.
export function serviceLineDraft(snapshot, serviceId) {
 const prior=snapshot.state?.plan?.contributions?.find(row=>row.service_id===serviceId)?.service_line
 const scope=snapshot.scopes.find(row=>row.service_id===serviceId)
 const canonical=(key,fallback)=>scope&&Object.hasOwn(scope,key)?scope[key]:prior?.[key]??fallback
 return {catalogue_version:1,service_group:prior?.service_group||'',start_date:canonical('start_date','')||'',target_date:canonical('target_date',null),timezone:prior?.timezone||'',generation_horizon:prior?.generation_horizon??null,scope_statement:canonical('scope_statement','')||'',exclusions:canonical('exclusions','')||''}
}
export function retainServiceLineDrafts(plan,snapshot,force=false){
 if(!force&&plan.service_line_version!==2&&!plan.items.some(item=>item.service_line))return plan
 return {...plan,service_line_version:2,items:plan.items.map(item=>({...item,service_line:item.service_line?{...item.service_line}:serviceLineDraft(snapshot,item.service_id)}))}
}
