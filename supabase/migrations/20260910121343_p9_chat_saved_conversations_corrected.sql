-- P9-CHAT-1 - owner-private saved Department Chat conversations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.department_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  engagement_id uuid not null,
  department_id text not null references public.departments(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text not null,
  state text not null default 'active',
  next_sequence bigint not null default 1,
  last_activity_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_chat_conversations_engagement_scope_fkey
    foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id) on delete cascade,
  constraint department_chat_conversations_department_check
    check (department_id in ('content', 'design', 'marketing')),
  constraint department_chat_conversations_title_check check (char_length(btrim(title)) between 1 and 160),
  constraint department_chat_conversations_state_check check (state in ('active', 'archived')),
  constraint department_chat_conversations_archive_check check ((state = 'archived') = (archived_at is not null)),
  constraint department_chat_conversations_sequence_check check (next_sequence >= 1),
  unique (id, organization_id),
  unique (id, organization_id, project_id, engagement_id, owner_id),
  unique (id, organization_id, project_id, engagement_id, department_id, owner_id)
);

alter table public.ai_runs
  add column department_chat_conversation_id uuid,
  add constraint ai_runs_department_chat_conversation_context_check
    check (department_chat_conversation_id is null or (project_id is not null and engagement_id is not null)),
  add constraint ai_runs_department_chat_conversation_fkey
    foreign key (department_chat_conversation_id, organization_id, project_id, engagement_id, user_id)
    references public.department_chat_conversations(id, organization_id, project_id, engagement_id, owner_id)
    on delete restrict;
alter table public.department_chat_proposals
  add column conversation_id uuid,
  add constraint department_chat_proposals_conversation_scope_fkey
    foreign key (conversation_id, organization_id, project_id, engagement_id, department_id, proposer_id)
    references public.department_chat_conversations(id, organization_id, project_id, engagement_id, department_id, owner_id)
    on delete restrict;

create table public.department_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  engagement_id uuid not null,
  department_id text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  author_id uuid references auth.users(id) on delete restrict,
  role text not null check (role in ('user', 'assistant')),
  body text not null check (char_length(btrim(body)) between 1 and 80000),
  status text not null check (status in ('pending', 'completed', 'failed', 'unsupported', 'unknown')),
  error_code text not null default '' check (char_length(error_code) <= 80),
  provider_dispatched_at timestamptz,
  ai_run_id uuid,
  proposal_id uuid,
  client_request_id uuid not null,
  sequence bigint not null check (sequence >= 1),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint department_chat_messages_conversation_scope_fkey
    foreign key (conversation_id, organization_id, project_id, engagement_id, department_id, owner_id)
    references public.department_chat_conversations(id, organization_id, project_id, engagement_id, department_id, owner_id)
    on delete restrict,
  constraint department_chat_messages_ai_run_scope_fkey
    foreign key (ai_run_id, organization_id) references public.ai_runs(id, organization_id) on delete restrict,
  constraint department_chat_messages_proposal_scope_fkey
    foreign key (proposal_id, organization_id) references public.department_chat_proposals(id, organization_id) on delete restrict,
  constraint department_chat_messages_terminal_check check (
    (status = 'pending' and role = 'user' and ai_run_id is null and proposal_id is null and finished_at is null and error_code = '')
    or (status = 'completed' and ai_run_id is not null and proposal_id is not null and finished_at is not null and error_code = '')
    or (status in ('failed', 'unsupported') and role = 'user' and ai_run_id is null and proposal_id is null and finished_at is not null and error_code <> '')
    or (status = 'unknown' and role = 'user' and ai_run_id is null and proposal_id is null
      and provider_dispatched_at is not null and finished_at is not null and error_code = 'outcome_unknown')
  ),
  constraint department_chat_messages_author_check check (
    (role = 'user' and author_id is not null)
    or (role = 'assistant' and author_id is null)
  ),
  unique (conversation_id, sequence),
  unique (conversation_id, client_request_id, role),
  unique (id, organization_id)
);

create index idx_department_chat_conversations_owner_context
  on public.department_chat_conversations(owner_id, organization_id, engagement_id, department_id, state, last_activity_at desc);
