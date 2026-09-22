import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { isContextChatUuid, validateContextChatMessage, validateContextChatScope } from './contextChatScope.mjs'

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

async function ownedConversation(admin: Client, organizationId: string, actorId: string, conversationId: string) {
  if (!isContextChatUuid(conversationId)) throw fail('Conversation ID is required')
  const { data, error } = await admin.from('department_chat_conversations')
    .select('id, organization_id, context_kind, project_id, engagement_id, department_id, owner_id, title, state, next_sequence, last_activity_at, created_at')
    .eq('id', conversationId).eq('organization_id', organizationId).eq('owner_id', actorId)
    .in('context_kind', CONTEXT_KINDS).maybeSingle()
  if (error) throw error
  if (!data) throw fail('Conversation unavailable', 404)
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
      let query = admin.from('department_chat_conversations')
        .select('id, context_kind, project_id, department_id, owner_id, title, state, last_activity_at, created_at')
        .eq('organization_id', organizationId).eq('owner_id', actorId)
        .eq('context_kind', scope.context_kind)
      query = scope.project_id ? query.eq('project_id', scope.project_id) : query.is('project_id', null)
      query = scope.department_id ? query.eq('department_id', scope.department_id) : query.is('department_id', null)
      const { data, error } = await query.order('last_activity_at', { ascending: false }).limit(50)
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
  const conversation = await ownedConversation(admin, organizationId, actorId, string(body.conversation_id))
  await requireScopeAccess(admin, organizationId, activeMembership, conversation)
  if (action === 'get_context_conversation') {
    const { data, error } = await admin.from('department_chat_messages')
      .select('id, author_id, role, body, status, client_request_id, sequence, created_at, finished_at')
      .eq('organization_id', organizationId).eq('conversation_id', conversation.id)
      .order('sequence', { ascending: false }).limit(100)
    if (error) throw error
    const messages = (data || []).reverse()
    return { conversation, messages, has_older: messages.length === 100 && messages[0].sequence > 1 }
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
