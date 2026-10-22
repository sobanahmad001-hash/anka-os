import {LINEUP_CONTRACTS,LINEUP_LABELS,buildLineupInput,mediaKind,modelOrder} from '../_shared/designModelLineup.js'
import {requireSupportedMediaSelection,requireSelectedSourceConsent} from '../_shared/designMediaSelection.js'
import {mediaRequestIdentity,requireMediaQuote} from '../_shared/designMediaCost.js'
type Admin={organizationId:string;rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>}
export async function prepareMediaRequest(admin:Admin,body:Record<string,any>,actor:string){
 const input=body.selection;if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Exact media selection required');
 const request={...input,organization_id:admin.organizationId,prompt_checksum:'0'.repeat(64)};
 mediaRequestIdentity(request);requireSupportedMediaSelection(request.provider,request.model_id,request.settings,request.output_count,request.input_versions);
 for(const source of request.input_versions)requireSelectedSourceConsent(source,source,request.provider);
 const {data,error}=await admin.rpc('prepare_design_media_request',{p_org:admin.organizationId,p_actor:actor,p_request:request});
 if(error)throw Object.assign(new Error('The confirmed brief, selected input or media connection is no longer available'),{status:409});
 if(data?.creative_brief_id!==body.creative_brief_id||!data?.request||typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>12000||mediaRequestIdentity({...data.request,prompt_checksum:request.prompt_checksum})!==mediaRequestIdentity(request))throw Error('Media request could not be confirmed');
 if(LINEUP_CONTRACTS[request.model_id])buildLineupInput(request.model_id,data.prompt,request.settings,request.output_count,LINEUP_CONTRACTS[request.model_id].input?'https://validated.invalid/original':undefined);
 const bytes=new TextEncoder().encode(data.prompt),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(data.request.prompt_checksum!==digest)throw Error('Confirmed prompt checksum mismatch');return data;
}
export async function quoteMediaRequest(admin:Admin,body:Record<string,any>,actor:string){
 const prepared=await prepareMediaRequest(admin,body,actor);
 const {data,error}=await admin.rpc('quote_design_media_request',{p_org:admin.organizationId,p_actor:actor,p_request:prepared.request});
 if(error){if(error.code==='55000')throw Object.assign(new Error('Admin pricing setup required: a current reviewed price is unavailable for these exact settings.'),{status:409,code:'MEDIA_RATE_UNAVAILABLE'});throw Object.assign(new Error('The exact price could not be verified. Nothing was generated. Try Generate again.'),{status:409,code:'MEDIA_QUOTE_UNAVAILABLE'});}
 requireMediaQuote(prepared.request,data);return {request:prepared.request,quote:data};
}
import {OPENAI_STILL_MODELS,SOUL_MODEL,SOUL_GUIDED_MODEL,SEEDANCE_TEXT_MODEL,SEEDANCE_INPUT_MODEL} from '../_shared/designMediaSelection.js'
export async function listMediaChoices(admin:any,body:Record<string,any>,actor:string){
 const {data:connections,error}=await admin.from('integration_connections').select('id,display_name,provider').eq('organization_id',admin.organizationId).in('provider',['openai','higgsfield']).eq('status','verified').is('archived_at',null).order('id').limit(101);
 if(error||!Array.isArray(connections)||connections.length>100)throw Error('Available media connections could not be confirmed');
 const inputs=body.input_versions||[];if(!Array.isArray(inputs)||inputs.length>1)throw Error('One exact selected input is supported');for(const input of inputs)requireSelectedSourceConsent(input,input,'higgsfield');
 const choices=[];
 for(const c of connections){
  const models=inputs.length?(c.provider==='higgsfield'?(inputs[0]?.kind==='private_attachment'?[SEEDANCE_INPUT_MODEL]:[SOUL_GUIDED_MODEL,SEEDANCE_INPUT_MODEL]):[]):c.provider==='openai'?[...OPENAI_STILL_MODELS]:[SOUL_MODEL,SEEDANCE_TEXT_MODEL];
  if(c.provider==='higgsfield')models.push(...Object.keys(LINEUP_CONTRACTS).filter(model=>LINEUP_CONTRACTS[model].input===Boolean(inputs.length)));
  for(const model of models){
   const settings=LINEUP_CONTRACTS[model]?{...LINEUP_CONTRACTS[model].defaults}:c.provider==='openai'?{size:'1024x1024',quality:'medium',background:'opaque',output_format:'png'}:[SOUL_MODEL,SOUL_GUIDED_MODEL].includes(model)?{resolution:'720p',aspect_ratio:'16:9',enhance_prompt:model===SOUL_GUIDED_MODEL}:{duration_seconds:5,resolution:'720p',aspect_ratio:'16:9',output_format:'mp4',generate_audio:false};
   if(model===SEEDANCE_INPUT_MODEL)delete (settings as Record<string,any>).aspect_ratio;
   const selection={organization_id:admin.organizationId,context:body.context,creative_brief_version_id:body.creative_brief_version_id,connector_connection_id:c.id,provider:c.provider,model_id:model,settings,output_count:1,input_versions:inputs,prompt_checksum:'0'.repeat(64)};
   const {data,error:denied}=await admin.rpc('prepare_design_media_request',{p_org:admin.organizationId,p_actor:actor,p_request:selection});
   if(denied){if(['42501','22023','40001'].includes(denied.code))continue;throw Error('Media eligibility could not be confirmed')}
   if(data?.creative_brief_id!==body.creative_brief_id||!data?.request||mediaRequestIdentity({...data.request,prompt_checksum:selection.prompt_checksum})!==mediaRequestIdentity(selection))throw Error('Media eligibility response changed');
   const {data:readiness,error:readinessError}=await admin.rpc('read_design_media_readiness',{p_org:admin.organizationId,p_actor:actor,p_request:data.request});
   if(readinessError||!Array.isArray(readiness?.configurations))throw Error('Current generation readiness could not be checked. Refresh available models.');
   const configurations=[];
   for(const entry of readiness.configurations){
    const request=entry?.request;
    if(!request||mediaRequestIdentity({...request,settings:data.request.settings,output_count:data.request.output_count,prompt_checksum:data.request.prompt_checksum})!==mediaRequestIdentity(data.request))throw Error('Readiness scope changed');
    try{requireSupportedMediaSelection(request.provider,request.model_id,request.settings,request.output_count,request.input_versions);
     if(LINEUP_CONTRACTS[model])buildLineupInput(model,data.prompt,request.settings,request.output_count,LINEUP_CONTRACTS[model].input?'https://validated.invalid/original':undefined);
    }catch{continue}
    if(!['estimated','verified'].includes(entry.price_basis)||!Number.isSafeInteger(entry.total_microusd)||entry.total_microusd<=0||!Number.isFinite(Date.parse(entry.valid_until))||Date.parse(entry.valid_until)<=Date.now())continue;
    configurations.push(entry);
   }
   const executionDisabled=c.provider==='higgsfield'&&Deno.env.get('DESIGN_VIDEO_PAID_EXECUTION_ENABLED')!=='true';
   choices.push({id:c.id+':'+model,label:(c.display_name||c.provider)+' · '+(LINEUP_LABELS[model]||model),kind:mediaKind(model),selection:data.request,configurations:executionDisabled?[]:configurations,unavailable_reason:executionDisabled?'execution_disabled':configurations.length?null:readiness.reason||'input_contract'});
  }
 }
 return {choices:choices.sort((a,b)=>modelOrder(a.selection.model_id)-modelOrder(b.selection.model_id))};
}