create index idx_department_chat_conversations_project
  on public.department_chat_conversations(project_id, organization_id, last_activity_at desc);
create index idx_department_chat_messages_conversation on public.department_chat_messages(conversation_id, sequence);
create index idx_department_chat_messages_owner_activity on public.department_chat_messages(owner_id, organization_id, created_at desc);
create index idx_department_chat_messages_ai_run on public.department_chat_messages(ai_run_id, organization_id) where ai_run_id is not null;
create index idx_department_chat_messages_proposal on public.department_chat_messages(proposal_id, organization_id) where proposal_id is not null;
create index idx_ai_runs_department_chat_conversation
  on public.ai_runs(department_chat_conversation_id, organization_id, created_at desc)
  where department_chat_conversation_id is not null;
create index idx_department_chat_proposals_conversation
  on public.department_chat_proposals(conversation_id, organization_id, created_at desc)
  where conversation_id is not null;

alter table public.department_chat_conversations enable row level security;
alter table public.department_chat_messages enable row level security;
create policy "Owners can read Department Chat conversations"
on public.department_chat_conversations for select to authenticated
using (owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id));
create policy "Owners can read Department Chat messages"
on public.department_chat_messages for select to authenticated
using (owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id));

drop policy "Leaders can audit organization AI runs" on public.ai_runs;
create policy "Leaders can audit organization AI runs"
on public.ai_runs for select to authenticated
using (
  redacted_at is null and capability <> 'quick_task_chat'
  and department_chat_conversation_id is null
  and public.has_organization_role(organization_id, array['system_owner', 'operations_admin', 'executive'])
);
drop policy "Proposers and leaders can read Department Chat proposals" on public.department_chat_proposals;
create policy "Proposers and leaders can read Department Chat proposals"
on public.department_chat_proposals for select to authenticated
using (
  public.is_team_organization_member(organization_id)
  and exists (
    select 1 from public.organizations organization
    where organization.id = department_chat_proposals.organization_id and organization.status = 'active'
  )
  and (
    proposer_id = (select auth.uid())
    or (
      conversation_id is null
      and public.has_organization_role(organization_id, array['system_owner', 'operations_admin', 'executive'])
    )
  )
);
revoke all on table public.department_chat_conversations, public.department_chat_messages
  from public, anon, authenticated;
grant select on table public.department_chat_conversations, public.department_chat_messages
  to authenticated, service_role;
grant all on table public.department_chat_conversations, public.department_chat_messages to service_role;

create function private.require_owned_department_chat_conversation(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid,
  p_require_active boolean default false
)
returns public.department_chat_conversations
language plpgsql security invoker set search_path = ''
as $$
declare v_conversation public.department_chat_conversations;
begin
  select conversation.* into v_conversation
  from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.project_id = p_project_id
    and conversation.engagement_id = p_engagement_id
    and conversation.department_id = p_department_id
    and conversation.owner_id = p_actor_id;
  if not found then
    raise exception 'Owned Department Chat conversation not found.' using errcode = '42501';
  end if;
  if p_require_active and v_conversation.state <> 'active' then
    raise exception 'Archived conversations must be reopened before sending.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
      and (
        membership.department_id = p_department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive')
      )
  ) then
    raise exception 'Active department membership or organization leadership required.' using errcode = '42501';
  end if;
  return v_conversation;
end;
$$;

create function public.create_department_chat_conversation(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid,
  p_department_id text, p_actor_id uuid, p_title text
)
returns public.department_chat_conversations
language plpgsql security invoker set search_path = ''
as $$
declare v_conversation public.department_chat_conversations;
begin
  if p_department_id not in ('content', 'design', 'marketing') then
    raise exception 'Saved conversations are not available for this department.' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 160 then
    raise exception 'Conversation title must be between 1 and 160 characters.' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.engagements engagement
    join public.engagement_services service
      on service.engagement_id = engagement.id
     and service.organization_id = engagement.organization_id
     and service.status = 'active'
    join public.service_catalog catalog
      on catalog.id = service.service_id and catalog.department_id = p_department_id
    join public.organization_memberships membership
      on membership.organization_id = engagement.organization_id
     and membership.user_id = p_actor_id
     and membership.member_kind = 'team' and membership.status = 'active'
     and (
       membership.department_id = p_department_id
       or membership.role in ('system_owner', 'operations_admin', 'executive')
     )
    join public.organizations organization
      on organization.id = engagement.organization_id and organization.status = 'active'
    where engagement.id = p_engagement_id
      and engagement.project_id = p_project_id
      and engagement.organization_id = p_organization_id
      and engagement.client_id is not null and engagement.brand_id is not null
  ) then
    raise exception 'Authorized Department Chat engagement context is required.' using errcode = '42501';
  end if;
  insert into public.department_chat_conversations (
    organization_id, project_id, engagement_id, department_id, owner_id, title
  ) values (
    p_organization_id, p_project_id, p_engagement_id, p_department_id, p_actor_id, btrim(p_title)
  ) returning * into v_conversation;
  return v_conversation;
