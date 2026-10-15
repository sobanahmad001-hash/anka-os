import { validateAdministration } from './authorityAdministration.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const roleProjection = { operations_admin: 'admin', executive: 'executive', department_manager: 'department_head', project_owner: 'member', contributor: 'member' }
const unavailable = message => ({ state: 'unavailable', message })
function identity(id) { if (!UUID.test(id || '')) throw new TypeError('Exact organization/user identity required') }
function check(signal) { signal?.throwIfAborted() }

// Read allowlist only. No caller-only capability RPC is invoked for a target.
export function createPeopleAccessReadRepository(client) {
  async function administration(org, user, signal) {
    identity(org); if (user) identity(user)
    check(signal)
    let query = client.rpc('get_authority_administration', { p_organization_id: org, p_user_id: user })
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await query
    check(signal); if (error) throw error
    return validateAdministration(data, org, user)
  }
  return Object.freeze({
    async list(org, { signal } = {}) {
      const data = await administration(org, null, signal)
      return data.members.map(row => ({ id: row.user_id, name: row.name || 'Unnamed team member', role: row.role, status: row.status }))
    },
    async read(org, user, { signal } = {}) {
      const data = await administration(org, user, signal)
      if (!data.members.some(row => row.user_id === user)) throw Error('Selected team member is absent from this organization')
      let profile
      try {
        let query = client.from('profiles').select('id, full_name, role, department').eq('id', user)
        if (signal) query = query.abortSignal(signal)
        const { data: row, error } = await query.maybeSingle()
        check(signal); if (error) throw error
        if (row && row.id !== user) throw Error('Profile identity mismatch')
        profile = row ? { state: 'available', id: row.id, full_name: row.full_name, role: row.role, department: row.department } : { state: 'missing', message: 'No profile returned by the authorized read' }
      } catch (error) { check(signal); profile = unavailable(error.message || 'Profile read unavailable') }
      return buildPeopleAccessReadModel(data, profile, new Date().toISOString())
    },
    async history(org, user, { signal } = {}) {
      identity(org); identity(user); check(signal)
      let query = client.rpc('get_organization_deactivation_history', { p_organization_id: org, p_user_id: user })
      if (signal) query = query.abortSignal(signal)
      const { data, error } = await query
      check(signal); if (error) throw error
      if (data?.organization_id !== org || data?.user_id !== user || !Array.isArray(data.history)
        || data.history.some(row => row.organization_id !== org || row.user_id !== user)) throw Error('Mismatched retained history')
      // Do not propagate work titles, assignment payloads or arbitrary JSON.
      return data.history.map(row => ({ id: row.id, occurredAt: row.created_at, reassignmentCount: Array.isArray(row.reassignment_records) ? row.reassignment_records.length : null }))
    },
  })
}

export function buildPeopleAccessReadModel(data, profile, observedAt) {
  const snapshot = data.snapshot
  if (!snapshot) throw Error('Team snapshot required')
  const expectedProfileRole = roleProjection[snapshot.legacy_role]
  const discrepancies = profile.state !== 'available' ? [] : [
    expectedProfileRole && profile.role !== expectedProfileRole ? 'The global profile role does not match the display role associated with this organization membership.' : null,
    profile.department !== snapshot.legacy_department_id ? 'The global profile department differs from this organization’s primary department.' : null,
  ].filter(Boolean)
  const member = data.members.find(row => row.user_id === snapshot.user_id)
  const projectNames = new Map(data.projects.map(row => [row.id, row.name]))
  return {
    organizationId: data.organization_id, userId: snapshot.user_id, observedAt,
    name: profile.state === 'available' ? profile.full_name || member?.name || 'Unnamed team member' : member?.name || 'Unnamed team member',
    profile, discrepancies,
    membership: { kind: 'team', role: snapshot.legacy_role, status: snapshot.status, primaryDepartment: snapshot.legacy_department_id },
    departments: snapshot.department_memberships.map(row => ({ id: row.id, department: row.department_id, status: row.status, source: row.source, revokedAt: row.revoked_at })),
    designations: snapshot.contributor_designations.map(row => ({ id: row.id, label: row.designation, status: row.status, source: row.source })),
    managerBindings: snapshot.project_manager_bindings.map(row => ({ id: row.id, projectId: row.project_id, name: projectNames.get(row.project_id) || 'Project not in current active-project list', status: row.status, source: row.source })),
    relationships: {
      teamVisibility: snapshot.status === 'active' ? 'Active team membership can provide visibility across this organization’s projects. Access to individual projects has not been checked.' : 'This organization membership is not active. Current project visibility has not been checked.',
      clientGrants: 'Client project access: not evaluated. Client contacts and their project access are not included in this view.',
      ownership: 'Project ownership and department participation: not evaluated. These are separate from project-manager relationships.',
    },
    effective: ['Read project', 'Create unassigned work', 'Execute work', 'Assign work', 'Specialist review', 'PM confirmation', 'Release', 'Client decision'].map(action => ({ action, state: 'Not evaluated', reason: 'Not checked for this person. Permissions depend on the project or item and its current state; these records alone do not establish permission.' })),
  }
}
