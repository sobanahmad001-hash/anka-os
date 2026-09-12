-- P9-MODELS-1: governed model selection for Shared Department Chat.
-- Model identifiers come only from verified connector facts; browser input is an opaque configuration id.

begin;

create table public.department_chat_model_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  department_id text not null check (department_id in ('content', 'design', 'marketing')),
  connector_connection_id uuid not null,
  model_id text not null check (char_length(btrim(model_id)) between 1 and 120),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  is_default boolean not null default false,
  verified_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  constraint department_chat_model_configurations_connector_fkey
    foreign key (connector_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete restrict,
  constraint department_chat_model_configurations_revocation_check
    check ((revoked_at is null and revoked_by is null) or (revoked_at is not null and revoked_by is not null)),
  constraint department_chat_model_configurations_default_check
    check (not is_default or revoked_at is null),
  unique (id, organization_id)
);

create unique index idx_department_chat_model_configurations_default
  on public.department_chat_model_configurations(organization_id, department_id, connector_connection_id)
  where is_default and revoked_at is null;
create unique index idx_department_chat_model_configurations_active_model
  on public.department_chat_model_configurations(
    organization_id, department_id, connector_connection_id, model_id
  ) where revoked_at is null;
create index idx_department_chat_model_configurations_active
  on public.department_chat_model_configurations(organization_id, department_id, connector_connection_id, created_at)
  where revoked_at is null;

-- The one model already verified on each mapped connector is the sole initial option.
insert into public.department_chat_model_configurations (
  organization_id, department_id, connector_connection_id, model_id,
  display_name, is_default, verified_at, created_by
)
select connection.organization_id, mapping.department_id, connection.id,
  btrim(connection.public_config ->> 'model_id'),
  btrim(connection.public_config ->> 'model_id'), true,
  coalesce(connection.last_checked_at, connection.updated_at), connection.created_by
from public.integration_connections connection
join public.integration_connection_departments mapping
  on mapping.connection_id = connection.id
 and mapping.organization_id = connection.organization_id
where connection.provider = 'openai'
  and connection.status = 'verified'
  and connection.archived_at is null
  and mapping.department_id in ('content', 'design', 'marketing')
  and char_length(btrim(coalesce(connection.public_config ->> 'model_id', ''))) between 1 and 120
on conflict do nothing;

alter table public.department_chat_model_configurations enable row level security;
create policy "Team can read Department Chat model configurations"
on public.department_chat_model_configurations for select to authenticated
using (public.is_team_organization_member(organization_id));
revoke all on public.department_chat_model_configurations from anon, authenticated;
grant select on public.department_chat_model_configurations to authenticated;
grant all on public.department_chat_model_configurations to service_role;

create function private.protect_department_chat_model_configuration()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.department_id is distinct from old.department_id
     or new.connector_connection_id is distinct from old.connector_connection_id
     or new.model_id is distinct from old.model_id
     or new.display_name is distinct from old.display_name
     or new.verified_at is distinct from old.verified_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Department Chat model configuration identity is immutable.' using errcode = '23514';
  end if;
  if old.revoked_at is not null and new is distinct from old then
    raise exception 'A revoked Department Chat model configuration is immutable.' using errcode = '23514';
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    new.is_default := false;
  elsif new.revoked_at is distinct from old.revoked_at
     or new.revoked_by is distinct from old.revoked_by then
    raise exception 'Invalid Department Chat model configuration transition.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_department_chat_model_configurations_protect
before update on public.department_chat_model_configurations
for each row execute function private.protect_department_chat_model_configuration();
revoke all on function private.protect_department_chat_model_configuration()
  from public, anon, authenticated;

alter table public.ai_runs
  add column department_chat_model_configuration_id uuid,
  add constraint ai_runs_department_chat_model_configuration_fkey
    foreign key (department_chat_model_configuration_id, organization_id)
    references public.department_chat_model_configurations(id, organization_id) on delete restrict;
