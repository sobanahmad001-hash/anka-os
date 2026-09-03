import { supabase } from '../lib/supabase'

export async function fetchPortfolioWorkspaceSnapshot(organizationId, { signal } = {}) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('organizationId is required')
  if (signal?.aborted) throw Object.assign(new Error('Workspace request aborted'), { name: 'AbortError' })

  function rows(result, name) {
    if (result.error) throw Object.assign(new Error(`Unable to load ${name}: ${result.error.message}`), {
      cause: result.error, status: result.status || result.error.status || result.error.statusCode,
    })
    const data = result.data || []
    const records = Array.isArray(data) ? data : [data]
    if (name !== 'profiles' && records.some(record => record.organization_id !== organizationId)) {
      throw Object.assign(new Error('Workspace record does not belong to the active organization.'), { status: 403, membershipMismatch: true })
    }
    return data
  }

const queries = {
  projects: () => supabase.from('projects').select('id, organization_id, client_id, name, engagement_type, status, health, owner_id, due_date, archived_at').eq('organization_id', organizationId).abortSignal(signal).is('archived_at', null),
  clients: () => supabase.from('clients').select('id, organization_id, name, company').eq('organization_id', organizationId).abortSignal(signal),
  brands: () => supabase.from('brands').select('id, organization_id, name').eq('organization_id', organizationId).abortSignal(signal),
  engagements: () => supabase.from('engagements').select('id, organization_id, project_id, brand_id, status').eq('organization_id', organizationId).abortSignal(signal),
  tasks: () => supabase.from('tasks').select('id, organization_id, project_id, department_id, status, due_date, archived_at').eq('organization_id', organizationId).abortSignal(signal).is('archived_at', null),
  workItems: () => supabase.from('work_items').select('id, organization_id, project_id, engagement_id, department_id, status, due_date, automation_flagged_at, deleted_at').eq('organization_id', organizationId).abortSignal(signal).is('deleted_at', null),
  stages: () => supabase.from('engagement_stage_instances').select('id, organization_id, engagement_id, accountable_department_id, status').eq('organization_id', organizationId).abortSignal(signal),
  milestones: () => supabase.from('milestones').select('id, organization_id, project_id, status, target_date, archived_at').eq('organization_id', organizationId).abortSignal(signal).is('archived_at', null),
  versions: () => supabase.from('deliverable_versions').select('id, organization_id, project_id, review_status, withdrawn_at').eq('organization_id', organizationId).abortSignal(signal).is('withdrawn_at', null).in('review_status', ['ready_for_internal_review', 'ready_for_client_review']),
  memberships: () => supabase.from('organization_memberships').select('organization_id, user_id').eq('organization_id', organizationId).abortSignal(signal).eq('member_kind', 'team').eq('status', 'active'),
  profiles: () => supabase.from('profiles').select('id, full_name, email').abortSignal(signal),
}

const names = Object.keys(queries)
  const results = await Promise.all(names.map((name) => queries[name]()))
  return Object.fromEntries(results.map((result, index) => [names[index], rows(result, names[index])]))

}
