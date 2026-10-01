import {normalizeVideoBrief,validateVideoBrief} from '../_shared/designVideoBrief.js'
type Json=Record<string,unknown>
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const identity=(value:unknown,label:string)=>{if(typeof value!=='string' || !UUID.test(value)) throw Object.assign(new Error(`${label} must be an exact UUID`),{status:400});return value}
export function videoBriefContext(body:Json) {
 const entries=['private_conversation_id','direction_version_id'].filter(key=>body[key]!=null)
 if(entries.length!==1)throw Object.assign(new Error('One exact private conversation or saved direction is required'),{status:400})
 return {[entries[0]]:identity(body[entries[0]],'Video context')}
}
function exactKeys(body:Json,extra:string[]) {
 if(Object.keys(body).some(key=>!['action','organization_id','private_conversation_id','direction_version_id',...extra].includes(key)))throw Object.assign(new Error('Unexpected video brief authority or payload fields'),{status:400})
}
function scope(admin:any,body:Json,actorId:string) {
 const context=videoBriefContext(body)
 return {p_organization_id:identity(admin.organizationId,'Organization'),p_actor_id:identity(actorId,'Current actor'),p_private_conversation_id:context.private_conversation_id||null,p_direction_version_id:context.direction_version_id||null}
}
function failure(error:any) {
 const verified=['22023','42501','40001','55000'].includes(error?.code)
 throw Object.assign(new Error(verified ? error.message : 'Canonical video brief outcome could not be confirmed'),{status:error?.code==='42501' ? 403 : error?.code==='40001' ? 409 : verified ? 400 : 503,code:verified ? error.code : undefined,rollback_verified:verified})
}
export async function getVideoBrief(admin:any,body:Json,actorId:string) {
 exactKeys(body,['operation_key'])
 const {data,error}=await admin.rpc('get_design_video_brief',{...scope(admin,body,actorId),p_operation_key:body.operation_key==null ? null : identity(body.operation_key,'Original operation')})
 if(error)failure(error)
 return data
}
export async function confirmVideoBrief(admin:any,body:Json,actorId:string) {
 exactKeys(body,['creative_brief_id','expected_revision','operation_key','video_brief'])
 if(!Number.isInteger(body.expected_revision) || Number(body.expected_revision)<0 || !(body.creative_brief_id===null || typeof body.creative_brief_id==='string' && UUID.test(body.creative_brief_id)))throw Object.assign(new Error('Exact root and expected revision are required'),{status:400,code:'22023',rollback_verified:true})
 const validation=validateVideoBrief(body.video_brief)
 if(!validation.valid)throw Object.assign(new Error([...validation.missing.map((label:string|number)=>`${label} is required`),...validation.errors].join('; ')),{status:400,code:'22023',rollback_verified:true})
 const {data,error}=await admin.rpc('confirm_design_video_brief',{...scope(admin,body,actorId),p_creative_brief_id:body.creative_brief_id,p_expected_revision:body.expected_revision,p_operation_key:identity(body.operation_key,'Original operation'),p_video_brief:normalizeVideoBrief(body.video_brief)})
 if(error)failure(error)
 return data
}

export async function getVideoJobBrief(admin:any,body:Json,actorId:string) {
 if(Object.keys(body).some(key=>!['action','organization_id','job_id'].includes(key)))throw Object.assign(new Error('Exact video job only is required'),{status:400})
 const {data,error}=await admin.rpc('get_design_video_job_brief_binding',{p_organization_id:identity(admin.organizationId,'Organization'),p_job_id:identity(body.job_id,'Original video job'),p_actor_id:identity(actorId,'Current actor')})
 if(error)failure(error)
 return data
}

// Provider-free reservation boundary: only the server-owned actor and explicit exact request are forwarded.
export async function reserveConfirmedVideoJob(admin:any,body:Json,actorId:string) {
 const context=scope(admin,body,actorId)
 const {data,error}=await admin.rpc('create_confirmed_design_video_job',{...context,
  p_creative_brief_version_id:identity(body.creative_brief_version_id,'Confirmed video brief version'),
  p_connector_connection_id:identity(body.connector_connection_id,'Video connection'),p_quote_id:identity(body.quote_id,'Exact quote'),p_operation_key:identity(body.operation_key,'Original video operation'),
  p_prompt:body.prompt,p_mode:body.mode,p_duration_seconds:body.duration_seconds,p_resolution:body.resolution,p_aspect_ratio:body.aspect_ratio,p_output_format:body.output_format,p_generate_audio:body.generate_audio})
 if(error || !data?.job_id || !data?.request_checksum || data.creative_brief_version_id!==body.creative_brief_version_id || typeof data.brief_checksum!=='string' || !/^[0-9a-f]{64}$/.test(data.brief_checksum)) throw Object.assign(new Error('Exact confirmed video job could not be recorded'),{status:503})
 return data
}
