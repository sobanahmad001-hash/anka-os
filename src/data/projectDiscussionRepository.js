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
          || typeof row.content !== 'string' || (row.parent_comment_id && !validId(row.parent_comment_id))
          || (row.links && (!Array.isArray(row.links) || row.links.some(link =>
            !['member', 'project_task', 'deliverable_version', 'file'].includes(link?.kind)
            || !validId(link?.id) || typeof link.available !== 'boolean'
            || (link.available && typeof link.label !== 'string')
            || (!link.available && link.label !== null)))))
        || (data.cursor && (!validId(data.cursor.id) || typeof data.cursor.created_at !== 'string'))) {
        throw Object.assign(new Error('Discussion did not match the active project'), { status: 409 })
      }
      return data
    },
    async referenceOptions(organizationId, projectId, { signal } = {}) {
      if (!validId(organizationId) || !validId(projectId)) throw new TypeError('Valid project required')
      let query = client.rpc('get_project_discussion_reference_options', {
        p_organization_id: organizationId, p_project_id: projectId,
      })
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
      const { data, error, status } = await query
      if (error) throw failure(error, status, 'Unable to load project reference options')
      if (data?.organization_id !== organizationId || data.project_id !== projectId
        || !Array.isArray(data.options) || data.options.some(row =>
          !['member', 'project_task', 'deliverable_version', 'file'].includes(row?.kind)
          || !validId(row?.id) || typeof row.label !== 'string')) {
        throw Object.assign(new Error('Reference options did not match the active project'), { status: 409 })
      }
      return data.options
    },
    async post({ organizationId, projectId, requestId, content, parentCommentId = null, links = [] }) {
      if (![organizationId, projectId, requestId].every(validId)
        || (parentCommentId && !validId(parentCommentId))
        || typeof content !== 'string' || !content.trim() || content.trim().length > 8000
        || !Array.isArray(links) || links.length > 10 || links.some(link =>
          !['member', 'project_task', 'deliverable_version', 'file'].includes(link?.kind)
          || !validId(link?.id))
        || new Set(links.map(link => `${link.kind}:${link.id}`)).size !== links.length) {
        throw new TypeError('Valid project message required')
      }
      const { data, error, status } = await client.rpc('post_project_discussion_message_with_links', {
        p_organization_id: organizationId, p_project_id: projectId, p_request_id: requestId,
        p_content: content.trim(), p_parent_comment_id: parentCommentId, p_links: links,
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
