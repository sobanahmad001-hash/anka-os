import { DOMParser } from '@xmldom/xmldom'
import { parseImportCsv, parseImportXlsx, IMPORT_LIMITS } from './projectSpreadsheetSource.js'
import { previewSpreadsheetImport, spreadsheetSourceIdentity } from './projectSpreadsheetPreview.js'
import { prepareProjectWebsiteImportDraft } from './projectSpreadsheetDraft.ts'
import { prepareProjectKeywordImportDraft, prepareProjectCalendarImport } from './projectSpreadsheetAdapters.ts'

type Json = Record<string, any>
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail=(message:string,status=409):never=>{throw Object.assign(new Error(message),{status})}
const canonical=(v:any):any=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
export class StrictImportXmlParser {
  parseFromString(value:string,type:string) {
    return new DOMParser({onError:()=>{throw Error('Malformed workbook XML')}}).parseFromString(value,type as 'application/xml')
  }
}
export function inspectProjectImportBytes(bytes:Uint8Array,mime:string) {
  if(bytes.length<1||bytes.length>IMPORT_LIMITS.bytes)fail('Source exceeds two-MB bound',400)
  if(mime==='text/csv')return parseImportCsv(bytes)
  if(mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')return parseImportXlsx(bytes,StrictImportXmlParser)
  return fail('Unsupported spreadsheet MIME',400)
}
async function one(query:any) {const {data,error}=await query.maybeSingle();if(error)throw error;return data}
async function many(query:any) {const {data,error}=await query;if(error)throw error;return data||[]}
async function rpc(admin:any,name:string,args:Json) {const {data,error}=await admin.rpc(name,args);if(error)throw error;return data}
export async function loadOwnedImportScope(admin:any,organizationId:string,actorId:string,conversationId:string) {
  if(![organizationId,actorId,conversationId].every(x=>UUID.test(x||'')))fail('Exact scope identities required',400)
  const conversation=await one(admin.from('department_chat_conversations').select('id,organization_id,project_id,owner_id,context_kind,state').eq('id',conversationId).eq('organization_id',organizationId).eq('owner_id',actorId).eq('context_kind','project_team').eq('state','active'))
  if(!conversation)fail('Owned active Project Chat unavailable',403)
  const [membership,organization,project]=await Promise.all([
    one(admin.from('organization_memberships').select('id').eq('organization_id',organizationId).eq('user_id',actorId).eq('member_kind','team').eq('status','active')),
    one(admin.from('organizations').select('id').eq('id',organizationId).eq('status','active')),
    one(admin.from('projects').select('id,organization_id,planning_timezone').eq('id',conversation.project_id).eq('organization_id',organizationId).is('archived_at',null)),
  ])
  if(!membership||!organization||!project)fail('Current project access unavailable',403)
  return {actorId,organizationId,projectId:project.id,conversation,project}
}
async function loadSource(admin:any,scope:Json,attachmentId:string) {
  if(!UUID.test(attachmentId||''))fail('Exact source identity required',400)
  const attachment=await one(admin.from('department_chat_attachments').select('*').eq('id',attachmentId).eq('organization_id',scope.organizationId).eq('conversation_id',scope.conversation.id).eq('uploaded_by',scope.actorId).eq('source_kind','project_spreadsheet').eq('status','reference_only'))
  if(!attachment||attachment.project_id!==scope.projectId||attachment.ai_use_allowed!==false||attachment.share_with_recipients!==false
    ||attachment.final_path!==`${scope.organizationId}/${scope.conversation.id}/final/${attachmentId}`)fail('Verified private source unavailable',403)
  const {data,error}=await admin.storage.from('department-chat-attachments').download(attachment.final_path)
  if(error)throw error
  if(data.size!==attachment.byte_size||data.size>IMPORT_LIMITS.bytes)fail('Stored source size changed')
  const bytes=new Uint8Array(await data.arrayBuffer())
  if(await spreadsheetSourceIdentity(bytes)!==attachment.sha256_hex)fail('Stored source checksum changed')
  return {attachment,workbook:inspectProjectImportBytes(bytes,attachment.verified_mime)}
}
async function artifactHead(admin:any,scope:Json,engagementId:string,type:string,id:string|null) {
  const roots=await many(admin.from('artifacts').select('id,organization_id,project_id,engagement_id,artifact_type,title').eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).eq('engagement_id',engagementId).eq('artifact_type',type).limit(101))
  if(roots.length>100)fail('Explicit bounded artifact selection required')
  if(!id){if(roots.length)fail('Select an existing canonical root; do not create a competing record');return {artifact:null,latestVersion:null}}
  const artifact=roots.find((r:Json)=>r.id===id);if(!artifact)fail('Exact same-project artifact required')
  const versions=await many(admin.from('artifact_versions').select('id,artifact_id,organization_id,version_number,content').eq('organization_id',scope.organizationId).eq('artifact_id',id).order('version_number',{ascending:false}).limit(1))
  if(!versions.length)fail('Existing root has no available exact head')
  return {artifact,latestVersion:versions[0]}
}
export async function preparePrivateProjectImport(admin:any,scope:Json,request:Json) {
  if(!UUID.test(request.engagement_id||'')||!['website_pages','keyword_plan','content_calendar'].includes(request.type))fail('Explicit supported target and engagement required',400)
  const engagement=await one(admin.from('engagements').select('id,name,project_id,organization_id').eq('id',request.engagement_id).eq('project_id',scope.projectId).eq('organization_id',scope.organizationId).neq('status','cancelled'))
  if(!engagement)fail('Exact current engagement required',403)
  const {attachment,workbook}=await loadSource(admin,scope,request.attachment_id)
  if(!Number.isInteger(request.sheet_index)||request.sheet_index<0||request.sheet_index>=workbook.sheets.length)fail('Choose a visible sheet',400)
  const sheet=workbook.sheets[request.sheet_index]
  if(sheet.hidden||!sheet.rows.length)fail('Hidden or empty sheet unavailable',400)
  if(!Array.isArray(request.selected_rows)||!request.selected_rows.length||request.selected_rows.length>25||new Set(request.selected_rows).size!==request.selected_rows.length
    ||request.selected_rows.some((r:any)=>!Number.isSafeInteger(r)||r<2||!sheet.rows.slice(1).some((x:Json)=>x.row===r)))fail('Review at most 25 distinct visible source rows',400)
  const selectedSheet={...sheet,rows:[sheet.rows[0],...sheet.rows.slice(1).filter((r:Json)=>request.selected_rows.includes(r.row))]}
  let head:Json={artifact:null,latestVersion:null};let existing:Json[]=[];let targets:Json[]=[];let architecture:Json|null=null
  if(request.type==='content_calendar') {
    const idColumn=request.mapping?.record_id
    if(!Number.isInteger(idColumn)&&!Number.isInteger(request.mapping?.calendar_key))fail('Map exact record IDs or stable calendar keys',400)
    const ids=selectedSheet.rows.slice(1).map((r:Json)=>r.cells[idColumn]).filter((id:string)=>UUID.test(id||''))
    const [tasks,work]=await Promise.all([
      many(admin.from('tasks').select('id,organization_id,project_id,department_id,title,row_version,due_date,status,user_id,assigned_to,archived_at').eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).in('id',ids).is('archived_at',null)),
      many(admin.from('work_items').select('id,organization_id,project_id,engagement_id,department_id,title,row_version,start_date,due_date,status,created_by,assignee_id,deleted_at').eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).eq('engagement_id',engagement.id).eq('department_id','marketing').is('deleted_at',null).limit(1001)),
    ])
    if(work.length>1000)fail('Calendar target lookup exceeds bounded review; narrow canonical lookup before import')
    targets=[...tasks.map((r:Json)=>({...r,record_kind:'project_task'})),...work.map((r:Json)=>({...r,record_kind:'engagement_work_item'}))]
    const accepted=await many(admin.from('department_chat_proposals').select('import_source_receipt,import_result').eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).eq('engagement_id',engagement.id).eq('conversation_owner_id',scope.actorId).eq('proposal_origin','spreadsheet_import').eq('target_key','content_calendar').eq('status','accepted').limit(1001))
    if(accepted.length>1000)fail('Private receipt lookup exceeds bounded review; explicitly map canonical IDs')
    const aliases:Json[]=[]
    for(const proposal of accepted)for(const source of proposal.import_source_receipt?.rows||[]) {
      if(!source.identity?.startsWith('calendar:'))continue
      const result=proposal.import_result?.rows?.find((r:Json)=>r.row_id===source.row_id&&r.outcome==='verified'&&r.action==='create')
      const target=targets.find(t=>t.record_kind==='engagement_work_item'&&t.id===result?.result?.record_id)
      if(target)aliases.push({...target,import_identity:source.identity})
      else if(result)fail('Original imported calendar target unavailable; no replacement create')
    }
    const seenAliases=new Map<string,Json>()
    for(const alias of aliases){const prior=seenAliases.get(alias.import_identity);if(prior&&prior.id!==alias.id)fail('Ambiguous imported calendar key');seenAliases.set(alias.import_identity,alias)}
    targets.push(...seenAliases.values())
    existing=targets.map(t=>({projectId:scope.projectId,identity:t.import_identity||`${t.record_kind}:${t.id}`,revision:t.row_version,values:{calendar_key:t.import_identity?.slice(9)||'',record_id:t.import_identity?'':t.id,record_kind:t.record_kind,title:t.title,due_date:t.due_date||'',start_date:t.start_date||''}}))
  } else {
    head=await artifactHead(admin,scope,engagement.id,request.type==='website_pages'?'website_architecture':'keyword_strategy',request.artifact_id||null)
    if(request.type==='website_pages') {
      existing=(head.latestVersion?.content.pages||[]).map((p:Json)=>({projectId:scope.projectId,identity:p.page_key,revision:head.latestVersion.version_number,
        values:{page_key:p.page_key,title:p.title,planned_path:'/'+p.slug,parent_page_key:p.parent_page_key||'',page_type:p.page_type,purpose:p.purpose}}))
      const registered=await many(admin.from('project_website_pages').select('page_key,architecture_artifact_id,initial_path').eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).limit(1001))
      if(registered.length>1000||registered.some((r:Json)=>r.architecture_artifact_id!==head.artifact?.id))fail('Registered pages require their original canonical architecture root')
    } else {
      const version=await one(admin.from('artifact_versions').select('id,artifact_id,organization_id,content').eq('id',request.architecture_version_id).eq('organization_id',scope.organizationId))
      const root=version&&await one(admin.from('artifacts').select('id,organization_id,project_id').eq('id',version.artifact_id).eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).eq('engagement_id',engagement.id).eq('artifact_type','website_architecture'))
      if(!root)fail('Select the exact project architecture version')
      architecture={...root,version_id:version.id,pages:version.content.pages}
      existing=(head.latestVersion?.content.keywords||[]).filter((k:Json)=>k.target_kind==='page').map((k:Json)=>({projectId:scope.projectId,identity:JSON.stringify([k.term.trim().toLowerCase(),k.locale.trim().toLowerCase(),k.target_page_key]),revision:head.latestVersion.version_number,
        values:Object.fromEntries(Object.entries(k).map(([key,value])=>[key,value===null?'':String(value)]))}))
    }
  }
  const preview=await previewSpreadsheetImport({projectId:scope.projectId,sourceSha256:attachment.sha256_hex,sourceName:attachment.original_name,sheet:selectedSheet,mapping:request.mapping,type:request.type,existing,existingComplete:true})
  const input={...scope,...head,conversation:scope.conversation,actorId:scope.actorId,organizationId:scope.organizationId,projectId:scope.projectId,attachment,preview,expectedParentVersionId:head.latestVersion?.id||null,architecture,targets,engagement,planningTimezone:scope.project.planning_timezone}
  const draft=request.type==='website_pages'?prepareProjectWebsiteImportDraft(input):request.type==='keyword_plan'?prepareProjectKeywordImportDraft(input):prepareProjectCalendarImport(input)
  const payload='rows' in draft?{rows:draft.rows}:{title:request.title,content:draft.content,expected_parent_version_id:input.expectedParentVersionId}
  if(request.type!=='content_calendar'&&(typeof request.title!=='string'||!request.title.trim()||request.title.length>240))fail('Review an explicit canonical draft title',400)
  const result={project_id:scope.projectId,conversation_id:scope.conversation.id,actor_id:scope.actorId,engagement_id:engagement.id,artifact_id:head.artifact?.id||null,
    parent_version_id:input.expectedParentVersionId,target:request.type==='website_pages'?'website_architecture':request.type==='keyword_plan'?'keyword_strategy':'content_calendar',
    payload,source_receipt:draft.privateReceipt,preview:{engagement_label:engagement.name||'Selected workstream',artifact_label:head.artifact?.title||request.title||null,rows:preview.rows.map((row:Json)=>({...row,before:existing.find(x=>x.identity===row.identity)?.values||null})),disclosures:workbook.disclosures,excluded:sheet.excluded||[],canonical_payload:payload},zero_write:true,provider_request_made:false}
  return {...result,review_sha256:await spreadsheetSourceIdentity(new TextEncoder().encode(JSON.stringify(canonical(result))))}
}
// Read-only contextual names, never an authority grant. Preview/confirm recheck
// the exact canonical scope independently. No source contents or customer rows.
export async function loadProjectImportTargets(admin:any,scope:Json,type:string,engagementId:string|null=null) {
  if(!['website_pages','keyword_plan','content_calendar'].includes(type))fail('Supported import target required',400)
  const department=type==='content_calendar'?'marketing':'content'
  if(department==='content') {
    const member=await one(admin.from('organization_memberships').select('department_id,role').eq('organization_id',scope.organizationId).eq('user_id',scope.actorId).eq('member_kind','team').eq('status','active'))
    if(!member||(member.department_id!=='content'&&!['system_owner','operations_admin','executive'].includes(member.role)))fail('Current Content draft authority required',403)
  }
  const engagements=await many(admin.from('engagements').select('id,name,status,engagement_services!inner(status,service_catalog!inner(department_id,is_active))')
    .eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).neq('status','cancelled')
    .eq('engagement_services.status','active').eq('engagement_services.service_catalog.department_id',department).eq('engagement_services.service_catalog.is_active',true).limit(101))
  if(engagements.length>100)fail('Too many engagement choices; narrow project context')
  const names=[...new Map(engagements.map((e:Json)=>[e.id,{id:e.id,label:e.name,status:e.status}])).values()]
  const result:Json={project_id:scope.projectId,conversation_id:scope.conversation.id,actor_id:scope.actorId,type,engagements:names,artifacts:[],architectures:[],read_only:true}
  if(!engagementId)return result
  if(!UUID.test(engagementId)||!names.some((e:any)=>e.id===engagementId))fail('Choose a current authorized project engagement',403)
  if(type==='content_calendar')return result
  const kind=type==='website_pages'?'website_architecture':'keyword_strategy'
  const roots=await many(admin.from('artifacts').select('id,title,artifact_type').eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).eq('engagement_id',engagementId).eq('artifact_type',kind).limit(101))
  const architectures=type==='keyword_plan'?await many(admin.from('artifacts').select('id,title,artifact_type').eq('organization_id',scope.organizationId).eq('project_id',scope.projectId).eq('engagement_id',engagementId).eq('artifact_type','website_architecture').limit(101)):[]
  if(roots.length>100||architectures.length>100)fail('Too many canonical choices; narrow project context')
  const ids=[...new Set([...roots,...architectures].map((r:Json)=>r.id))]
  const versions=ids.length?await many(admin.from('artifact_versions').select('id,artifact_id,version_number,created_at').eq('organization_id',scope.organizationId).in('artifact_id',ids).order('version_number',{ascending:false}).limit(201)):[]
  if(versions.length>200)fail('Too many version choices; narrow canonical context')
  result.artifacts=roots.map((r:Json)=>({id:r.id,label:r.title,version_number:versions.find((v:Json)=>v.artifact_id===r.id)?.version_number||null}))
  result.architectures=architectures.flatMap((r:Json)=>versions.filter((v:Json)=>v.artifact_id===r.id).map((v:Json)=>({id:v.id,label:r.title+' · version '+v.version_number,version_number:v.version_number})))
  return result
}
export async function projectImportAction(admin:any,identity:Json,body:Json,releaseReady=false) {
  // The HTTP entry always passes a server-owned constant. Body flags never
  // enable uploads, proposal persistence or confirmation.
  if(!releaseReady)fail('Spreadsheet upload and confirmation are unavailable until acceptance gates pass',503)
  const scope=await loadOwnedImportScope(admin,identity.organizationId,identity.actorId,body.conversation_id)
  if(body.action==='targets')return loadProjectImportTargets(admin,scope,body.type,body.engagement_id||null)
  if(body.action==='reserve_source') {
    if(!UUID.test(body.attachment_id||'')||typeof body.original_name!=='string'||!body.original_name.trim()||body.original_name.length>200||/[\u0000-\u001f]/.test(body.original_name)
      ||!['public','internal','confidential','restricted'].includes(body.data_classification)
      ||!['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(body.claimed_mime)
      ||!(body.claimed_mime==='text/csv'?/\.csv$/i:/\.xlsx$/i).test(body.original_name))fail('Review exact supported source name, type and classification',400)
    const prior=await one(admin.from('department_chat_attachments').select('upload_expires_at').eq('id',body.attachment_id).eq('organization_id',scope.organizationId).eq('conversation_id',scope.conversation.id).eq('uploaded_by',scope.actorId))
    const saved=await rpc(admin,'reserve_project_chat_import_attachment',{p_attachment_id:body.attachment_id,p_conversation_id:scope.conversation.id,p_organization_id:scope.organizationId,p_actor_id:scope.actorId,
      p_original_name:body.original_name,p_claimed_mime:body.claimed_mime,p_data_classification:body.data_classification,p_upload_expires_at:prior?.upload_expires_at||new Date(Date.now()+2*60*60*1000).toISOString()})
    if(saved.status!=='awaiting_upload')return {attachment_id:saved.id,status:saved.status,upload_available:false}
    const {data,error}=await admin.storage.from('department-chat-attachments').createSignedUploadUrl(saved.staging_path,{upsert:false})
    if(error)throw error
    return {attachment_id:saved.id,project_id:scope.projectId,conversation_id:scope.conversation.id,status:saved.status,upload:data,claimed_mime:saved.claimed_mime,expires_at:saved.upload_expires_at}
  }
  if(body.action==='source_status') {
    if(!UUID.test(body.attachment_id||''))fail('Exact source identity required',400)
    const saved=await one(admin.from('department_chat_attachments').select('id,status,project_id,conversation_id,sha256_hex,import_inspection,failure_code').eq('id',body.attachment_id).eq('organization_id',scope.organizationId).eq('conversation_id',scope.conversation.id).eq('uploaded_by',scope.actorId).eq('source_kind','project_spreadsheet'))
    return saved
  }
  if(body.action==='finish_source') {
    if(!UUID.test(body.attachment_id||''))fail('Exact source identity required',400)
    const saved=await rpc(admin,'claim_project_chat_import_attachment',{p_attachment_id:body.attachment_id,p_organization_id:scope.organizationId,p_actor_id:scope.actorId})
    if(saved.status==='reference_only')return {attachment_id:saved.id,status:saved.status,sha256_hex:saved.sha256_hex,inspection:saved.import_inspection}
    let copied=false
    try {
      const {data,error}=await admin.storage.from('department-chat-attachments').download(saved.staging_path)
      if(error)throw error
      if(data.size<1||data.size>IMPORT_LIMITS.bytes)fail('Source exceeds two-MB bound',400)
      const bytes=new Uint8Array(await data.arrayBuffer()),workbook=inspectProjectImportBytes(bytes,saved.claimed_mime)
      const sha=await spreadsheetSourceIdentity(bytes)
      const inspection={sheets:workbook.sheets.map((s:Json)=>({name:s.name,hidden:s.hidden,rows:s.rows.length,columns:s.rows[0]?.cells.length||0,excluded:s.excluded||[],formula_cells:s.formulas?.length||0})),disclosures:workbook.disclosures}
      if(new TextEncoder().encode(JSON.stringify(inspection)).length>32768)fail('Inspection metadata exceeds bounds',400)
      const finalPath=`${scope.organizationId}/${scope.conversation.id}/final/${saved.id}`
      const copy=await admin.storage.from('department-chat-attachments').copy(saved.staging_path,finalPath)
      if(copy.error)throw copy.error
      copied=true
      const finished=await rpc(admin,'finish_project_chat_import_attachment',{p_attachment_id:saved.id,p_organization_id:scope.organizationId,p_actor_id:scope.actorId,p_verified_mime:saved.claimed_mime,
        p_byte_size:bytes.length,p_sha256_hex:sha,p_inspection:inspection,p_notice:'Private spreadsheet reference; no source contents dispatched to a provider or memory'})
      return {attachment_id:finished.id,status:finished.status,sha256_hex:finished.sha256_hex,inspection:finished.import_inspection}
    } catch(error) {
      // A lost finalization response is recovered by reading the original record;
      // never mark an already finalized source failed or overwrite its object.
      const current=await one(admin.from('department_chat_attachments').select('id,status,sha256_hex,import_inspection').eq('id',saved.id).eq('organization_id',scope.organizationId).eq('uploaded_by',scope.actorId))
      if(current?.status==='reference_only')return {attachment_id:current.id,status:current.status,sha256_hex:current.sha256_hex,inspection:current.import_inspection,recovered:true}
      await rpc(admin,'fail_department_chat_attachment',{p_attachment_id:saved.id,p_actor_id:scope.actorId,p_status:'failed',p_failure_code:'spreadsheet_finalization_failed',
        p_orphan_final_path:copied?`${scope.organizationId}/${scope.conversation.id}/final/${saved.id}`:null})
      throw error
    }
  }
  if(body.action==='recover')return rpc(admin,'get_project_chat_import_proposal',{p_org:scope.organizationId,p_conversation:scope.conversation.id,p_actor:scope.actorId,p_request:body.request_id})
  if(body.action==='confirm') {
    if(body.confirmed!==true||!UUID.test(body.request_id||'')||!/^[0-9a-f]{64}$/.test(body.review_sha256||''))fail('Confirm the exact original review',400)
    return rpc(admin,'confirm_project_chat_import_proposal',{p_org:scope.organizationId,p_conversation:scope.conversation.id,p_actor:scope.actorId,p_request:body.request_id,p_review_sha256:body.review_sha256})
  }
  if(!['preview','save_proposal'].includes(body.action))fail('Unsupported importer action',400)
  const prepared=await preparePrivateProjectImport(admin,scope,body)
  if(body.action==='preview')return prepared
  if(!UUID.test(body.request_id||'')||body.review_sha256!==prepared.review_sha256)fail('Review changed; preview the exact batch again')
  return rpc(admin,'save_project_chat_import_proposal',{p_org:scope.organizationId,p_conversation:scope.conversation.id,p_actor:scope.actorId,p_attachment:body.attachment_id,
    p_engagement:prepared.engagement_id,p_target:prepared.target,p_request:body.request_id,p_artifact:prepared.artifact_id,p_parent:prepared.parent_version_id,
    p_payload:prepared.payload,p_preview:prepared.preview,p_source_receipt:prepared.source_receipt})
}
