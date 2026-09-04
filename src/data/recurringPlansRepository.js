import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Recurring plans query failed')
  return data
}

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('recurring-plans', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Recurring plans function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const recurringPlans = Object.freeze({
  list: engagementId => dataOrThrow(
    supabase.from('recurring_work_plans').select('*')
      .eq('engagement_id', engagementId).order('created_at').order('id')
  ),
  listVersions: planId => dataOrThrow(
    supabase.from('recurring_work_plan_versions').select('*')
      .eq('plan_id', planId).order('version_number')
  ),
  listTemplateItems: versionId => dataOrThrow(
    supabase.from('recurring_work_plan_template_items').select('*')
      .eq('plan_version_id', versionId).order('position').order('id')
  ),
  listApprovals: planId => dataOrThrow(
    supabase.from('recurring_work_plan_version_approvals').select('*')
      .eq('plan_id', planId).order('approved_at').order('id')
  ),
  listOccurrences: planId => dataOrThrow(
    supabase.from('recurring_work_occurrences').select('*')
      .eq('plan_id', planId).order('period_start').order('id')
  ),
  listGenerationAttempts: planId => dataOrThrow(
    supabase.from('recurring_work_generation_attempts').select('*')
      .eq('plan_id', planId).order('requested_at').order('id')
  ),
  listGeneratedWork: planId => dataOrThrow(
    supabase.from('work_items').select(
      'id, organization_id, project_id, engagement_id, title, status, priority, assignee_id, start_date, due_date, created_via, recurring_occurrence_id, recurring_plan_id, recurring_plan_version_id, recurring_template_key, deleted_at',
    ).eq('recurring_plan_id', planId).is('deleted_at', null).order('position').order('id')
  ),
  listTeamMemberships: organizationId => dataOrThrow(
    supabase.from('organization_memberships')
      .select('organization_id, user_id, member_kind, status, department_id')
      .eq('organization_id', organizationId).eq('member_kind', 'team')
  ),
  create: input => invoke('create_plan', input),
  createVersion: input => invoke('create_version', input),
  approveVersion: (planId, planVersionId, approvalNote = '') =>
    invoke('approve_version', { planId, planVersionId, approvalNote }),
  reassignTemplateItem: (planId, templateKey, assigneeId = null) =>
    invoke('reassign_template_item', { planId, templateKey, assigneeId }),
  transition: (planId, status, reason = '', impact = '') =>
    invoke('transition_plan', { planId, status, reason, impact }),
  previewPeriod: (planId, periodStart, pastPeriodReason = '') =>
    invoke('preview_period', { planId, periodStart, pastPeriodReason }),
  previewMonth: (planId, monthStart, pastPeriodReason = '') =>
    invoke('preview_month', { planId, monthStart, pastPeriodReason }),
  confirmPeriod: (planId, periodStart, requestKey, pastPeriodReason = '') =>
    invoke('confirm_period', { planId, periodStart, requestKey, pastPeriodReason }),
})
