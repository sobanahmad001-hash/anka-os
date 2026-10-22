import {prepareMediaRequest} from './mediaRequests.ts'
const org='99999999-9999-4999-8999-999999999901',actor='99999999-9999-4999-8999-999999999902';
const selection={organization_id:'caller-org',context:{kind:'private',id:'chat'},creative_brief_version_id:'version',connector_connection_id:'connector',provider:'openai',model_id:'gpt-image-1',settings:{size:'1024x1024',quality:'low',background:'opaque',output_format:'png'},output_count:1,input_versions:[],prompt_checksum:'a'.repeat(64)};
const prompt='Exact frozen canonical instructions';
async function fixture(change:any={}){const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prompt))),x=>x.toString(16).padStart(2,'0')).join('');const calls:any[]=[];return {calls,admin:{organizationId:org,rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{creative_brief_id:'brief',prompt,request:{...args.p_request,prompt_checksum:checksum,...change}},error:null}}}}}
Deno.test('media preparation binds current organization and database-confirmed frozen prompt',async()=>{const {admin,calls}=await fixture();const result=await prepareMediaRequest(admin,{creative_brief_id:'brief',selection},actor);if(result.request.organization_id!==org||result.prompt!==prompt||calls.length!==1||calls[0].args.p_actor!==actor||calls[0].args.p_request.prompt_checksum!=='0'.repeat(64))throw Error('Caller controlled identity or prompt')})
Deno.test('media preparation refuses altered server selection or checksum',async()=>{for(const change of [{model_id:'gpt-image-1.5'},{output_count:2},{context:{kind:'private',id:'other'}},{prompt_checksum:'a'.repeat(64)}]){const {admin}=await fixture(change);let rejected=false;try{await prepareMediaRequest(admin,{creative_brief_id:'brief',selection},actor)}catch{rejected=true}if(!rejected)throw Error('Changed request accepted')}})
Deno.test('unsupported selection and mismatched brief never become dispatch-ready',async()=>{const {admin,calls}=await fixture();let rejected=false;try{await prepareMediaRequest(admin,{creative_brief_id:'brief',selection:{...selection,settings:{...selection.settings,webhook:'https://example.com'}}},actor)}catch{rejected=true}if(!rejected||calls.length)throw Error('Unsupported setting reached database');rejected=false;try{await prepareMediaRequest(admin,{creative_brief_id:'other',selection},actor)}catch{rejected=true}if(!rejected)throw Error('Wrong brief accepted')})
import {quoteMediaRequest} from './mediaRequests.ts'
Deno.test('missing reviewed rates produce safe setup guidance; unrelated failures do not masquerade as missing rates',async()=>{
 for(const code of ['55000','42501','NETWORK_ERROR']){
  const base=await fixture();const admin:any=base.admin;const original=admin.rpc;
  admin.rpc=async(name:string,args:any)=>name==='quote_design_media_request'?{data:null,error:{code,message:'internal detail'}}:original(name,args);
  let error:any;try{await quoteMediaRequest(admin,{creative_brief_id:'brief',selection},actor)}catch(e){error=e}
  if(error?.status!==409||error?.code!==(code==='55000'?'MEDIA_RATE_UNAVAILABLE':'MEDIA_QUOTE_UNAVAILABLE')||error.message.includes('internal detail'))throw Error('Unsafe or misclassified quote error')
 }
})

Deno.test('quote endpoint accepts seven-day estimates and rejects over-window or verified extensions',async()=>{
 for(const [basis,days,extra,pass] of [['estimated',7,0,true],['estimated',7,1,false],['verified',1,0,true],['verified',1,1,false]] as const){
  const base=await fixture();const original=base.admin.rpc;
  const admin={organizationId:org,rpc:async(name:string,args:any)=>{
   if(name!=='quote_design_media_request')return original(name,args);
   const reviewed=Date.now()-60000;
   return {error:null,data:{id:'quote',currency:'USD',request:args.p_request,request_checksum:'b'.repeat(64),unit_max_charge_microusd:3200,total_max_charge_microusd:3200,price_basis:basis,reviewed_at:new Date(reviewed).toISOString(),verified_at:new Date(reviewed).toISOString(),valid_until:new Date(reviewed+days*86400000+extra).toISOString()}};
  }};
  let accepted=false;try{await quoteMediaRequest(admin,{creative_brief_id:'brief',selection},actor);accepted=true}catch{}
  if(accepted!==pass)throw Error('Quote window mismatch '+basis+' '+extra);
 }
});

