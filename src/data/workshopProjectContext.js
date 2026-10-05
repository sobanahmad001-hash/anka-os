// Read through the caller's authenticated client. Project RLS is independent of legacy workstreams.
export async function readWorkshopProjectContext(client, departmentId, organizationId, signal) {
  if (!organizationId || !['content', 'design', 'marketing'].includes(departmentId)) throw new TypeError('Valid Workshop organization and department required')
  const read = async query => {
    if (signal?.aborted) throw Object.assign(new Error('Workshop selection was cancelled.'), { name: 'AbortError' })
    const { data, error, status } = await (signal ? query.abortSignal(signal) : query)
    if (error) throw Object.assign(new Error(error.message || 'Unable to read Workshop project context.'), { cause: error, status: error.code === '42501' ? 403 : status })
    if (signal?.aborted) throw Object.assign(new Error('Workshop selection was cancelled.'), { name: 'AbortError' })
    if (!Array.isArray(data) || data.some(row => row.organization_id !== organizationId)) {
      throw Object.assign(new Error('Workshop project context is unavailable in the active organization.'), { status: 403, membershipMismatch: true })
    }
    return data
  }
  const projects = await read(client.from('projects')
    .select('id, organization_id, client_id, name, status, archived_at')
    .eq('organization_id', organizationId).is('archived_at', null).order('name').order('id'))
  if (projects.some(row => !row.id || row.archived_at)) throw new Error('Workshop project selection is no longer current. Refresh to retry.')
  if (!projects.length) return { projects, engagements: [], services: [] }
  const projectIds = new Set(projects.map(row => row.id))
  const engagements = await read(client.from('engagements')
    .select('id, organization_id, project_id, brand_id, name, status')
    .eq('organization_id', organizationId).in('project_id', [...projectIds]).order('name').order('id'))
  if (engagements.some(row => !row.id || !projectIds.has(row.project_id))) throw new Error('Workshop engagement does not match an accessible project.')
  if (!engagements.length) return { projects, engagements, services: [] }
  const engagementIds = new Set(engagements.map(row => row.id))
  const services = await read(client.from('engagement_services')
    .select('id, organization_id, engagement_id, status, service_catalog!inner(id, department_id, name, slug)')
    .eq('organization_id', organizationId).in('engagement_id', [...engagementIds])
    .eq('service_catalog.department_id', departmentId))
  if (services.some(row => !engagementIds.has(row.engagement_id) || row.service_catalog?.department_id !== departmentId)) {
    throw new Error('Workshop service does not match the selected department and engagement.')
  }
  return { projects, engagements, services }
}
