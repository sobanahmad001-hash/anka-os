const ACTIONS = new Set(['add_department', 'revoke_department', 'set_designation', 'add_project_manager', 'revoke_project_manager'])

// UI hint only: every RPC independently verifies current server-side membership.
export function canShowAuthorityAdministration(membership) {
  return Boolean(membership?.organizationId && ['system_owner', 'operations_admin'].includes(membership.role))
}

function invalid() { throw new Error('Invalid or mismatched compatibility administration response') }
function checkEnvelope(data, organizationId) {
  if (!data || data.schema_version !== 1 || data.compatibility_only !== true || data.organization_id !== organizationId) invalid()
}
export function validateAdministration(data, organizationId, userId) {
  checkEnvelope(data, organizationId)
  if (!data.actor_id) invalid()
  for (const key of ['members', 'departments', 'projects']) {
    if (!Array.isArray(data[key]) || data[key].some(row => !row || row.organization_id !== organizationId || !(row.id || row.user_id))) invalid()
  }
  const snapshot = data.snapshot
  if (userId) {
    if (!snapshot || snapshot.user_id !== userId || snapshot.organization_id !== organizationId || typeof data.token !== 'string' || !data.token) invalid()
    for (const key of ['department_memberships', 'contributor_designations', 'project_manager_bindings']) {
      if (!Array.isArray(snapshot[key]) || snapshot[key].some(row => !row?.id || row.organization_id !== organizationId ||
          row.user_id !== userId || !['active', 'revoked'].includes(row.status))) invalid()
    }
  } else if (snapshot !== null || data.token !== null) invalid()
  return { organization_id: organizationId, compatibility_only: true, actor_id: data.actor_id, assignment_enforced: data.assignment_enforced === true,
    members: data.members, departments: data.departments, projects: data.projects, snapshot, token: data.token }
}

export function createAuthorityAdministrationRepository(client) {
  async function rpc(name, args, signal) {
    signal?.throwIfAborted()
    let request = client.rpc(name, args)
    if (signal && request.abortSignal) request = request.abortSignal(signal)
    const { data, error } = await request
    signal?.throwIfAborted()
    if (error) throw error
    return data
  }
  return {
    async read(organizationId, userId = null, { signal } = {}) {
      if (!organizationId) throw new TypeError('Organization is required')
      return validateAdministration(await rpc('get_authority_administration',
        { p_organization_id: organizationId, p_user_id: userId }, signal), organizationId, userId)
    },
    async change({ organizationId, userId, action, value, token, requestId }, { signal } = {}) {
      if (!organizationId || !userId || !token || !requestId || !ACTIONS.has(action) ||
          (action === 'set_designation' ? ![null, 'intern', 'executive'].includes(value) : typeof value !== 'string' || !value)) {
        throw new TypeError('Complete compatibility command required')
      }
      const data = await rpc('change_authority_compatibility', { p_organization_id: organizationId, p_user_id: userId,
        p_action: action, p_value: value, p_expected_token: token, p_request_id: requestId }, signal)
      checkEnvelope(data, organizationId)
      if (data.user_id !== userId || data.request_id !== requestId) invalid()
      return data
    },
  }
}
