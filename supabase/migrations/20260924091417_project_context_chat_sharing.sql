-- Creator-controlled project conversation sharing. Other private contexts and AI dispatch stay owner-only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.department_chat_conversations
  add constraint department_chat_conversations_project_share_identity_key
    unique (id, organization_id, project_id, owner_id);

create table public.project_context_chat_shares (
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  owner_id uuid not null,
  recipient_id uuid not null references auth.users(id) on delete restrict,
  shared_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key (conversation_id, recipient_id),
  foreign key (conversation_id, organization_id, project_id, owner_id)
    references public.department_chat_conversations
      (id, organization_id, project_id, owner_id) on delete restrict,
  check (recipient_id <> owner_id)
);
create index project_context_chat_shares_recipient_idx
  on public.project_context_chat_shares
    (organization_id, project_id, recipient_id, conversation_id)
  where revoked_at is null;
alter table public.project_context_chat_shares enable row level security;
revoke all on public.project_context_chat_shares
  from public, anon, authenticated, service_role;
grant all on public.project_context_chat_shares to service_role;

create function public.set_project_context_chat_shares(
  p_conversation_id uuid, p_organization_id uuid, p_actor_id uuid,
  p_recipient_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  conversation public.department_chat_conversations;
  recipients uuid[] := coalesce(p_recipient_ids, '{}'::uuid[]);
  active_recipients jsonb;
begin
  select * into conversation from public.department_chat_conversations c
    where c.id = p_conversation_id and c.organization_id = p_organization_id
      and c.owner_id = p_actor_id and c.context_kind = 'project_team'
    for update;
  if not found then
    raise exception 'Only the project conversation creator may change sharing.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.projects p
    join public.organizations o on o.id = p.organization_id and o.status = 'active'
    join public.organization_memberships m on m.organization_id = p.organization_id
      and m.user_id = p_actor_id and m.member_kind = 'team' and m.status = 'active'
    where p.id = conversation.project_id and p.organization_id = p_organization_id
      and p.archived_at is null
  ) then
    raise exception 'Active project creator access required.' using errcode = '42501';
  end if;
  if cardinality(recipients) > 50
    or exists (select 1 from unnest(recipients) r(id)
      where r.id is null or r.id = p_actor_id)
    or cardinality(recipients) <> (select count(distinct r.id) from unnest(recipients) r(id)) then
    raise exception 'Choose up to 50 distinct internal recipients other than yourself.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(recipients) r(id)
    where not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = p_organization_id and m.user_id = r.id
        and m.member_kind = 'team' and m.status = 'active'
    )
  ) then
    raise exception 'Every recipient must be an active internal project member.' using errcode = '42501';
  end if;
  update public.project_context_chat_shares s
    set revoked_at = clock_timestamp()
    where s.conversation_id = p_conversation_id
      and s.organization_id = p_organization_id
      and s.revoked_at is null and s.recipient_id <> all(recipients);
  insert into public.project_context_chat_shares
    (conversation_id, organization_id, project_id, owner_id, recipient_id)
    select conversation.id, conversation.organization_id, conversation.project_id,
      conversation.owner_id, r.id from unnest(recipients) r(id)
    on conflict (conversation_id, recipient_id) do update
      set revoked_at = null,
          shared_at = case when project_context_chat_shares.revoked_at is null
            then project_context_chat_shares.shared_at else clock_timestamp() end;
  select coalesce(jsonb_agg(jsonb_build_object(
    'recipient_id', s.recipient_id, 'shared_at', s.shared_at)
    order by s.recipient_id), '[]'::jsonb)
    into active_recipients from public.project_context_chat_shares s
    where s.conversation_id = p_conversation_id and s.organization_id = p_organization_id
      and s.revoked_at is null;
  return jsonb_build_object('conversation_id', p_conversation_id,
    'recipients', active_recipients);
end;
$$;
revoke all on function public.set_project_context_chat_shares(uuid,uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.set_project_context_chat_shares(uuid,uuid,uuid,uuid[])
  to service_role;

create function public.list_project_context_chat_conversations(
  p_organization_id uuid, p_project_id uuid, p_actor_id uuid, p_offset integer
) returns setof public.department_chat_conversations
language sql security invoker set search_path = '' as $$
  select c.* from public.department_chat_conversations c
  where c.organization_id = p_organization_id and c.project_id = p_project_id
    and c.context_kind = 'project_team'
    and exists (select 1 from public.projects p
      where p.id = p_project_id and p.organization_id = p_organization_id
        and p.archived_at is null)
    and exists (select 1 from public.organization_memberships m
      where m.organization_id = p_organization_id and m.user_id = p_actor_id
        and m.member_kind = 'team' and m.status = 'active')
    and (c.owner_id = p_actor_id or exists (
      select 1 from public.project_context_chat_shares s
      where s.conversation_id = c.id and s.organization_id = p_organization_id
        and s.project_id = p_project_id and s.recipient_id = p_actor_id
        and s.revoked_at is null))
  order by c.last_activity_at desc, c.id desc
  limit 51 offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;
revoke all on function public.list_project_context_chat_conversations(uuid,uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_context_chat_conversations(uuid,uuid,uuid,integer)
  to service_role;

comment on table public.project_context_chat_shares is
  'Creator-selected internal project recipients; revocation blocks future API reads and replies. No model dispatch or official-action authority is granted.';
create or replace function public.append_context_chat_human_message(
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
    and not coalesce(v_membership.role in ('system_owner', 'operations_admin', 'executive'), false)
    and not exists (
      select 1 from public.organization_department_memberships department_membership
      where department_membership.organization_id = p_organization_id
        and department_membership.user_id = p_actor_id
        and department_membership.department_id = v_conversation.department_id
        and department_membership.status = 'active'
    ) then
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

  if v_conversation.owner_id <> p_actor_id then
    if v_conversation.context_kind <> 'project_team' then
      raise exception 'Conversation is unavailable.' using errcode = '42501';
    end if;
    perform 1 from public.project_context_chat_shares share
      where share.conversation_id = v_conversation.id
        and share.organization_id = p_organization_id
        and share.project_id = v_conversation.project_id
        and share.recipient_id = p_actor_id and share.revoked_at is null
      for share;
    if not found then
      raise exception 'Project conversation sharing is unavailable.' using errcode = '42501';
    end if;
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
commit;
