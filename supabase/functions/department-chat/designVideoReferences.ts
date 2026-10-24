import {inspectVideoReference} from '../_shared/designVideoReferenceInspection.js'
type Json = Record<string, any>
const BUCKET = 'design-video-references'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail = (message: string, status=400) => Object.assign(new Error(message),{status})
const id = (value: unknown) => { if(typeof value!=='string'||!uuid.test(value))throw fail('Exact attachment identity required'); return value }
const path = (org:string,conversation:string,actor:string,attachment:string) => `${org}/${actor}/${conversation}/${attachment}/original`
async function rpc(admin:any,name:string,args:Json) {
 const {data,error}=await admin.rpc(name,args)
 if(error)throw fail(error.message,error.code==='42501'?403:error.code==='23505'?409:422)
 return data
}
function visible(a:Json) {
 const {extracted_text,...metadata}=a
 return {...metadata,text_characters:extracted_text?.length||0,reference_only:a.extraction_kind==='reference_only'}
}
async function current(admin:any,args:Json,attachmentId?:string) {
 const rows=await rpc(admin,'read_design_video_references',args)
 if(!Array.isArray(rows))throw fail('Attachment read unavailable',503)
 if(!attachmentId)return rows
 const a=rows.find(row=>row.id===attachmentId&&row.status!=='revoked')
 if(!a)throw fail('Attachment unavailable',404)
 return a
}
export const DESIGN_VIDEO_REFERENCE_ACTIONS=new Set(['design_video_reference_reserve','design_video_reference_finalize','design_video_reference_list','design_video_reference_revoke','design_video_reference_download'])

export async function designVideoReferenceAction(action:string,admin:any,body:Json,actor:string,org:string) {
 const conversation=id(body.conversation_id),args={p_org:org,p_conversation:conversation,p_actor:actor}
 if(action==='design_video_reference_list')return (await current(admin,args)).map(visible)
 const attachmentId=id(body.attachment_id)
 if(action==='design_video_reference_reserve') {
  if(typeof body.original_name!=='string'||body.original_name.length<1||body.original_name.length>200||/[\x00-\x1f\x7f]/.test(body.original_name))throw fail('Valid filename required')
  if(!Number.isSafeInteger(body.byte_size)||body.byte_size<1||body.byte_size>20971520)throw fail('Choose a file up to 20 MiB')
  if(typeof body.sha256_hex!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256_hex))throw fail('Source checksum required')
  if(body.ai_use_allowed!==false)throw fail('Video references cannot be sent to AI')
  if(!['video/mp4','video/quicktime'].includes(body.claimed_mime))throw fail('MP4 or MOV required')
  const a=await rpc(admin,'reserve_design_video_reference',{...args,p_id:attachmentId,p_name:body.original_name,
   p_mime:body.claimed_mime,p_bytes:body.byte_size,p_sha:body.sha256_hex,p_classification:body.classification,p_consent:body.ai_use_allowed})
  if(a.status==='ready')return {attachment:visible(a),upload:null}
  const objectPath=path(org,conversation,actor,attachmentId)
  const {data,error}=await admin.storage.from(BUCKET).createSignedUploadUrl(objectPath,{upsert:false})
  if(error)throw fail('Could not reserve immutable upload. Retry the same upload.',503)
  // A revocation racing token issuance prevents returning the token. An issued
  // token can only write this immutable object; it can never finalize/revive it.
  await current(admin,args,attachmentId)
  return {attachment:visible(a),upload:{bucket:BUCKET,path:objectPath,token:data.token}}
 }
 if(action==='design_video_reference_revoke') {
  await rpc(admin,'revoke_design_video_reference',{...args,p_id:attachmentId});return {revoked:true}
 }
 const a=await current(admin,args,attachmentId)
 if(action==='design_video_reference_finalize'&&a.status==='ready')return visible(a)
 if(action==='design_video_reference_download'&&a.status!=='ready')throw fail('Source is not finalized',409)
 const {data:file,error}=await admin.storage.from(BUCKET).download(path(org,conversation,actor,attachmentId))
 if(error||!file)throw fail('Original upload is not visible yet. Retry the same upload.',409)
 if(file.type.split(';')[0].toLowerCase()!==a.claimed_mime)throw fail('Uploaded Content-Type differs from the reservation',422)
 if(file.size!==a.declared_bytes||file.size>20971520)throw fail('Uploaded file length differs from the reserved original',422)
 const bytes=new Uint8Array(await file.arrayBuffer())
 const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
 if(checksum!==a.expected_sha256)throw fail('Uploaded original checksum differs from the reservation',422)
 if(action==='design_video_reference_download') {
  await current(admin,args,attachmentId)
  return new Response(bytes,{headers:{'Content-Type':a.verified_mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.original_name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
 }
 if(action!=='design_video_reference_finalize')throw fail('Unsupported attachment action')
 const inspection=inspectVideoReference(bytes,a.claimed_mime)
 const result=await rpc(admin,'finalize_design_video_reference',{...args,p_id:attachmentId,p_sha:checksum,p_bytes:bytes.length,
  p_mime:inspection.verifiedMime,p_kind:inspection.extractionKind,p_text:inspection.extractedText,p_notice:inspection.extractionNotice})
 return visible(result)
}

