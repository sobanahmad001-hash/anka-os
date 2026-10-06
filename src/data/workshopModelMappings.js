const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEPARTMENTS = new Set(['content', 'design', 'marketing'])
export const mappingKey = row => `${row.connection_id}:${row.department_id}`
function invalid() { throw new Error('Mapping response could not be confirmed. Check the original request.') }
export function validateMappingResult(data, scope, command) {
  if (!data || data.schema_version !== 1 || ['organization_id', 'project_id', 'engagement_id'].some(k => data[k] !== scope[k])) invalid()
  if (command) {
    if (data.request_id !== command.request_id || data.persisted !== true || !Array.isArray(data.added) || !Array.isArray(data.selections)) invalid()
    const expected = command.selections.map(mappingKey).sort()
    if (JSON.stringify(data.selections.map(mappingKey).sort()) !== JSON.stringify(expected)
      || data.added.some(row => !expected.includes(mappingKey(row))) || new Set(data.added.map(mappingKey)).size !== data.added.length) invalid()
  } else {
    if (!/^[a-f0-9]{32}$/.test(data.token) || typeof data.project_name !== 'string' || !Array.isArray(data.candidates)
      || data.candidates.length > 100 || data.candidates.some(row => !UUID.test(row.connection_id) || !DEPARTMENTS.has(row.department_id)
        || typeof row.display_name !== 'string' || typeof row.linked !== 'boolean' || !Array.isArray(row.models) || !row.models.length
        || row.models.some(m => !UUID.test(m.id) || typeof m.model_id !== 'string' || !m.model_id))) invalid()
    if (new Set(data.candidates.map(mappingKey)).size !== data.candidates.length) invalid()
  }
  return data
}
export function createWorkshopModelMappings(invoke) {
  async function call(action, scope, extra, signal) {
    if (['organization_id', 'project_id', 'engagement_id'].some(k => !UUID.test(scope[k]))) throw new Error('Exact project and engagement required')
    signal?.throwIfAborted()
    let response
    try { response = await invoke({ action, ...scope, ...extra }, signal) } catch { signal?.throwIfAborted(); invalid() }
    const { data, error } = response || {}
    signal?.throwIfAborted()
    if (error || data?.error) {
      let status = error?.context?.status
      if (!status && /^mapping_(400|403|409|503)$/.test(data?.code || '')) status = Number(data.code.slice(8))
      throw Object.assign(new Error(status === 409 ? 'Review changed. Load eligible connections again.'
        : status === 403 ? 'Current leadership and active project access required.'
        : status === 400 ? 'Mapping command is invalid or unavailable.' : 'Outcome uncertain. Check the original request before another save.'),
      { definitive: [400, 401, 403, 409].includes(status) })
    }
    return data?.result
  }
  return {
    async read(scope, signal) { return validateMappingResult(await call('list_workshop_mappings', scope, {}, signal), scope) },
    async save(scope, command, signal) {
      if (!UUID.test(command.request_id) || !/^[a-f0-9]{32}$/.test(command.expected_token) || !Array.isArray(command.selections)
        || !command.selections.length || command.selections.length > 30) throw new Error('Reviewed command required')
      return validateMappingResult(await call('save_workshop_mappings', scope, { request_id: command.request_id, expected_token: command.expected_token, selections: command.selections }, signal), scope, command)
    },
    async recover(scope, command, signal) {
      if (!UUID.test(command.request_id)) throw new Error('Original request required')
      const result = await call('recover_workshop_mappings', scope, { request_id: command.request_id }, signal)
      return result === null ? null : validateMappingResult(result, scope, command)
    },
  }
}
