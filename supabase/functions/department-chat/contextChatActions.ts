import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { isContextChatUuid, validateContextChatListOffset, validateContextChatMessage, validateContextChatScope } from './contextChatScope.mjs'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>
const LEADERS = new Set(['system_owner', 'operations_admin', 'executive'])
const CONTEXT_KINDS = ['organization', 'department_private', 'project_team']
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status })
const string = (value: unknown) => typeof value === 'string' ? value.trim() : ''

async function requireScopeAccess(admin: Client, organizationId: string, membership: Json, scope: Json) {
  if (scope.context_kind === 'department_private') {
    if (LEADERS.has(string(membership.role)) || membership.department_id === scope.department_id) return
    const { data, error } = await admin.from('organization_department_memberships')
      .select('id').eq('organization_id', organizationId)
      .eq('user_id', membership.user_id).eq('department_id', scope.department_id)
      .eq('status', 'active').maybeSingle()
    if (error) throw error
    if (!data) throw fail('Private Workshop department access required', 403)
  }
  if (scope.context_kind === 'project_team') {
    const { data, error } = await admin.from('projects')
      .select('id').eq('id', scope.project_id).eq('organization_id', organizationId)
      .is('archived_at', null).maybeSingle()
    if (error) throw error
    if (!data) throw fail('Active project access required', 403)
  }
}

async function accessibleConversation(admin: Client, organizationId: string, actorId: string, conversationId: string) {
  if (!isContextChatUuid(conversationId)) throw fail('Conversation ID is required')
  const { data, error } = await admin.from('department_chat_conversations')
    .select('id, organization_id, context_kind, project_id, engagement_id, department_id, owner_id, title, state, next_sequence, last_activity_at, created_at')
    .eq('id', conversationId).eq('organization_id', organizationId)
    .in('context_kind', CONTEXT_KINDS).maybeSingle()
  if (error) throw error
  if (!data) throw fail('Conversation unavailable', 404)
  if (data.owner_id !== actorId) {
    if (data.context_kind !== 'project_team') throw fail('Conversation unavailable', 404)
    const { data: share, error: shareError } = await admin.from('project_context_chat_shares')
      .select('conversation_id').eq('conversation_id', data.id)
      .eq('organization_id', organizationId).eq('project_id', data.project_id)
      .eq('recipient_id', actorId).is('revoked_at', null).maybeSingle()
    if (shareError) throw shareError
    if (!share) throw fail('Conversation unavailable', 404)
  }
  return data
}

