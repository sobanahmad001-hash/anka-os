import { supabase } from '../lib/supabase'

const EMPTY = { data: [], error: null }

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`)
}

export async function fetchClientWorkspaceSnapshot(clientId, organizationId, { signal } = {}) {
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

  function row(result, name) {
    rows(result, name)
    return result.data && !Array.isArray(result.data) ? result.data : null
  }

required(clientId, 'Client id')
  const client = row(await supabase.from('clients').select('id, organization_id, name, company, email, industry, status, notes, owner_id, created_at, updated_at').eq('organization_id', organizationId).abortSignal(signal).eq('id', clientId).single(), 'client')
  if (!client) throw Object.assign(new Error('Client unavailable in the active organization.'), { status: 404 })
  const [agencyClientResult, projectsResult, contactsResult, membershipsResult, profilesResult] = await Promise.all([
    supabase.from('agency_clients').select('id, organization_id, canonical_client_id, name, legal_name, primary_email, website_url, industry, status, owner_id').eq('organization_id', organizationId).abortSignal(signal).eq('canonical_client_id', clientId).eq('organization_id', organizationId).maybeSingle(),
    supabase.from('projects').select('id, organization_id, client_id, name, description, engagement_type, status, priority, health, owner_id, start_date, due_date, progress, portal_visible, client_summary, archived_at').eq('organization_id', organizationId).abortSignal(signal).eq('client_id', clientId).eq('organization_id', organizationId).is('archived_at', null).order('updated_at', { ascending: false }),
    supabase.from('client_contacts').select('id, organization_id, client_id, full_name, email, portal_role, status, created_at').eq('organization_id', organizationId).abortSignal(signal).eq('client_id', clientId).eq('organization_id', organizationId).order('created_at'),
    supabase.from('organization_memberships').select('organization_id, user_id').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).eq('member_kind', 'team').eq('status', 'active'),
    supabase.from('profiles').select('id, full_name, email').abortSignal(signal),
  ])
  const agencyClient = row(agencyClientResult, 'agency-client extension')
  const projects = rows(projectsResult, 'projects')
  const projectIds = projects.map((project) => project.id)
  const projectQuery = (factory) => projectIds.length ? factory() : Promise.resolve(EMPTY)
  const [brands, engagements, access, tasks, workItems, milestones, requests, deliverables, versions, releases] = await Promise.all([
    agencyClient ? supabase.from('brands').select('id, organization_id, client_id, name, description, website_url, status, is_default').eq('organization_id', organizationId).abortSignal(signal).eq('client_id', agencyClient.id).eq('organization_id', organizationId).order('name') : Promise.resolve(EMPTY),
    agencyClient && projectIds.length ? supabase.from('engagements').select('id, organization_id, client_id, brand_id, project_id, name, engagement_type, objective, status, lead_owner_id, start_date, target_date').eq('organization_id', organizationId).abortSignal(signal).eq('client_id', agencyClient.id).eq('organization_id', organizationId).in('project_id', projectIds) : Promise.resolve(EMPTY),
    projectQuery(() => supabase.from('project_client_access').select('id, organization_id, project_id, client_contact_id, access_role, status, created_at').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).in('project_id', projectIds)),
    projectQuery(() => supabase.from('tasks').select('id, organization_id, project_id, title, status, priority, assigned_to, due_date, archived_at').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).in('project_id', projectIds).is('archived_at', null).order('due_date', { nullsFirst: false })),
    projectQuery(() => supabase.from('work_items').select('id, organization_id, project_id, engagement_id, title, status, priority, assignee_id, due_date, deleted_at').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).in('project_id', projectIds).is('deleted_at', null).order('due_date', { nullsFirst: false })),
    projectQuery(() => supabase.from('milestones').select('id, organization_id, project_id, name, status, owner_id, target_date, archived_at').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).in('project_id', projectIds).is('archived_at', null).order('target_date', { nullsFirst: false })),
    projectQuery(() => supabase.from('requests').select('id, organization_id, project_id, title, request_type, request_origin, status, priority, owner_id, required_by, archived_at').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).in('project_id', projectIds).is('archived_at', null).order('required_by', { nullsFirst: false })),
    projectQuery(() => supabase.from('deliverables').select('id, organization_id, project_id, title, status, owner_id, due_date, client_released_version_id, archived_at').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).in('project_id', projectIds).is('archived_at', null).order('due_date', { nullsFirst: false })),
    projectQuery(() => supabase.from('deliverable_versions').select('id, organization_id, project_id, deliverable_id, version_number, title, review_status, client_released_at, withdrawn_at, created_at').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).in('project_id', projectIds).is('withdrawn_at', null).order('created_at', { ascending: false })),
    projectQuery(() => supabase.from('client_portal_items').select('id, organization_id, project_id, source_type, source_id, item_type, title, summary, status, released_at, withdrawn_at').eq('organization_id', organizationId).abortSignal(signal).eq('organization_id', organizationId).in('project_id', projectIds).is('withdrawn_at', null).order('released_at', { ascending: false })),
  ])
  return {
    client, agencyClient, projects, contacts: rows(contactsResult, 'contacts'), memberships: rows(membershipsResult, 'memberships'), profiles: rows(profilesResult, 'profiles'),
    brands: rows(brands, 'brands'), engagements: rows(engagements, 'engagement extensions'), access: rows(access, 'project access'), tasks: rows(tasks, 'Project Tasks'), workItems: rows(workItems, 'Engagement Work Items'),
    milestones: rows(milestones, 'milestones'), requests: rows(requests, 'requests'), deliverables: rows(deliverables, 'deliverables'), versions: rows(versions, 'deliverable versions'), releases: rows(releases, 'client releases'),
  }

}
