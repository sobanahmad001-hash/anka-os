import { supabase } from '../lib/supabase.js'

const validId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const failure = (error, status, fallback) => Object.assign(new Error(error?.message || fallback), {
  cause: error, status: error?.code === '42501' ? 403 : status || undefined,
})

export function createProjectDiscussionRepository(client) {
  if (!client?.rpc) throw new TypeError('A Supabase client is required')
  return {
    async page(organizationId, projectId, cursor = null, { signal } = {}) {
      if (!validId(organizationId) || !validId(projectId)
        || (cursor && (!validId(cursor.id) || typeof cursor.created_at !== 'string'))) {
        throw new TypeError('Valid project and discussion cursor required')
      }
      let query = client.rpc('get_project_discussion', {
        p_organization_id: organizationId, p_project_id: projectId,
        p_before_created_at: cursor?.created_at || null, p_before_id: cursor?.id || null,
      })
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error, status } = await query
      if (error) throw failure(error, status, 'Unable to load project discussion')
      if (data?.organization_id !== organizationId || data.project_id !== projectId
        || !Array.isArray(data.messages) || typeof data.has_older !== 'boolean'
        || data.messages.some(row => !validId(row?.id) || !validId(row?.author_id)
          || typeof row.content !== 'string' || (row.parent_comment_id && !validId(row.parent_comment_id)))
        || (data.cursor && (!validId(data.cursor.id) || typeof data.cursor.created_at !== 'string'))) {
        throw Object.assign(new Error('Discussion did not match the active project'), { status: 409 })
      }
      return data
    },
    async post({ organizationId, projectId, requestId, content, parentCommentId = null }) {
      if (![organizationId, projectId, requestId].every(validId)
        || (parentCommentId && !validId(parentCommentId))
        || typeof content !== 'string' || !content.trim() || content.trim().length > 8000) {
        throw new TypeError('Valid project message required')
      }
      const { data, error, status } = await client.rpc('post_project_discussion_message', {
        p_organization_id: organizationId, p_project_id: projectId, p_request_id: requestId,
        p_content: content.trim(), p_parent_comment_id: parentCommentId,
      })
      if (error) throw failure(error, status, 'Unable to post project message')
      if (data?.organization_id !== organizationId || data.project_id !== projectId
        || data.request_id !== requestId || data.comment_id !== requestId) {
        throw Object.assign(new Error('Posted message did not match the selected project'), { status: 409 })
      }
      return data
    },
  }
}

export const projectDiscussionRepository = createProjectDiscussionRepository(supabase)
