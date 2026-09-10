-- P9-CHAT-2 - deliberate internal conversation sharing and collaborative replies.
-- Depends on released 20260910121343_p9_chat_saved_conversations_corrected.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Conversation ownership is distinct from the collaborator who authored a run
-- or proposal. Keep both identities in the linked-record foreign keys.
alter table public.ai_runs
  add column department_chat_conversation_owner_id uuid;
update public.ai_runs run
set department_chat_conversation_owner_id = conversation.owner_id
from public.department_chat_conversations conversation
where conversation.id = run.department_chat_conversation_id
  and conversation.organization_id = run.organization_id;
alter table public.ai_runs
  drop constraint ai_runs_department_chat_conversation_fkey,
  drop constraint ai_runs_department_chat_conversation_context_check,
  add constraint ai_runs_department_chat_conversation_context_check check (
    (department_chat_conversation_id is null and department_chat_conversation_owner_id is null)
    or (department_chat_conversation_id is not null and department_chat_conversation_owner_id is not null
      and project_id is not null and engagement_id is not null)
  ),
  add constraint ai_runs_department_chat_conversation_fkey
    foreign key (department_chat_conversation_id, organization_id, project_id, engagement_id, department_chat_conversation_owner_id)
    references public.department_chat_conversations(id, organization_id, project_id, engagement_id, owner_id)
    on delete restrict;

alter table public.department_chat_proposals
  add column conversation_owner_id uuid;
update public.department_chat_proposals proposal
set conversation_owner_id = conversation.owner_id
from public.department_chat_conversations conversation
where conversation.id = proposal.conversation_id
  and conversation.organization_id = proposal.organization_id;
alter table public.department_chat_proposals
  drop constraint department_chat_proposals_conversation_scope_fkey,
  add constraint department_chat_proposals_conversation_identity_check check (
    (conversation_id is null) = (conversation_owner_id is null)
  ),
  add constraint department_chat_proposals_conversation_scope_fkey
    foreign key (conversation_id, organization_id, project_id, engagement_id, department_id, conversation_owner_id)
    references public.department_chat_conversations(id, organization_id, project_id, engagement_id, department_id, owner_id)
    on delete restrict;

create table public.department_chat_conversation_shares (
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  engagement_id uuid not null,
  department_id text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  recipient_id uuid not null references auth.users(id) on delete restrict,
  shared_by uuid not null references auth.users(id) on delete restrict,
  shared_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint department_chat_conversation_shares_pkey primary key (conversation_id, recipient_id),
  constraint department_chat_conversation_shares_scope_fkey
    foreign key (conversation_id, organization_id, project_id, engagement_id, department_id, owner_id)
    references public.department_chat_conversations(id, organization_id, project_id, engagement_id, department_id, owner_id)
    on delete restrict,
  constraint department_chat_conversation_shares_internal_check
    check (recipient_id <> owner_id and shared_by = owner_id),
  unique (conversation_id, organization_id, recipient_id)
);

create index idx_department_chat_conversation_shares_recipient
  on public.department_chat_conversation_shares(recipient_id, organization_id, project_id, engagement_id, department_id, conversation_id)
  where revoked_at is null;
create index idx_department_chat_conversation_shares_owner
  on public.department_chat_conversation_shares(owner_id, organization_id, conversation_id, recipient_id);

alter table public.department_chat_conversation_shares enable row level security;
create policy "Owners and active recipients can read Department Chat shares"
on public.department_chat_conversation_shares for select to authenticated
using (
  public.is_team_organization_member(organization_id)
  and exists (
    select 1 from public.organizations organization
    where organization.id = department_chat_conversation_shares.organization_id
      and organization.status = 'active'
  )
  and (
    owner_id = (select auth.uid())
    or (
      recipient_id = (select auth.uid()) and revoked_at is null
      and exists (
      select 1 from public.organization_memberships membership
      join public.organizations organization
        on organization.id = membership.organization_id and organization.status = 'active'
      join public.engagements engagement
        on engagement.id = department_chat_conversation_shares.engagement_id
       and engagement.organization_id = membership.organization_id
       and engagement.project_id = department_chat_conversation_shares.project_id
       and engagement.status <> 'cancelled'
      join public.projects project
        on project.id = engagement.project_id
       and project.organization_id = engagement.organization_id
       and project.archived_at is null
      join public.engagement_services service
        on service.engagement_id = engagement.id
       and service.organization_id = engagement.organization_id
       and service.status = 'active'
      join public.service_catalog catalog
        on catalog.id = service.service_id
       and catalog.department_id = department_chat_conversation_shares.department_id
      where membership.organization_id = department_chat_conversation_shares.organization_id
        and membership.user_id = (select auth.uid())
        and membership.member_kind = 'team' and membership.status = 'active'
        and (
          membership.department_id = department_chat_conversation_shares.department_id
          or membership.role in ('system_owner', 'operations_admin', 'executive')
        )
      )
    )
  )
);