end;
$$;

create function public.rename_department_chat_conversation(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid, p_title text
)
returns public.department_chat_conversations
language plpgsql security invoker set search_path = ''
as $$
declare v_conversation public.department_chat_conversations;
begin
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 160 then
    raise exception 'Conversation title must be between 1 and 160 characters.' using errcode = '23514';
  end if;
  update public.department_chat_conversations
  set title = btrim(p_title), updated_at = now()
  where id = p_conversation_id and owner_id = p_actor_id
  returning * into v_conversation;
  return v_conversation;
end;
$$;

create function public.set_department_chat_conversation_state(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid, p_state text
)
returns public.department_chat_conversations
language plpgsql security invoker set search_path = ''
as $$
declare v_conversation public.department_chat_conversations;
begin
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  if p_state not in ('active', 'archived') then
    raise exception 'Conversation state must be active or archived.' using errcode = '23514';
  end if;
  update public.department_chat_conversations
  set state = p_state,
      archived_at = case when p_state = 'archived' then now() else null end,
      updated_at = now()
  where id = p_conversation_id and owner_id = p_actor_id
  returning * into v_conversation;
  return v_conversation;
end;
$$;

create function public.begin_department_chat_turn(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid,
  p_client_request_id uuid, p_prompt text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_conversation public.department_chat_conversations;
  v_message public.department_chat_messages;
begin
  select conversation.* into v_conversation
  from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.project_id = p_project_id
    and conversation.engagement_id = p_engagement_id
    and conversation.department_id = p_department_id
    and conversation.owner_id = p_actor_id
  for update;
  if not found then
    raise exception 'Owned Department Chat conversation not found.' using errcode = '42501';
  end if;
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, true
  );
  if char_length(btrim(coalesce(p_prompt, ''))) not between 1 and 8000 then
    raise exception 'Draft request must be between 1 and 8000 characters.' using errcode = '23514';
  end if;
  select message.* into v_message
  from public.department_chat_messages message
  where message.conversation_id = p_conversation_id
    and message.client_request_id = p_client_request_id and message.role = 'user';
  if found then
    if v_message.body <> btrim(p_prompt) then
      raise exception 'client_request_id conflicts with a different prompt.' using errcode = '23505';
    end if;
    return jsonb_build_object('message', to_jsonb(v_message), 'replayed', true);
  end if;
  insert into public.department_chat_messages (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, author_id, role, body, status, client_request_id, sequence
  ) values (
    v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id,
    v_conversation.owner_id, p_actor_id, 'user', btrim(p_prompt), 'pending',
    p_client_request_id, v_conversation.next_sequence
  ) returning * into v_message;
  update public.department_chat_conversations
  set next_sequence = next_sequence + 1, last_activity_at = now(), updated_at = now()
  where id = v_conversation.id;
  return jsonb_build_object('message', to_jsonb(v_message), 'replayed', false);
end;
$$;

create function public.fail_department_chat_turn(
  p_message_id uuid, p_conversation_id uuid, p_organization_id uuid,
  p_project_id uuid, p_engagement_id uuid, p_department_id text,
  p_actor_id uuid, p_error_code text
)
returns public.department_chat_messages
language plpgsql security invoker set search_path = ''
as $$
declare v_message public.department_chat_messages;
begin
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  select message.* into v_message
  from public.department_chat_messages message
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.owner_id = p_actor_id and message.role = 'user'
  for update;
  if not found then
    raise exception 'Department Chat message not found.' using errcode = '42501';
  end if;
  if v_message.status = 'pending' then
    update public.department_chat_messages
    set status = 'failed',
        error_code = left(btrim(coalesce(nullif(p_error_code, ''), 'request_failed')), 80),
        finished_at = now()
    where id = v_message.id returning * into v_message;
  end if;
  return v_message;
