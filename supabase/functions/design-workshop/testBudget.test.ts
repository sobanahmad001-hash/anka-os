import {generateMedia} from './mediaExecution.ts'
import {LINEUP_CONTRACTS} from '../_shared/designModelLineup.js'
const models:Record<string,{defaults:Record<string,unknown>,input:boolean}>={...LINEUP_CONTRACTS,
 'higgsfield-ai/soul/v2/standard':{defaults:{resolution:'720p',aspect_ratio:'16:9',enhance_prompt:false},input:false},
 'higgsfield-ai/soul/v2/image-to-image':{defaults:{resolution:'720p',aspect_ratio:'16:9',enhance_prompt:true},input:true},
 'bytedance/seedance-2.5/text-to-video':{defaults:{duration_seconds:5,resolution:'720p',aspect_ratio:'16:9',generate_audio:false,output_format:'mp4'},input:false},
 'bytedance/seedance-2.5/image-to-video':{defaults:{duration_seconds:5,resolution:'720p',generate_audio:false,output_format:'mp4'},input:true},
};
for(const [model,spec] of Object.entries(models))for(const reason of ['activation blocked','USD10 exhausted']){
 Deno.test(`${reason}: no provider submission for ${model}`,async()=>{
  const previous=Deno.env.get('DESIGN_VIDEO_PAID_EXECUTION_ENABLED');Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED','true');
  try{
   const prompt='Offline exact brief',checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prompt))),x=>x.toString(16).padStart(2,'0')).join('');
   const source={kind:'media_output',id:'original:0',checksum:'a'.repeat(64),provider_consent:{provider:'higgsfield',source_id:'original:0',checksum:'a'.repeat(64),allow_transfer:true}};
   const request={organization_id:'org',context:{kind:'private',id:'chat'},creative_brief_version_id:'version',connector_connection_id:'connection',provider:'higgsfield',model_id:model,settings:spec.defaults,output_count:1,input_versions:spec.input?[source]:[],prompt_checksum:checksum};
   let claims=0,calls=0;
   const admin:any={organizationId:'org',rpc:async(name:string)=>{
    if(name==='prepare_design_media_request')return {data:{creative_brief_id:'brief',request,prompt},error:null};
    if(name==='claim_design_media_generation'){claims++;return {data:null,error:{code:reason==='activation blocked'?'42501':'22003',message:reason}}}
    throw Error('Unexpected write after denial');
   }};
   const noCall=()=>{calls++;throw Error('Provider must never be called')};
   const deps={credential:async()=> 'synthetic:no-secret',inputUrl:async()=> 'https://synthetic.invalid/original',fetch:noCall,adapter:{submit:noCall,submitImage:noCall,submitGuidedImage:noCall,submitImageToVideo:noCall,submitLineup:noCall}};
   const body={creative_brief_id:'brief',selection:request,operation_key:'99999999-9999-4999-8999-999999999903',quote_id:'99999999-9999-4999-8999-999999999904',acceptance:{generate:true,confirm_above_threshold:true}};
   let denied=false;try{await generateMedia(admin,body,'actor',deps)}catch{denied=true}
   if(!denied||claims!==1||calls!==0)throw Error('Budget denial did not stop dispatch');
  }finally{if(previous===undefined)Deno.env.delete('DESIGN_VIDEO_PAID_EXECUTION_ENABLED');else Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED',previous)}
 });
}
