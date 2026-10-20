
import {assertEquals,assertRejects} from 'jsr:@std/assert@1.0.14'
import {privateAnimationSources,resolvePrivateAnimationSource} from './privateAnimationSources.ts'
import {originalInputUrl,generateMedia} from './mediaExecution.ts'
const chat='a0000000-0000-4000-8000-000000000001',id='a0000000-0000-4000-8000-000000000002';
const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const row={id,organization_id:'org',conversation_id:chat,owner_id:'actor',original_name:'Original.png',status:'ready',verified_mime:'image/png',extraction_kind:'reference_only',declared_bytes:bytes.length,expected_sha256:sha,extracted_text:'must not leak'};
const context={kind:'private',id:chat},input={kind:'private_attachment',id,checksum:sha,provider_consent:{provider:'higgsfield',source_id:id,checksum:sha,allow_transfer:true}};
const request={model_id:'bytedance/seedance-2.5/image-to-video',context,input_versions:[input]};
Deno.test('private animation lists only same-owner ready PNG/JPEG metadata and never reference text',async()=>{
 const admin={organizationId:'org',rpc:async(_n:string,args:any)=>{assertEquals(args.p_actor,'actor');assertEquals(args.p_conversation,chat);return {data:[row,{...row,id:'revoked',status:'revoked'},{...row,id:'pdf',verified_mime:'application/pdf'}],error:null}}};
 const sources=await privateAnimationSources(admin,{context},'actor');assertEquals(sources.length,1);assertEquals(sources[0].kind,'private_attachment');assertEquals('extracted_text' in sources[0],false);
 await assertRejects(()=>privateAnimationSources(admin,{context:{kind:'engagement',id:chat}},'actor'));
 await assertRejects(()=>privateAnimationSources({...admin,rpc:async()=>({data:[{...row,owner_id:'other'}],error:null})},{context},'actor'));
 await assertRejects(()=>privateAnimationSources({...admin,rpc:async()=>({data:null,error:{code:'42501'}})},{context},'actor'));
});
Deno.test('uploaded animation rechecks exact original, byte checksum and revocation before signing',async()=>{
 let revoked=false,changed=false,signs=0;
 const admin={organizationId:'org',rpc:async()=>({data:[{...row,status:revoked?'revoked':'ready'}],error:null}),storage:{from:(bucket:string)=>{assertEquals(bucket,'design-private-attachments');return {download:async(path:string)=>{assertEquals(path,'org/actor/'+chat+'/'+id+'/original');return {data:new Blob([changed?new Uint8Array([...bytes,0]):bytes],{type:'image/png'}),error:null}},createSignedUrl:async()=>{signs++;return {data:{signedUrl:'https://storage.example/original'},error:null}}}}}};
 assertEquals(await originalInputUrl(admin,request,'actor'),'https://storage.example/original');assertEquals(signs,1);
 changed=true;await assertRejects(()=>originalInputUrl(admin,request,'actor'));assertEquals(signs,1);
 changed=false;revoked=true;await assertRejects(()=>originalInputUrl(admin,request,'actor'));assertEquals(signs,1);
 await assertRejects(()=>resolvePrivateAnimationSource(admin,{...request,model_id:'higgsfield-ai/soul/v2/image-to-image'},'actor'));
 await assertRejects(()=>resolvePrivateAnimationSource(admin,{...request,input_versions:[input,input]},'actor'));
});
Deno.test('revocation rejected by final atomic claim cannot dispatch the prepared private image',async()=>{
 const previous=Deno.env.get('DESIGN_VIDEO_PAID_EXECUTION_ENABLED');Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED','true');
 try{
 const prompt='Synthetic brief',checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prompt))),x=>x.toString(16).padStart(2,'0')).join('');
 const selection={...request,organization_id:'org',creative_brief_version_id:'version',connector_connection_id:'connection',provider:'higgsfield',settings:{duration_seconds:5,resolution:'720p',output_format:'mp4',generate_audio:false},output_count:1,prompt_checksum:checksum};
 let revoked=false,submits=0;const admin={organizationId:'org',rpc:async(n:string)=>{if(n==='prepare_design_media_request')return {data:{creative_brief_id:'brief',request:selection,prompt},error:null};if(n==='claim_design_media_generation'){assertEquals(revoked,true);return {data:null,error:{message:'Source revoked',code:'42501'}}}throw Error(n)}};
 await assertRejects(()=>generateMedia(admin,{creative_brief_id:'brief',selection,operation_key:id,quote_id:chat,acceptance:{generate:true}},'actor',{credential:async()=> 'synthetic',inputUrl:async()=>{revoked=true;return 'https://storage.example/original'},adapter:{submitImageToVideo:async()=>{submits++;throw Error('Forbidden')}}}));assertEquals(submits,0);
 }finally{if(previous===undefined)Deno.env.delete('DESIGN_VIDEO_PAID_EXECUTION_ENABLED');else Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED',previous)}
});