end;
$$;

create function public.mark_department_chat_turn_dispatched(
  p_message_id uuid, p_conversation_id uuid, p_organization_id uuid,
  p_project_id uuid, p_engagement_id uuid, p_department_id text,
  p_actor_id uuid
)
returns public.department_chat_messages
language plpgsql security invoker set search_path = ''
as $$
declare v_message public.department_chat_messages;
begin
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, true
  );
  select message.* into v_message
  from public.department_chat_messages message
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.owner_id = p_actor_id and message.author_id = p_actor_id
    and message.role = 'user'
  for update;
  if not found or v_message.status <> 'pending' then
    raise exception 'Pending Department Chat message not found.' using errcode = '42501';
  end if;
  if v_message.provider_dispatched_at is null then
    update public.department_chat_messages
    set provider_dispatched_at = clock_timestamp()
    where id = v_message.id returning * into v_message;
  end if;
  return v_message;
end;
$$;

create function public.mark_department_chat_turn_unknown(
  p_message_id uuid, p_conversation_id uuid, p_organization_id uuid,
  p_project_id uuid, p_engagement_id uuid, p_department_id text,
  p_actor_id uuid
)
returns public.department_chat_messages
language plpgsql security invoker set search_path = ''
as $$
declare v_message public.department_chat_messages;
begin
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  select message.* into v_message
  from public.department_chat_messages message
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.owner_id = p_actor_id and message.author_id = p_actor_id
    and message.role = 'user'
  for update;
  if not found then
    raise exception 'Department Chat message not found.' using errcode = '42501';
  end if;
  if v_message.status = 'pending' then
    if v_message.provider_dispatched_at is null then
      raise exception 'A request cannot be unknown before provider dispatch.' using errcode = '23514';
    end if;
    update public.department_chat_messages
    set status = 'unknown', error_code = 'outcome_unknown', finished_at = now()
    where id = v_message.id returning * into v_message;
  end if;
  return v_message;
end;
$$;

create function public.expire_department_chat_pending_turns(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid
)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare v_count integer;
begin
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  update public.department_chat_messages
  set status = case when provider_dispatched_at is null then 'failed' else 'unknown' end,
      error_code = case when provider_dispatched_at is null then 'interrupted' else 'outcome_unknown' end,
      finished_at = now()
  where conversation_id = p_conversation_id
    and organization_id = p_organization_id
    and owner_id = p_actor_id
    and role = 'user' and status = 'pending'
    and created_at <= now() - interval '2 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.save_department_chat_conversation_proposal(
  p_conversation_id uuid, p_message_id uuid,
  p_organization_id uuid, p_engagement_id uuid, p_project_id uuid,
  p_department_id text, p_actor_id uuid, p_proposal_kind text,
  p_target_key text, p_artifact_id uuid, p_engagement_stage_instance_id uuid,
  p_validated_payload jsonb, p_preview_payload jsonb,
  p_safe_prompt_metadata jsonb, p_context_artifact_version_ids uuid[],
  p_context_checksum text, p_connector_connection_id uuid, p_model_id text,
  p_idempotency_key uuid, p_input_text text, p_output_text text,
  p_latency_ms integer, p_input_tokens integer, p_output_tokens integer,
  p_estimated_cost_microusd bigint
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_conversation public.department_chat_conversations;
  v_user_message public.department_chat_messages;
  v_assistant_message public.department_chat_messages;
  v_saved jsonb;
  v_ai_run_id uuid;
  v_proposal_id uuid;
