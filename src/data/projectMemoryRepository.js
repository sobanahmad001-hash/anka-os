import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const failure = (error, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : undefined,
})
const scoped = (data, organizationId, projectId) => data?.organization_id === organizationId
  && data?.project_id === projectId

export function createProjectMemoryRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async list(organizationId, projectId, { signal } = {}) {
      if (!validId(organizationId) || !validId(projectId)) throw new TypeError('Valid project required')
      let query = client.rpc('get_project_ai_memory', {
        p_organization_id: organizationId, p_project_id: projectId,
      })
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error } = await query
      if (error) throw failure(error, 'Unable to load project memory')
      if (!scoped(data, organizationId, projectId)
        || !Array.isArray(data.confirmed) || !Array.isArray(data.candidates)
        || [...data.confirmed, ...data.candidates].some(row =>
          !validId(row?.id) || !validId(row?.source_comment_id)
          || typeof row?.statement !== 'string')) {
        throw Object.assign(new Error('Memory did not match the active project'), { status: 409 })
      }
      return data
    },
    async propose({ organizationId, projectId, requestId, sourceCommentId, statement, supersedesId = null }) {
      if (![organizationId, projectId, requestId, sourceCommentId].every(validId)
        || (supersedesId && !validId(supersedesId))
        || typeof statement !== 'string' || !statement.trim()
        || statement.trim().length > 1000) throw new TypeError('Valid sourced lesson required')
      const { data, error } = await client.rpc('propose_project_ai_memory', {
        p_organization_id: organizationId, p_project_id: projectId,
        p_request_id: requestId, p_source_comment_id: sourceCommentId,
        p_statement: statement.trim(), p_supersedes_id: supersedesId,
      })
      if (error) throw failure(error, 'Unable to propose project memory')
      if (data?.memory_id !== requestId || !['candidate', 'confirmed', 'rejected', 'superseded', 'retired'].includes(data.status)) {
        throw Object.assign(new Error('Lesson receipt did not match the request'), { status: 409 })
      }
      return data
    },
    async review({ organizationId, projectId, memoryId, requestId, decision, evidence }) {
      if (![organizationId, projectId, memoryId, requestId].every(validId)
        || !['confirm', 'reject', 'retire'].includes(decision)
        || typeof evidence !== 'string' || !evidence.trim()
        || evidence.trim().length > 1000) throw new TypeError('Valid memory decision required')
      const { data, error } = await client.rpc('review_project_ai_memory', {
        p_organization_id: organizationId, p_project_id: projectId,
        p_memory_id: memoryId, p_request_id: requestId,
        p_decision: decision, p_evidence: evidence.trim(),
      })
      if (error) throw failure(error, 'Unable to review project memory')
      if (data?.memory_id !== memoryId
        || data.status !== ({ confirm: 'confirmed', reject: 'rejected', retire: 'retired' })[decision]) {
        throw Object.assign(new Error('Memory decision did not match the request'), { status: 409 })
      }
      return data
    },
  }
}

export const projectMemoryRepository = createProjectMemoryRepository(supabase)
