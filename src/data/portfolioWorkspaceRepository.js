import { supabase } from '../lib/supabase'

const queries = {
  projects: () => supabase.from('projects').select('id, organization_id, client_id, name, engagement_type, status, health, owner_id, due_date, archived_at').is('archived_at', null),
  clients: () => supabase.from('clients').select('id, organization_id, name, company'),
  brands: () => supabase.from('brands').select('id, organization_id, name'),
  engagements: () => supabase.from('engagements').select('id, organization_id, project_id, brand_id, status'),
  tasks: () => supabase.from('tasks').select('id, organization_id, project_id, department_id, status, due_date, archived_at').is('archived_at', null),
  workItems: () => supabase.from('work_items').select('id, organization_id, project_id, engagement_id, department_id, status, due_date, automation_flagged_at, deleted_at').is('deleted_at', null),
  stages: () => supabase.from('engagement_stage_instances').select('id, organization_id, engagement_id, accountable_department_id, status'),
  milestones: () => supabase.from('milestones').select('id, organization_id, project_id, status, target_date, archived_at').is('archived_at', null),
  versions: () => supabase.from('deliverable_versions').select('id, organization_id, project_id, review_status, withdrawn_at').is('withdrawn_at', null).in('review_status', ['ready_for_internal_review', 'ready_for_client_review']),
  memberships: () => supabase.from('organization_memberships').select('organization_id, user_id').eq('member_kind', 'team').eq('status', 'active'),
  profiles: () => supabase.from('profiles').select('id, full_name, email'),
}

function unwrap(result, name) {
  if (result.error) throw new Error(`Unable to load portfolio ${name}: ${result.error.message}`)
  return result.data || []
}

export async function fetchPortfolioWorkspaceSnapshot() {
  const names = Object.keys(queries)
  const results = await Promise.all(names.map((name) => queries[name]()))
  return Object.fromEntries(results.map((result, index) => [names[index], unwrap(result, names[index])]))
}
