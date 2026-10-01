-- First Send saves the conversation and first message in one transaction.
-- The Edge action supplies the authenticated actor and calls as service_role.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create or replace function public.start_context_chat_human_message(
  p_conversation_id uuid, p_organization_id uuid, p_actor_id uuid,
  p_context_kind text, p_project_id uuid, p_department_id text,
  p_request_id uuid, p_body text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_conversation public.department_chat_conversations;
  v_membership public.organization_memberships;
  v_message public.department_chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_title text;
begin
  if p_conversation_id is null or p_request_id is null or length(v_body) not between 1 and 8000
    or p_context_kind is null or p_context_kind not in ('organization', 'department_private', 'project_team')
    or (p_context_kind = 'organization' and (p_project_id is not null or p_department_id is not null))
    or (p_context_kind = 'department_private' and (p_project_id is not null or p_department_id is null or p_department_id not in ('content', 'design', 'marketing')))
    or (p_context_kind = 'project_team' and (p_project_id is null or p_department_id is not null)) then
    raise exception 'Valid context, first message and request identity required.' using errcode = '22023';
  end if;
  -- Lifecycle operations lock the project first. Use the same order and hold
  -- the parent until commit so archive/delete cannot cross a successful Send.
  if p_context_kind = 'project_team' then
    perform 1 from public.projects project
    where project.id = p_project_id and project.organization_id = p_organization_id and project.archived_at is null
    for share;
    if not found then raise exception 'Project is unavailable.' using errcode = '42501'; end if;
  end if;
  select membership.* into v_membership from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
  where membership.organization_id = p_organization_id and membership.user_id = p_actor_id
    and membership.member_kind = 'team' and membership.status = 'active'
  for share of membership, organization;
  if not found then raise exception 'Active team membership required.' using errcode = '42501'; end if;
  if p_context_kind = 'department_private'
    and v_membership.department_id is distinct from p_department_id
    and not coalesce(v_membership.role in ('system_owner', 'operations_admin', 'executive'), false) then
    perform 1 from public.organization_department_memberships department_membership
    where department_membership.organization_id = p_organization_id
      and department_membership.user_id = p_actor_id and department_membership.department_id = p_department_id
      and department_membership.status = 'active'
    for share;
    if not found then raise exception 'Department access changed.' using errcode = '42501'; end if;
  end if;
  v_title := regexp_replace(v_body, '[[:space:]]+', ' ', 'g');
  if char_length(v_title) > 80 then v_title := rtrim(left(v_title, 79)) || '…'; end if;
  insert into public.department_chat_conversations (
    id, organization_id, owner_id, context_kind, project_id, department_id, title
  ) values (
    p_conversation_id, p_organization_id, p_actor_id, p_context_kind, p_project_id, p_department_id, v_title
  ) on conflict (id) do nothing;
  select * into v_conversation from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id for update;
  if not found or v_conversation.organization_id is distinct from p_organization_id
    or v_conversation.owner_id is distinct from p_actor_id
    or v_conversation.context_kind is distinct from p_context_kind
    or v_conversation.project_id is distinct from p_project_id
    or v_conversation.department_id is distinct from p_department_id
    or v_conversation.engagement_id is not null then
    raise exception 'Conversation identity mismatch.' using errcode = '42501';
  end if;
  v_message := public.append_context_chat_human_message(p_conversation_id, p_organization_id, p_actor_id, p_request_id, v_body);
  select * into v_conversation from public.department_chat_conversations conversation where conversation.id = p_conversation_id;
  return jsonb_build_object('conversation', to_jsonb(v_conversation), 'message', to_jsonb(v_message));
end;
$$;
revoke all on function public.start_context_chat_human_message(uuid, uuid, uuid, text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.start_context_chat_human_message(uuid, uuid, uuid, text, uuid, text, uuid, text) to service_role;
comment on function public.start_context_chat_human_message(uuid, uuid, uuid, text, uuid, text, uuid, text) is
  'Service-only atomic context first Send; same-ID retries must match owner and scope; existing append enforces request/body replay identity.';
commit;
