async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Work Items query failed'), { status: error.status || error.statusCode })
  return data
}

export async function readOrganizationRows(organizationId, buildQuery, { signal, label = 'Work Items' } = {}) {
  if (!organizationId) return []
  let query = buildQuery(organizationId)
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const rows = await dataOrThrow(query) || []
  if (rows.some(row => row.organization_id !== organizationId)) {
    throw Object.assign(new Error(`${label} returned data outside the active organization`), { status: 403, membershipMismatch: true })
  }
  return rows
}

export function isCurrentWorkItemsRequest(request, current) {
  return Boolean(request.organizationId && request.organizationId === current.organizationId && request.generation === current.generation && !request.signal?.aborted)
}
