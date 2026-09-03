import { supabase } from '../lib/supabase'

export async function fetchClientWorkDirectorySnapshot(organizationId, { signal } = {}) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('organizationId is required')
  if (signal?.aborted) throw Object.assign(new Error('Client Work request aborted'), { name: 'AbortError' })

  const scoped = (table, columns) => supabase.from(table).select(columns).eq('organization_id', organizationId).abortSignal(signal)
  const requests = [
    ['clients', scoped('clients', 'id, organization_id, name, company, industry, status, owner_id, updated_at').order('company')],
    ['agencyClients', scoped('agency_clients', 'id, organization_id, canonical_client_id, name, legal_name, status, owner_id')],
    ['brands', scoped('brands', 'id, organization_id, client_id, name, status, is_default').order('name')],
    ['projects', scoped('projects', 'id, organization_id, client_id, name, engagement_type, status, health, owner_id, due_date, archived_at, updated_at').is('archived_at', null).order('updated_at', { ascending: false })],
    ['engagements', scoped('engagements', 'id, organization_id, client_id, brand_id, project_id, status')],
    ['tasks', scoped('tasks', 'id, organization_id, project_id, status, archived_at').is('archived_at', null)],
    ['workItems', scoped('work_items', 'id, organization_id, project_id, engagement_id, status, deleted_at').is('deleted_at', null)],
    ['memberships', scoped('organization_memberships', 'organization_id, user_id').eq('member_kind', 'team').eq('status', 'active')],
    ['profiles', supabase.from('profiles').select('id, full_name, email').abortSignal(signal)],
  ]
  const results = await Promise.all(requests.map(([, request]) => request))
  const snapshot = { organizationId }
  results.forEach((result, index) => {
    const name = requests[index][0]
    if (result.error) throw Object.assign(new Error('Unable to load Client Work ' + name + ': ' + result.error.message), {
      cause: result.error,
      status: result.status || result.error.status || result.error.statusCode,
    })
    const rows = result.data || []
    if (name !== 'profiles' && rows.some((row) => row.organization_id !== organizationId)) {
      throw Object.assign(new Error('Client Work data is stale for the active organization.'), { status: 409, membershipMismatch: true })
    }
    snapshot[name] = rows
  })
  return snapshot
}
