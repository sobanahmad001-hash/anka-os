-- Preserve legacy engagement conversations; reserve a new conversation and its
-- first human turn together. Only the authenticated Edge handler supplies actor.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create or replace function public.start_engagement_chat_turn(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid,
  p_client_request_id uuid, p_prompt text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_conversation public.department_chat_conversations;
  v_membership public.organization_memberships;
  v_first public.department_chat_messages;
  v_turn jsonb;
  v_prompt text := btrim(coalesce(p_prompt, ''));
  v_title text;
begin
  if p_conversation_id is null or p_client_request_id is null
    or p_department_id is null or p_department_id not in ('content', 'design', 'marketing')
    or char_length(v_prompt) not between 1 and 8000 then
    raise exception 'Exact engagement context, request identity and prompt required.' using errcode = '22023';
  end if;
  -- Match lifecycle lock order and hold all authority witnesses through commit.
  perform 1 from public.projects project
  where project.id = p_project_id and project.organization_id = p_organization_id
    and project.archived_at is null for share;
  if not found then raise exception 'Project unavailable.' using errcode = '42501'; end if;
  select membership.* into v_membership from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
    and organization.status = 'active'
  where membership.organization_id = p_organization_id and membership.user_id = p_actor_id
    and membership.member_kind = 'team' and membership.status = 'active'
    and (membership.department_id = p_department_id
      or membership.role in ('system_owner', 'operations_admin', 'executive'))
  for share of membership, organization;
  if not found then raise exception 'Current Workshop contribution permission required.' using errcode = '42501'; end if;
  perform 1 from public.engagements engagement
  join public.engagement_services service on service.engagement_id = engagement.id
    and service.organization_id = engagement.organization_id and service.status = 'active'
  join public.service_catalog catalog on catalog.id = service.service_id
    and catalog.department_id = p_department_id
  where engagement.id = p_engagement_id and engagement.organization_id = p_organization_id
    and engagement.project_id = p_project_id and engagement.status <> 'cancelled'
    and engagement.client_id is not null and engagement.brand_id is not null
  for share of engagement, service, catalog;
  if not found then raise exception 'Authorized Workshop engagement required.' using errcode = '42501'; end if;
  v_title := regexp_replace(v_prompt, '[[:space:]]+', ' ', 'g');
  if char_length(v_title) > 80 then v_title := rtrim(left(v_title,79)) || '…'; end if;
  insert into public.department_chat_conversations
    (id, organization_id, project_id, engagement_id, department_id, owner_id, context_kind, title)
  values (p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, 'department_project', v_title)
  on conflict (id) do nothing;
  select conversation.* into v_conversation from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id for update;
  if not found or v_conversation.organization_id is distinct from p_organization_id
    or v_conversation.project_id is distinct from p_project_id
    or v_conversation.engagement_id is distinct from p_engagement_id
    or v_conversation.department_id is distinct from p_department_id
    or v_conversation.owner_id is distinct from p_actor_id
    or v_conversation.context_kind is distinct from 'department_project' then
    raise exception 'Conversation identity mismatch.' using errcode = '42501';
  end if;
  select message.* into v_first from public.department_chat_messages message
  where message.conversation_id = p_conversation_id order by message.sequence limit 1;
  if found and (v_first.role is distinct from 'user'
    or v_first.author_id is distinct from p_actor_id
    or v_first.client_request_id is distinct from p_client_request_id
    or v_first.body is distinct from v_prompt) then
    raise exception 'First Send identity conflicts with the saved conversation.' using errcode = '23505';
  end if;
  v_turn := public.begin_department_chat_turn_with_attachments(p_conversation_id,
    p_organization_id, p_project_id, p_engagement_id, p_department_id, p_actor_id,
    p_client_request_id, v_prompt, '{}'::uuid[]);
  select conversation.* into v_conversation from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id;
  return v_turn || jsonb_build_object('conversation', to_jsonb(v_conversation));
end;
$$;
revoke all on function public.start_engagement_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.start_engagement_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text) to service_role;
comment on function public.start_engagement_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text) is
  'Service-only atomic legacy engagement first Send. First-request replay reserves no additional turn; Edge must never redispatch replayed requests.';
commit;
