import { supabase } from '../lib/supabase.js'
import { readOrganizationRows } from './workItemsScope.js'
export { isCurrentWorkItemsRequest } from './workItemsScope.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Work Items query failed')
  return data
}

async function invoke(client, action, input) {
  const { data, error } = await client.functions.invoke('work-items', {
    body: { action, ...input },
  })
  if (error) {
    let payload = null
    try { payload = await error.context?.json?.() } catch { /* preserve transport error */ }
    const stale = payload?.error?.code === 'stale_write' ? payload.error : null
    if (stale) throw Object.assign(new Error('This record changed elsewhere. Reload the current version before deliberately reapplying your change.'), stale, { status: 409, stale: true })
    throw Object.assign(new Error(error.message || 'Work Items function failed'), { status: error.context?.status || error.status })
  }
  if (data?.error) {
    const stale = data.error?.code === 'stale_write' ? data.error : null
    throw Object.assign(new Error(stale ? 'This record changed elsewhere. Reload the current version before deliberately reapplying your change.' : data.error.message || data.error), data.error, stale ? { status: 409, stale: true } : {})
  }
  return data?.data
}

export function createWorkItemsRepository(client) {
  return Object.freeze({
  list: (organizationId, engagementId, { signal } = {}) => {
    if (!organizationId || !engagementId) return Promise.resolve([])
    return readOrganizationRows(organizationId, () => client.from('work_items')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('engagement_id', engagementId)
      .is('deleted_at', null)
      .order('position')
      .order('created_at'), { signal, label: 'Work Items' })
  },
  listDependencies: (organizationId, workItemIds, { signal } = {}) => organizationId && workItemIds.length ? readOrganizationRows(organizationId, () => client.from('work_item_dependencies')
      .select('*')
      .eq('organization_id', organizationId)
      .in('work_item_id', workItemIds)
      .order('created_at'), { signal, label: 'Work Item dependencies' }) : Promise.resolve([]),
  save: input => invoke(client, 'save', input),
  remove: (organizationId, workItemId, expectedRowVersion) => invoke(client, 'delete', { organizationId, workItemId, expectedRowVersion }),
  addDependency: (organizationId, workItemId, dependsOnWorkItemId, expectedRowVersion) => invoke(client, 'add_dependency', { organizationId, workItemId, dependsOnWorkItemId, expectedRowVersion }),
  removeDependency: (organizationId, workItemId, dependsOnWorkItemId, expectedRowVersion) => invoke(client, 'remove_dependency', { organizationId, workItemId, dependsOnWorkItemId, expectedRowVersion }),
  acknowledgeAutomationFlag: (organizationId, workItemId, expectedRowVersion) => invoke(client, 'acknowledge_automation_flag', { organizationId, workItemId, expectedRowVersion }),
  move: (organizationId, workItemId, expectedRowVersion, targetStatus, beforeWorkItemId = null) => invoke(client, 'move', { organizationId, workItemId, expectedRowVersion, targetStatus, beforeWorkItemId }),
  generateContentTasks: (organizationId, engagementId) => invoke(client, 'generate_content_tasks', { organizationId, engagementId }),
  listAutomationRules: organizationId => dataOrThrow(
    client.from('automation_rules')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at')
      .order('id')
  ),
  async createAutomationRule(input) {
    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) throw new Error('Authentication required')
    return dataOrThrow(
      client.from('automation_rules').insert({
        organization_id: input.organizationId,
        name: input.name.trim(),
        trigger_type: input.triggerType,
        condition_status: input.triggerType === 'due_date_arrived' ? input.conditionStatus?.trim() || null : null,
        action_type: input.actionType,
        action_target_status: input.actionType === 'move_status' ? input.actionTargetStatus : null,
        enabled: input.triggerType !== 'due_date_arrived',
        created_by: user.id,
      }).select().single()
    )
  },
  toggleAutomationRule: (ruleId, enabled) => dataOrThrow(
    client.from('automation_rules').update({ enabled }).eq('id', ruleId).select().single()
  ),
  })
}

export const workItems = createWorkItemsRepository(supabase)
