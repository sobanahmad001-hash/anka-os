import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Work Items query failed')
  return data
}

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('work-items', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Work Items function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const workItems = Object.freeze({
  list: engagementId => dataOrThrow(
    supabase.from('work_items')
      .select('*')
      .eq('engagement_id', engagementId)
      .is('deleted_at', null)
      .order('position')
      .order('created_at')
  ),
  listDependencies: workItemIds => workItemIds.length ? dataOrThrow(
    supabase.from('work_item_dependencies')
      .select('*')
      .in('work_item_id', workItemIds)
      .order('created_at')
  ) : Promise.resolve([]),
  save: input => invoke('save', input),
  remove: workItemId => invoke('delete', { workItemId }),
  addDependency: (workItemId, dependsOnWorkItemId) => invoke('add_dependency', { workItemId, dependsOnWorkItemId }),
  removeDependency: (workItemId, dependsOnWorkItemId) => invoke('remove_dependency', { workItemId, dependsOnWorkItemId }),
  acknowledgeAutomationFlag: workItemId => invoke('acknowledge_automation_flag', { workItemId }),
  generateContentTasks: engagementId => invoke('generate_content_tasks', { engagementId }),
  listAutomationRules: organizationId => dataOrThrow(
    supabase.from('automation_rules')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at')
      .order('id')
  ),
  async createAutomationRule(input) {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) throw new Error('Authentication required')
    return dataOrThrow(
      supabase.from('automation_rules').insert({
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
    supabase.from('automation_rules').update({ enabled }).eq('id', ruleId).select().single()
  ),
})