drop policy "Owners can read Department Chat conversations" on public.department_chat_conversations;
create policy "Owners and active recipients can read Department Chat conversations"
on public.department_chat_conversations for select to authenticated
using (
  public.is_team_organization_member(organization_id)
  and (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.department_chat_conversation_shares share
      join public.organization_memberships membership
        on membership.organization_id = share.organization_id
       and membership.user_id = share.recipient_id
       and membership.member_kind = 'team' and membership.status = 'active'
      join public.engagements engagement
        on engagement.id = share.engagement_id
       and engagement.organization_id = share.organization_id
       and engagement.project_id = share.project_id
       and engagement.status <> 'cancelled'
      join public.projects project
        on project.id = engagement.project_id
       and project.organization_id = engagement.organization_id
       and project.archived_at is null
      join public.engagement_services service
        on service.engagement_id = engagement.id
       and service.organization_id = engagement.organization_id
       and service.status = 'active'
      join public.service_catalog catalog
        on catalog.id = service.service_id
       and catalog.department_id = share.department_id
      where share.conversation_id = department_chat_conversations.id
        and share.organization_id = department_chat_conversations.organization_id
        and share.recipient_id = (select auth.uid()) and share.revoked_at is null
        and (
          membership.department_id = department_chat_conversations.department_id
          or membership.role in ('system_owner', 'operations_admin', 'executive')
        )
    )
  )
);

drop policy "Owners can read Department Chat messages" on public.department_chat_messages;
create policy "Owners and active recipients can read Department Chat messages"
on public.department_chat_messages for select to authenticated
using (
  public.is_team_organization_member(organization_id)
  and (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.department_chat_conversation_shares share
      join public.organization_memberships membership
        on membership.organization_id = share.organization_id
       and membership.user_id = share.recipient_id
       and membership.member_kind = 'team' and membership.status = 'active'
      join public.engagements engagement
        on engagement.id = share.engagement_id
       and engagement.organization_id = share.organization_id
       and engagement.project_id = share.project_id
       and engagement.status <> 'cancelled'
      join public.projects project
        on project.id = engagement.project_id
       and project.organization_id = engagement.organization_id
       and project.archived_at is null
      join public.engagement_services service
        on service.engagement_id = engagement.id
       and service.organization_id = engagement.organization_id
       and service.status = 'active'
      join public.service_catalog catalog
        on catalog.id = service.service_id
       and catalog.department_id = share.department_id
      where share.conversation_id = department_chat_messages.conversation_id
        and share.organization_id = department_chat_messages.organization_id
        and share.recipient_id = (select auth.uid()) and share.revoked_at is null
        and (
          membership.department_id = department_chat_messages.department_id
          or membership.role in ('system_owner', 'operations_admin', 'executive')
        )
    )
  )
);

drop policy "Users can read own AI runs" on public.ai_runs;
create policy "Users can read own standalone AI runs"
on public.ai_runs for select to authenticated
using (
  redacted_at is null
  and user_id = (select auth.uid())
  and department_chat_conversation_id is null
  and public.is_team_organization_member(organization_id)
);

create policy "Active participants can read linked Department Chat AI runs"
on public.ai_runs for select to authenticated
using (
  department_chat_conversation_id is not null
  and public.is_team_organization_member(organization_id)
  and exists (
    select 1 from public.organizations organization
    where organization.id = ai_runs.organization_id and organization.status = 'active'
  )
  and (
    department_chat_conversation_owner_id = (select auth.uid())
    or exists (
    select 1 from public.department_chat_conversation_shares share
    join public.organization_memberships membership
      on membership.organization_id = share.organization_id
     and membership.user_id = share.recipient_id
     and membership.member_kind = 'team' and membership.status = 'active'
    join public.engagements engagement
      on engagement.id = share.engagement_id
     and engagement.organization_id = share.organization_id
     and engagement.project_id = share.project_id
     and engagement.status <> 'cancelled'
    join public.projects project
      on project.id = engagement.project_id
     and project.organization_id = engagement.organization_id
     and project.archived_at is null
    join public.engagement_services service
      on service.engagement_id = engagement.id
     and service.organization_id = engagement.organization_id
     and service.status = 'active'
    join public.service_catalog catalog
      on catalog.id = service.service_id
     and catalog.department_id = share.department_id
    where share.conversation_id = ai_runs.department_chat_conversation_id
      and share.organization_id = ai_runs.organization_id
      and share.recipient_id = (select auth.uid()) and share.revoked_at is null
      and (
        membership.department_id = share.department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive')
      )
    )
  )
);

