-- Atomic, idempotent human turns for the new canonical conversation contexts.
-- Only the authenticated Edge function's service client may call this function.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.append_context_chat_human_message(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_body text
) returns public.department_chat_messages
language plpgsql security invoker set search_path = ''
as $$
declare
  v_conversation public.department_chat_conversations;
  v_existing public.department_chat_messages;
  v_message public.department_chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_membership public.organization_memberships;
begin
  if p_request_id is null or length(v_body) not between 1 and 8000 then
    raise exception 'Human message and request ID are required.' using errcode = '22023';
  end if;
  select * into v_conversation
  from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.owner_id = p_actor_id
    and conversation.context_kind in ('organization', 'department_private', 'project_team')
  for update;
  if not found then
    raise exception 'Conversation is unavailable.' using errcode = '42501';
  end if;
  select * into v_membership
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_id
    and membership.member_kind = 'team' and membership.status = 'active';
  if not found then
    raise exception 'Active team membership required.' using errcode = '42501';
  end if;
  if v_conversation.context_kind = 'department_private'
    and v_membership.department_id is distinct from v_conversation.department_id
    and not coalesce(v_membership.role in ('system_owner', 'operations_admin', 'executive'), false) then
    raise exception 'Department access changed.' using errcode = '42501';
  end if;
  if v_conversation.context_kind = 'project_team' and not exists (
    select 1 from public.projects project
    where project.id = v_conversation.project_id
      and project.organization_id = p_organization_id
      and project.archived_at is null
  ) then
    raise exception 'Project is unavailable.' using errcode = '42501';
  end if;

  select * into v_existing from public.department_chat_messages message
  where message.conversation_id = p_conversation_id
    and message.client_request_id = p_request_id and message.role = 'user';
  if found then
    if v_existing.organization_id is distinct from p_organization_id
      or v_existing.author_id is distinct from p_actor_id
      or v_existing.body is distinct from v_body
      or v_existing.status <> 'completed'
      or v_existing.ai_run_id is not null then
      raise exception 'Request ID already used with different message inputs.' using errcode = '23505';
    end if;
    return v_existing;
  end if;
  if v_conversation.state <> 'active' then
    raise exception 'Reopen the conversation before sending.' using errcode = '23514';
  end if;
  insert into public.department_chat_messages (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, author_id, role, body, status, client_request_id, sequence, finished_at
  ) values (
    v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id, v_conversation.owner_id,
    p_actor_id, 'user', v_body, 'completed', p_request_id, v_conversation.next_sequence, now()
  ) returning * into v_message;
  update public.department_chat_conversations
  set next_sequence = next_sequence + 1, last_activity_at = now(), updated_at = now()
  where id = v_conversation.id;
  return v_message;
end;
$$;
revoke all on function public.append_context_chat_human_message(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.append_context_chat_human_message(uuid,uuid,uuid,uuid,text)
  to service_role;

commit;
