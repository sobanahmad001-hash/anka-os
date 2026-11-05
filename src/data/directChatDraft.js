import {selectedProjectStageContext} from './projectStageChatContext.js'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TTL = 60 * 60 * 1000
const validText = value => typeof value === 'string' && value.length <= 8000
const validStage = value => {
  if(!value || Object.keys(value).sort().join(',')!=='output_version_ids,selection' || !Array.isArray(value.output_version_ids) || value.output_version_ids.length>20 || new Set(value.output_version_ids).size!==value.output_version_ids.length || value.output_version_ids.some(id=>typeof id!=='string'||!UUID.test(id)))return false
  const selected=value.selection
  if(!selected||Object.keys(selected).sort().join(',')!=='context_sha256,engagement_id,group_id,organization_id,partition,phase,plan_id,project_id,version' || !selected.partition || Object.keys(selected.partition).some(key=>!['kind','id','architecture_version_id'].includes(key)) || (selected.partition.kind==='website_page'?!UUID.test(selected.partition.architecture_version_id):selected.partition.architecture_version_id!==undefined))return false
  try{selectedProjectStageContext(selected,selected);return true}catch{return false}
}
const validAttempt = value => !value || (UUID.test(value.conversation_id) && UUID.test(value.client_request_id)
  && validText(value.text) && typeof value.isNew === 'boolean'
  && (value.design_attachment_ids === undefined || Array.isArray(value.design_attachment_ids) && value.design_attachment_ids.length <= 3 && new Set(value.design_attachment_ids).size === value.design_attachment_ids.length && value.design_attachment_ids.every(id => typeof id === 'string' && UUID.test(id)))
  && (value.project_document_ids === undefined || Array.isArray(value.project_document_ids) && value.project_document_ids.length <= 3 && new Set(value.project_document_ids).size === value.project_document_ids.length && value.project_document_ids.every(id => typeof id === 'string' && UUID.test(id)))
  && (value.project_stage_context === undefined || validStage(value.project_stage_context) && value.design_attachment_ids===undefined && value.project_document_ids===undefined)
  && Object.keys(value).every(key => ['conversation_id', 'client_request_id', 'text', 'isNew', 'design_attachment_ids', 'project_document_ids', 'project_stage_context'].includes(key)))
export function readDirectChatDraft(key, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(`${key}:draft`))
    if (!value) return null
    if (!Number.isFinite(value.expires_at) || value.expires_at <= now || value.expires_at > now + TTL
      || !UUID.test(value.new_conversation_id) || (value.conversation_id != null && !UUID.test(value.conversation_id))
      || !validText(value.text) || !validAttempt(value.attempt)
      || !Object.keys(value).every(field => ['expires_at', 'new_conversation_id', 'conversation_id', 'text', 'attempt'].includes(field))) {
      storage.removeItem(`${key}:draft`); return null
    }
    return value
  } catch { return null }
}
export function writeDirectChatDraft(key, value, storage = globalThis.sessionStorage, now = Date.now()) {
  if (!validText(value.text) || !UUID.test(value.new_conversation_id) || (value.conversation_id != null && !UUID.test(value.conversation_id)) || !validAttempt(value.attempt) || Object.keys(value).some(field => !['new_conversation_id', 'conversation_id', 'text', 'attempt'].includes(field))) throw new Error('Invalid scoped chat draft')
  if (!value.text && !value.attempt) storage.removeItem(`${key}:draft`)
  else storage.setItem(`${key}:draft`, JSON.stringify({ ...value, expires_at: now + TTL }))
}
export function clearDirectChatDraft(key, storage = globalThis.sessionStorage) { storage.removeItem(`${key}:draft`) }
