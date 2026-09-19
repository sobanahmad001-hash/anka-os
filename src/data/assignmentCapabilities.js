const DENIED = Object.freeze({ can_assign: false, can_execute: false })

export function recordAssignmentCapabilities(capabilities, kind, row) {
  const values = capabilities?.[kind]
  const capability = Array.isArray(values) ? values.find(item => item.id === row?.id) : null
  return capability && Number(capability.row_version) === Number(row?.row_version) ? capability : DENIED
}

export async function readAssignmentCapabilities(client, organizationId, projectId, { signal } = {}) {
  if (!organizationId || !projectId) throw new TypeError('Organization and canonical project are required')
  signal?.throwIfAborted()
  let query = client.rpc('get_assignment_capabilities', { p_organization_id: organizationId, p_project_id: projectId })
  if (signal && query.abortSignal) query = query.abortSignal(signal)
  const { data, error } = await query
  signal?.throwIfAborted()
  if (error) throw error
  if (!data || data.schema_version !== 1 || data.assignment_enforced !== true ||
    data.organization_id !== organizationId || data.project_id !== projectId || !data.actor_id ||
    typeof data.can_assign !== 'boolean' || data.can_create_unassigned !== true) throw new Error('Invalid assignment capability scope')
  for (const key of ['project_tasks', 'engagement_work_items']) {
    if (!Array.isArray(data[key]) || data[key].some(item => !item?.id || !Number.isSafeInteger(Number(item.row_version)) ||
      Number(item.row_version) < 1 || typeof item.can_assign !== 'boolean' || typeof item.can_execute !== 'boolean')) {
      throw new Error('Invalid assignment capability records')
    }
  }
  return { organization_id: organizationId, project_id: projectId, assignment_enforced: true, can_assign: data.can_assign,
    can_create_unassigned: true, project_tasks: data.project_tasks, engagement_work_items: data.engagement_work_items }
}
