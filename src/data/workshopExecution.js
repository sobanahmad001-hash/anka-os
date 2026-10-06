const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const departments = ['content', 'design', 'marketing']
const unknown = () => { throw new Error('Activation outcome is unconfirmed. Check the original request before another save.') }
const same = (a, b) => JSON.stringify(a.map(x => [x.department_id, x.enabled]).sort()) === JSON.stringify(b.map(x => [x.department_id, x.enabled]).sort())
export function validateExecutionResult(value, scope, command) {
  if (!value || value.schema_version !== 1 || Object.keys(scope).some(k => value[k] !== scope[k])) unknown()
  if (command) {
    if (value.persisted !== true || value.request_id !== command.request_id || !Array.isArray(value.selections)
      || !same(value.selections, command.selections)) unknown()
  } else if (!/^[a-f0-9]{32}$/.test(value.token) || typeof value.project_name !== 'string'
    || !Array.isArray(value.workshops) || value.workshops.length !== 3
    || new Set(value.workshops.map(x => x.department_id)).size !== 3
    || value.workshops.some(x => !departments.includes(x.department_id) || typeof x.enabled !== 'boolean' || typeof x.eligible !== 'boolean')) unknown()
  return value
}
export function createWorkshopExecution(invoke) {
  async function call(action, scope, extra, signal) {
    if (['organization_id', 'project_id', 'engagement_id'].some(k => !UUID.test(scope[k]))) throw new Error('Exact project and engagement required.')
    const pinned = Object.fromEntries(['organization_id', 'project_id', 'engagement_id'].map(k => [k, scope[k]]))
    signal?.throwIfAborted()
    let response
    try { response = await invoke({ action, ...pinned, ...extra }, signal) } catch { signal?.throwIfAborted(); unknown() }
    signal?.throwIfAborted()
    if (response?.error || response?.data?.error) {
      const status = response.error?.context?.status || Number((response.data?.code || '').replace('execution_', ''))
      throw Object.assign(new Error(status === 409 ? 'Activation review changed. Load settings and review again.'
        : status === 403 ? 'Current leadership and active project access required.'
        : status === 400 ? 'Reviewed activation command is invalid or unavailable.'
        : 'Activation outcome is unconfirmed. Check the original request before another save.'), { definitive: [400, 401, 403, 409].includes(status) })
    }
    return response?.data?.result
  }
  function validateCommand(command) {
    if (!UUID.test(command?.request_id) || !/^[a-f0-9]{32}$/.test(command.expected_token)
      || !Array.isArray(command.selections) || !command.selections.length || command.selections.length > 3
      || new Set(command.selections.map(x => x.department_id)).size !== command.selections.length
      || command.selections.some(x => !departments.includes(x.department_id) || typeof x.enabled !== 'boolean')) throw new Error('An original reviewed activation command is required.')
  }
  return {
    async read(scope, signal) { return validateExecutionResult(await call('list_workshop_execution', scope, {}, signal), scope) },
    async save(scope, command, signal) {
      validateCommand(command)
      return validateExecutionResult(await call('save_workshop_execution', scope, { request_id: command.request_id, expected_token: command.expected_token,
        selections: command.selections.map(({ department_id, enabled }) => ({ department_id, enabled })) }, signal), scope, command)
    },
    async recover(scope, command, signal) {
      validateCommand(command)
      const result = await call('recover_workshop_execution', scope, { request_id: command.request_id }, signal)
      return result === null ? null : validateExecutionResult(result, scope, command)
    },
  }
}
