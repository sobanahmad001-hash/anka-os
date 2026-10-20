
import {assertEquals,assertRejects} from 'jsr:@std/assert@1.0.14'
import {originalInputUrl,generateMedia} from './mediaExecution.ts'
import {SOUL_GUIDED_MODEL,requireSupportedMediaSelection} from '../_shared/designMediaSelection.js'
const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const source={kind:'media_output',id:'job:0',checksum,provider_consent:{provider:'higgsfield',source_id:'job:0',checksum,allow_transfer:true}};
const settings={resolution:'720p',aspect_ratio:'16:9',enhance_prompt:true};
Deno.test('guided image requires one byte-checksummed source and exact enabled settings',()=>{
 assertEquals(requireSupportedMediaSelection('higgsfield',SOUL_GUIDED_MODEL,settings,1,[source]),'image');
 for(const inputs of [[],[source,source],[{...source,kind:'private_image_job'}]]){let denied=false;try{requireSupportedMediaSelection('higgsfield',SOUL_GUIDED_MODEL,settings,1,inputs)}catch{denied=true}assertEquals(denied,true)}
})
Deno.test('source URL is signed only after exact stored image bytes match; changed bytes never transfer',async()=>{
 let signs=0,changed=false;const admin={organizationId:'org',rpc:async()=>({data:{id:source.id,checksum,bucket:'design-generated-media',path:'org/private/actor/media/job/0.png'},error:null}),storage:{from:()=>({download:async()=>({data:new Blob([changed?new Uint8Array([...bytes,0]):bytes],{type:'image/png'}),error:null}),createSignedUrl:async()=>{signs++;return {data:{signedUrl:'https://storage.example/original'},error:null}}})}};
 const request={model_id:SOUL_GUIDED_MODEL,context:{kind:'private',id:'chat'},input_versions:[source]};
 assertEquals(await originalInputUrl(admin,request,'actor'),'https://storage.example/original');assertEquals(signs,1);
 changed=true;await assertRejects(()=>originalInputUrl(admin,request,'actor'),Error,'bytes changed');assertEquals(signs,1);
})
Deno.test('guided request uses shared claim and never resubmits an original operation',async()=>{
 const previous=Deno.env.get('DESIGN_VIDEO_PAID_EXECUTION_ENABLED');Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED','true');
 try{
 const prompt='Synthetic frozen brief',promptChecksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prompt))),n=>n.toString(16).padStart(2,'0')).join('');
 const request={organization_id:'org',context:{kind:'private',id:'chat'},creative_brief_version_id:'version',connector_connection_id:'connection',provider:'higgsfield',model_id:SOUL_GUIDED_MODEL,settings,output_count:1,input_versions:[source],prompt_checksum:promptChecksum};
 let claimed=false,submits=0;const job={id:'job',operation_key:'a0000000-0000-4000-8000-000000000001',claim_id:'claim',status:'claimed',request};
 const admin={organizationId:'org',rpc:async(name:string,args:any)=>{if(name==='prepare_design_media_request')return {data:{creative_brief_id:'brief',request,prompt},error:null};if(name==='claim_design_media_generation'){const replay=claimed;claimed=true;return {data:{...job,must_not_submit:replay},error:null}}if(name==='record_design_media_generation')return {data:{...job,status:args.p_state},error:null};throw Error(name)}};
 const deps={credential:async()=> 'synthetic:only',inputUrl:async()=> 'https://storage.example/original',adapter:{submitGuidedImage:async(input:any)=>{submits++;assertEquals(input.image_url,'https://storage.example/original');return {state:'pending',requestId:'mock',statusUrl:'https://api.higgsfield.ai/requests/mock/status'}}},fetch:()=>{throw Error('Network forbidden')}};
 const body={creative_brief_id:'brief',selection:request,operation_key:job.operation_key,quote_id:'a0000000-0000-4000-8000-000000000002',acceptance:{generate:true}};
 await Promise.all([generateMedia(admin,body,'actor',deps),generateMedia(admin,body,'actor',deps)]);assertEquals(submits,1);
 }finally{if(previous===undefined)Deno.env.delete('DESIGN_VIDEO_PAID_EXECUTION_ENABLED');else Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED',previous)}
})
