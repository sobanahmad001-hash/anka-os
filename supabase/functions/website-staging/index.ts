import {resolveServerOrganizationContext,type ServerOrganizationContext} from '../_shared/serverOrganizationContext.ts'
import {STAGING_PROTOCOL,uuid,sha,createStagingTransport,stagingBundle,stagingCommand,verifyStagingReceipt} from '../_shared/websiteStaging.js'
import {websiteNativeSnapshotChecksum} from '../_shared/websiteNativeDesign.js'
type Json=Record<string,any>
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(data:Json,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}})
async function rpc(client:any,name:string,args:Json){const{data,error}=await client.rpc(name,args);if(error)throw Object.assign(Error(error.message),{status:error.code==='42501'?403:['40001','23505','55000'].includes(error.code)?409:400,knownRollback:['22023','42501','40001','23505','55000'].includes(error.code)});return data}
function exact(body:Json,keys:string[]){if(Object.keys(body).length!==keys.length||keys.some(k=>!Object.hasOwn(body,k)))throw Error('Exact staging request fields required')}
const realEnv=(name:string)=>Deno.env.get(name)
const resolveHost=async(host:string)=>{const r=await Promise.allSettled([Deno.resolveDns(host,'A'),Deno.resolveDns(host,'AAAA')]);return r.flatMap(x=>x.status==='fulfilled'?x.value:[])}
export async function handler(req:Request,dependencies:{resolveContext?:typeof resolveServerOrganizationContext;env?:(name:string)=>string|undefined;fetcher?:typeof fetch;resolver?:(host:string)=>Promise<string[]>}={}){
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({error:'Method not allowed'},405)
 let retained=false,posted=false,localFailure:any=null,action='',ctx:ServerOrganizationContext|undefined
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Staging request required');let raw='',size=0;const decoder=new TextDecoder()
  for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>4096){await reader.cancel();return reply({error:'Staging request exceeds bound'},413)}raw+=decoder.decode(p.value,{stream:true})}raw+=decoder.decode()
  const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Staging object required')
  const common=['action','organization_id','project_id','engagement_id'],fields:Record<string,string[]>={inspect:['connection_id'],bind:['connection_id','site_id','base_url','connection_revision','inspection_sha256','request_id'],'dry-run':['target_id','job_id'],deploy:['target_id','job_id','remote_head','review_sha256','previous_run_id','request_id'],recover:['request_id']}
  action=b.action
  if(!fields[b.action])throw Error('Unsupported staging action; client publication is unavailable');exact(b,[...common,...fields[b.action]])
  for(const k of ['organization_id','project_id','engagement_id',...fields[b.action].filter(k=>k.endsWith('_id'))])if(!(k==='previous_run_id'&&b[k]===null)&&!uuid(b[k]))throw Error('Exact staging identities required')
  if(b.action==='deploy'&&b.remote_head!==null&&!uuid(b.remote_head))throw Error('Exact remote page head required')
  ctx=await(dependencies.resolveContext||resolveServerOrganizationContext)(req,{root:{kind:'engagement',id:b.engagement_id},requestedOrganizationId:b.organization_id})
  if(ctx.organizationId!==b.organization_id||ctx.projectId!==b.project_id||ctx.engagementId!==b.engagement_id)throw Error('Staging context changed')
  const scope={p_organization_id:ctx.organizationId,p_project_id:ctx.projectId,p_engagement_id:ctx.engagementId,p_actor_id:ctx.user.id},admin=ctx.admin
  const dispatch=(target:any=null,job:any=null,connection:any=null,head:any=null)=>rpc(admin,'get_website_staging_dispatch',{...scope,p_connection_id:connection,p_target_id:target,p_job_id:job,p_remote_head:head})
  const transport=(c:Json)=>createStagingTransport(c,{env:dependencies.env||realEnv,fetcher:dependencies.fetcher||fetch,resolver:dependencies.resolver||resolveHost})
  if(['inspect','bind'].includes(b.action)){
   if(ctx.membership.member_kind!=='team'||ctx.membership.status!=='active'||!['system_owner','operations_admin'].includes(ctx.membership.role))return reply({error:'Organization owner or operations admin must bind staging'},403)
   const current=await dispatch(null,null,b.connection_id),t=transport(current.connection),identity=await t.identity()
   const inspected={connection_id:b.connection_id,connection_revision:current.connection.revision,site_id:identity.site_id,base_url:t.origin,environment:'staging',protocol:STAGING_PROTOCOL,published:false}
   const digest=await websiteNativeSnapshotChecksum(inspected)
   if(b.action==='inspect')return reply({data:{...inspected,inspection_sha256:digest}})
   if(!uuid(b.site_id)||b.site_id!==identity.site_id||b.base_url!==t.origin||b.connection_revision!==current.connection.revision||b.inspection_sha256!==digest)throw Error('Staging identity changed; inspect the current target')
   const row=await rpc(admin,'bind_website_staging_target',{...scope,p_connection_id:b.connection_id,p_site_id:b.site_id,p_base_url:b.base_url,p_connection_revision:b.connection_revision,p_request_id:b.request_id})
   return reply({data:{...row,published:false}})
  }
  if(b.action==='deploy'){
   const original=await rpc(admin,'get_website_staging_recovery',{...scope,p_request_id:b.request_id})
   if(original){
    retained=true;const run=original.run
    if(run.created_by!==ctx.user.id||run.target_id!==b.target_id||run.job_id!==b.job_id||run.remote_head!==b.remote_head||run.review_sha256!==b.review_sha256||run.previous_run_id!==b.previous_run_id)throw Error('Original staging request owns different reviewed inputs')
    return reply({data:{...run,status:original.result?.outcome||'processing',evidence:original.result?.evidence,replayed:true,published:false}})
   }
  }
  if(b.action==='recover'){
   const current=await rpc(admin,'get_website_staging_recovery',{...scope,p_request_id:b.request_id})
   if(!current)return reply({data:{organization_id:ctx.organizationId,project_id:ctx.projectId,engagement_id:ctx.engagementId,request_id:b.request_id,status:'failed',not_claimed:true,published:false}})
   if(current.result)return reply({data:{...current.run,status:current.result.outcome,evidence:current.result.evidence,published:false}})
   retained=true;const t=transport(current.connection);await t.identity(current.target.site_id)
   const receipt=await t.request('/wp-json/anka-stage/v1/requests/'+b.request_id)
   if(receipt.status==='missing')throw Error('Original remote receipt is missing. Its outcome remains uncertain; recovery never resends or infers failure from elapsed time.')
   return await settle(current,current.run,t,receipt)
  }
  let current=await dispatch(b.target_id,b.job_id),t=transport(current.connection);await t.identity(current.target.site_id)
  const m=current.source.manifest,query=new URLSearchParams({organization_id:ctx.organizationId,project_id:ctx.projectId as string,engagement_id:ctx.engagementId as string,page_id:current.page_id,page_key:m.scope.page_key})
  const head=await t.request('/wp-json/anka-stage/v1/head?'+query)
  if(head.protocol!==STAGING_PROTOCOL||head.site_id!==current.target.site_id||head.page_id!==current.page_id||head.published!==false||(head.head!==null&&!uuid(head.head)))throw Error('Exact staging page head differs')
  current=await dispatch(b.target_id,b.job_id,null,head.head)
  const bundle=await stagingBundle(current)
  if(b.action==='dry-run')return reply({data:{organization_id:ctx.organizationId,project_id:ctx.projectId,engagement_id:ctx.engagementId,target_id:b.target_id,job_id:b.job_id,page_id:current.page_id,page_key:m.scope.page_key,page_path:current.source.context.page.path,title:m.content.title,site_id:current.target.site_id,base_url:t.origin,remote_head:head.head,review_sha256:current.review_sha256,package_sha256:current.job.artifact_sha256,files:9,environment:'staging',published:false}})
  if(b.remote_head!==head.head||b.review_sha256!==current.review_sha256)throw Object.assign(Error('Staging target or source changed; repeat the dry run'),{knownRollback:true})
  const claim=await rpc(admin,'start_website_staging_run',{...scope,p_target_id:b.target_id,p_job_id:b.job_id,p_remote_head:b.remote_head,p_review_sha256:b.review_sha256,p_previous_run_id:b.previous_run_id,p_request_id:b.request_id})
  retained=true
  if(!claim.created)return reply({data:{...claim.run,status:'processing',replayed:true,published:false}})
  localFailure={scope,run:claim.run,current}
  // Recheck actual authority, source and connection immediately before the only external write.
  const bucket='wordpress-theme-exports',path=current.job.storage_path,expected=ctx.organizationId+'/'+current.job.website_page_design_id+'/'+current.job.id+'/native-block.zip'
  if(path!==expected)throw Error('Original private package path differs')
  const{data:blob,error}=await admin.storage.from(bucket).download(path)
  if(error||!blob||blob.type.split(';')[0]!=='application/zip'||blob.size!==current.job.seo_verification.package_bytes||blob.size>1048576||await sha(new Uint8Array(await blob.arrayBuffer()))!==current.job.artifact_sha256)throw Error('Original private package verification failed')
  const command=await stagingCommand(current,claim.run,bundle)
  await dispatch(b.target_id,b.job_id,null,head.head)
  if(Date.now()>=Date.parse(claim.run.created_at)+600000)throw Error('Original dispatch window expired; recover before another attempt')
  posted=true
  const receipt=await t.request('/wp-json/anka-stage/v1/deploy',{method:'POST',body:command})
  return await settle(current,claim.run,t,receipt)

  async function settle(current:Json,run:Json,t:any,receipt:Json):Promise<Response>{
   verifyStagingReceipt(receipt,current,run)
   if(['pending'].includes(receipt.status))throw Error('Original staging request is not settled; recovery never resends it')
   const staged=receipt.status==='staged'
   let evidence:Json={wordpress_version:receipt.wordpress_version,php_version:receipt.php_version,compiler:receipt.compiler,protocol:STAGING_PROTOCOL,environment:'staging',published:false,base_url:t.origin,site_id:current.target.site_id,request_id:run.request_id,package_sha256:current.job.artifact_sha256,status:receipt.status,unresolved_paths:receipt.unresolved_paths||[]}
   if(staged){
    const html=await t.request('/?anka_staging_preview='+run.request_id,{html:true})
    if(!html.includes('name="anka-staging-request" content="'+run.request_id+'"')||!html.includes('name="anka-package-sha256" content="'+current.job.artifact_sha256+'"')||!html.includes('name="anka-staging-site" content="'+current.target.site_id+'"'))throw Error('Working staging preview identity could not be verified')
    evidence={...evidence,preview_url:receipt.preview_url,preview_verified:true}
   }
   const result=await rpc(admin,'record_website_staging_result',{...scope,p_run_id:run.id,p_outcome:staged?'staged':'failed',p_evidence:evidence})
   return reply({data:{...run,status:result.outcome,evidence:result.evidence,published:false}})
  }
 }catch(error){const e=error as Error&{status?:number;knownRollback?:boolean};
  // Only this live worker can prove it never attempted the external POST. A killed worker stays uncertain.
  if(retained&&!posted&&localFailure&&ctx){try{
   const {scope,run,current}=localFailure,evidence={protocol:STAGING_PROTOCOL,environment:'staging',published:false,base_url:current.target.base_url,site_id:current.target.site_id,request_id:run.request_id,package_sha256:current.job.artifact_sha256,status:'not_dispatched'}
   const result=await rpc(ctx.admin,'record_website_staging_result',{...scope,p_run_id:run.id,p_outcome:'failed',p_evidence:evidence})
   return reply({data:{...run,status:result.outcome,evidence:result.evidence,published:false}})
  }catch{/* Revocation or receipt uncertainty never permits a replacement write. */}}
  return reply({error:e.message||'Staging could not be verified',request_retained:retained,rollback_verified:!retained&&!(['deploy','recover'].includes(action))&&e.knownRollback===true},e.status||400)}
}
if(import.meta.main)Deno.serve(req=>handler(req))