begin
  select conversation.* into v_conversation
  from public.department_chat_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.project_id = p_project_id
    and conversation.engagement_id = p_engagement_id
    and conversation.department_id = p_department_id
    and conversation.owner_id = p_actor_id
  for update;
  if not found or v_conversation.state <> 'active' then
    raise exception 'Active owned Department Chat conversation required.' using errcode = '42501';
  end if;
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, true
  );
  select message.* into v_user_message
  from public.department_chat_messages message
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.owner_id = p_actor_id and message.role = 'user'
  for update;
  if not found or v_user_message.status <> 'pending' or v_user_message.body <> btrim(p_input_text) then
    raise exception 'Pending Department Chat turn does not match this request.' using errcode = '23514';
  end if;

  v_saved := public.save_department_chat_proposal(
    p_organization_id, p_engagement_id, p_project_id, p_department_id,
    p_actor_id, p_proposal_kind, p_target_key, p_artifact_id,
    p_engagement_stage_instance_id, p_validated_payload, p_preview_payload,
    p_safe_prompt_metadata, p_context_artifact_version_ids, p_context_checksum,
    p_connector_connection_id, p_model_id, p_idempotency_key, p_input_text,
    p_output_text, p_latency_ms, p_input_tokens, p_output_tokens,
    p_estimated_cost_microusd
  );
  v_ai_run_id := (v_saved ->> 'ai_run_id')::uuid;
  v_proposal_id := (v_saved ->> 'proposal_id')::uuid;

  update public.ai_runs set department_chat_conversation_id = p_conversation_id
  where id = v_ai_run_id and organization_id = p_organization_id;
  update public.department_chat_proposals set conversation_id = p_conversation_id
  where id = v_proposal_id and organization_id = p_organization_id;
  update public.department_chat_messages
  set status = 'completed', ai_run_id = v_ai_run_id, proposal_id = v_proposal_id,
      finished_at = now()
  where id = v_user_message.id returning * into v_user_message;
  insert into public.department_chat_messages (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, author_id, role, body, status, ai_run_id, proposal_id,
    client_request_id, sequence, finished_at
  ) values (
    v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id,
    v_conversation.owner_id, null, 'assistant', btrim(p_output_text),
    'completed', v_ai_run_id, v_proposal_id, v_user_message.client_request_id,
    v_conversation.next_sequence, now()
  ) returning * into v_assistant_message;
  update public.department_chat_conversations
  set next_sequence = next_sequence + 1, last_activity_at = now(), updated_at = now()
  where id = v_conversation.id;
  return v_saved || jsonb_build_object(
    'conversation_id', v_conversation.id,
    'user_message_id', v_user_message.id,
    'assistant_message_id', v_assistant_message.id
  );
end;
$$;

create function private.protect_department_chat_message()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Department Chat history is append-only.' using errcode = '23514';
  end if;
  if old.status = 'pending' and new.status = 'pending'
     and old.provider_dispatched_at is null and new.provider_dispatched_at is not null
     and (to_jsonb(new) - 'provider_dispatched_at') = (to_jsonb(old) - 'provider_dispatched_at') then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or new.engagement_id is distinct from old.engagement_id
     or new.department_id is distinct from old.department_id
     or new.owner_id is distinct from old.owner_id
     or new.author_id is distinct from old.author_id
     or new.role is distinct from old.role
     or new.body is distinct from old.body
     or new.provider_dispatched_at is distinct from old.provider_dispatched_at
     or new.client_request_id is distinct from old.client_request_id
     or new.sequence is distinct from old.sequence
     or new.created_at is distinct from old.created_at then
    raise exception 'Department Chat message source is immutable.' using errcode = '23514';
  end if;
  if old.status <> 'pending' and new is distinct from old then
    raise exception 'Terminal Department Chat messages are immutable.' using errcode = '23514';
  end if;
  if old.status = 'pending' and new.status not in ('completed', 'failed', 'unsupported', 'unknown') then
    raise exception 'Invalid Department Chat message transition.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_department_chat_messages_append_only
before update or delete on public.department_chat_messages
for each row execute function private.protect_department_chat_message();

create function private.protect_department_chat_proposal_conversation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.conversation_id is not null and new.conversation_id is distinct from old.conversation_id then
    raise exception 'Department Chat proposal conversation is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_department_chat_proposal_conversation
before update on public.department_chat_proposals
for each row execute function private.protect_department_chat_proposal_conversation();

