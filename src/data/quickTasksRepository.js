import { supabase } from '../lib/supabase.js'
import { requireQuickTaskCopyResult } from './quickTaskCopy.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Quick Tasks query failed')
  return data
}

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('quick-tasks', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Quick Tasks function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

async function copyGeneralRequest(input) {
  const { data, error } = await supabase.functions.invoke('quick-tasks', { body: { action: 'copy_general', ...input } })
  if (error || data?.error) {
    throw Object.assign(new Error(data?.error || error?.message || 'Copy failed'), {
      status: error?.context?.status || error?.status || data?.status,
    })
  }
  return requireQuickTaskCopyResult(data?.data)
}

export const quickTasks = Object.freeze({
  copyGeneralRequest,
  list: organizationId => dataOrThrow(
    supabase.from('quick_tasks').select('*').eq('organization_id', organizationId).order('updated_at', { ascending: false })
  ),
  revision: revisionId => dataOrThrow(
    supabase.from('quick_task_revisions').select('*').eq('id', revisionId).single()
  ),
  messages: quickTaskId => dataOrThrow(
    supabase.from('quick_task_messages').select('*').eq('quick_task_id', quickTaskId).order('created_at')
  ),
  create: input => invoke('create', input),
  append: input => invoke('append', input),
  fork: input => invoke('fork', input),
  chat: input => invoke('chat', input),
  promotionOptions: async organizationId => {
    const [clients, engagements, services, artifacts, memberships, profiles] = await Promise.all([
      dataOrThrow(supabase.from('clients').select('id, name, status').eq('organization_id', organizationId).order('name')),
      dataOrThrow(supabase.from('engagements').select('id, name, project_id, brand_id, status').eq('organization_id', organizationId).order('name')),
      dataOrThrow(supabase.from('engagement_services').select('engagement_id, status, service_catalog(department_id, is_active)').eq('organization_id', organizationId).eq('status', 'active')),
      dataOrThrow(supabase.from('artifacts').select('id, title, artifact_type, engagement_id, project_id, brand_id').eq('organization_id', organizationId).order('title')),
      dataOrThrow(supabase.from('organization_memberships').select('user_id, department_id, role').eq('organization_id', organizationId).eq('member_kind', 'team').eq('status', 'active')),
      dataOrThrow(supabase.from('profiles').select('id, full_name, email')),
    ])
    const profileById = new Map((profiles || []).map(profile => [profile.id, profile]))
    const departmentsByEngagement = new Map()
    for (const service of services || []) {
      const catalog = Array.isArray(service.service_catalog) ? service.service_catalog[0] : service.service_catalog
      if (!catalog?.is_active || !catalog.department_id) continue
      const current = departmentsByEngagement.get(service.engagement_id) || []
      departmentsByEngagement.set(service.engagement_id, [...new Set([...current, catalog.department_id])])
    }
    return {
      clients: clients || [], artifacts: artifacts || [],
      engagements: (engagements || []).filter(item => item.project_id).map(item => ({
        ...item, active_departments: departmentsByEngagement.get(item.id) || [],
      })),
      members: (memberships || []).map(item => ({ ...item, profile: profileById.get(item.user_id) || null })),
    }
  },
  promote: input => invoke('promote', input),
  lifecycle: (action, quickTaskId) => invoke(action, { quickTaskId }),
})
