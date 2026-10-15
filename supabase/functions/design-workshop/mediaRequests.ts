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
 const bytes=new TextEncoder().encode(data.prompt),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(data.request.prompt_checksum!==digest)throw Error('Confirmed prompt checksum mismatch');return data;
}
export async function quoteMediaRequest(admin:Admin,body:Record<string,any>,actor:string){
 const prepared=await prepareMediaRequest(admin,body,actor);
 const {data,error}=await admin.rpc('quote_design_media_request',{p_org:admin.organizationId,p_actor:actor,p_request:prepared.request});
 if(error)throw Object.assign(new Error('A current reviewed price is unavailable for this exact request'),{status:409});
 requireMediaQuote(prepared.request,data);return {request:prepared.request,quote:data};
}
import {OPENAI_STILL_MODELS,SOUL_MODEL,SEEDANCE_TEXT_MODEL,SEEDANCE_INPUT_MODEL} from '../_shared/designMediaSelection.js'
export async function listMediaChoices(admin:any,body:Record<string,any>,actor:string){
 const {data:connections,error}=await admin.from('integration_connections').select('id,display_name,provider').eq('organization_id',admin.organizationId).in('provider',['openai','higgsfield']).eq('status','verified').is('archived_at',null).order('id').limit(101);
 if(error||!Array.isArray(connections)||connections.length>100)throw Error('Available media connections could not be confirmed');
 const inputs=body.input_versions||[];if(!Array.isArray(inputs)||inputs.length>1)throw Error('One exact selected input is supported');for(const input of inputs)requireSelectedSourceConsent(input,input,'higgsfield');
 const choices=[];
 for(const c of connections){
  const models=inputs.length?(c.provider==='higgsfield'?[SEEDANCE_INPUT_MODEL]:[]):c.provider==='openai'?OPENAI_STILL_MODELS:[SOUL_MODEL,SEEDANCE_TEXT_MODEL];
  for(const model of models){
   const settings=c.provider==='openai'?{size:'1024x1024',quality:'medium',background:'opaque',output_format:'png'}:model===SOUL_MODEL?{resolution:'720p',aspect_ratio:'16:9',enhance_prompt:false}:{duration_seconds:5,resolution:'720p',aspect_ratio:'16:9',output_format:'mp4',generate_audio:false};
   if(model===SEEDANCE_INPUT_MODEL)delete (settings as Record<string,any>).aspect_ratio;
   const selection={organization_id:admin.organizationId,context:body.context,creative_brief_version_id:body.creative_brief_version_id,connector_connection_id:c.id,provider:c.provider,model_id:model,settings,output_count:1,input_versions:inputs,prompt_checksum:'0'.repeat(64)};
   const {data,error:denied}=await admin.rpc('prepare_design_media_request',{p_org:admin.organizationId,p_actor:actor,p_request:selection});
   if(denied){if(['42501','22023','40001'].includes(denied.code))continue;throw Error('Media eligibility could not be confirmed')}
   if(data?.creative_brief_id!==body.creative_brief_id||!data?.request||mediaRequestIdentity({...data.request,prompt_checksum:selection.prompt_checksum})!==mediaRequestIdentity(selection))throw Error('Media eligibility response changed');
   choices.push({id:c.id+':'+model,label:(c.display_name||c.provider)+' · '+model,kind:[SEEDANCE_TEXT_MODEL,SEEDANCE_INPUT_MODEL].includes(model)?'video':'image',selection:data.request});
  }
 }
 return {choices};
}
