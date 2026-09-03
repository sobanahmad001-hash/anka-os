import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Marketing Overview query failed'), { status: error.status ?? error.statusCode ?? error.context?.status })
  return data || []
}

export async function loadMarketingOverviewWork({ organizationId, engagement, signal, client = supabase }) {
  if (!organizationId || !engagement?.id || engagement.organization_id !== organizationId) throw Object.assign(new Error('Marketing Overview organization mismatch'), { status: 403, membershipMismatch: true })
  const options = { signal }
  const requests = [
    dataOrThrow(client.from('tasks').select('*').eq('organization_id', organizationId).eq('project_id', engagement.project_id).eq('department_id', 'marketing').is('archived_at', null).order('due_date'), options),
    dataOrThrow(client.from('work_items').select('*').eq('organization_id', organizationId).eq('engagement_id', engagement.id).eq('department_id', 'marketing').is('deleted_at', null).order('due_date'), options),
    dataOrThrow(client.from('artifact_approval_requests').select('id, organization_id, artifact_version_id, status, requested_by, created_at, artifact_versions!inner(id, version_number, artifact_id, artifacts!inner(id, title, artifact_type, engagement_id))').eq('organization_id', organizationId).eq('status', 'pending').eq('artifact_versions.artifacts.engagement_id', engagement.id).eq('artifact_versions.artifacts.artifact_type', 'campaign_brief').order('created_at'), options),
    dataOrThrow(client.from('organization_memberships').select('organization_id, user_id, member_kind, status').eq('organization_id', organizationId).eq('member_kind', 'team').eq('status', 'active'), options),
  ]
  const settled = await Promise.allSettled(requests)
  const [tasks, workItems, approvalRequests, memberships] = settled.map(item => item.status === 'fulfilled' ? item.value : [])
  if (settled[0].status === 'rejected' && settled[1].status === 'rejected' && settled[2].status === 'rejected') throw settled[0].reason
  const userIds = [...new Set(memberships.map(item => item.user_id).filter(Boolean))]
  const profiles = userIds.length ? await dataOrThrow(client.from('profiles').select('id, full_name, email').in('id', userIds), options) : []
  return { tasks, workItems, approvalRequests, memberships, profiles, sectionErrors: Object.freeze({ tasks: settled[0].status === 'rejected' ? settled[0].reason.message : '', workItems: settled[1].status === 'rejected' ? settled[1].reason.message : '', approvalRequests: settled[2].status === 'rejected' ? settled[2].reason.message : '' }) }
}
