const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA=/^[0-9a-f]{64}$/
export function createProjectSpreadsheetImportRepository(client,scope) {
  if(!client?.functions?.invoke||![scope.organizationId,scope.projectId,scope.conversationId,scope.actorId].every(x=>UUID.test(x||'')))throw TypeError('Exact signed-in Project Chat scope required')
  const matches=data=>data?.project_id===scope.projectId&&data.conversation_id===scope.conversationId&&data.actor_id===scope.actorId
  async function call(action,body) {
    const {data,error}=await client.functions.invoke('project-chat-import',{body:{...body,action,organization_id:scope.organizationId,conversation_id:scope.conversationId}})
    if(error)throw error
    if(new TextEncoder().encode(JSON.stringify(data)).length>262144)throw Error('Import response exceeds bounds')
    return data
  }
  return Object.freeze({
    async targets(type,engagementId=null) {
      if(!['website_pages','keyword_plan','content_calendar'].includes(type)||engagementId&&!UUID.test(engagementId))throw TypeError('Current supported project target required')
      const data=await call('targets',{type,engagement_id:engagementId})
      if(!matches(data)||data.type!==type||data.read_only!==true)throw Error('Project choices changed')
      for(const key of ['engagements','artifacts','architectures'])if(!Array.isArray(data[key])||data[key].length>200||new Set(data[key].map(x=>x.id)).size!==data[key].length||data[key].some(x=>!UUID.test(x.id||'')||typeof x.label!=='string'||!x.label.trim()||x.label.length>400))throw Error('Bounded named project choices required')
      return data
    },
    async reserveSource(file,attachmentId,classification) {
      if(!UUID.test(attachmentId||'')||!file||file.size<1||file.size>2097152||!['public','internal','confidential','restricted'].includes(classification))throw TypeError('Review exact private source and classification')
      const mime=/\.csv$/i.test(file.name)?'text/csv':/\.xlsx$/i.test(file.name)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':null
      if(!mime)throw TypeError('CSV/XLSX source required')
      const data=await call('reserve_source',{attachment_id:attachmentId,original_name:file.name,claimed_mime:mime,data_classification:classification})
      if(data.attachment_id!==attachmentId||data.project_id!==scope.projectId||data.conversation_id!==scope.conversationId||data.status!=='awaiting_upload'
        ||data.upload?.path!==`${scope.organizationId}/${scope.conversationId}/staging/${attachmentId}`||typeof data.upload?.token!=='string')throw Error('Private upload identity changed')
      return data
    },
    async uploadSource(file,reservation) {
      if(!client.storage?.from||reservation.project_id!==scope.projectId||reservation.conversation_id!==scope.conversationId
        ||reservation.upload?.path!==`${scope.organizationId}/${scope.conversationId}/staging/${reservation.attachment_id}`)throw Error('Private upload scope changed')
      const {error}=await client.storage.from('department-chat-attachments').uploadToSignedUrl(reservation.upload.path,reservation.upload.token,file,{contentType:reservation.claimed_mime,upsert:false})
      if(error)throw error
    },
    async finishSource(attachmentId,sha256) {if(!UUID.test(attachmentId||'')||!SHA.test(sha256||''))throw TypeError('Exact source receipt required');const data=await call('finish_source',{attachment_id:attachmentId});if(data.attachment_id!==attachmentId||data.status!=='reference_only'||data.sha256_hex!==sha256)throw Error('Verified source receipt changed');return data},
    async sourceStatus(attachmentId) {if(!UUID.test(attachmentId||''))throw TypeError('Original attachment UUID required');const data=await call('source_status',{attachment_id:attachmentId});if(data&& (data.id!==attachmentId||data.project_id!==scope.projectId||data.conversation_id!==scope.conversationId))throw Error('Source recovery scope changed');return data},
    async preview(input) {const data=await call('preview',input);if(!matches(data)||data.zero_write!==true||data.provider_request_made!==false||!SHA.test(data.review_sha256||''))throw Error('Exact zero-write import review changed');return data},
    async save(input,requestId,reviewSha256) {if(!UUID.test(requestId||'')||!SHA.test(reviewSha256||''))throw TypeError('Original review and request required');const data=await call('save_proposal',{...input,request_id:requestId,review_sha256:reviewSha256});if(!matches(data)||data.request_id!==requestId||!UUID.test(data.proposal_id||'')||!SHA.test(data.review_sha256||'')||data.provider_request_made!==false)throw Error('Original private proposal identity changed');return data},
    async confirm(requestId,reviewSha256,confirmed) {if(!UUID.test(requestId||'')||!SHA.test(reviewSha256||'')||confirmed!==true)throw TypeError('Confirm the exact original review');const data=await call('confirm',{request_id:requestId,review_sha256:reviewSha256,confirmed:true});if(!matches(data)||data.request_id!==requestId||data.review_sha256!==reviewSha256||data.approval_created!==false||data.publication_authorized!==false||data.provider_request_made!==false||!Array.isArray(data.rows))throw Error('Canonical import receipt changed');return data},
    async recover(requestId) {if(!UUID.test(requestId||''))throw TypeError('Original request UUID required');const data=await call('recover',{request_id:requestId});if(data!==null&&(!matches(data)||data.organization_id!==scope.organizationId||data.request_id!==requestId||!UUID.test(data.proposal_id||'')||data.provider_request_made!==false))throw Error('Original import recovery scope changed');return data},
  })
}

// Recovery metadata is UUID-only. Source cells, mappings and private preview
// content never enter browser persistence. An uncertain operation blocks new work.
export function createProjectImportRecoverySession(repository,scope,storage) {
  const key=`anka:project-import:${scope.organizationId}:${scope.projectId}:${scope.conversationId}:${scope.actorId}`
  let pending=null;let flight=null
  const raw=storage.getItem(key)
  if(raw){let value;try{value=JSON.parse(raw)}catch{throw Error('Unreadable importer recovery metadata')}
    if(Object.keys(value).length!==1||!UUID.test(value.requestId||''))throw Error('Invalid importer recovery metadata');pending=value.requestId}
  const single=run=>{if(flight)return flight;flight=Promise.resolve().then(run).finally(()=>{flight=null});return flight}
  return Object.freeze({
    get pendingRequestId(){return pending},
    save(input,reviewSha256) {return single(async()=>{if(pending)throw Error('Recover the original pending import before new work');const requestId=crypto.randomUUID();storage.setItem(key,JSON.stringify({requestId}));pending=requestId;return repository.save(input,requestId,reviewSha256)})},
    retrySave(input,reviewSha256) {return single(async()=>{if(!pending)throw Error('No original import request to retry');return repository.save(input,pending,reviewSha256)})},
    confirm(reviewSha256,confirmed) {return single(async()=>{if(!pending)throw Error('No original import proposal');const result=await repository.confirm(pending,reviewSha256,confirmed);storage.removeItem(key);pending=null;return result})},
    recover() {return single(async()=>{if(!pending)return null;const result=await repository.recover(pending);if(result?.status==='accepted'||['rejected','expired','stale'].includes(result?.status)){storage.removeItem(key);pending=null}return result})},
  })
}
