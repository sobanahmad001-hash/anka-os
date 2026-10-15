const canonical=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'
type PricingClient = {organizationId:string;rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>}
export async function listMediaRates(admin:PricingClient,actorId:string){
 const {data,error}=await admin.rpc('list_design_media_rates',{p_org:admin.organizationId,p_actor:actorId});
 if(error)throw Object.assign(new Error('Reviewed media rates could not be read'),{status:403});
 if(!Array.isArray(data)||data.some(r=>r.organization_id!==admin.organizationId))throw new Error('Invalid scoped rate response');
 return data;
}
export async function configureMediaRate(admin:PricingClient,body:Record<string,any>,actorId:string,now=Date.now()){
 const provider=body.provider,model=body.model_id,settings=body.settings,unit=body.unit_max_charge_microusd;
 const verified=Date.parse(body.verified_at),until=Date.parse(body.valid_until);
 let source:URL;try{source=new URL(body.source_url)}catch{throw new Error('Official pricing source required')}
 const hosts=provider==='higgsfield'?['open.higgsfield.ai']:provider==='openai'?['developers.openai.com','openai.com']:[];
 if(!hosts.includes(source.hostname)||source.protocol!=='https:'||source.username||source.password||source.port
 ||typeof model!=='string'||!model.trim()||model.length>200||!settings||typeof settings!=='object'||Array.isArray(settings)
 ||JSON.stringify(settings).length>8192||!Number.isSafeInteger(unit)||unit<1||unit>90071992547409
 ||!Number.isFinite(verified)||!Number.isFinite(until)||verified>now||until<=now||until<=verified||until-verified>86400000)
 throw new Error('Current exact settings, official source and bounded unit price required');
 const {data,error}=await admin.rpc('configure_design_media_rate',{p_org:admin.organizationId,p_actor:actorId,p_provider:provider,p_model:model,p_settings:settings,p_unit_max:unit,p_source:source.href,p_verified_at:new Date(verified).toISOString(),p_valid_until:new Date(until).toISOString()});
 if(error)throw Object.assign(new Error('Reviewed rate was not confirmed. Refresh rates before trying again.'),{status:409});
 if(!data?.id||data.organization_id!==admin.organizationId||data.provider!==provider||data.model_id!==model||data.unit_max_charge_microusd!==unit||canonical(data.settings)!==canonical(settings)||data.source_url!==source.href||Date.parse(data.verified_at)!==verified||Date.parse(data.valid_until)!==until)throw new Error('Rate persistence could not be confirmed');
 return data;
}
