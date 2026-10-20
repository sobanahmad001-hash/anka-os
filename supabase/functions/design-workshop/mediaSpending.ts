export async function readMediaSpending(admin:any,actor:string,body:Record<string,unknown>){
 const month=body.month;if(typeof month!=='string'||!/^\d{4}-\d{2}-01$/.test(month)||!Number.isFinite(Date.parse(month)))throw Error('Choose a valid accounting month');
 const {data,error}=await admin.rpc('get_design_media_spending',{p_org:admin.organizationId,p_actor:actor,p_month:month});
 if(error)throw Object.assign(Error('Spending could not be read for this organization and month'),{status:403});
 if(data?.organization_id!==admin.organizationId||data.month!==month||data.currency!=='USD'||data.scope!=='design_media_reservations'||data.agent_attribution!=='not_recorded'||!Array.isArray(data.groups)||data.groups.length>1501)throw Error('Invalid spending scope');
 const money=['reserved_microusd','uncertain_microusd','reconciled_microusd'],counts=['request_count','reconciled_count','released_count'];
 const groups=data.groups.map((g:any)=>{
  if(!['total','user','project','model'].includes(g.dimension)||money.some(k=>typeof g[k]!=='string'||!/^\d{1,30}$/.test(g[k]))||counts.some(k=>!Number.isSafeInteger(g[k])||g[k]<0)||['user_id','project_key','provider','model_id'].some(k=>g[k]!==null&&(typeof g[k]!=='string'||g[k].length>200)))throw Error('Invalid spending totals');
  return Object.fromEntries(['dimension','user_id','project_key','provider','model_id',...money,...counts].map(k=>[k,g[k]]));
 });
 if(groups.filter((g:any)=>g.dimension==='total').length!==1)throw Error('Missing spending total');
 const b=data.guard;if(b!==null&&(!['local_monthly_cap','provider_managed'].includes(b?.mode)||b.external_provider_limit_verified!==false||(b.mode==='local_monthly_cap'&&(typeof b.monthly_limit_microusd!=='string'||!/^\d{1,30}$/.test(b.monthly_limit_microusd)))))throw Error('Invalid spending guard');
 return {organization_id:admin.organizationId,month,currency:'USD',scope:'design_media_reservations',agent_attribution:'not_recorded',guard:b===null?null:{mode:b.mode,monthly_limit_microusd:b.mode==='local_monthly_cap'?b.monthly_limit_microusd:null,external_provider_limit_verified:false},groups};
}
