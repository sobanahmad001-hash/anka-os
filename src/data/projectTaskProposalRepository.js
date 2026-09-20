import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const errorFrom = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})

export function createProjectTaskProposalRepository(client) {
  if (!client?.from || !client?.rpc || !client?.functions?.invoke) throw new TypeError('Supabase client required')
  return {
    async list(organizationId, projectId, { signal } = {}) {
      if (!validId(organizationId) || !validId(projectId)) throw new TypeError('Valid project required')
      let query = client.from('project_task_change_proposals').select('*')
        .eq('organization_id', organizationId).eq('project_id', projectId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error } = await query
      if (error) throw errorFrom(error, 'Unable to load proposals')
      if (!Array.isArray(data) || data.some(item => item.organization_id !== organizationId
        || item.project_id !== projectId || !validId(item.id) || !validId(item.task_id))) {
        throw Object.assign(new Error('Proposals did not match the active project'), { status: 409 })
      }
      return data
    },
    async create(input) {
      const { organizationId, projectId, proposalId, taskId, expectedRowVersion,
        beforeStatus, proposedStatus, rationale, impact, costNote, sourceCommentId = null,
        supersedesId = null } = input
      if (![organizationId, projectId, proposalId, taskId].every(validId)
        || (sourceCommentId && !validId(sourceCommentId)) || (supersedesId && !validId(supersedesId))
        || !Number.isSafeInteger(expectedRowVersion) || expectedRowVersion < 1
        || !beforeStatus || !proposedStatus || !rationale?.trim() || !impact?.trim() || !costNote?.trim()) {
        throw new TypeError('Complete project task proposal required')
      }
      const { data, error } = await client.rpc('create_project_task_change_proposal', {
        p_organization_id: organizationId, p_project_id: projectId, p_proposal_id: proposalId,
        p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_before_status: beforeStatus,
        p_proposed_status: proposedStatus, p_rationale: rationale.trim(), p_impact: impact.trim(),
        p_cost_note: costNote.trim(), p_source_comment_id: sourceCommentId, p_supersedes_id: supersedesId,
      })
      if (error) throw errorFrom(error, 'Unable to create proposal')
      if (data?.id !== proposalId || data.organization_id !== organizationId || data.project_id !== projectId
        || data.task_id !== taskId) throw Object.assign(new Error('Proposal did not match the target task'), { status: 409 })
      return data
    },
    async decide({ organizationId, projectId, proposalId, decision }) {
      if (![organizationId, projectId, proposalId].every(validId) || !['approve', 'reject'].includes(decision)) {
        throw new TypeError('Valid proposal decision required')
      }
      const { data, error } = await client.functions.invoke('work-items', { body: {
        action: 'decide_project_task_change_proposal', organizationId, projectId, proposalId, decision,
      } })
      if (error) throw errorFrom(error, 'Unable to decide proposal')
      if (data?.error) throw errorFrom(typeof data.error === 'string' ? { message: data.error } : data.error, 'Unable to decide proposal')
      const result = data?.data
      if (result?.id !== proposalId || result.organization_id !== organizationId
        || result.project_id !== projectId || !['applied', 'approved_failed', 'rejected'].includes(result.status)) {
        throw Object.assign(new Error('Decision did not match the active proposal'), { status: 409 })
      }
      return result
    },
  }
}

export const projectTaskProposalRepository = createProjectTaskProposalRepository(supabase)