drop policy "Proposers and leaders can read Department Chat proposals" on public.department_chat_proposals;
create policy "Proposers, leaders, and active recipients can read Department Chat proposals"
on public.department_chat_proposals for select to authenticated
using (
  public.is_team_organization_member(organization_id)
  and exists (
    select 1 from public.organizations organization
    where organization.id = department_chat_proposals.organization_id and organization.status = 'active'
  )
  and (
    (conversation_id is null and proposer_id = (select auth.uid()))
    or conversation_owner_id = (select auth.uid())
    or (
      conversation_id is null
      and public.has_organization_role(organization_id, array['system_owner', 'operations_admin', 'executive'])
    )
    or exists (
      select 1 from public.department_chat_conversation_shares share
      join public.organization_memberships membership
        on membership.organization_id = share.organization_id
       and membership.user_id = share.recipient_id
       and membership.member_kind = 'team' and membership.status = 'active'
      join public.engagements engagement
        on engagement.id = share.engagement_id
       and engagement.organization_id = share.organization_id
       and engagement.project_id = share.project_id
       and engagement.status <> 'cancelled'
      join public.projects project
        on project.id = engagement.project_id
       and project.organization_id = engagement.organization_id
       and project.archived_at is null
      join public.engagement_services service
        on service.engagement_id = engagement.id
       and service.organization_id = engagement.organization_id
       and service.status = 'active'
      join public.service_catalog catalog
        on catalog.id = service.service_id
       and catalog.department_id = share.department_id
      where share.conversation_id = department_chat_proposals.conversation_id
        and share.organization_id = department_chat_proposals.organization_id
        and share.recipient_id = (select auth.uid()) and share.revoked_at is null
        and (
          membership.department_id = share.department_id
          or membership.role in ('system_owner', 'operations_admin', 'executive')
        )
    )
  )
);

revoke all on table public.department_chat_conversation_shares from public, anon, authenticated;
grant select on table public.department_chat_conversation_shares to authenticated, service_role;
grant all on table public.department_chat_conversation_shares to service_role;

create function private.is_current_department_chat_contributor(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid,
  p_department_id text, p_user_id uuid
)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    join public.engagements engagement
      on engagement.id = p_engagement_id
     and engagement.organization_id = membership.organization_id
     and engagement.project_id = p_project_id
     and engagement.status <> 'cancelled'
    join public.projects project
      on project.id = engagement.project_id and project.organization_id = engagement.organization_id
     and project.archived_at is null
    join public.engagement_services service
      on service.engagement_id = engagement.id
     and service.organization_id = engagement.organization_id
     and service.status = 'active'
    join public.service_catalog catalog
      on catalog.id = service.service_id and catalog.department_id = p_department_id
    where membership.organization_id = p_organization_id
      and membership.user_id = p_user_id
      and membership.member_kind = 'team' and membership.status = 'active'
      and (
        membership.department_id = p_department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive')
      )
  );
$$;

create function private.require_accessible_department_chat_conversation(
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
    and conversation.department_id = p_department_id;
  if not found then
    raise exception 'Department Chat conversation not found.' using errcode = '42501';
  end if;
  if p_require_active and v_conversation.state <> 'active' then
    raise exception 'Archived conversations must be reopened before sending.' using errcode = '23514';
  end if;
  if not private.is_current_department_chat_contributor(
    p_organization_id, p_project_id, p_engagement_id, p_department_id, p_actor_id
  ) then
    raise exception 'Current Workshop contribution permission is required.' using errcode = '42501';
  end if;
  if v_conversation.owner_id <> p_actor_id and not exists (
    select 1 from public.department_chat_conversation_shares share
    where share.conversation_id = p_conversation_id
      and share.organization_id = p_organization_id
      and share.recipient_id = p_actor_id and share.revoked_at is null
  ) then
    raise exception 'Conversation sharing is not active for this recipient.' using errcode = '42501';
  end if;
  return v_conversation;
end;
$$;

create function public.can_access_department_chat_conversation(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid
)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.department_chat_conversations conversation
    where conversation.id = p_conversation_id
      and conversation.organization_id = p_organization_id
      and conversation.project_id = p_project_id
      and conversation.engagement_id = p_engagement_id
      and conversation.department_id = p_department_id
      and (
        (
          conversation.owner_id = p_actor_id
          and public.is_team_organization_member(p_organization_id)
        )
        or (
          private.is_current_department_chat_contributor(
            p_organization_id, p_project_id, p_engagement_id, p_department_id, p_actor_id
          )
          and exists (
            select 1 from public.department_chat_conversation_shares share
            where share.conversation_id = conversation.id
              and share.organization_id = conversation.organization_id
              and share.recipient_id = p_actor_id
              and share.revoked_at is null
          )
        )
      )
  );
