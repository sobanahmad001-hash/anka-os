-- Anka OS - QTS2 owner-private sandbox chat.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.ai_runs drop constraint ai_runs_capability_check;
alter table public.ai_runs add constraint ai_runs_capability_check check (capability in (
  'project_pulse', 'daily_brief', 'research_support', 'writing_support',
  'quality_review', 'action_proposal', 'quick_task_chat'
));

alter table public.ai_runs
  add column quick_task_id uuid,
  add column quick_task_revision_id uuid,
  add column department_id text references public.departments(id) on delete restrict,
  add column connector_connection_id uuid,
  add constraint ai_runs_id_organization_user_unique unique (id, organization_id, user_id),
  add constraint ai_runs_quick_task_fkey foreign key (quick_task_id, organization_id, user_id)
    references public.quick_tasks(id, organization_id, owner_id) on delete restrict,
  add constraint ai_runs_quick_task_revision_fkey foreign key (quick_task_revision_id, quick_task_id, organization_id, user_id)
    references public.quick_task_revisions(id, quick_task_id, organization_id, owner_id) on delete restrict,
  add constraint ai_runs_connector_fkey foreign key (connector_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete restrict,
  add constraint ai_runs_quick_task_context_check check (
    (capability = 'quick_task_chat' and project_id is null and engagement_id is null
      and quick_task_id is not null and quick_task_revision_id is not null
      and department_id is not null and connector_connection_id is not null
      and proposed_action is null and human_decision = 'not_applicable')
    or
    (capability <> 'quick_task_chat' and quick_task_id is null and quick_task_revision_id is null
      and department_id is null and connector_connection_id is null)
  );

drop policy "Leaders can audit organization AI runs" on public.ai_runs;
create policy "Leaders can audit organization AI runs"
on public.ai_runs for select to authenticated
using (
  redacted_at is null
  and capability <> 'quick_task_chat'
  and public.has_organization_role(
    organization_id,
    array['system_owner', 'operations_admin', 'executive']
  )
);

alter table public.quick_task_revisions
  add column source_kind text not null default 'manual',
  add column ai_run_id uuid,
  add constraint quick_task_revisions_source_kind_check check (
    source_kind in ('manual', 'quick_chat', 'copied_general_request', 'copied_department_chat')
  ),
  add constraint quick_task_revisions_quick_chat_ai_check check (source_kind <> 'quick_chat' or ai_run_id is not null),
  add constraint quick_task_revisions_ai_run_fkey foreign key (ai_run_id, organization_id, owner_id)
    references public.ai_runs(id, organization_id, user_id) on delete restrict;

create table public.quick_task_messages (
  id uuid primary key default gen_random_uuid(),
  quick_task_id uuid not null,
  quick_task_revision_id uuid not null,
  organization_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('user', 'assistant', 'system_summary')),
  body text not null check (char_length(btrim(body)) between 1 and 50000),
  ai_run_id uuid,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint quick_task_messages_task_fkey foreign key (quick_task_id, organization_id, owner_id)
    references public.quick_tasks(id, organization_id, owner_id) on delete restrict,
  constraint quick_task_messages_revision_fkey foreign key (quick_task_revision_id, quick_task_id, organization_id, owner_id)
    references public.quick_task_revisions(id, quick_task_id, organization_id, owner_id) on delete restrict,
  constraint quick_task_messages_ai_run_fkey foreign key (ai_run_id, organization_id, owner_id)
    references public.ai_runs(id, organization_id, user_id) on delete restrict,
  constraint quick_task_messages_ai_role_check check (
    (role in ('user', 'assistant') and ai_run_id is not null) or role = 'system_summary'
  )
);

create unique index idx_quick_task_messages_ai_role on public.quick_task_messages(ai_run_id, role)
  where ai_run_id is not null and role in ('user', 'assistant');
create index idx_quick_task_messages_task_owner_created
  on public.quick_task_messages(quick_task_id, organization_id, owner_id, created_at);
create index idx_quick_task_messages_revision_fk
  on public.quick_task_messages(quick_task_revision_id, quick_task_id, organization_id, owner_id);
create index idx_quick_task_messages_ai_run_fk on public.quick_task_messages(ai_run_id, organization_id, owner_id)
  where ai_run_id is not null;
