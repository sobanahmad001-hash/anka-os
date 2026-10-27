import {resolveServerOrganizationContext,type ServerOrganizationContext} from '../_shared/serverOrganizationContext.ts'
import {verifyWebsiteNativeManifest} from '../_shared/websiteNativeDraft.js'
import {buildWebsiteBlockSource,WEBSITE_BLOCK_COMPILER} from '../_shared/websiteBlockBuild.js'
import {createStoredZip} from '../wordpress-export/theme.ts'
type Json=Record<string,unknown>
const bucket='wordpress-theme-exports',cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(data:Json,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}})
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const sha=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(x=>x.toString(16).padStart(2,'0')).join('')
const failure=(message:string,status:number)=>Object.assign(Error(message),{status})
function exact(body:Json,keys:string[]){if(Object.keys(body).length!==keys.length||keys.some(k=>!Object.hasOwn(body,k)))throw failure('Exact native build request fields required',400)}
async function rpc(client:any,name:string,args:Json){const{data,error}=await client.rpc(name,args);if(error)throw Object.assign(Error(error.message),{code:error.code,status:['42501'].includes(error.code)?403:['40001','23505','55000'].includes(error.code)?409:400,knownRollback:['22023','42501','40001','23505','55000','54000'].includes(error.code)});return data}
export async function handler(req:Request,dependencies:{resolveContext?:typeof resolveServerOrganizationContext}={}){
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
 if(req.method!=='POST')return reply({error:'Method not allowed'},405)
 let ctx:ServerOrganizationContext|undefined,job:Json|undefined,claimed=false
 try{
  const reader=req.body?.getReader();if(!reader)throw failure('Build request required',400)
  const decoder=new TextDecoder();let raw='',count=0
  for(;;){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>4096){await reader.cancel();throw failure('Build request exceeds bound',413)}raw+=decoder.decode(part.value,{stream:true})}raw+=decoder.decode()
  const body:Json=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw failure('Build object required',400)
  const common=['action','organization_id','project_id','engagement_id']
  if(body.action==='build')exact(body,[...common,'design_id','request_id','review_sha256'])
  else if(body.action==='download')exact(body,[...common,'job_id','kind'])
  else throw failure('Unsupported native build action',400)
  for(const k of ['organization_id','project_id','engagement_id',body.action==='build'?'design_id':'job_id'])if(!uuid(body[k]))throw failure('Exact native build context required',400)
  ctx=await(dependencies.resolveContext||resolveServerOrganizationContext)(req,{root:{kind:'engagement',id:body.engagement_id as string},requestedOrganizationId:body.organization_id as string})
  if(ctx.organizationId!==body.organization_id||ctx.projectId!==body.project_id||ctx.engagementId!==body.engagement_id)throw failure('Native build context changed',403)
  const scope={p_organization_id:ctx.organizationId,p_project_id:ctx.projectId,p_engagement_id:ctx.engagementId}
  if(body.action==='download'){
   if(!['package','source'].includes(body.kind as string))throw failure('Exact artifact kind required',400)
   const record=await rpc(ctx.userClient,'get_website_block_artifact',{...scope,p_job_id:body.job_id})
   const base=ctx.organizationId+'/'+record.website_page_design_id+'/'+record.id+'/',verification=record.seo_verification
   if(record.id!==body.job_id||record.provider_job_id!==WEBSITE_BLOCK_COMPILER||record.storage_path!==base+'native-block.zip'||verification?.source_path!==base+'source.zip')throw failure('Native artifact scope differs',409)
   const source=body.kind==='source',path=base+(source?'source.zip':'native-block.zip'),expected=source?verification.source_sha256:record.artifact_sha256,bytes=source?verification.source_bytes:verification.package_bytes,mime='application/zip'
   if(!/^[a-f0-9]{64}$/.test(expected)||!Number.isInteger(bytes)||bytes<1||bytes>(source?524288:1048576))throw failure('Native artifact verification metadata differs',409)
   const{data:blob,error}=await ctx.admin.storage.from(bucket).download(path);if(error||!blob||blob.size!==bytes||blob.type.split(';')[0]!==mime)throw failure('Original native artifact size or MIME differs',409)
   if(await sha(new Uint8Array(await blob.arrayBuffer()))!==expected)throw failure('Original native artifact checksum differs',409)
   // Recheck current membership/scope immediately before issuing a short-lived URL.
   await rpc(ctx.userClient,'get_website_block_artifact',{...scope,p_job_id:body.job_id})
   const{data:signed,error:signError}=await ctx.admin.storage.from(bucket).createSignedUrl(path,300,{download:source?'anka-native-source.zip':'anka-native-block.zip'})
   if(signError||!signed?.signedUrl)throw failure('Native artifact signing unavailable',503)
   return reply({data:{...record,kind:body.kind,download_url:signed.signedUrl,download_expires_in:300,checksum_verified:true,delivery_approved:false,staging:false,published:false}})
  }
  if(!uuid(body.request_id)||typeof body.review_sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.review_sha256))throw failure('Exact reviewed build request required',400)
  if(ctx.membership.member_kind!=='team'||ctx.membership.status!=='active'||!(['system_owner','operations_admin','executive'].includes(ctx.membership.role)||ctx.membership.department_id==='development'))throw failure('Current Development build authority required',403)
  const claim=await rpc(ctx.admin,'start_website_block_build',{...scope,p_actor_id:ctx.user.id,p_design_id:body.design_id,p_request_id:body.request_id,p_review_sha256:body.review_sha256})
  job=claim.job;claimed=claim.created===true
  if(!claimed)return reply({data:{...job,...scopeToRow(scope),request_id:body.request_id,replayed:true,delivery_approved:false,staging:false,published:false}})
  const reviewed=claim.source
  if(reviewed.design_id!==body.design_id||reviewed.organization_id!==ctx.organizationId||reviewed.project_id!==ctx.projectId||reviewed.engagement_id!==ctx.engagementId)throw failure('Resolved native design belongs to another context',403)
  if(reviewed.review_sha256!==body.review_sha256||job!.organization_id!==ctx.organizationId||job!.website_page_design_id!==body.design_id||job!.requested_by!==ctx.user.id)throw failure('Claimed build source changed',409)
  // Only the atomically pinned server source enters the fixed compiler. Replay never recompiles.
  await verifyWebsiteNativeManifest(reviewed.context,reviewed.manifest)
  const source=await buildWebsiteBlockSource(reviewed.manifest)
  const encoded=new TextEncoder(),archive=createStoredZip(Object.entries(source.files).sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>({name:source.directory+'/'+name,bytes:encoded.encode(text)})))
  if(archive.byteLength>1048576)throw failure('Native ZIP exceeds output bound',413)
  const sourceJson=encoded.encode(JSON.stringify({compiler:WEBSITE_BLOCK_COMPILER,manifest:reviewed.manifest,review_sha256:body.review_sha256,files_checksum:source.files_checksum,file_hashes:source.file_hashes,delivery_approved:false,staging:false,published:false}))
  const original=createStoredZip([{name:'source.json',bytes:sourceJson}])
  if(original.byteLength>524288)throw failure('Native source exceeds output bound',413)
  const base=ctx.organizationId+'/'+body.design_id+'/'+job!.id+'/'
  for(const[path,bytes,type]of [[base+'source.zip',original,'application/zip'],[base+'native-block.zip',archive,'application/zip']] as const){
   const{error}=await ctx.admin.storage.from(bucket).upload(path,new Blob([new Uint8Array(bytes).buffer],{type}),{contentType:type,upsert:false,cacheControl:'3600'});if(error)throw failure('Private native artifact upload could not complete; original request retained',503)
  }
  const result=await rpc(ctx.admin,'finish_website_block_build',{...scope,p_actor_id:ctx.user.id,p_job_id:job!.id,p_package_sha256:await sha(archive),p_source_sha256:await sha(original),p_package_bytes:archive.byteLength,p_source_bytes:original.byteLength,p_file_hashes:source.file_hashes})
  return reply({data:{...result,delivery_approved:false,staging:false,published:false}})
 }catch(error){
  const e=error as Error&{status?:number;code?:string;knownRollback?:boolean}
  // Preserve failed source objects/history. Never delete artifacts or retry the compiler automatically.
  if(claimed&&ctx&&job)try{await ctx.admin.rpc('fail_website_block_build',{p_organization_id:ctx.organizationId,p_actor_id:ctx.user.id,p_job_id:job.id})}catch{/* Original processing request remains recoverable. */}
  return reply({error:e.message||'Native build failed',code:e.code,rollback_verified:!claimed&&e.knownRollback===true,request_retained:claimed},e.status||400)
 }
}
function scopeToRow(s:Json){return {organization_id:s.p_organization_id,project_id:s.p_project_id,engagement_id:s.p_engagement_id}}
if(import.meta.main)Deno.serve(req=>handler(req))
