-- WCH3 - durable Department Chat proposals and atomic human confirmation.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_runs'::regclass
      and conname = 'ai_runs_id_organization_id_key'
  ) then
    alter table public.ai_runs
      add constraint ai_runs_id_organization_id_key unique (id, organization_id);
  end if;
end;
$$;

create table public.department_chat_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  engagement_id uuid not null,
  project_id uuid not null,
  department_id text not null references public.departments(id) on delete restrict,
  proposer_id uuid not null references auth.users(id) on delete restrict,
  proposal_kind text not null check (proposal_kind in ('artifact_version', 'work_item')),
  target_key text not null,
  artifact_id uuid,
  engagement_stage_instance_id uuid,
  validated_payload jsonb not null check (jsonb_typeof(validated_payload) = 'object' and octet_length(validated_payload::text) <= 80000),
  preview_payload jsonb not null check (jsonb_typeof(preview_payload) = 'object' and octet_length(preview_payload::text) <= 80000),
  safe_prompt_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_prompt_metadata) = 'object' and octet_length(safe_prompt_metadata::text) <= 4000),
  context_artifact_version_ids uuid[] not null default '{}'::uuid[],
  context_checksum text not null check (context_checksum ~ '^[a-f0-9]{64}$'),
  connector_connection_id uuid not null,
  model_id text not null check (length(trim(model_id)) between 1 and 160),
  ai_run_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired', 'stale')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  accepted_artifact_id uuid,
  accepted_artifact_version_id uuid,
  accepted_work_item_id uuid,
  idempotency_key uuid not null unique,
  failure_reason text not null default '' check (length(failure_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_chat_proposals_engagement_scope_fkey foreign key (engagement_id, project_id, organization_id)
    references public.engagements(id, project_id, organization_id) on delete cascade,
  constraint department_chat_proposals_ai_run_scope_fkey foreign key (ai_run_id, organization_id)
    references public.ai_runs(id, organization_id) on delete restrict,
  constraint department_chat_proposals_connector_scope_fkey foreign key (connector_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete restrict,
  constraint department_chat_proposals_artifact_scope_fkey foreign key (artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete restrict,
  constraint department_chat_proposals_stage_scope_fkey foreign key (engagement_stage_instance_id, organization_id)
    references public.engagement_stage_instances(id, organization_id) on delete restrict,
  constraint department_chat_proposals_accepted_artifact_scope_fkey foreign key (accepted_artifact_id, organization_id)
    references public.artifacts(id, organization_id) on delete restrict,
  constraint department_chat_proposals_accepted_version_scope_fkey foreign key (accepted_artifact_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  constraint department_chat_proposals_accepted_work_item_scope_fkey foreign key (accepted_work_item_id, organization_id)
    references public.work_items(id, organization_id) on delete restrict,
  constraint department_chat_proposals_target_allowlist_check check (
    (proposal_kind = 'artifact_version' and (
      (department_id = 'content' and target_key in ('discovery', 'vision', 'audience', 'website_architecture', 'keyword_strategy', 'content', 'campaign_messaging', 'scripts'))
      or (department_id = 'design' and target_key = 'design_system')
      or (department_id = 'marketing' and target_key in ('channel_strategy', 'campaign_brief', 'measurement_plan'))
      or (department_id = 'development' and target_key in ('technical_brief', 'launch_checklist'))
    ))
    or (proposal_kind = 'work_item' and department_id in ('content', 'design', 'marketing', 'development') and target_key in ('task', 'bug', 'request'))
  ),
  constraint department_chat_proposals_lifecycle_check check (
    (status = 'pending' and decided_by is null and decided_at is null and accepted_artifact_id is null and accepted_artifact_version_id is null and accepted_work_item_id is null)
    or (status = 'accepted' and decided_by is not null and decided_at is not null and (
      (proposal_kind = 'artifact_version' and accepted_artifact_id is not null and accepted_artifact_version_id is not null and accepted_work_item_id is null)
      or (proposal_kind = 'work_item' and accepted_artifact_id is null and accepted_artifact_version_id is null and accepted_work_item_id is not null)
    ))
    or (status in ('rejected', 'expired', 'stale') and decided_by is not null and decided_at is not null and accepted_artifact_id is null and accepted_artifact_version_id is null and accepted_work_item_id is null)
  ),
  constraint department_chat_proposals_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  unique (id, organization_id)
);

create index idx_department_chat_proposals_proposer_pending on public.department_chat_proposals(proposer_id, expires_at, created_at desc) where status = 'pending';
create index idx_department_chat_proposals_engagement on public.department_chat_proposals(organization_id, engagement_id, created_at desc);
create index idx_department_chat_proposals_project_fk on public.department_chat_proposals(project_id, organization_id);
create index idx_department_chat_proposals_connector_fk on public.department_chat_proposals(connector_connection_id, organization_id);
create index idx_department_chat_proposals_artifact_fk on public.department_chat_proposals(artifact_id, organization_id) where artifact_id is not null;
create index idx_department_chat_proposals_stage_fk on public.department_chat_proposals(engagement_stage_instance_id, organization_id) where engagement_stage_instance_id is not null;
create index idx_department_chat_proposals_accepted_artifact_fk on public.department_chat_proposals(accepted_artifact_id, organization_id) where accepted_artifact_id is not null;
create index idx_department_chat_proposals_accepted_version_fk on public.department_chat_proposals(accepted_artifact_version_id, organization_id) where accepted_artifact_version_id is not null;
create index idx_department_chat_proposals_accepted_work_item_fk on public.department_chat_proposals(accepted_work_item_id, organization_id) where accepted_work_item_id is not null;

alter table public.department_chat_proposals enable row level security;
create policy "Proposers and leaders can read Department Chat proposals"
  on public.department_chat_proposals for select to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and exists (select 1 from public.organizations organization where organization.id = department_chat_proposals.organization_id and organization.status = 'active')
    and (proposer_id = (select auth.uid()) or public.has_organization_role(organization_id, array['system_owner', 'operations_admin', 'executive']))
  );
revoke all on public.department_chat_proposals from anon, authenticated;
grant select on public.department_chat_proposals to authenticated;
grant all on public.department_chat_proposals to service_role;

create or replace function private.protect_department_chat_proposal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
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
     or new.connector_connection_id is distinct from old.connector_connection_id
     or new.model_id is distinct from old.model_id
     or new.ai_run_id is distinct from old.ai_run_id
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

-- WCH-owned bounded audit vocabulary avoids changes to shared event enums.
create table public.department_chat_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references auth.users(id),
  proposal_id uuid,
  ai_run_id uuid,
  event_kind text not null check (event_kind in ('preview_requested', 'preview_generated', 'preview_blocked', 'preview_failed', 'confirmed', 'rejected', 'expired', 'stale', 'replay', 'official_record_created', 'atomic_failure')),
  reason_code text not null default '' check (reason_code in ('', 'policy_denied', 'connector_unavailable', 'model_missing', 'credential_missing', 'invalid_output', 'provider_failed', 'context_changed', 'proposal_expired', 'atomic_write_failed')),
  created_at timestamptz not null default now(),
  constraint department_chat_audit_proposal_scope_fkey foreign key (proposal_id, organization_id)
    references public.department_chat_proposals(id, organization_id) on delete restrict,
  constraint department_chat_audit_ai_run_scope_fkey foreign key (ai_run_id, organization_id)
    references public.ai_runs(id, organization_id) on delete restrict
);
create index department_chat_audit_proposal_idx on public.department_chat_audit_events(proposal_id, organization_id, created_at);
create index department_chat_audit_ai_run_idx on public.department_chat_audit_events(ai_run_id, organization_id) where ai_run_id is not null;
create index department_chat_audit_org_idx on public.department_chat_audit_events(organization_id, created_at);
alter table public.department_chat_audit_events enable row level security;
revoke all on public.department_chat_audit_events from public, anon, authenticated, service_role;
grant select, insert on public.department_chat_audit_events to service_role;

create function public.record_department_chat_attempt(p_organization_id uuid, p_actor_id uuid, p_event_kind text, p_reason_code text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_event_kind not in ('preview_requested', 'preview_blocked', 'preview_failed') then
    raise exception 'Invalid attempt event.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = p_organization_id and membership.user_id = p_actor_id
      and membership.status = 'active' and membership.member_kind = 'team'
  ) then raise exception 'Active team organization required.' using errcode = '42501'; end if;
  insert into public.department_chat_audit_events(organization_id, actor_id, event_kind, reason_code)
  values (p_organization_id, p_actor_id, p_event_kind, p_reason_code);
end;
$$;
revoke all on function public.record_department_chat_attempt(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_department_chat_attempt(uuid, uuid, text, text) to service_role;

create function private.audit_department_chat_proposal()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.department_chat_audit_events(organization_id, actor_id, proposal_id, ai_run_id, event_kind, reason_code)
  values (new.organization_id, coalesce(new.decided_by, new.proposer_id), new.id, new.ai_run_id,
    case new.status when 'pending' then 'preview_generated' when 'accepted' then 'confirmed' else new.status end,
    case new.status when 'stale' then 'context_changed' when 'expired' then 'proposal_expired' else '' end);
  if new.status = 'accepted' then
    insert into public.department_chat_audit_events(organization_id, actor_id, proposal_id, ai_run_id, event_kind)
    values (new.organization_id, new.decided_by, new.id, new.ai_run_id, 'official_record_created');
  end if;
  return new;
end;
$$;
create trigger trg_department_chat_audit after insert or update on public.department_chat_proposals
for each row execute function private.audit_department_chat_proposal();

create trigger trg_department_chat_proposals_protect
before update on public.department_chat_proposals
for each row execute function private.protect_department_chat_proposal();

create or replace function public.save_department_chat_proposal(
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
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_engagement public.engagements;
  v_proposal_id uuid := gen_random_uuid();
  v_ai_run_id uuid;
  v_proposal public.department_chat_proposals;
begin
  select engagement.* into v_engagement
  from public.engagements engagement
  where engagement.id = p_engagement_id
    and engagement.project_id = p_project_id
    and engagement.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'Department Chat engagement context changed.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and (
        membership.department_id = p_department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive')
      )
  ) then
    raise exception 'Active team membership required.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.integration_connections connection
    join public.integration_connection_departments department
      on department.connection_id = connection.id
     and department.organization_id = connection.organization_id
     and department.department_id = p_department_id
    join public.integration_connection_engagements mapping
      on mapping.connection_id = connection.id
     and mapping.organization_id = connection.organization_id
     and mapping.engagement_id = p_engagement_id
     and mapping.department_id = p_department_id
    where connection.id = p_connector_connection_id
      and connection.organization_id = p_organization_id
      and connection.provider = 'openai'
      and connection.status = 'verified'
      and connection.archived_at is null
      and connection.public_config ->> 'model_id' = p_model_id
  ) then
    raise exception 'Department Chat connector context changed.' using errcode = '23514';
  end if;
  if (select count(*) from public.integration_connections c
      join public.integration_connection_departments d on d.connection_id=c.id and d.organization_id=c.organization_id
      join public.integration_connection_engagements e on e.connection_id=c.id and e.organization_id=c.organization_id and e.department_id=d.department_id
      where c.organization_id=p_organization_id and c.provider='openai' and c.status='verified' and c.archived_at is null
        and d.department_id=p_department_id and e.engagement_id=p_engagement_id) <> 1
    or not exists(select 1 from public.engagement_services s join public.service_catalog c on c.id=s.service_id
      where s.organization_id=p_organization_id and s.engagement_id=p_engagement_id and s.status='active' and c.department_id=p_department_id) then
    raise exception 'Department Chat connector or service policy changed.' using errcode = '23514';
  end if;
  if p_artifact_id is not null and not exists (
    select 1 from public.artifacts artifact
    where artifact.id = p_artifact_id
      and artifact.organization_id = p_organization_id
      and artifact.project_id = p_project_id
      and artifact.engagement_id = p_engagement_id
      and artifact.artifact_type = p_target_key
  ) then
    raise exception 'Proposal artifact does not match its engagement and type.' using errcode = '23514';
  end if;
  if p_engagement_stage_instance_id is not null and not exists (
    select 1 from public.engagement_stage_instances stage
    where stage.id = p_engagement_stage_instance_id
      and stage.organization_id = p_organization_id
      and stage.engagement_id = p_engagement_id
      and stage.accountable_department_id = p_department_id
  ) then
    raise exception 'Proposal stage does not match its department and engagement.' using errcode = '23514';
  end if;

  insert into public.ai_runs (
    organization_id, project_id, engagement_id, user_id, capability, status,
    provider, model, input_text, output_text, context_manifest, proposed_action,
    latency_ms, input_tokens, output_tokens, estimated_cost_microusd, human_decision
  ) values (
    p_organization_id, p_project_id, p_engagement_id, p_actor_id,
    'action_proposal', 'completed', 'openai', p_model_id,
    '', '', -- WCH retains validated payload and prompt digest only, never raw prompts/provider output.
    jsonb_build_object(
      'purpose', p_department_id || '_' || p_proposal_kind || '_proposal',
      'profile_version', 'wch2-v1', 'department_id', p_department_id,
      'proposal_kind', p_proposal_kind, 'target_key', p_target_key,
      'connector_connection_id', p_connector_connection_id,
      'model_id', p_model_id, 'context_checksum', p_context_checksum,
      'approved_artifact_version_ids', to_jsonb(coalesce(p_context_artifact_version_ids, '{}'::uuid[]))
    ),
    jsonb_build_object('proposal_id', v_proposal_id, 'proposal_kind', p_proposal_kind, 'target_key', p_target_key),
    p_latency_ms, p_input_tokens, p_output_tokens, p_estimated_cost_microusd,
    'pending'
  ) returning id into v_ai_run_id;

  insert into public.department_chat_proposals (
    id, organization_id, engagement_id, project_id, department_id, proposer_id,
    proposal_kind, target_key, artifact_id, engagement_stage_instance_id,
    validated_payload, preview_payload, safe_prompt_metadata,
    context_artifact_version_ids, context_checksum, connector_connection_id,
    model_id, ai_run_id, idempotency_key
  ) values (
    v_proposal_id, p_organization_id, p_engagement_id, p_project_id,
    p_department_id, p_actor_id, p_proposal_kind, p_target_key, p_artifact_id,
    p_engagement_stage_instance_id, p_validated_payload, p_preview_payload,
    p_safe_prompt_metadata, coalesce(p_context_artifact_version_ids, '{}'::uuid[]),
    p_context_checksum, p_connector_connection_id, p_model_id, v_ai_run_id,
    p_idempotency_key
  ) returning * into v_proposal;

  return jsonb_build_object(
    'proposal_id', v_proposal.id, 'ai_run_id', v_proposal.ai_run_id,
    'status', v_proposal.status, 'proposal_kind', v_proposal.proposal_kind,
    'target_key', v_proposal.target_key, 'preview', v_proposal.preview_payload,
    'expires_at', v_proposal.expires_at, 'model', v_proposal.model_id,
    'connector_connection_id', v_proposal.connector_connection_id
  );
end;
$$;

create or replace function public.confirm_department_chat_proposal(
  p_proposal_id uuid, p_actor_id uuid, p_context_checksum text,
  p_connector_connection_id uuid, p_model_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proposal public.department_chat_proposals;
  v_engagement public.engagements;
  v_artifact public.artifacts;
  v_version public.artifact_versions;
  v_latest public.artifact_versions;
  v_work_item public.work_items;
  v_artifact_id uuid;
  v_content jsonb;
  v_content_checksum text;
  v_connector_count integer;
begin
  select proposal.* into v_proposal
  from public.department_chat_proposals proposal
  where proposal.id = p_proposal_id
  for update;
  if not found then
    raise exception 'Department Chat proposal not found.' using errcode = 'P0002';
  end if;
  if v_proposal.proposer_id <> p_actor_id then
    raise exception 'Only the proposer can confirm this proposal.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = v_proposal.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and (
        membership.department_id = v_proposal.department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive')
      )
  ) then
    raise exception 'Department Chat authority changed.' using errcode = '42501';
  end if;
  if v_proposal.status = 'accepted' then
    insert into public.department_chat_audit_events(organization_id, actor_id, proposal_id, ai_run_id, event_kind)
    values (v_proposal.organization_id, p_actor_id, v_proposal.id, v_proposal.ai_run_id, 'replay');
    return jsonb_build_object(
      'outcome', 'accepted', 'replayed', true, 'proposal_id', v_proposal.id,
      'artifact_id', v_proposal.accepted_artifact_id,
      'artifact_version_id', v_proposal.accepted_artifact_version_id,
      'work_item_id', v_proposal.accepted_work_item_id
    );
  end if;
  if v_proposal.status <> 'pending' then
    return jsonb_build_object('outcome', v_proposal.status, 'proposal_id', v_proposal.id);
  end if;
  if v_proposal.expires_at <= now() then
    update public.department_chat_proposals
    set status = 'expired', decided_by = p_actor_id, decided_at = now(),
        failure_reason = 'proposal_expired'
    where id = v_proposal.id;
    update public.ai_runs
    set human_decision = 'rejected', decision_outcome = 'proposal_expired',
        decided_by = p_actor_id, decided_at = now()
    where id = v_proposal.ai_run_id;
    return jsonb_build_object('outcome', 'expired', 'proposal_id', v_proposal.id);
  end if;
  if v_proposal.context_checksum is distinct from p_context_checksum
     or v_proposal.connector_connection_id is distinct from p_connector_connection_id
     or v_proposal.model_id is distinct from p_model_id then
    update public.department_chat_proposals
    set status = 'stale', decided_by = p_actor_id, decided_at = now(),
        failure_reason = 'context_changed_regenerate'
    where id = v_proposal.id;
    update public.ai_runs
    set human_decision = 'rejected', decision_outcome = 'context_changed_regenerate',
        decided_by = p_actor_id, decided_at = now()
    where id = v_proposal.ai_run_id;
    return jsonb_build_object('outcome', 'stale', 'proposal_id', v_proposal.id);
  end if;

  select count(*) into v_connector_count
  from public.integration_connections connection
  join public.integration_connection_departments department
    on department.connection_id = connection.id
   and department.organization_id = connection.organization_id
   and department.department_id = v_proposal.department_id
  join public.integration_connection_engagements mapping
    on mapping.connection_id = connection.id
   and mapping.organization_id = connection.organization_id
   and mapping.engagement_id = v_proposal.engagement_id
   and mapping.department_id = v_proposal.department_id
  where connection.organization_id = v_proposal.organization_id
    and connection.provider = 'openai'
    and connection.status = 'verified'
    and connection.archived_at is null;
  if v_connector_count <> 1 or not exists (
    select 1
    from public.integration_connections connection
    join public.integration_connection_departments department
      on department.connection_id = connection.id
     and department.organization_id = connection.organization_id
     and department.department_id = v_proposal.department_id
    join public.integration_connection_engagements mapping
      on mapping.connection_id = connection.id
     and mapping.organization_id = connection.organization_id
     and mapping.engagement_id = v_proposal.engagement_id
     and mapping.department_id = v_proposal.department_id
    where connection.id = p_connector_connection_id
      and connection.organization_id = v_proposal.organization_id
      and connection.provider = 'openai'
      and connection.status = 'verified'
      and connection.archived_at is null
      and connection.public_config ->> 'model_id' = p_model_id
  ) or not exists (
    select 1 from public.engagement_services service
    join public.service_catalog catalog on catalog.id = service.service_id
    where service.organization_id = v_proposal.organization_id
      and service.engagement_id = v_proposal.engagement_id
      and service.status = 'active'
      and catalog.department_id = v_proposal.department_id
  ) then
    raise exception 'Department Chat connector or service policy changed.' using errcode = '23514';
  end if;

  select engagement.* into v_engagement
  from public.engagements engagement
  where engagement.id = v_proposal.engagement_id
    and engagement.project_id = v_proposal.project_id
    and engagement.organization_id = v_proposal.organization_id
  for share;
  if not found then
    raise exception 'Department Chat engagement context changed.' using errcode = '23514';
  end if;

  begin
  if v_proposal.proposal_kind = 'artifact_version' then
    v_artifact_id := v_proposal.artifact_id;
    if v_artifact_id is not null then
      select artifact.* into v_artifact
      from public.artifacts artifact
      where artifact.id = v_artifact_id
        and artifact.organization_id = v_proposal.organization_id
        and artifact.project_id = v_proposal.project_id
        and artifact.engagement_id = v_proposal.engagement_id
        and artifact.artifact_type = v_proposal.target_key
      for update;
      if not found then
        raise exception 'Proposal artifact changed or is unavailable.' using errcode = '23514';
      end if;
    else
      insert into public.artifacts (
        organization_id, project_id, brand_id, engagement_id,
        engagement_stage_instance_id, artifact_type, title, created_by
      ) values (
        v_proposal.organization_id, v_proposal.project_id, v_engagement.brand_id,
        v_proposal.engagement_id, v_proposal.engagement_stage_instance_id,
        v_proposal.target_key,
        left(trim(v_proposal.validated_payload ->> 'title'), 240), p_actor_id
      ) returning * into v_artifact;
      v_artifact_id := v_artifact.id;
    end if;

    select version.* into v_latest
    from public.artifact_versions version
    where version.artifact_id = v_artifact_id
    order by version.version_number desc limit 1 for update;
    v_content := v_proposal.validated_payload -> 'content';
    if jsonb_typeof(v_content) <> 'object' then
      raise exception 'Validated artifact payload is invalid.' using errcode = '23514';
    end if;
    v_content_checksum := encode(
      extensions.digest(convert_to(v_content::text, 'UTF8'), 'sha256'),
      'hex'
    );
    insert into public.artifact_versions (
      organization_id, artifact_id, version_number, parent_version_id,
      content, content_checksum, change_summary, ai_use_allowed,
      data_classification, created_by
    ) values (
      v_proposal.organization_id, v_artifact_id,
      coalesce(v_latest.version_number, 0) + 1, v_latest.id, v_content,
      v_content_checksum,
      left(coalesce(v_proposal.validated_payload ->> 'change_summary', 'Confirmed Department Chat draft'), 1000),
      false, 'internal', p_actor_id
    ) returning * into v_version;
    insert into public.engagement_events (
      organization_id, engagement_id, event_type, actor_id, payload
    ) values (
      v_proposal.organization_id, v_proposal.engagement_id,
      'artifact_draft_proposed_via_chat', p_actor_id,
      jsonb_build_object(
        'record_type', 'artifact', 'record_id', v_artifact_id,
        'version_id', v_version.id, 'action', 'confirmed_chat_draft',
        'artifact_type', v_proposal.target_key, 'source', 'department_chat',
        'proposal_id', v_proposal.id, 'ai_run_id', v_proposal.ai_run_id
      )
    );
    update public.department_chat_proposals
    set status = 'accepted', decided_by = p_actor_id, decided_at = now(),
        accepted_artifact_id = v_artifact_id,
        accepted_artifact_version_id = v_version.id
    where id = v_proposal.id;
  else
    select * into v_work_item from public.save_work_item(
      p_work_item_id => null, p_engagement_id => v_proposal.engagement_id,
      p_title => v_proposal.validated_payload ->> 'title',
      p_description => v_proposal.validated_payload ->> 'description',
      p_work_item_type => v_proposal.target_key,
      p_priority => v_proposal.validated_payload ->> 'priority',
      p_status => 'not_started', p_assignee_id => null,
      p_department_id => v_proposal.department_id,
      p_linked_artifact_id => null, p_linked_artifact_version_id => null,
      p_linked_engagement_stage_instance_id => null,
      p_start_date => null, p_due_date => null, p_position => 0,
      p_parent_work_item_id => null, p_actor_id => p_actor_id,
      p_created_via => 'ai_chat_proposal'
    );
    update public.engagement_events
    set payload = payload || jsonb_build_object('proposal_id', v_proposal.id, 'ai_run_id', v_proposal.ai_run_id)
    where organization_id = v_proposal.organization_id and engagement_id = v_proposal.engagement_id
      and event_type = 'work_item_created' and payload ->> 'record_id' = v_work_item.id::text;
    update public.department_chat_proposals
    set status = 'accepted', decided_by = p_actor_id, decided_at = now(),
        accepted_work_item_id = v_work_item.id
    where id = v_proposal.id;
  end if;

  update public.ai_runs
  set human_decision = 'accepted', decision_outcome = 'canonical_record_created',
      decided_by = p_actor_id, decided_at = now()
  where id = v_proposal.ai_run_id;
  return jsonb_build_object(
    'outcome', 'accepted', 'replayed', false, 'proposal_id', v_proposal.id,
    'artifact_id', v_artifact_id, 'artifact_version_id', v_version.id,
    'work_item_id', v_work_item.id
  );
  exception when others then
    insert into public.department_chat_audit_events(organization_id, actor_id, proposal_id, ai_run_id, event_kind, reason_code)
    values (v_proposal.organization_id, p_actor_id, v_proposal.id, v_proposal.ai_run_id, 'atomic_failure', 'atomic_write_failed');
    return jsonb_build_object('outcome', 'atomic_failure', 'proposal_id', v_proposal.id);
  end;