create index idx_quick_task_messages_actor on public.quick_task_messages(actor_id, created_at desc);
create index idx_quick_task_messages_owner on public.quick_task_messages(owner_id, created_at desc);
create index idx_quick_task_revisions_ai_run_fk on public.quick_task_revisions(ai_run_id, organization_id, owner_id)
  where ai_run_id is not null;
create index idx_ai_runs_quick_task_fk on public.ai_runs(quick_task_id, organization_id, user_id, created_at desc)
  where quick_task_id is not null;
create index idx_ai_runs_quick_task_revision_fk
  on public.ai_runs(quick_task_revision_id, quick_task_id, organization_id, user_id)
  where quick_task_revision_id is not null;
create index idx_ai_runs_connector_fk on public.ai_runs(connector_connection_id, organization_id)
  where connector_connection_id is not null;
create index idx_ai_runs_qts_department on public.ai_runs(department_id, organization_id, created_at desc)
  where capability = 'quick_task_chat';

create trigger trg_quick_task_messages_append_only before update or delete on public.quick_task_messages
for each row execute function private.reject_quick_task_history_mutation();

alter table public.quick_task_messages enable row level security;
create policy "Owners can read their Quick Task messages" on public.quick_task_messages for select to authenticated
using (owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id));

revoke all on table public.quick_task_messages from public, anon, authenticated;
grant select on table public.quick_task_messages to authenticated, service_role;
grant all on table public.quick_task_messages to service_role;