alter table public.department_chat_proposals
  add column model_configuration_id uuid,
  add constraint department_chat_proposals_model_configuration_fkey
    foreign key (model_configuration_id, organization_id)
    references public.department_chat_model_configurations(id, organization_id) on delete restrict;
create index idx_ai_runs_department_chat_model_configuration
  on public.ai_runs(department_chat_model_configuration_id, organization_id)
  where department_chat_model_configuration_id is not null;
create index idx_department_chat_proposals_model_configuration
  on public.department_chat_proposals(model_configuration_id, organization_id)
  where model_configuration_id is not null;

create function private.department_chat_model_configuration_is_current(
  p_configuration_id uuid, p_organization_id uuid, p_engagement_id uuid,
  p_department_id text, p_connector_connection_id uuid, p_model_id text
)
returns boolean language sql security invoker set search_path = '' stable as $$
  select exists (
    select 1
    from public.department_chat_model_configurations configuration
    join public.integration_connections connection
      on connection.id = configuration.connector_connection_id
     and connection.organization_id = configuration.organization_id
    join public.integration_connection_departments department
      on department.connection_id = connection.id
     and department.organization_id = connection.organization_id
     and department.department_id = configuration.department_id
    join public.integration_connection_engagements engagement
      on engagement.connection_id = connection.id
     and engagement.organization_id = connection.organization_id
     and engagement.department_id = configuration.department_id
     and engagement.engagement_id = p_engagement_id
    where configuration.id = p_configuration_id
      and configuration.organization_id = p_organization_id
      and configuration.department_id = p_department_id
      and configuration.connector_connection_id = p_connector_connection_id
      and configuration.model_id = p_model_id
      and configuration.revoked_at is null
      and connection.provider = 'openai'
      and connection.status = 'verified'
      and connection.archived_at is null
      and (
        connection.public_config ->> 'model_id' = configuration.model_id
        or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb) ? configuration.model_id
      )
  );