export async function contextChatAction(
  action: string, admin: Client, body: Json, actorId: string,
  organizationId: string, membership: Json,
) {
  const activeMembership = { ...membership, user_id: actorId }
  if (action === 'create_context_conversation' || action === 'list_context_conversations') {
    const scope = validateContextChatScope(body)
    await requireScopeAccess(admin, organizationId, activeMembership, scope)
    if (action === 'list_context_conversations') {
      const offset = validateContextChatListOffset(body.offset)
      if (scope.context_kind === 'project_team') {
        const { data, error } = await admin.rpc('list_project_context_chat_conversations', {
          p_organization_id: organizationId, p_project_id: scope.project_id,
          p_actor_id: actorId, p_offset: offset,
        })
        if (error) throw error
        return (data || []).map((row: Json) => ({
          id: row.id, context_kind: row.context_kind, project_id: row.project_id,
          department_id: row.department_id, owner_id: row.owner_id, title: row.title,
          state: row.state, last_activity_at: row.last_activity_at, created_at: row.created_at,
        }))
      }
      let query = admin.from('department_chat_conversations')
        .select('id, context_kind, project_id, department_id, owner_id, title, state, last_activity_at, created_at')
        .eq('organization_id', organizationId).eq('owner_id', actorId)
        .eq('context_kind', scope.context_kind)
      query = scope.project_id ? query.eq('project_id', scope.project_id) : query.is('project_id', null)
      query = scope.department_id ? query.eq('department_id', scope.department_id) : query.is('department_id', null)
      const { data, error } = await query.order('last_activity_at', { ascending: false })
        .order('id', { ascending: false }).range(offset, offset + 50)
      if (error) throw error
      return data || []
    }
    const title = string(body.title)
    if (title.length > 160) throw fail('Conversation title is too long')
    const { data, error } = await admin.from('department_chat_conversations')
      .insert({ ...scope, organization_id: organizationId, owner_id: actorId,
        title: title || 'New conversation' }).select('id, context_kind, project_id, department_id, title, state, created_at').single()
    if (error) throw error
    return data
  }
  const conversation = await accessibleConversation(admin, organizationId, actorId, string(body.conversation_id))
  await requireScopeAccess(admin, organizationId, activeMembership, conversation)
  if (action === 'get_project_context_sharing' || action === 'set_project_context_sharing') {
    if (conversation.context_kind !== 'project_team' || conversation.owner_id !== actorId) {
      throw fail('Only the project conversation creator can manage sharing', 403)
    }
    if (action === 'set_project_context_sharing') {
      if (!Array.isArray(body.recipient_ids) || body.recipient_ids.length > 50
        || body.recipient_ids.some(id => !isContextChatUuid(id))) {
        throw fail('Choose up to 50 valid recipient IDs')
      }
      const { data, error } = await admin.rpc('set_project_context_chat_shares', {
        p_conversation_id: conversation.id, p_organization_id: organizationId,
        p_actor_id: actorId, p_recipient_ids: body.recipient_ids,
      })
      if (error) throw error
      return data
    }
    const [{ data: memberships, error: memberError }, { data: shares, error: shareError }] =
      await Promise.all([
        admin.from('organization_memberships').select('user_id,role')
          .eq('organization_id', organizationId).eq('member_kind', 'team')
          .eq('status', 'active').neq('user_id', actorId),
        admin.from('project_context_chat_shares').select('recipient_id,shared_at')
          .eq('conversation_id', conversation.id).eq('organization_id', organizationId)
          .is('revoked_at', null),
      ])
    if (memberError) throw memberError
    if (shareError) throw shareError
    const ids = (memberships || []).map(member => member.user_id)
    const { data: profiles, error: profileError } = ids.length
      ? await admin.from('profiles').select('id,full_name').in('id', ids)
      : { data: [], error: null }
    if (profileError) throw profileError
    const names = new Map((profiles || []).map(profile => [profile.id, profile]))
    return {
      candidates: (memberships || []).map(member => ({
        id: member.user_id, role: member.role,
        full_name: names.get(member.user_id)?.full_name || '',
      })).sort((a, b) => String(a.full_name || a.id)
        .localeCompare(String(b.full_name || b.id))),
      recipients: shares || [],
    }
  }
  if (action === 'get_context_conversation') {
    const before = body.before_sequence
    if (before !== undefined && (!Number.isSafeInteger(before) || Number(before) < 2)) {
      throw fail('Conversation page cursor is invalid')
    }
    let query = admin.from('department_chat_messages')
      .select('id, author_id, role, body, status, client_request_id, sequence, created_at, finished_at, in_reply_to_message_id')
      .eq('organization_id', organizationId).eq('conversation_id', conversation.id)
    if (before !== undefined) query = query.lt('sequence', before)
    const { data, error } = await query.order('sequence', { ascending: false }).limit(101)
    if (error) throw error
    const rows = data || []
    return { conversation, messages: rows.slice(0, 100).reverse(), has_older: rows.length > 100 }
  }
  if (action === 'append_context_human_message') {
    const requestId = string(body.client_request_id)
    if (!isContextChatUuid(requestId)) throw fail('Message request ID is required')
    const message = validateContextChatMessage(body.message)
    const { data, error } = await admin.rpc('append_context_chat_human_message', {
      p_conversation_id: conversation.id, p_organization_id: organizationId,
      p_actor_id: actorId, p_request_id: requestId, p_body: message,
    })
    if (error) throw error
    return data
  }
  throw fail('Unsupported context conversation action')
}
