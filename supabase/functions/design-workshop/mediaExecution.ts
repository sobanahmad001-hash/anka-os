import {LINEUP_CONTRACTS,mediaKind,requiresImage} from '../_shared/designModelLineup.js'
import {resolvePrivateAnimationSource} from './privateAnimationSources.ts'
import {prepareMediaRequest} from './mediaRequests.ts'
import {createDesignMediaAdapter} from '../_shared/designMediaAdapter.ts'
import {SOUL_MODEL,SOUL_GUIDED_MODEL,SEEDANCE_INPUT_MODEL,SEEDANCE_TEXT_MODEL} from '../_shared/designMediaSelection.js'
import {imageOutput,fetchDesignImageOutput} from '../_shared/designImageOutput.ts'
import {fetchDesignVideoOutput} from '../_shared/designVideoOutput.ts'
type Json=Record<string,any>
const uuid=(value:any)=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw Error('Original operation identity required');return value}
const publicJob=(job:Json)=>({...((job.conversation_id)?{conversation_id:job.conversation_id,chat_binding:job.chat_binding}:{}),...(Number.isInteger(job.brief_version_number)?{brief_version_number:job.brief_version_number}:{}),id:job.id,operation_key:job.operation_key,status:job.status,request:job.request,created_at:job.created_at,outputs:job.output_manifest||job.outputs||[]})
async function rpc(admin:any,name:string,args:Json){const {data,error}=await admin.rpc(name,args);if(error||!data)throw Object.assign(new Error('Media request could not be confirmed; recover the original operation'),{status:409});return data}
export async function recoverMediaGeneration(admin:any,body:Json,actor:string){return publicJob(await loadJob(admin,body,actor))}
async function loadJob(admin:any,body:Json,actor:string){return rpc(admin,'get_design_media_conversation_result',{p_org:admin.organizationId,p_actor:actor,p_operation:uuid(body.operation_key),p_conversation:body.conversation_id?uuid(body.conversation_id):null})}
async function connection(admin:any,request:Json){
 const {data,error}=await admin.from('integration_connections').select('id,provider,status,secret_name').eq('organization_id',admin.organizationId).eq('id',request.connector_connection_id).eq('provider',request.provider).eq('status','verified').is('archived_at',null).maybeSingle();
 const pattern=request.provider==='higgsfield'?/^ANKA_HIGGSFIELD_[A-Z0-9_]+$/:/^ANKA_OPENAI_[A-Z0-9_]+$/;
 if(error||!data||!pattern.test(data.secret_name||''))throw Error('Pinned media connection is unavailable');const credential=Deno.env.get(data.secret_name);if(!credential)throw Error('Pinned media credential is unavailable');return credential;
}
async function adapter(credential:string,reader:typeof fetch){const {createHiggsfieldClient}=await import('npm:@higgsfield/client@0.2.6/v2');return createDesignMediaAdapter(createHiggsfieldClient,credential,reader)}
const withChat=(source:Json,result:Json)=>({...result,...(source.conversation_id?{conversation_id:source.conversation_id,chat_binding:source.chat_binding}:{}),...(Number.isInteger(source.brief_version_number)?{brief_version_number:source.brief_version_number}:{})});
async function record(admin:any,job:Json,actor:string,state:string,receipt:Json|null){return withChat(job,await rpc(admin,'record_design_media_generation',{p_org:admin.organizationId,p_actor:actor,p_job:job.id,p_claim:job.claim_id,p_state:state,p_receipt:receipt}))}
export async function originalInputUrl(admin:any,request:Json,actor:string){
 const input=request.input_versions[0];let path:string,bucket='design-generated-media';
 if(input.kind==='private_attachment'){
  const original=await resolvePrivateAnimationSource(admin,request,actor);bucket=original.bucket;path=original.path;
 }else if(input.kind==='media_output'){
  const original=await rpc(admin,'resolve_design_media_input',{p_org:admin.organizationId,p_actor:actor,p_context:request.context,p_source:input.id,p_checksum:input.checksum});
  if(original.id!==input.id||original.checksum!==input.checksum||original.bucket!==bucket||!original.path?.startsWith(admin.organizationId+'/private/'+actor+'/media/'))throw Error('Original input scope changed');path=original.path;
 }else if(input.kind==='private_image_job'){
  const {data,error}=await admin.from('design_private_experiment_jobs').select('id,storage_path,request_checksum').eq('id',uuid(input.id)).eq('organization_id',admin.organizationId).eq('owner_id',actor).eq('status','succeeded').maybeSingle();
  if(error||!data||data.request_checksum!==input.checksum||!data.storage_path?.startsWith(admin.organizationId+'/private/'+actor+'/'))throw Error('Original private input changed');path=data.storage_path;
 }else if(input.kind==='design_asset_version'){
  const {data,error}=await admin.from('design_asset_versions').select('id,asset_id,storage_path,storage_bucket,content_checksum').eq('id',uuid(input.id)).eq('organization_id',admin.organizationId).maybeSingle();
  if(error||!data||data.content_checksum!==input.checksum||data.storage_bucket!==bucket||!data.storage_path?.startsWith(admin.organizationId+'/'))throw Error('Original asset version changed');path=data.storage_path;
 }else throw Error('Unsupported original input');
 if(request.model_id===SOUL_GUIDED_MODEL||LINEUP_CONTRACTS[request.model_id]?.input||input.kind==='private_attachment'){
  if(!['design_asset_version','media_output','private_attachment'].includes(input.kind))throw Error('Original byte checksum required');
  const {data:original,error:readError}=await admin.storage.from(bucket).download(path);
  if(readError||!original||original.size<12||original.size>(input.kind==='private_attachment'?5:10)*1024*1024)throw Error('Original input bytes unavailable');
  const verified=await imageOutput(new Uint8Array(await original.arrayBuffer()),original.type.split(';')[0]);
  if(verified.checksum!==input.checksum)throw Error('Original input bytes changed');
 }
 const {data,error}=await admin.storage.from(bucket).createSignedUrl(path,3600);if(error||!data?.signedUrl)throw Error('Original input could not be shared');return data.signedUrl;
}
export async function generateMedia(admin:any,body:Json,actor:string,deps:Json={}){
 const operation=uuid(body.operation_key),quote=uuid(body.quote_id);if(body.acceptance?.generate!==true)throw Error('Explicit Generate is required');
 const prepared=await prepareMediaRequest(admin,body,actor),request=prepared.request;
 if(request.provider==='higgsfield'&&Deno.env.get('DESIGN_VIDEO_PAID_EXECUTION_ENABLED')!=='true')throw Error('Media execution is not enabled');
 const credential=deps.credential?await deps.credential(request):await connection(admin,request),reader=deps.fetch||fetch;
 const media=request.provider==='higgsfield'?(deps.adapter||await adapter(credential,reader)):null;
 const source=requiresImage(request.model_id)?(deps.inputUrl?await deps.inputUrl(request):await originalInputUrl(admin,request,actor)):null;
 const job=await rpc(admin,body.conversation_id?'claim_design_media_in_conversation':'claim_design_media_generation',{p_org:admin.organizationId,p_actor:actor,...(body.conversation_id?{p_conversation:uuid(body.conversation_id)}:{}),p_operation:operation,p_quote:quote,p_request:request,p_prompt:prepared.prompt,p_acceptance:body.acceptance});
 if(job.must_not_submit===true)return publicJob(job);
 let receipt:Json,inline:any[]|null=null;
 try{
  const settings=request.settings;
  if(request.provider==='openai'){
   const response=await reader('https://api.openai.com/v1/images/generations',{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify({model:request.model_id,prompt:prepared.prompt,n:request.output_count,size:settings.size,quality:settings.quality,background:settings.background,output_format:'png',moderation:'auto',stream:false})});
   if(!response.ok)throw Error('Provider response uncertain');const result=await readBoundedImageResponse(response,request.output_count);if(!Array.isArray(result.data)||result.data.length!==request.output_count)throw Error('Incomplete original output set');
   inline=[];for(const item of result.data){if(typeof item.b64_json!=='string'||item.b64_json.length>14000000)throw Error('Unsupported original output');inline.push(await imageOutput(Uint8Array.from(atob(item.b64_json),c=>c.charCodeAt(0)),'image/png'))}
   receipt={kind:'openai-inline',outputCount:inline.length,...(response.headers.get('x-request-id')?{requestId:response.headers.get('x-request-id')}:{}),state:'provider_completed'};
  }else if(LINEUP_CONTRACTS[request.model_id])receipt=await media.submitLineup(request.model_id,prepared.prompt,settings,request.output_count,source||undefined);
  else if(request.model_id===SOUL_GUIDED_MODEL)receipt=await media.submitGuidedImage({prompt:prepared.prompt,image_url:source,batch_size:request.output_count,resolution:settings.resolution,aspect_ratio:settings.aspect_ratio,enhance_prompt:true});
  else if(request.model_id===SOUL_MODEL)receipt=await media.submitImage({prompt:prepared.prompt,batch_size:request.output_count,resolution:settings.resolution,aspect_ratio:settings.aspect_ratio,enhance_prompt:settings.enhance_prompt});
  else if(request.model_id===SEEDANCE_INPUT_MODEL)receipt=await media.submitImageToVideo({prompt:prepared.prompt,image_url:source,duration:settings.duration_seconds,resolution:settings.resolution,output_format:settings.output_format,generate_audio:settings.generate_audio});
  else if(request.model_id===SEEDANCE_TEXT_MODEL)receipt=await media.submit({prompt:prepared.prompt,duration:settings.duration_seconds,resolution:settings.resolution,aspect_ratio:settings.aspect_ratio,output_format:settings.output_format,generate_audio:settings.generate_audio});
  else throw Error('No verified transport for this exact model');
 }catch{await record(admin,job,actor,'outcome_unknown',null);return publicJob({...job,status:'outcome_unknown'})}
 const saved=await record(admin,job,actor,receipt.state==='pending'?'provider_pending':receipt.state,receipt);
 if(inline)return publicJob(await storeOriginals(admin,saved,actor,inline));return publicJob(saved);
}
async function storeOriginals(admin:any,job:Json,actor:string,outputs:any[],alreadyStored=false){
 if(outputs.length!==job.request.output_count)throw Error('Exact complete original set required');const manifest=[];
 for(let i=0;i<outputs.length;i++){
  const output=outputs[i],video=output.contentType.startsWith('video/'),bucket=video?'design-generated-video':'design-generated-media',extension=output.extension||(output.contentType==='video/mp4'?'mp4':'mov');
  const path=admin.organizationId+'/private/'+actor+'/media/'+job.id+'/'+i+'.'+extension,store=admin.storage.from(bucket);
  const {error}=alreadyStored?{error:null}:await store.upload(path,output.bytes,{contentType:output.contentType,upsert:false});
  if(error){const {data:existing,error:readError}=await store.download(path);if(readError||!existing||existing.size!==output.byteLength||existing.type.split(';')[0]!==output.contentType)throw Error('Original storage needs recovery');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await existing.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==output.checksum)throw Error('Original storage conflict')}
  manifest.push({id:job.id+':'+i,bucket,path,extension,mime_type:output.contentType,checksum:output.checksum,byte_length:output.byteLength});
 }
 return withChat(job,await rpc(admin,'complete_design_media_storage',{p_org:admin.organizationId,p_actor:actor,p_job:job.id,p_claim:job.claim_id,p_manifest:manifest}));
}
export async function pollMediaGeneration(admin:any,body:Json,actor:string,reader:typeof fetch=fetch){
 const job=await loadJob(admin,body,actor);if(!['provider_pending','outcome_unknown'].includes(job.status)||job.request.provider!=='higgsfield'||!job.provider_receipt?.requestId||!job.provider_receipt?.statusUrl)return publicJob(job);
 const media=await adapter(await connection(admin,job.request),reader),receipt=await media.status(job.provider_receipt.requestId,job.provider_receipt.statusUrl,mediaKind(job.request.model_id)==='image'?'image':'video',mediaKind(job.request.model_id)==='image'?job.request.output_count:undefined);
 return publicJob(await record(admin,job,actor,receipt.state==='pending'?'provider_pending':receipt.state,receipt));
}
export async function ingestMediaGeneration(admin:any,body:Json,actor:string,reader:typeof fetch=fetch){
 const job=await loadJob(admin,body,actor);if(job.status==='ready')return publicJob(job);if(job.status!=='provider_completed')throw Error('Original output recovery is unavailable');
 if(job.request.provider==='openai'){
  const outputs=[];if(job.provider_receipt?.kind!=='openai-inline'||job.provider_receipt.outputCount!==job.request.output_count)throw Error('Original output receipt is unavailable');
  for(let i=0;i<job.request.output_count;i++){
   const path=admin.organizationId+'/private/'+actor+'/media/'+job.id+'/'+i+'.png';
   const {data,error}=await admin.storage.from('design-generated-media').download(path);
   if(error||!data||data.size>10*1024*1024||data.type.split(';')[0]!=='image/png')throw Error('Original image is not stored; generation will not be repeated');
   outputs.push(await imageOutput(new Uint8Array(await data.arrayBuffer()),'image/png'));
  }
  return publicJob(await storeOriginals(admin,job,actor,outputs,true));
 }
 if(job.request.provider!=='higgsfield')throw Error('Unsupported original provider');
 const hosts=(Deno.env.get('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),outputs=[];
 if(mediaKind(job.request.model_id)==='image'){for(const url of job.provider_receipt.outputUrls||[])outputs.push(await fetchDesignImageOutput(url,hosts,reader))}
 else outputs.push(await fetchDesignVideoOutput(job.provider_receipt.outputUrl,hosts,LINEUP_CONTRACTS[job.request.model_id]?'original':job.request.settings.output_format,reader));
 return publicJob(await storeOriginals(admin,job,actor,outputs));
}
export function originalMediaDescriptor(job:Json,original:Json,index:number,org:string,actor:string){
 const types:Record<string,string[]>={'image/png':['png'],'image/jpeg':['jpg','jpeg'],'video/mp4':['mp4'],'video/quicktime':['mov']};
 const extensions=types[original.mime_type];
 if(!extensions?.includes(original.extension)||original.id!==job.id+':'+index||!Number.isSafeInteger(original.byte_length)||original.byte_length<1||!/^[a-f0-9]{64}$/.test(original.checksum||''))throw Error('Original output metadata is invalid');
 const filename=index+'.'+original.extension,bucket=original.mime_type.startsWith('image/')?'design-generated-media':'design-generated-video';
 if(original.bucket!==bucket||original.path!==org+'/private/'+actor+'/media/'+job.id+'/'+filename)throw Error('Original storage scope mismatch');
 return {filename,bucket,path:original.path};
}
export async function signMediaGeneration(admin:any,body:Json,actor:string){
 const job=await loadJob(admin,body,actor);if(job.status!=='ready'||!Array.isArray(job.output_manifest)||job.output_manifest.length!==job.request.output_count)throw Error('Ready complete original media required');
 const outputs=[],expires_at=new Date(Date.now()+60000).toISOString();
 for(const [index,original] of job.output_manifest.entries()){
  const descriptor=originalMediaDescriptor(job,original,index,admin.organizationId,actor);
  const {data,error}=await admin.storage.from(descriptor.bucket).createSignedUrl(descriptor.path,60,...(body.download===true?[{download:descriptor.filename}]:[]));
  if(error||!data?.signedUrl)throw Error('Original file unavailable');
  outputs.push({...original,filename:descriptor.filename,expires_at,...(body.download===true?{download_url:data.signedUrl}:{signed_url:data.signedUrl})});
 }
 return {...publicJob(job),outputs};
}

export async function listMediaConversationResults(admin:any,body:Json,actor:string){
 const conversation=uuid(body.conversation_id),items=await rpc(admin,'list_design_media_conversation_results',{p_org:admin.organizationId,p_actor:actor,p_conversation:conversation,p_before:body.before_created_at||null,p_before_id:body.before_id?uuid(body.before_id):null});
 if(!Array.isArray(items)||items.length>25||items.some(job=>job.conversation_id!==conversation||job.request?.organization_id!==admin.organizationId))throw Error('Media conversation scope could not be confirmed');
 return {items:items.map(publicJob),next:items.length===25?{created_at:items[24].created_at,id:items[24].id}:null};
}

export async function readBoundedImageResponse(response:Response,count:number){
 if(!Number.isSafeInteger(count)||count<1||count>10||!response.body)throw Error('Invalid image response bound');
 const limit=count*14000000+65536,declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw Error('Image response exceeds bound');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Image response exceeds bound');chunks.push(value)}}catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

export async function listMediaGenerations(admin:any,body:Json,actor:string){
 const items=await rpc(admin,'list_design_media_generations',{p_org:admin.organizationId,p_actor:actor,p_context:body.context,p_before:body.before_created_at||null,p_before_id:body.before_id?uuid(body.before_id):null});
 if(!Array.isArray(items)||items.length>25||items.some(job=>JSON.stringify(job.request?.context)!==JSON.stringify(body.context)&&JSON.stringify(Object.entries(job.request?.context||{}).sort())!==JSON.stringify(Object.entries(body.context||{}).sort())))throw Error('Media history scope could not be confirmed');
 return {items:items.map(publicJob),next:items.length===25?{created_at:items[24].created_at,id:items[24].id}:null};
}
