// Invoke with the caller's authenticated Supabase client, never a service-role client.
export const draftSchemaVersion = 1
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function draftArgs(input) {
  const keys = ['schema_version','organization_id','project_id','card_kind','card_id','request_id','previous_version_id','title','body']
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length || keys.some(k => !(k in input))) throw new TypeError('Exact draft schema required')
  if (input.schema_version !== 1 || !['project_task','engagement_work_item'].includes(input.card_kind)) throw new TypeError('Unsupported draft schema or card')
  for (const key of ['organization_id','project_id','card_id','request_id']) if (typeof input[key] !== 'string' || !uuid.test(input[key])) throw new TypeError('Exact UUID scope required')
  if (input.previous_version_id !== null && (typeof input.previous_version_id !== 'string' || !uuid.test(input.previous_version_id))) throw new TypeError('Exact previous version required')
  for (const [key,max] of [['title',240],['body',100000]]) if (typeof input[key] !== 'string' || !input[key].trim() || [...input[key]].length > max) throw new TypeError('Draft text exceeds bounds')
  return {p_org:input.organization_id,p_project:input.project_id,p_card_kind:input.card_kind,p_card_id:input.card_id,p_request:input.request_id,p_previous:input.previous_version_id,p_title:input.title,p_body:input.body}
}
export async function createSuppliedDraft(client, input) {
  const {data,error} = await client.rpc('save_hybrid_work_draft', draftArgs(input))
  if (error) throw error // Unknown transport outcomes must retry the SAME request and payload.
  if (!data || data.schema_version !== 1 || data.organization_id !== input.organization_id || data.project_id !== input.project_id || data.card_kind !== input.card_kind || data.card_id !== input.card_id || data.version_id !== input.request_id || data.request_id !== input.request_id || data.asset_kind !== 'content' || !uuid.test(data.document_id) || !Number.isSafeInteger(data.version_number) || data.version_number < 1) throw new Error('Draft receipt scope mismatch; retain request ID for recovery')
  return data
}