$$;

-- Complete only the current author's reserved turn. The conversation row lock
-- serializes assistant-message sequence allocation with concurrent replies.
create or replace function public.save_department_chat_conversation_proposal(
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
  for update;
  if not found or v_conversation.state <> 'active' then
    raise exception 'Active Department Chat conversation required.' using errcode = '42501';
  end if;
  perform private.require_accessible_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, true
  );
  select message.* into v_user_message
  from public.department_chat_messages message
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.author_id = p_actor_id and message.role = 'user'
  for update;
  if not found or v_user_message.status <> 'pending' or v_user_message.body <> btrim(p_input_text) then
    raise exception 'Pending Department Chat turn does not match this author and request.' using errcode = '23514';
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

  update public.ai_runs
  set department_chat_conversation_id = p_conversation_id,
      department_chat_conversation_owner_id = v_conversation.owner_id
  where id = v_ai_run_id and organization_id = p_organization_id;
  update public.department_chat_proposals
  set conversation_id = p_conversation_id,
      conversation_owner_id = v_conversation.owner_id
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

create or replace function public.begin_department_chat_turn(
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
  for update;
  if not found then
    raise exception 'Department Chat conversation not found.' using errcode = '42501';
  end if;
  perform private.require_accessible_department_chat_conversation(
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
    if v_message.author_id <> p_actor_id then
      raise exception 'This request identity belongs to another author.' using errcode = '23505';
    end if;
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

create or replace function public.fail_department_chat_turn(
  p_message_id uuid, p_conversation_id uuid, p_organization_id uuid,
  p_project_id uuid, p_engagement_id uuid, p_department_id text,
  p_actor_id uuid, p_error_code text
)
returns public.department_chat_messages
language plpgsql security invoker set search_path = ''
as $$
declare v_message public.department_chat_messages;
begin
  select message.* into v_message
  from public.department_chat_messages message
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.organization_id = p_organization_id and message.project_id = p_project_id
    and message.engagement_id = p_engagement_id and message.department_id = p_department_id
    and message.author_id = p_actor_id and message.role = 'user'
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

create or replace function public.mark_department_chat_turn_dispatched(
  p_message_id uuid, p_conversation_id uuid, p_organization_id uuid,
  p_project_id uuid, p_engagement_id uuid, p_department_id text,
  p_actor_id uuid
)
returns public.department_chat_messages
language plpgsql security invoker set search_path = ''
as $$
declare v_message public.department_chat_messages;
begin
  perform private.require_accessible_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, true
  );
  select message.* into v_message
  from public.department_chat_messages message
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.organization_id = p_organization_id and message.project_id = p_project_id
    and message.engagement_id = p_engagement_id and message.department_id = p_department_id
    and message.author_id = p_actor_id and message.role = 'user'
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

create or replace function public.mark_department_chat_turn_unknown(
  p_message_id uuid, p_conversation_id uuid, p_organization_id uuid,
  p_project_id uuid, p_engagement_id uuid, p_department_id text,
  p_actor_id uuid
)
returns public.department_chat_messages
language plpgsql security invoker set search_path = ''
as $$
declare v_message public.department_chat_messages;
begin
  select message.* into v_message
  from public.department_chat_messages message
  where message.id = p_message_id and message.conversation_id = p_conversation_id
    and message.organization_id = p_organization_id and message.project_id = p_project_id
    and message.engagement_id = p_engagement_id and message.department_id = p_department_id
    and message.author_id = p_actor_id and message.role = 'user'
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

create or replace function public.expire_department_chat_pending_turns(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid
)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare v_count integer;
begin
  perform private.require_accessible_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  update public.department_chat_messages
  set status = case when provider_dispatched_at is null then 'failed' else 'unknown' end,
      error_code = case when provider_dispatched_at is null then 'interrupted' else 'outcome_unknown' end,
      finished_at = now()
  where conversation_id = p_conversation_id
    and organization_id = p_organization_id
    and author_id = p_actor_id
    and role = 'user' and status = 'pending'
    and created_at <= now() - interval '2 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.set_department_chat_conversation_shares(
  p_conversation_id uuid, p_organization_id uuid, p_project_id uuid,
  p_engagement_id uuid, p_department_id text, p_actor_id uuid,
  p_recipient_ids uuid[]
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_conversation public.department_chat_conversations;
  v_recipient_ids uuid[] := coalesce(p_recipient_ids, '{}'::uuid[]);
  v_active jsonb;
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
    raise exception 'Only the conversation creator can change sharing.' using errcode = '42501';
  end if;
  perform private.require_owned_department_chat_conversation(
    p_conversation_id, p_organization_id, p_project_id, p_engagement_id,
    p_department_id, p_actor_id, false
  );
  if cardinality(v_recipient_ids) > 50
    or exists (select 1 from unnest(v_recipient_ids) recipient(id) where recipient.id is null or recipient.id = p_actor_id)
    or cardinality(v_recipient_ids) <> (select count(distinct recipient.id) from unnest(v_recipient_ids) recipient(id)) then
    raise exception 'Choose up to 50 distinct eligible recipients other than yourself.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_recipient_ids) recipient(id)
    where not private.is_current_department_chat_contributor(
      p_organization_id, p_project_id, p_engagement_id, p_department_id, recipient.id
    )
  ) then
    raise exception 'Every recipient must currently hold Workshop contribution permission.' using errcode = '42501';
  end if;

  update public.department_chat_conversation_shares
  set revoked_at = now(), updated_at = now()
  where conversation_id = p_conversation_id and organization_id = p_organization_id
    and revoked_at is null and recipient_id <> all(v_recipient_ids);

  insert into public.department_chat_conversation_shares (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, recipient_id, shared_by
  )
  select v_conversation.id, v_conversation.organization_id, v_conversation.project_id,
    v_conversation.engagement_id, v_conversation.department_id,
    v_conversation.owner_id, recipient.id, p_actor_id
  from unnest(v_recipient_ids) recipient(id)
  on conflict (conversation_id, recipient_id) do update
  set revoked_at = null, shared_by = excluded.shared_by,
      shared_at = case
        when department_chat_conversation_shares.revoked_at is null
          then department_chat_conversation_shares.shared_at
        else now()
      end,
      updated_at = now();

  select coalesce(jsonb_agg(jsonb_build_object(
    'recipient_id', share.recipient_id,
    'shared_at', share.shared_at
  ) order by share.recipient_id), '[]'::jsonb)
  into v_active
  from public.department_chat_conversation_shares share
  where share.conversation_id = p_conversation_id and share.revoked_at is null;
  return jsonb_build_object('conversation_id', p_conversation_id, 'recipients', v_active);
