import {validateContentArtifact} from './contentArtifacts.ts'
import type {ServerOrganizationContext} from './serverOrganizationContext.ts'
type Json=Record<string,unknown>
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const identities=['project_id','engagement_id','page_id','architecture_version_id','request_id']
const failure=(message:string,status=400)=>Object.assign(Error(message),{status,rollback_verified:true,request_retained:false})
export function pageKeywordIdentity(body:Json):Json{
 const result:Json={}
 for(const key of identities){if(typeof body[key]!=='string'||!UUID.test(body[key] as string))throw failure('Exact page strategy '+key+' required');result[key]=body[key]}
 if(typeof body.page_key!=='string'||body.page_key!==body.page_key.trim()||!body.page_key||body.page_key.length>1208||/[\u0000-\u001f\u007f]/.test(body.page_key))throw failure('Exact stable page key required')
 return {...result,page_key:body.page_key}
}
function scope(context:ServerOrganizationContext,identity:Json){
 if(context.projectId!==identity.project_id||context.engagementId!==identity.engagement_id)throw failure('Original page strategy scope differs',403)
}
async function hydrate(context:ServerOrganizationContext,pointer:any,identity:Json){
 if(pointer===null)return null
 if(!pointer||Object.entries(identity).some(([key,value])=>pointer[key]!==value)||!UUID.test(pointer.artifact_id||'')||!UUID.test(pointer.version_id||'')||!Array.isArray(pointer.warnings)||pointer.warnings.some((w:unknown)=>typeof w!=='string'))throw Error('Original page strategy pointer differs')
 // Current authenticated RLS remains authoritative for the immutable version body.
 const {data:version,error}=await context.userClient.from('artifact_versions').select('*').eq('organization_id',context.organizationId).eq('artifact_id',pointer.artifact_id).eq('id',pointer.version_id).maybeSingle()
 if(error)throw error
 if(!version||version.organization_id!==context.organizationId||version.artifact_id!==pointer.artifact_id||version.id!==pointer.version_id||version.created_by!==context.user.id||version.version_number!==1||version.parent_version_id!==null||version.content?.source_architecture_version_id!==identity.architecture_version_id||!version.content?.keywords?.some((row:any)=>row.target_kind==='page'&&row.target_page_key===identity.page_key))throw Error('Original page strategy version unavailable')
 const {version_id:_,...receipt}=pointer
 return {...receipt,version}
}
export async function savePageKeywordStrategy(context:ServerOrganizationContext,body:Json){
 const identity=pageKeywordIdentity(body);scope(context,identity)
 const allowed=['action','organization_id',...identities,'page_key','artifact_type','artifact_id','engagement_stage_instance_id','title','content','change_summary','ai_use_allowed','data_classification']
 if(Object.keys(body).some(key=>!allowed.includes(key))||body.artifact_type!=='keyword_strategy'||body.artifact_id!==null)throw failure('Page strategy creates only its first canonical keyword version')
 let content:Json
 try{content=validateContentArtifact('keyword_strategy',body.content)}catch(error){throw failure((error as Error).message)}
 if(content.schema_version!==2||content.source_architecture_version_id!==identity.architecture_version_id||!(content.keywords as any[]).some(row=>row.target_kind==='page'&&row.target_page_key===identity.page_key))throw failure('Exact selected architecture and page target required')
 const stage=body.engagement_stage_instance_id??null
 if(stage!==null&&(typeof stage!=='string'||!UUID.test(stage)))throw failure('Exact Content stage required')
 const classification=body.data_classification??'internal'
 if(!['public','internal','confidential','restricted'].includes(classification as string)||typeof body.title!=='string'||!body.title.trim()||body.title.length>240||typeof body.change_summary!=='string'||body.change_summary.length>1000||typeof body.ai_use_allowed!=='boolean')throw failure('Exact bounded draft metadata required')
 const input={title:body.title.trim(),content,change_summary:body.change_summary,ai_use_allowed:body.ai_use_allowed,data_classification:classification,stage_id:stage}
 // No preliminary artifact/version write. A failed RPC statement rolls back ALL rows.
 let response
 try{response=await context.admin.rpc('save_page_keyword_strategy_atomic',{p_organization_id:context.organizationId,p_actor_id:context.user.id,...Object.fromEntries(Object.entries(identity).map(([k,v])=>['p_'+k,v])),p_input:input})}
 catch(error){throw Object.assign(error as Error,{rollback_verified:false,request_retained:true})}
 const {data,error}=response
 // A conflict/busy request might already exist or still be settling elsewhere.
 if(error){const known=['22023','42501','55000','22P02'].includes(error.code);throw Object.assign(Error(error.message),{status:error.code==='42501'?403:409,code:error.code,rollback_verified:known,request_retained:!known})}
 // Read failure after RPC success is UNKNOWN, never a rollback or resend permission.
 try{return await hydrate(context,data,identity)}catch(error){throw Object.assign(error as Error,{rollback_verified:false,request_retained:true})}
}
export async function recoverPageKeywordStrategy(context:ServerOrganizationContext,body:Json){
 const identity=pageKeywordIdentity(body);scope(context,identity)
 const allowed=['action','organization_id',...identities,'page_key']
 if(Object.keys(body).some(key=>!allowed.includes(key)))throw failure('Only original receipt identity may be recovered')
 const {data,error}=await context.userClient.rpc('recover_page_keyword_strategy_receipt',{p_organization_id:context.organizationId,...Object.fromEntries(Object.entries(identity).map(([k,v])=>['p_'+k,v]))})
 if(error)throw error
 return await hydrate(context,data,identity)
}