create function private.protect_ai_run_department_chat_conversation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.department_chat_conversation_id is not null
     and new.department_chat_conversation_id is distinct from old.department_chat_conversation_id then
    raise exception 'AI run Department Chat conversation is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_ai_runs_department_chat_conversation
before update of department_chat_conversation_id on public.ai_runs
for each row execute function private.protect_ai_run_department_chat_conversation();

create or replace function private.protect_department_chat_proposal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- P9 permits exactly one new source transition: the atomic save wrapper links
  -- a still-pending proposal to its creator-private conversation.
  if old.status = 'pending' and new.status = 'pending'
     and old.conversation_id is null and new.conversation_id is not null
     and (to_jsonb(new) - array['conversation_id', 'updated_at'])
       = (to_jsonb(old) - array['conversation_id', 'updated_at']) then
    new.updated_at := now();
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.engagement_id is distinct from old.engagement_id
     or new.project_id is distinct from old.project_id
     or new.department_id is distinct from old.department_id
     or new.proposer_id is distinct from old.proposer_id
     or new.proposal_kind is distinct from old.proposal_kind
     or new.target_key is distinct from old.target_key
     or new.artifact_id is distinct from old.artifact_id
     or new.engagement_stage_instance_id is distinct from old.engagement_stage_instance_id
     or new.validated_payload is distinct from old.validated_payload
     or new.preview_payload is distinct from old.preview_payload
     or new.safe_prompt_metadata is distinct from old.safe_prompt_metadata
     or new.context_artifact_version_ids is distinct from old.context_artifact_version_ids
     or new.context_checksum is distinct from old.context_checksum
     or new.database_context_checksum is distinct from old.database_context_checksum
     or new.connector_connection_id is distinct from old.connector_connection_id
     or new.model_id is distinct from old.model_id
     or new.ai_run_id is distinct from old.ai_run_id
     or new.conversation_id is distinct from old.conversation_id
     or new.expires_at is distinct from old.expires_at
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'Department Chat proposal source data is immutable.' using errcode = '23514';
  end if;
  if old.status <> 'pending' and new is distinct from old then
    raise exception 'A decided Department Chat proposal is immutable.' using errcode = '23514';
  end if;
  if old.status = 'pending' and new.status not in ('accepted', 'rejected', 'expired', 'stale') then
    raise exception 'Invalid Department Chat proposal transition.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.require_owned_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function private.protect_department_chat_message() from public, anon, authenticated;
revoke all on function private.protect_department_chat_proposal_conversation() from public, anon, authenticated;
revoke all on function private.protect_ai_run_department_chat_conversation() from public, anon, authenticated;
grant execute on function private.require_owned_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid, boolean)
  to service_role;
grant execute on function private.protect_department_chat_message() to service_role;
grant execute on function private.protect_department_chat_proposal_conversation() to service_role;
grant execute on function private.protect_ai_run_department_chat_conversation() to service_role;

revoke all on function public.create_department_chat_conversation(uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.rename_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_department_chat_conversation_state(uuid, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.begin_department_chat_turn(uuid, uuid, uuid, uuid, text, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_department_chat_turn(uuid, uuid, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.mark_department_chat_turn_dispatched(uuid, uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_department_chat_turn_unknown(uuid, uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.expire_department_chat_pending_turns(uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.save_department_chat_conversation_proposal(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint
) from public, anon, authenticated;
grant execute on function public.create_department_chat_conversation(uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.rename_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.set_department_chat_conversation_state(uuid, uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.begin_department_chat_turn(uuid, uuid, uuid, uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.fail_department_chat_turn(uuid, uuid, uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.mark_department_chat_turn_dispatched(uuid, uuid, uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.mark_department_chat_turn_unknown(uuid, uuid, uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.expire_department_chat_pending_turns(uuid, uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.save_department_chat_conversation_proposal(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint
) to service_role;

comment on table public.department_chat_conversations is
  'Creator-private saved Department Chat threads in one exact organization/project/engagement/department context.';
comment on table public.department_chat_messages is
  'Creator-private append-only Department Chat text history; Quick Task messages are never reused.';
comment on column public.department_chat_conversations.next_sequence is
  'Conversation-local monotonic sequence allocated under row lock for deterministic concurrent turns.';
commit;
