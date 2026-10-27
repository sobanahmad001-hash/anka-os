import {resolveServerOrganizationContext,type ServerOrganizationContext} from '../_shared/serverOrganizationContext.ts'
import {compileWebsiteNativeDesign,validateWebsiteNativeSite} from '../_shared/websiteNativeDesign.js'
import {verifyWebsiteNativeManifest} from '../_shared/websiteNativeDraft.js'
type Json=Record<string,unknown>
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(data:Json,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}})
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
function exact(value:Json,keys:string[]){if(Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error('Exact Website draft request fields required')}
const failure=(message:string,status:number)=>Object.assign(new Error(message),{status})
export async function handler(req:Request,dependencies:{resolveContext?:typeof resolveServerOrganizationContext}={}){
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
 if(req.method!=='POST')return reply({error:'Method not allowed'},405)
 let writeStarted=false,rollback=false,code:string|undefined
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Website request body required');let raw='',size=0;const decoder=new TextDecoder();while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>262144){await reader.cancel();throw failure('Website draft request exceeds bound',413)}raw+=decoder.decode(chunk.value,{stream:true})}raw+=decoder.decode()
  const body:Json=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object')throw Error('JSON object required')
  const base=['action','organization_id','project_id','engagement_id','request_id']
  if(body.action==='save_site')exact(body,[...base,'expected_version_id','identity_version_id','site'])
  else if(body.action==='save_design')exact(body,[...base,'direction_version_id','architecture_approval_id','review_sha256','manifest'])
  else throw Error('Unsupported Website draft action')
  for(const key of ['organization_id','project_id','engagement_id','request_id'])if(!uuid(body[key]))throw Error('Exact Website scope and request UUIDs required')
  const ctx:ServerOrganizationContext=await(dependencies.resolveContext||resolveServerOrganizationContext)(req,{root:{kind:'engagement',id:body.engagement_id as string},requestedOrganizationId:body.organization_id as string})
  if(ctx.organizationId!==body.organization_id||ctx.projectId!==body.project_id||ctx.engagementId!==body.engagement_id)throw failure('Website project context changed',403)
  if(ctx.membership.member_kind!=='team'||ctx.membership.status!=='active'||!(['system_owner','operations_admin','executive'].includes(ctx.membership.role)||ctx.membership.department_id==='design'))throw failure('Current Design draft authority required',403)
  const args={p_organization_id:ctx.organizationId,p_project_id:ctx.projectId,p_engagement_id:ctx.engagementId,p_actor_id:ctx.user.id,p_request_id:body.request_id}
  let result
  if(body.action==='save_site'){
   if(body.expected_version_id!==null&&!uuid(body.expected_version_id)||body.identity_version_id!==null&&!uuid(body.identity_version_id))throw Error('Exact site and identity version IDs required')
   const site=validateWebsiteNativeSite(body.site)
   writeStarted=true;result=await ctx.admin.rpc('save_website_native_site',{...args,p_expected_version_id:body.expected_version_id,p_identity_version_id:body.identity_version_id,p_site:site})
  }else{
   if(body.direction_version_id!==null&&!uuid(body.direction_version_id)||!uuid(body.architecture_approval_id)||typeof body.review_sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.review_sha256))throw Error('Exact reviewed Website sources required')
   const manifest=body.manifest as {scope:Json;sources:Record<string,{version_id:string}>}
   if(!manifest||manifest.scope?.organization_id!==ctx.organizationId||manifest.scope?.project_id!==ctx.projectId||manifest.scope?.engagement_id!==ctx.engagementId)throw failure('Manifest belongs to another context',403)
   const source=await ctx.userClient.rpc('get_website_native_source',{p_organization_id:ctx.organizationId,p_project_id:ctx.projectId,p_engagement_id:ctx.engagementId,p_page_id:manifest.scope.page_id,p_architecture_version_id:manifest.sources?.architecture?.version_id,p_content_version_id:manifest.sources?.content?.version_id,p_brief_version_id:manifest.sources?.brief?.version_id,p_site_version_id:manifest.sources?.site_system?.version_id})
   if(source.error)throw failure(source.error.message,409)
   if(source.data?.review_sha256!==body.review_sha256||source.data?.architecture?.approval_id!==body.architecture_approval_id)throw failure('Sources changed; refresh and review',409)
   const verified=await verifyWebsiteNativeManifest(source.data,manifest),compiled=await compileWebsiteNativeDesign(verified)
   writeStarted=true;result=await ctx.admin.rpc('save_website_native_design',{...args,p_direction_version_id:body.direction_version_id,p_architecture_approval_id:body.architecture_approval_id,p_review_sha256:body.review_sha256,p_manifest:verified,p_html:compiled.preview,p_css:compiled.files['style.css']})
  }
  if(result.error){code=result.error.code;rollback=['22023','42501','40001','55000','23505','23514'].includes(code||'');throw failure(result.error.message,['40001','23505'].includes(code||'')?409:403)}
  if(result.data?.organization_id!==ctx.organizationId||result.data?.project_id!==ctx.projectId||result.data?.engagement_id!==ctx.engagementId||result.data?.created_by!==ctx.user.id||result.data?.request_id!==body.request_id)throw failure('Saved Website receipt could not be verified; recover the original request',409)
  return reply({data:result.data})
 }catch(error){const status=error&&typeof error==='object'&&'status'in error?Number(error.status):400;return reply({error:error instanceof Error?error.message:'Website draft unavailable',rollback_verified:!writeStarted||rollback,code},Number.isFinite(status)?status:400)}
}
if(import.meta.main)Deno.serve(req=>handler(req))