import {listMediaChoices} from './mediaRequests.ts'
import {LINEUP_CONTRACTS,requiresImage} from '../_shared/designModelLineup.js'
Deno.test('all exposed models intersect exact priced combinations and reject unrelated readiness scope',async()=>{
 const previous=Deno.env.get('DESIGN_VIDEO_PAID_EXECUTION_ENABLED');Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED','true');
 try{
  for(const input of [false,true]){
   const chain:any={select(){return this},eq(){return this},in(){return this},is(){return this},order(){return this},limit:async()=>({data:[{id:'connector',display_name:'Higgsfield',provider:'higgsfield'}],error:null})};
   let changed=false,missing=false;
   const admin:any={organizationId:org,from:()=>chain,rpc:async(name:string,args:any)=>{
    const request=args.p_request;
    if(name==='prepare_design_media_request')return {data:{creative_brief_id:'brief',request,prompt},error:null};
    if(name!=='read_design_media_readiness')throw Error('Unexpected RPC');
    if(missing)return {data:null,error:{code:'NETWORK'}};
    const settings={...request.settings,...(request.model_id.startsWith('kling-')?{duration:3}:{}),...(request.model_id.startsWith('xai/')?{quality:'low'}:{})};
    return {data:{configurations:[{request:{...request,settings,...(changed?{organization_id:'other'}:{})},price_basis:'estimated',total_microusd:30000,valid_until:new Date(Date.now()+60000).toISOString()},{request:{...request,settings:{...settings,unsupported:true}},price_basis:'estimated',total_microusd:30000,valid_until:new Date(Date.now()+60000).toISOString()}]},error:null};
   }};
   const source={kind:'media_output',id:'old:0',checksum:'a'.repeat(64),provider_consent:{provider:'higgsfield',source_id:'old:0',checksum:'a'.repeat(64),allow_transfer:true}};
   const body={creative_brief_id:'brief',creative_brief_version_id:'v2',context:{kind:'private',id:'chat'},input_versions:input?[source]:[]};
   const response=await listMediaChoices(admin,body,actor);
   if(response.choices.length!==Object.keys(LINEUP_CONTRACTS).filter(m=>requiresImage(m)===input).length+2)throw Error('Model coverage missing');
   for(const choice of response.choices){if(choice.configurations.length!==1)throw Error('Unsupported combination exposed');if(choice.selection.model_id.startsWith('kling-')&&choice.configurations[0].request.settings.duration!==3)throw Error('Priced duration replaced');if(choice.selection.model_id.startsWith('xai/')&&choice.configurations[0].request.settings.quality!=='low')throw Error('Priced quality replaced')}
   changed=true;let denied=false;try{await listMediaChoices(admin,body,actor)}catch{denied=true}if(!denied)throw Error('Cross-scope readiness accepted');changed=false;missing=true;denied=false;try{await listMediaChoices(admin,body,actor)}catch{denied=true}if(!denied)throw Error('Transient failure presented as ready');missing=false;
   Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED','false');const disabled=await listMediaChoices(admin,body,actor);if(disabled.choices.some(c=>c.configurations.length||c.unavailable_reason!=='execution_disabled'))throw Error('Disabled provider exposed');Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED','true');
  }
 }finally{if(previous===undefined)Deno.env.delete('DESIGN_VIDEO_PAID_EXECUTION_ENABLED');else Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED',previous)}
});