$$;
revoke all on function private.department_chat_model_configuration_is_current(uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function private.department_chat_model_configuration_is_current(uuid, uuid, uuid, text, uuid, text)
  to service_role;

create function public.assert_department_chat_model_dispatch(
  p_configuration_id uuid, p_organization_id uuid, p_engagement_id uuid,
  p_department_id text, p_connector_connection_id uuid, p_model_id text, p_actor_id uuid
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
      and membership.status = 'active' and membership.member_kind = 'team'
      and (membership.department_id = p_department_id
        or membership.role in ('system_owner', 'operations_admin', 'executive'))
  ) then
    raise exception 'Department Chat authority changed.' using errcode = '42501';
  end if;
  if not private.department_chat_model_configuration_is_current(
    p_configuration_id, p_organization_id, p_engagement_id, p_department_id,
    p_connector_connection_id, p_model_id
  ) then
    raise exception 'Selected Department Chat model is stale or unavailable.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.engagement_services service
    join public.service_catalog catalog on catalog.id = service.service_id
    where service.organization_id = p_organization_id
      and service.engagement_id = p_engagement_id
      and service.status = 'active' and catalog.department_id = p_department_id
  ) then
    raise exception 'Department Chat service policy changed.' using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.assert_department_chat_model_dispatch(uuid, uuid, uuid, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.assert_department_chat_model_dispatch(uuid, uuid, uuid, text, uuid, text, uuid)
  to service_role;

create function public.configure_department_chat_model_allowlist(
  p_organization_id uuid, p_connector_connection_id uuid,
  p_actor_id uuid, p_department_model_ids jsonb
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_connection public.integration_connections;
  v_entry record;
  v_model_id text;
begin
  if jsonb_typeof(coalesce(p_department_model_ids, 'null'::jsonb)) <> 'object' then
    raise exception 'Department model selections must be an object.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
      and membership.status = 'active' and membership.member_kind = 'team'
      and membership.role in ('system_owner', 'operations_admin', 'executive')
  ) then
    raise exception 'Leadership access required.' using errcode = '42501';
  end if;
  select connection.* into v_connection
  from public.integration_connections connection
  where connection.id = p_connector_connection_id
    and connection.organization_id = p_organization_id
    and connection.provider = 'openai' and connection.status = 'verified'
    and connection.archived_at is null
  for update;
  if not found then raise exception 'A verified OpenAI connector is required.' using errcode = '23514'; end if;

  for v_entry in select key, value from jsonb_each(p_department_model_ids)
  loop
    if v_entry.key not in ('content', 'design', 'marketing')
       or jsonb_typeof(v_entry.value) <> 'array'
       or not exists (
         select 1 from public.integration_connection_departments department
         where department.connection_id = v_connection.id
           and department.organization_id = v_connection.organization_id
           and department.department_id = v_entry.key
       ) then
      raise exception 'Model allowlist contains an unmapped department.' using errcode = '23514';
    end if;
    for v_model_id in select distinct btrim(value) from jsonb_array_elements_text(v_entry.value) model(value)
    loop
      if char_length(v_model_id) not between 1 and 120
         or not (
           v_connection.public_config ->> 'model_id' = v_model_id
           or coalesce(v_connection.public_config -> 'verified_model_ids', '[]'::jsonb) ? v_model_id
         ) then
        raise exception 'Model allowlist contains an unverified model.' using errcode = '23514';
      end if;
    end loop;
  end loop;

  update public.department_chat_model_configurations
  set revoked_at = now(), revoked_by = p_actor_id, is_default = false
  where organization_id = p_organization_id
    and connector_connection_id = p_connector_connection_id
    and revoked_at is null;

  insert into public.department_chat_model_configurations (
    organization_id, department_id, connector_connection_id, model_id,
    display_name, is_default, verified_at, created_by
  )
  select p_organization_id, selected.department_id, p_connector_connection_id,
    selected.model_id, selected.model_id,
    row_number() over (partition by selected.department_id order by selected.ordinality) = 1,
    coalesce(v_connection.last_checked_at, v_connection.updated_at), p_actor_id
  from (
    select entry.key as department_id, btrim(model.value) as model_id, model.ordinality
    from jsonb_each(p_department_model_ids) entry
    cross join lateral jsonb_array_elements_text(entry.value) with ordinality model(value, ordinality)
  ) selected;
end;
$$;
revoke all on function public.configure_department_chat_model_allowlist(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.configure_department_chat_model_allowlist(uuid, uuid, uuid, jsonb)
  to service_role;

create function private.bind_department_chat_model_configuration(
  p_saved jsonb, p_configuration_id uuid, p_organization_id uuid,
  p_engagement_id uuid, p_department_id text, p_connector_connection_id uuid, p_model_id text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_proposal_id uuid := (p_saved ->> 'proposal_id')::uuid;
  v_ai_run_id uuid := (p_saved ->> 'ai_run_id')::uuid;
begin
  -- Dispatch already established current approval immediately before the paid call.
  -- Bind the exact immutable identity even if an administrator revokes it while that call is in flight.
  if not exists (
    select 1 from public.department_chat_model_configurations configuration
    where configuration.id = p_configuration_id
      and configuration.organization_id = p_organization_id
      and configuration.department_id = p_department_id
      and configuration.connector_connection_id = p_connector_connection_id
      and configuration.model_id = p_model_id
  ) then
    raise exception 'Department Chat model configuration identity changed.' using errcode = '23514';
  end if;
  update public.department_chat_proposals
  set model_configuration_id = p_configuration_id
  where id = v_proposal_id and organization_id = p_organization_id
    and model_configuration_id is null;
  if not found and not exists (
    select 1 from public.department_chat_proposals
    where id = v_proposal_id and organization_id = p_organization_id
      and model_configuration_id = p_configuration_id
  ) then
    raise exception 'Department Chat proposal model identity could not be frozen.' using errcode = '23514';
  end if;
  update public.ai_runs
  set department_chat_model_configuration_id = p_configuration_id,
      context_manifest = context_manifest || jsonb_build_object('model_configuration_id', p_configuration_id)
  where id = v_ai_run_id and organization_id = p_organization_id
    and department_chat_model_configuration_id is null;
  if not found and not exists (
    select 1 from public.ai_runs
    where id = v_ai_run_id and organization_id = p_organization_id
      and department_chat_model_configuration_id = p_configuration_id
  ) then
    raise exception 'Department Chat run model identity could not be frozen.' using errcode = '23514';
  end if;
  return p_saved || jsonb_build_object('model_configuration_id', p_configuration_id);
end;
$$;
revoke all on function private.bind_department_chat_model_configuration(jsonb, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function private.bind_department_chat_model_configuration(jsonb, uuid, uuid, uuid, text, uuid, text)
  to service_role;

-- The predecessor proposal lifecycle accepted only the connector's primary
-- model_id. P9 allowlists may select any connector-verified model, so preserve
-- every existing authority/context check while extending only that model fact.
-- The P9 wrappers below immediately freeze the selected configuration on both
-- the proposal and AI-run ledger rows in the same transaction.
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
  v_database_context_checksum text;
  v_proposal_id uuid := gen_random_uuid();
  v_ai_run_id uuid;
  v_proposal public.department_chat_proposals;
begin
  -- Acquire the canonical context locks before taking any row lock. This avoids
  -- lock-order inversion with concurrent context writers and approval publication.
  v_database_context_checksum := private.department_chat_current_context_checksum(
    p_organization_id, p_engagement_id, p_department_id,
    p_connector_connection_id, p_model_id, p_engagement_stage_instance_id
  );
  if v_database_context_checksum is null then
    raise exception 'Department Chat database context changed.' using errcode = '23514';
  end if;

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
      and (
        connection.public_config ->> 'model_id' = p_model_id
        or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb) ? p_model_id
      )
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

  select proposal.* into v_proposal
  from public.department_chat_proposals proposal
  where proposal.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_proposal.organization_id is distinct from p_organization_id
       or v_proposal.engagement_id is distinct from p_engagement_id
       or v_proposal.project_id is distinct from p_project_id
       or v_proposal.department_id is distinct from p_department_id
       or v_proposal.proposer_id is distinct from p_actor_id
       or v_proposal.proposal_kind is distinct from p_proposal_kind
       or v_proposal.target_key is distinct from p_target_key
       or v_proposal.artifact_id is distinct from p_artifact_id
       or v_proposal.engagement_stage_instance_id is distinct from p_engagement_stage_instance_id
       or v_proposal.validated_payload is distinct from p_validated_payload
       or v_proposal.preview_payload is distinct from p_preview_payload
       or v_proposal.safe_prompt_metadata is distinct from p_safe_prompt_metadata
       or v_proposal.context_artifact_version_ids
          is distinct from coalesce(p_context_artifact_version_ids, '{}'::uuid[])
       or v_proposal.context_checksum is distinct from p_context_checksum
       or v_proposal.connector_connection_id is distinct from p_connector_connection_id
       or v_proposal.model_id is distinct from p_model_id then
      raise exception 'Department Chat idempotency key was reused with different proposal input.'
        using errcode = '23514';
    end if;
    return jsonb_build_object(
      'proposal_id', v_proposal.id, 'ai_run_id', v_proposal.ai_run_id,
      'status', v_proposal.status, 'proposal_kind', v_proposal.proposal_kind,
      'target_key', v_proposal.target_key, 'preview', v_proposal.preview_payload,
      'expires_at', v_proposal.expires_at, 'model', v_proposal.model_id,
      'connector_connection_id', v_proposal.connector_connection_id
    );
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
      'database_context_checksum', v_database_context_checksum,
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
    context_artifact_version_ids, context_checksum, database_context_checksum, connector_connection_id,
    model_id, ai_run_id, idempotency_key
  ) values (
    v_proposal_id, p_organization_id, p_engagement_id, p_project_id,
    p_department_id, p_actor_id, p_proposal_kind, p_target_key, p_artifact_id,
    p_engagement_stage_instance_id, p_validated_payload, p_preview_payload,
    p_safe_prompt_metadata, coalesce(p_context_artifact_version_ids, '{}'::uuid[]),
    p_context_checksum, v_database_context_checksum, p_connector_connection_id, p_model_id, v_ai_run_id,
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
  v_current_database_context_checksum text;
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
  v_current_database_context_checksum := private.department_chat_current_context_checksum(
    v_proposal.organization_id, v_proposal.engagement_id, v_proposal.department_id,
    v_proposal.connector_connection_id, v_proposal.model_id,
    v_proposal.engagement_stage_instance_id
  );
  -- Authority is rechecked after the organization and membership tables are
  -- frozen, so revocation cannot race the canonical write.
  if not exists (
    select 1 from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
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
  if v_proposal.context_checksum is distinct from p_context_checksum
     or v_proposal.connector_connection_id is distinct from p_connector_connection_id
     or v_proposal.model_id is distinct from p_model_id
     or v_proposal.database_context_checksum is distinct from v_current_database_context_checksum then
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

  select engagement.* into v_engagement
  from public.engagements engagement
  where engagement.id = v_proposal.engagement_id
    and engagement.project_id = v_proposal.project_id
    and engagement.organization_id = v_proposal.organization_id
  for share;
  if not found then
    raise exception 'Department Chat engagement context changed.' using errcode = '23514';
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
      and (
        connection.public_config ->> 'model_id' = p_model_id
        or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb) ? p_model_id
      )
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

  if v_proposal.model_configuration_id is not null
     and not private.department_chat_model_configuration_is_current(
       v_proposal.model_configuration_id, v_proposal.organization_id,
       v_proposal.engagement_id, v_proposal.department_id,
       v_proposal.connector_connection_id, v_proposal.model_id
     ) then
    raise exception 'Selected Department Chat model is stale or unavailable.'
      using errcode = '23514';
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
-- Permit exactly the one-time provenance bind introduced by P9. The dedicated
-- model-binding trigger validates the configuration against the frozen source;
-- every other pending-to-pending proposal mutation remains rejected.
create or replace function private.protect_department_chat_proposal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status = 'pending'
     and old.model_configuration_id is null
     and new.model_configuration_id is not null
     and (to_jsonb(new) - array['model_configuration_id', 'updated_at'])
       = (to_jsonb(old) - array['model_configuration_id', 'updated_at']) then
    new.updated_at := now();
    return new;
  end if;  if old.status = 'pending' and new.status = 'pending'
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
create function public.save_department_chat_proposal_with_model(
  p_model_configuration_id uuid,
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
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_saved jsonb;
begin
  v_saved := public.save_department_chat_proposal(
    p_organization_id, p_engagement_id, p_project_id, p_department_id,
    p_actor_id, p_proposal_kind, p_target_key, p_artifact_id,
    p_engagement_stage_instance_id, p_validated_payload, p_preview_payload,
    p_safe_prompt_metadata, p_context_artifact_version_ids, p_context_checksum,
    p_connector_connection_id, p_model_id, p_idempotency_key, p_input_text,
    p_output_text, p_latency_ms, p_input_tokens, p_output_tokens,
    p_estimated_cost_microusd
  );
  return private.bind_department_chat_model_configuration(
    v_saved, p_model_configuration_id, p_organization_id, p_engagement_id,
    p_department_id, p_connector_connection_id, p_model_id
  );
end;
$$;

create function public.save_department_chat_conversation_proposal_with_model(
  p_model_configuration_id uuid,
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
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_saved jsonb;
begin
  v_saved := public.save_department_chat_conversation_proposal(
    p_conversation_id, p_message_id, p_organization_id, p_engagement_id,
    p_project_id, p_department_id, p_actor_id, p_proposal_kind, p_target_key,
    p_artifact_id, p_engagement_stage_instance_id, p_validated_payload,
    p_preview_payload, p_safe_prompt_metadata, p_context_artifact_version_ids,
    p_context_checksum, p_connector_connection_id, p_model_id,
    p_idempotency_key, p_input_text, p_output_text, p_latency_ms,
    p_input_tokens, p_output_tokens, p_estimated_cost_microusd
  );
  return private.bind_department_chat_model_configuration(
    v_saved, p_model_configuration_id, p_organization_id, p_engagement_id,
    p_department_id, p_connector_connection_id, p_model_id
  );
end;
$$;

revoke all on function public.save_department_chat_proposal_with_model(
  uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint
) from public, anon, authenticated;
grant execute on function public.save_department_chat_proposal_with_model(
  uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint
) to service_role;
revoke all on function public.save_department_chat_conversation_proposal_with_model(
  uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint
) from public, anon, authenticated;
grant execute on function public.save_department_chat_conversation_proposal_with_model(
  uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid,
  jsonb, jsonb, jsonb, uuid[], text, uuid, text, uuid, text, text,
  integer, integer, integer, bigint
) to service_role;

create function private.protect_department_chat_model_binding()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.model_configuration_id is not null then
    perform 1
    from public.department_chat_model_configurations configuration
    where configuration.id = new.model_configuration_id
      and configuration.organization_id = new.organization_id
    for share;
    if not found then
      raise exception 'Department Chat proposal model configuration is unavailable.' using errcode = '23514';
    end if;
  end if;
  if old.model_configuration_id is not null
     and new.model_configuration_id is distinct from old.model_configuration_id then
    raise exception 'Department Chat proposal model configuration is immutable.' using errcode = '23514';
  end if;
  if new.department_id in ('content', 'design', 'marketing')
     and old.model_configuration_id is null and new.model_configuration_id is null
     and new.status = 'accepted' then
    raise exception 'Department Chat proposal model configuration is required.' using errcode = '23514';
  end if;
  if old.model_configuration_id is null and new.model_configuration_id is not null
     and not exists (
       select 1 from public.department_chat_model_configurations configuration
       where configuration.id = new.model_configuration_id
         and configuration.organization_id = new.organization_id
         and configuration.department_id = new.department_id
         and configuration.connector_connection_id = new.connector_connection_id
         and configuration.model_id = new.model_id
     ) then
    raise exception 'Department Chat proposal model configuration does not match its frozen source.' using errcode = '23514';
  end if;
  if new.model_configuration_id is not null and new.status = 'accepted'
     and not private.department_chat_model_configuration_is_current(
    new.model_configuration_id, new.organization_id, new.engagement_id, new.department_id,
    new.connector_connection_id, new.model_id
  ) then
    raise exception 'Selected Department Chat model is stale or unavailable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_department_chat_proposals_model_binding
before update on public.department_chat_proposals
for each row execute function private.protect_department_chat_model_binding();
revoke all on function private.protect_department_chat_model_binding()
  from public, anon, authenticated;

create function private.protect_ai_run_model_binding()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.department_chat_model_configuration_id is not null
     and new.department_chat_model_configuration_id is distinct from old.department_chat_model_configuration_id then
    raise exception 'AI run model configuration is immutable.' using errcode = '23514';
  end if;
  if old.department_chat_model_configuration_id is null
     and new.department_chat_model_configuration_id is not null
     and not exists (
       select 1 from public.department_chat_model_configurations configuration
       where configuration.id = new.department_chat_model_configuration_id
         and configuration.organization_id = new.organization_id
         and configuration.model_id = new.model
         and configuration.connector_connection_id::text
           = new.context_manifest ->> 'connector_connection_id'
     ) then
    raise exception 'AI run model configuration does not match its frozen source.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_ai_runs_model_binding
before update of department_chat_model_configuration_id on public.ai_runs
for each row execute function private.protect_ai_run_model_binding();
revoke all on function private.protect_ai_run_model_binding()
  from public, anon, authenticated;

comment on table public.department_chat_model_configurations is
  'Administrator-governed immutable model identities derived only from verified connector configuration facts.';
comment on column public.ai_runs.department_chat_model_configuration_id is
  'Immutable selected model configuration identity for a Department Chat run; historical identity survives revocation.';

commit;