end;
$$;

create or replace function private.protect_department_chat_proposal_conversation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.conversation_id is not null
     and (
       new.conversation_id is distinct from old.conversation_id
       or new.conversation_owner_id is distinct from old.conversation_owner_id
     ) then
    raise exception 'Department Chat proposal conversation is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.protect_department_chat_proposal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status = 'pending'
     and old.conversation_id is null and old.conversation_owner_id is null
     and new.conversation_id is not null and new.conversation_owner_id is not null
     and (to_jsonb(new) - array['conversation_id', 'conversation_owner_id', 'updated_at'])
       = (to_jsonb(old) - array['conversation_id', 'conversation_owner_id', 'updated_at']) then
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
     or new.conversation_owner_id is distinct from old.conversation_owner_id
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

revoke all on function private.is_current_department_chat_contributor(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function private.require_accessible_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function private.is_current_department_chat_contributor(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function private.require_accessible_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid, boolean) to service_role;
revoke all on function public.can_access_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.can_access_department_chat_conversation(uuid, uuid, uuid, uuid, text, uuid)
  to service_role;
revoke all on function private.protect_department_chat_proposal_conversation() from public, anon, authenticated;
grant execute on function private.protect_department_chat_proposal_conversation() to service_role;
revoke all on function private.protect_department_chat_proposal() from public, anon, authenticated;
grant execute on function private.protect_department_chat_proposal() to service_role;
revoke all on function public.set_department_chat_conversation_shares(uuid, uuid, uuid, uuid, text, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.set_department_chat_conversation_shares(uuid, uuid, uuid, uuid, text, uuid, uuid[]) to service_role;

comment on table public.department_chat_conversation_shares is
  'Creator-controlled, revocable internal recipients for one fixed Department Chat context; grants no project, tool, approval, release, or publication authority.';
comment on function public.set_department_chat_conversation_shares(uuid, uuid, uuid, uuid, text, uuid, uuid[]) is
  'Atomically replaces active recipients after checking current internal Workshop contribution authority.';

commit;
