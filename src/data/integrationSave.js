const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MESSAGES = {
  connection_name_conflict: 'A connection with this name already exists. Existing connections are unchanged. Review them before choosing a different name.',
  authentication_required: 'Your session must be signed in before saving. Your form has been kept.',
  access_denied: 'You do not have permission to save this connection in the selected organization. Your form has been kept.',
  save_rejected: 'The connection could not be saved. Check the selected organization and form values. Your form has been kept.',
  save_unconfirmed: 'The save could not be confirmed. Your form has been kept. Check existing connections before trying again.',
}

export function connectionSaveError(code = 'save_unconfirmed') {
  const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'save_unconfirmed'
  const error = new Error(MESSAGES[safeCode])
  error.code = safeCode
  return error
}

export function connectionSaveErrorMessage(error) {
  return connectionSaveError(error?.code).message
}

// Only fixed application codes/statuses reach the UI, never server bodies or SQL details.
export async function saveConnectionMetadata(invoke, body) {
  let result
  try { result = await invoke(body) } catch { throw connectionSaveError() }
  const { data, error } = result || {}
  if (error || data?.error) {
    let code = data?.code
    const status = error?.context?.status
    if (error?.context && typeof error.context.clone === 'function') {
      try { code = (await error.context.clone().json())?.code } catch { /* Keep safe fallback. */ }
    }
    if (code === 'connection_name_conflict') throw connectionSaveError(code)
    if (status === 401) throw connectionSaveError('authentication_required')
    if (status === 403) throw connectionSaveError('access_denied')
    throw connectionSaveError(status >= 400 && status < 500 ? 'save_rejected' : 'save_unconfirmed')
  }
  const saved = data?.connection
  const expectedDepartments = body.organization_only ? [] : body.department_ids
  const sameDepartments = Array.isArray(saved?.department_ids) && Array.isArray(expectedDepartments)
    && saved.department_ids.length === expectedDepartments.length
    && saved.department_ids.every(id => expectedDepartments.includes(id))
  if (!saved || !UUID.test(saved.id || '') || !UUID.test(saved.organization_id || '')
    || (body.organization_id && saved.organization_id !== body.organization_id)
    || saved.provider !== body.provider || saved.display_name !== body.display_name?.trim()
    || !['configured', 'disconnected'].includes(saved.status) || !sameDepartments
    || (body.public_config?.model_id && saved.public_config?.model_id !== body.public_config.model_id.trim())) {
    throw connectionSaveError()
  }
  return data
}
