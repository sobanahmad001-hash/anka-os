import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Proofing query failed')
  return data
}

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('proofing-layer', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Proofing action failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

function targetInput(targetKind, versionId) {
  if (targetKind === 'artifact') return { artifact_version_id: versionId }
  if (targetKind === 'design_direction') return { design_direction_version_id: versionId }
  throw new Error('Unsupported proofing target')
}

export const proofing = Object.freeze({
  async list(targetKind, versionId) {
    const targetColumn = targetKind === 'artifact' ? 'artifact_version_id' : 'design_direction_version_id'
    const comments = await dataOrThrow(supabase.from('artifact_version_comments')
      .select('*').eq(targetColumn, versionId).order('created_at'))
    const userIds = [...new Set(comments.flatMap(item => [item.author_id, item.resolved_by]).filter(Boolean))]
    const profiles = userIds.length
      ? await dataOrThrow(supabase.from('profiles').select('id, full_name, email').in('id', userIds))
      : []
    const byUser = new Map(profiles.map(profile => [profile.id, profile]))
    return comments.map(comment => ({
      ...comment,
      author: byUser.get(comment.author_id) || null,
      resolver: byUser.get(comment.resolved_by) || null,
    }))
  },

  add: (targetKind, versionId, body, commentPosition = null) => invoke('add_comment', {
    ...targetInput(targetKind, versionId), body, comment_position: commentPosition,
  }),

  resolve: commentId => invoke('resolve_comment', { comment_id: commentId }),
})