end;
$$;

create or replace function public.reject_department_chat_proposal(
  p_proposal_id uuid, p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proposal public.department_chat_proposals;
begin
  select proposal.* into v_proposal
  from public.department_chat_proposals proposal
  where proposal.id = p_proposal_id
  for update;
  if not found then
    raise exception 'Department Chat proposal not found.' using errcode = 'P0002';
  end if;
  if v_proposal.proposer_id <> p_actor_id then
    raise exception 'Only the proposer can reject this proposal.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = v_proposal.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and (
        membership.department_id = v_proposal.department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive')
      )
  ) then
    raise exception 'Department Chat authority changed.' using errcode = '42501';
  end if;
  if v_proposal.status = 'rejected' then
    insert into public.department_chat_audit_events(organization_id, actor_id, proposal_id, ai_run_id, event_kind)
    values (v_proposal.organization_id, p_actor_id, v_proposal.id, v_proposal.ai_run_id, 'replay');
    return jsonb_build_object('outcome', 'rejected', 'replayed', true, 'proposal_id', v_proposal.id);
  end if;
  if v_proposal.status <> 'pending' then
    return jsonb_build_object('outcome', v_proposal.status, 'proposal_id', v_proposal.id);
  end if;
  if v_proposal.expires_at <= now() then
    update public.department_chat_proposals
    set status = 'expired', decided_by = p_actor_id, decided_at = now(),
        failure_reason = 'proposal_expired'
    where id = v_proposal.id;
    update public.ai_runs
    set human_decision = 'rejected', decision_outcome = 'proposal_expired',
        decided_by = p_actor_id, decided_at = now()
    where id = v_proposal.ai_run_id;
    return jsonb_build_object('outcome', 'expired', 'proposal_id', v_proposal.id);
  end if;
  update public.department_chat_proposals
  set status = 'rejected', decided_by = p_actor_id, decided_at = now()
  where id = v_proposal.id;
  update public.ai_runs
  set human_decision = 'rejected', decision_outcome = 'proposal_rejected',
      decided_by = p_actor_id, decided_at = now()
  where id = v_proposal.ai_run_id;
  return jsonb_build_object('outcome', 'rejected', 'replayed', false, 'proposal_id', v_proposal.id);
end;
$$;

revoke all on function public.save_department_chat_proposal(
  uuid, uuid, uuid, text, uuid, text, text, uuid, uuid, jsonb, jsonb,
  jsonb, uuid[], text, uuid, text, uuid, text, text, integer, integer,
  integer, bigint
) from public, anon, authenticated;
grant execute on function public.save_department_chat_proposal(
  uuid, uuid, uuid, text, uuid, text, text, uuid, uuid, jsonb, jsonb,
  jsonb, uuid[], text, uuid, text, uuid, text, text, integer, integer,
  integer, bigint
) to service_role;
revoke all on function public.confirm_department_chat_proposal(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_department_chat_proposal(uuid, uuid, text, uuid, text)
  to service_role;
revoke all on function public.reject_department_chat_proposal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reject_department_chat_proposal(uuid, uuid)
  to service_role;

comment on table public.department_chat_proposals is
  'Validated, expiring Department Chat previews. Only proposer decisions may create one canonical unapproved artifact version or not-started work item.';

commit;