create function private.is_valid_quick_task_sandbox_content(value jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case
    when jsonb_typeof(value) = 'object'
      and value - array['notes', 'checklist'] = '{}'::jsonb
      and jsonb_typeof(value -> 'notes') = 'string'
      and char_length(value ->> 'notes') <= 50000
      and jsonb_typeof(value -> 'checklist') = 'array'
      and jsonb_array_length(value -> 'checklist') <= 100
    then not exists (
        select 1 from jsonb_array_elements(value -> 'checklist') item
        where jsonb_typeof(item) <> 'object'
          or item - array['text', 'done'] <> '{}'::jsonb
          or jsonb_typeof(item -> 'text') <> 'string'
          or char_length(btrim(item ->> 'text')) not between 1 and 500
          or jsonb_typeof(item -> 'done') <> 'boolean'
      )
    else false
  end;
$$;

create function private.require_quick_task_chat_authority(
  p_quick_task_id uuid, p_expected_revision_id uuid, p_actor_id uuid,
  p_department_id text, p_connector_connection_id uuid
) returns public.quick_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task public.quick_tasks;
begin
  select task.* into v_task from public.quick_tasks task
  where task.id = p_quick_task_id and task.owner_id = p_actor_id;
  if not found then raise exception 'Owned Quick Task not found.'; end if;
  if v_task.state <> 'active' then raise exception 'Only active Quick Tasks can use sandbox chat.'; end if;
  if v_task.current_revision_id <> p_expected_revision_id then raise exception 'Quick Task changed; reload before chatting.'; end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = v_task.organization_id and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
      and (membership.department_id = p_department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive'))
  ) then raise exception 'Active department membership or organization leadership required.'; end if;
  if not exists (
    select 1 from public.integration_connections connection
    join public.integration_connection_departments mapping
      on mapping.connection_id = connection.id and mapping.organization_id = connection.organization_id
    where connection.id = p_connector_connection_id and connection.organization_id = v_task.organization_id
      and connection.provider = 'openai' and connection.status = 'verified' and connection.archived_at is null
      and mapping.department_id = p_department_id
  ) then raise exception 'Verified department OpenAI mapping required.'; end if;
  return v_task;
end;
$$;

create function public.record_quick_task_chat_success(
  p_quick_task_id uuid, p_expected_revision_id uuid, p_actor_id uuid,
  p_department_id text, p_connector_connection_id uuid, p_model text,
  p_prompt text, p_output text, p_content jsonb, p_input_tokens integer,
  p_output_tokens integer, p_estimated_cost_microusd bigint, p_latency_ms integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.quick_tasks;
  v_revision public.quick_task_revisions;
  v_ai_run_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
  v_revision_number integer;
begin
  select task.* into v_task from public.quick_tasks task
  where task.id = p_quick_task_id and task.owner_id = p_actor_id for update;
  if not found then raise exception 'Owned Quick Task not found.'; end if;
  perform private.require_quick_task_chat_authority(
    p_quick_task_id, p_expected_revision_id, p_actor_id, p_department_id, p_connector_connection_id
  );
  if char_length(btrim(coalesce(p_prompt, ''))) not between 1 and 8000 then raise exception 'Sandbox prompt must be between 1 and 8000 characters.'; end if;
  if char_length(btrim(coalesce(p_output, ''))) not between 1 and 50000 then raise exception 'Sandbox output must be between 1 and 50000 characters.'; end if;
  if not private.is_valid_quick_task_sandbox_content(p_content) then raise exception 'Sandbox output is not a valid Quick Task revision.'; end if;
  if char_length(btrim(coalesce(p_model, ''))) not between 1 and 120 then raise exception 'Model is required.'; end if;
  if p_input_tokens is not null and p_input_tokens < 0 then raise exception 'Input tokens cannot be negative.'; end if;
  if p_output_tokens is not null and p_output_tokens < 0 then raise exception 'Output tokens cannot be negative.'; end if;
  if p_estimated_cost_microusd is not null and p_estimated_cost_microusd < 0 then raise exception 'Estimated cost cannot be negative.'; end if;
  if p_latency_ms is not null and p_latency_ms < 0 then raise exception 'Latency cannot be negative.'; end if;

  v_revision_number := v_task.current_revision_number + 1;
  insert into public.ai_runs (
    id, organization_id, project_id, engagement_id, user_id, capability, status,
    provider, model, input_text, output_text, context_manifest, latency_ms,
    input_tokens, output_tokens, estimated_cost_microusd, human_decision,
    quick_task_id, quick_task_revision_id, department_id, connector_connection_id
  ) values (
    v_ai_run_id, v_task.organization_id, null, null, p_actor_id, 'quick_task_chat', 'completed',
    'openai', btrim(p_model), btrim(p_prompt), btrim(p_output),
    jsonb_build_object('purpose', 'quick_task_sandbox_revision', 'department_id', p_department_id,
      'connector_connection_id', p_connector_connection_id,
      'source_quick_task_revision_id', p_expected_revision_id,
      'generated_quick_task_revision_id', v_revision_id, 'upstream_retention', 'disabled'),
    p_latency_ms, p_input_tokens, p_output_tokens, p_estimated_cost_microusd,
    'not_applicable', v_task.id, p_expected_revision_id, p_department_id, p_connector_connection_id
  );

  insert into public.quick_task_revisions (
    id, quick_task_id, organization_id, owner_id, revision_number, content,
    content_sha256, created_by, source_kind, ai_run_id
  ) values (
    v_revision_id, v_task.id, v_task.organization_id, v_task.owner_id, v_revision_number,
    p_content, encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex'),
    p_actor_id, 'quick_chat', v_ai_run_id
  ) returning * into v_revision;

  insert into public.quick_task_messages (
    quick_task_id, quick_task_revision_id, organization_id, owner_id, role, body, ai_run_id, actor_id
  ) values
    (v_task.id, p_expected_revision_id, v_task.organization_id, v_task.owner_id,
      'user', btrim(p_prompt), v_ai_run_id, p_actor_id),
    (v_task.id, v_revision_id, v_task.organization_id, v_task.owner_id,
      'assistant', coalesce(nullif(btrim(p_content ->> 'notes'), ''), btrim(p_output)), v_ai_run_id, p_actor_id);

  update public.quick_tasks task set current_revision_id = v_revision_id,
    current_revision_number = v_revision_number, last_activity_at = now(),
    expires_at = now() + interval '30 days', recoverable_until = null, updated_at = now()
  where task.id = v_task.id returning * into v_task;

  insert into public.quick_task_lifecycle_events (
    quick_task_id, organization_id, owner_id, actor_id, event_type, revision_number, from_state, to_state
  ) values (v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id,
    'revision_appended', v_revision_number, 'active', 'active');

  return jsonb_build_object('task', to_jsonb(v_task), 'revision', to_jsonb(v_revision), 'ai_run_id', v_ai_run_id);
end;
$$;

create function public.record_quick_task_chat_failure(
  p_quick_task_id uuid, p_expected_revision_id uuid, p_actor_id uuid,
  p_department_id text, p_connector_connection_id uuid, p_model text,
  p_prompt text, p_status text, p_failure_reason text, p_latency_ms integer
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_task public.quick_tasks; v_ai_run_id uuid := gen_random_uuid();
begin
  select task.* into v_task from public.quick_tasks task
  where task.id = p_quick_task_id and task.owner_id = p_actor_id;
  if not found then raise exception 'Owned Quick Task not found.'; end if;
  if not exists (
    select 1 from public.quick_task_revisions revision
    where revision.id = p_expected_revision_id and revision.quick_task_id = v_task.id
      and revision.organization_id = v_task.organization_id and revision.owner_id = p_actor_id
  ) then raise exception 'Quick Task revision not found.'; end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = v_task.organization_id and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
      and (membership.department_id = p_department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive'))
  ) then raise exception 'Active department membership or organization leadership required.'; end if;
  if not exists (
    select 1 from public.integration_connections connection
    join public.integration_connection_departments mapping
      on mapping.connection_id = connection.id and mapping.organization_id = connection.organization_id
    where connection.id = p_connector_connection_id and connection.organization_id = v_task.organization_id
      and connection.provider = 'openai' and connection.status = 'verified' and connection.archived_at is null
      and mapping.department_id = p_department_id
  ) then raise exception 'Verified department OpenAI mapping required.'; end if;
  if p_status not in ('failed', 'blocked') then raise exception 'Failure status must be failed or blocked.'; end if;
  if char_length(btrim(coalesce(p_prompt, ''))) not between 1 and 8000 then raise exception 'Sandbox prompt must be between 1 and 8000 characters.'; end if;
  if char_length(btrim(coalesce(p_model, ''))) not between 1 and 120 then raise exception 'Model is required.'; end if;
  if p_latency_ms is not null and p_latency_ms < 0 then raise exception 'Latency cannot be negative.'; end if;
  insert into public.ai_runs (
    id, organization_id, project_id, engagement_id, user_id, capability, status,
    provider, model, input_text, output_text, context_manifest, latency_ms,
    human_decision, quick_task_id, quick_task_revision_id, department_id, connector_connection_id
  ) values (
    v_ai_run_id, v_task.organization_id, null, null, p_actor_id, 'quick_task_chat', p_status,
    'openai', btrim(p_model), btrim(p_prompt), '',
    jsonb_build_object('purpose', 'quick_task_sandbox_revision', 'department_id', p_department_id,
      'connector_connection_id', p_connector_connection_id,
      'source_quick_task_revision_id', p_expected_revision_id, 'upstream_retention', 'disabled',
      'failure_reason', left(coalesce(p_failure_reason, 'Sandbox chat failed.'), 1000)),
    p_latency_ms, 'not_applicable', v_task.id, p_expected_revision_id,
    p_department_id, p_connector_connection_id
  );
  return v_ai_run_id;
end;
$$;

revoke all on function private.is_valid_quick_task_sandbox_content(jsonb) from public, anon, authenticated;
revoke all on function private.require_quick_task_chat_authority(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function private.is_valid_quick_task_sandbox_content(jsonb) to service_role;
grant execute on function private.require_quick_task_chat_authority(uuid, uuid, uuid, text, uuid) to service_role;
revoke all on function public.record_quick_task_chat_success(uuid, uuid, uuid, text, uuid, text, text, text, jsonb, integer, integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.record_quick_task_chat_failure(uuid, uuid, uuid, text, uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_quick_task_chat_success(uuid, uuid, uuid, text, uuid, text, text, text, jsonb, integer, integer, bigint, integer) to service_role;
grant execute on function public.record_quick_task_chat_failure(uuid, uuid, uuid, text, uuid, text, text, text, text, integer) to service_role;

comment on table public.quick_task_messages is 'Owner-private append-only QTS sandbox transcript; never canonical or leadership-readable.';
comment on function public.record_quick_task_chat_success(uuid, uuid, uuid, text, uuid, text, text, text, jsonb, integer, integer, bigint, integer) is 'Atomically audits one successful QTS chat and appends its validated sandbox revision.';
comment on function public.record_quick_task_chat_failure(uuid, uuid, uuid, text, uuid, text, text, text, text, integer) is 'Audits failed or blocked QTS chat without extending Quick Task expiry.';

commit;
