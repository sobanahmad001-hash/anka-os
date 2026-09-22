-- Verified N7 text providers share N6 route and immutable claim safeguards.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '120s';

alter table private.ai_execution_route_rejections drop constraint if exists ai_execution_route_rejections_provider_http_status_check;

alter table private.ai_execution_route_rejections add constraint ai_execution_route_rejections_provider_http_status_check check (provider_http_status in (429, 503, 529));

alter table private.ai_execution_route_rejections drop constraint if exists ai_execution_route_rejections_provider_error_code_check;

alter table private.ai_execution_route_rejections add constraint ai_execution_route_rejections_provider_error_code_check check (provider_error_code in ('rate_limit_exceeded','slow_down','rate_limit_error','server_is_overloaded','overloaded_error','service_unavailable','too_many_requests'));

create or replace function public.configure_department_chat_model_allowlist(
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
    and connection.provider in ('openai', 'anthropic', 'google_gemini') and connection.status = 'verified'
    and connection.archived_at is null
  for update;
  if not found then raise exception 'A verified text-model connector is required.' using errcode = '23514'; end if;

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

create or replace function public.configure_pipeline_ai_text_routes(
  p_organization_id uuid, p_department_id text, p_request_id uuid,
  p_model_configuration_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  request_sha text;
  existing private.pipeline_ai_text_route_sets;
  next_revision bigint;
  route_set_id uuid;
  model_id uuid;
  position integer;
begin
  if actor is null or p_organization_id is null or p_request_id is null
    or p_department_id is null or p_department_id not in ('content', 'design', 'marketing')
    or p_model_configuration_ids is null
    or cardinality(p_model_configuration_ids) > 3
    or array_position(p_model_configuration_ids, null) is not null
    or (select count(distinct id) from unnest(p_model_configuration_ids) as chosen(id)) <> cardinality(p_model_configuration_ids)
  then
    raise exception 'An organization, department, request and up to three distinct models are required.'
      using errcode = '22023';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'department_id', p_department_id,
    'model_configuration_ids', p_model_configuration_ids
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin')
    for update of organization;
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  select * into existing from private.pipeline_ai_text_route_sets
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.configured_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Route request ID belongs to a different configuration.' using errcode = '23505';
    end if;
    return jsonb_build_object('route_set_id', existing.id, 'revision', existing.revision,
      'route_count', cardinality(p_model_configuration_ids), 'idempotent_replay', true);
  end if;
  for model_id, position in
    select chosen.id, chosen.position from unnest(p_model_configuration_ids)
      with ordinality chosen(id, position)
  loop
    perform 1 from public.department_chat_model_configurations configuration
      join public.integration_connections connection
        on connection.id = configuration.connector_connection_id
       and connection.organization_id = configuration.organization_id
      join public.integration_connection_departments department
        on department.connection_id = connection.id
       and department.organization_id = connection.organization_id
       and department.department_id = configuration.department_id
      where configuration.id = model_id
        and configuration.organization_id = p_organization_id
        and configuration.department_id = p_department_id
        and configuration.revoked_at is null
        and connection.provider in ('openai', 'anthropic', 'google_gemini') and connection.status = 'verified'
        and connection.archived_at is null
        and (
          connection.public_config ->> 'model_id' = configuration.model_id
          or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb)
            ? configuration.model_id
        )
      for share of configuration, connection, department;
    if not found then
      raise exception 'Every text route requires a current, connector-verified model in this department.'
        using errcode = '42501';
    end if;
  end loop;
  select coalesce(max(revision), 0) + 1 into next_revision
    from private.pipeline_ai_text_route_sets
    where organization_id = p_organization_id and department_id = p_department_id;
  insert into private.pipeline_ai_text_route_sets(
    organization_id, department_id, revision, request_id, request_sha256, configured_by
  ) values (
    p_organization_id, p_department_id, next_revision, p_request_id, request_sha, actor
  ) returning id into route_set_id;
  insert into private.pipeline_ai_text_route_entries(
    route_set_id, organization_id, department_id, priority, model_configuration_id
  )
  select route_set_id, p_organization_id, p_department_id, chosen.position, chosen.id
    from unnest(p_model_configuration_ids) with ordinality chosen(id, position);
  return jsonb_build_object('route_set_id', route_set_id, 'revision', next_revision,
    'route_count', cardinality(p_model_configuration_ids), 'idempotent_replay', false);
end;
$$;

create or replace function public.get_pipeline_ai_text_routes(
  p_organization_id uuid, p_job_id uuid, p_department_id text, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  current_set private.pipeline_ai_text_route_sets;
  routes jsonb;
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null
    or p_department_id is null or p_department_id not in ('content', 'design', 'marketing') then
    raise exception 'Scoped text-route request is required.' using errcode = '22023';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id;
  if not found or job.status <> 'blocked_configuration'
    or job.requested_by <> p_actor_id then
    raise exception 'The blocked, actor-owned execution job is unavailable.' using errcode = '42501';
  end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  if not found or not exists (
    select 1 from public.engagements engagement
    where engagement.id = intent.engagement_id
      and engagement.organization_id = p_organization_id
      and engagement.status in ('planning', 'active')
  ) then
    raise exception 'Current engagement scope is unavailable.' using errcode = '42501';
  end if;
  perform 1 from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin');
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  if intent.project_activation_id is null
    or job.input_manifest ->> 'project_activation_id' is distinct from intent.project_activation_id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256
    or exists (
      select 1 from public.project_pipeline_activations current_activation
      join public.project_pipeline_activations newer
        on newer.organization_id = current_activation.organization_id
       and newer.engagement_id = current_activation.engagement_id
       and newer.activation_number > current_activation.activation_number
      where current_activation.id = intent.project_activation_id
        and current_activation.organization_id = p_organization_id
    )
    or not exists (
      select 1 from public.ai_execution_configured_steps step
      where step.job_id = job.id and step.organization_id = p_organization_id
        and step.project_activation_id = intent.project_activation_id
        and step.definition_step ->> 'department_id' = p_department_id
        and (step.definition_step ->> 'kind') in ('ai_assisted', 'automatic')
    ) then
    raise exception 'Current pinned AI step is required for this department.' using errcode = '42501';
  end if;
  select * into current_set from private.pipeline_ai_text_route_sets
    where organization_id = p_organization_id and department_id = p_department_id
    order by revision desc limit 1;
  if not found then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'priority', entry.priority, 'provider', connection.provider,
    'connection_id', connection.id, 'model_id', configuration.model_id,
    'model_configuration_id', configuration.id
  ) order by entry.priority), '[]'::jsonb) into routes
  from private.pipeline_ai_text_route_entries entry
  join public.department_chat_model_configurations configuration
    on configuration.id = entry.model_configuration_id
   and configuration.organization_id = entry.organization_id
   and configuration.department_id = entry.department_id
   and configuration.revoked_at is null
  join public.integration_connections connection
    on connection.id = configuration.connector_connection_id
   and connection.organization_id = configuration.organization_id
   and connection.provider in ('openai', 'anthropic', 'google_gemini') and connection.status = 'verified'
   and connection.archived_at is null
  join public.integration_connection_departments department
    on department.connection_id = connection.id
   and department.organization_id = connection.organization_id
   and department.department_id = entry.department_id
  join public.integration_connection_engagements engagement
    on engagement.connection_id = connection.id
   and engagement.organization_id = connection.organization_id
   and engagement.department_id = entry.department_id
   and engagement.engagement_id = intent.engagement_id
  where entry.route_set_id = current_set.id
    and (
      connection.public_config ->> 'model_id' = configuration.model_id
      or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb)
        ? configuration.model_id
    );
  return routes;
end;
$$;

create or replace function public.claim_pipeline_ai_step_dispatch(
  p_organization_id uuid, p_attempt_id uuid,
  p_dispatch_request_id uuid, p_prompt_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt private.ai_execution_step_attempts;
  existing private.ai_execution_dispatch_claims;
  reservation private.ai_execution_step_budget_reservations;
  step public.ai_execution_configured_steps;
  current_routes jsonb;
  selected_route jsonb;
  new_id uuid;
begin
  if p_organization_id is null or p_attempt_id is null
    or p_dispatch_request_id is null
    or p_prompt_sha256 is null or p_prompt_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact scoped dispatch identity and prompt digest are required.' using errcode = '22023';
  end if;
  select * into attempt from private.ai_execution_step_attempts
    where id = p_attempt_id and organization_id = p_organization_id for share;
  if not found then raise exception 'Prepared attempt is unavailable.' using errcode = 'P0002'; end if;
  -- Serialize concurrent workers. Matching replay is never permission to call a provider again.
  perform 1 from public.ai_execution_step_progress
    where configured_step_id = attempt.configured_step_id
      and organization_id = p_organization_id for update;
  select * into existing from private.ai_execution_dispatch_claims
    where attempt_id = attempt.id;
  if found then
    if existing.dispatch_request_id <> p_dispatch_request_id
      or existing.prompt_sha256 <> p_prompt_sha256 then
      raise exception 'AI step already has another dispatch claim.' using errcode = '23505';
    end if;
    return jsonb_build_object('claim_id', existing.id, 'status', 'already_claimed',
      'must_not_submit', true);
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where id = attempt.reservation_id and organization_id = p_organization_id;
  select * into step from public.ai_execution_configured_steps
    where id = attempt.configured_step_id and organization_id = p_organization_id;
  if reservation.id is null or reservation.status <> 'reserved'
    or step.id is null or not exists (
      select 1 from public.ai_execution_step_progress progress
      where progress.configured_step_id = attempt.configured_step_id
        and progress.organization_id = p_organization_id
        and progress.status = 'waiting'
    ) then
    raise exception 'Only a waiting, reserved AI step can be dispatched.' using errcode = '55000';
  end if;
  current_routes := public.get_pipeline_ai_text_routes(p_organization_id,
    attempt.job_id, step.definition_step ->> 'department_id', attempt.actor_id);
  if public.preflight_pipeline_ai_job(p_organization_id, attempt.job_id, attempt.actor_id) ->> 'configuration_ready' is distinct from 'true' then
    raise exception 'Configured AI preflight changed after preparation.' using errcode = '55000';
  end if;
  if current_routes is distinct from attempt.route_snapshot then
    raise exception 'Verified route changed after preparation.' using errcode = '55000';
  end if;
  selected_route := attempt.route_snapshot -> 0;
  if selected_route is null or selected_route ->> 'provider' not in ('openai', 'anthropic', 'google_gemini')
    or selected_route ->> 'connection_id' is null
    or selected_route ->> 'model_id' is null then
    raise exception 'A verified text-model route is required.' using errcode = '42501';
  end if;
  insert into private.ai_execution_dispatch_claims(
    organization_id, attempt_id, dispatch_request_id, route, prompt_sha256
  ) values (
    p_organization_id, attempt.id, p_dispatch_request_id,
    selected_route, p_prompt_sha256
  ) returning id into new_id;
  return jsonb_build_object('claim_id', new_id, 'status', 'claimed',
    'must_not_submit', false, 'route', selected_route);
end;
$$;

create or replace function public.record_pipeline_ai_retryable_rejection(
  p_organization_id uuid, p_attempt_id uuid, p_priority integer,
  p_http_status integer, p_error_code text, p_provider_request_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt private.ai_execution_step_attempts;
  claim private.ai_execution_dispatch_claims;
  reservation private.ai_execution_step_budget_reservations;
  prior private.ai_execution_route_rejections;
  rejection_id uuid;
begin
  if p_organization_id is null or p_attempt_id is null
    or p_priority is null or p_priority not between 1 and 3
    or p_http_status is null or p_error_code is null
    or not ((p_http_status = 429 and p_error_code in
      ('rate_limit_exceeded','slow_down','rate_limit_error','too_many_requests'))
      or (p_http_status = 503 and p_error_code in ('server_is_overloaded','service_unavailable'))
      or (p_http_status = 529 and p_error_code = 'overloaded_error'))
    or length(coalesce(p_provider_request_id,'')) > 120 then
    raise exception 'Confirmed retryable provider rejection is required.' using errcode = '22023';
  end if;
  select * into attempt from private.ai_execution_step_attempts
    where id = p_attempt_id and organization_id = p_organization_id;
  if not found then raise exception 'Prepared attempt is unavailable.' using errcode = 'P0002'; end if;
  if (
    (attempt.route_snapshot -> (p_priority - 1) ->> 'provider' = 'openai'
      and ((p_http_status = 429 and p_error_code in ('rate_limit_exceeded','slow_down','rate_limit_error'))
        or (p_http_status = 503 and p_error_code = 'server_is_overloaded')))
    or (attempt.route_snapshot -> (p_priority - 1) ->> 'provider' = 'anthropic'
      and ((p_http_status = 429 and p_error_code = 'rate_limit_error')
        or (p_http_status = 529 and p_error_code = 'overloaded_error')))
    or (attempt.route_snapshot -> (p_priority - 1) ->> 'provider' = 'google_gemini'
      and ((p_http_status = 429 and p_error_code in ('rate_limit_exceeded','too_many_requests'))
        or (p_http_status = 503 and p_error_code = 'service_unavailable')))
  ) is distinct from true then
    raise exception 'Rejection does not match the claimed provider route.' using errcode = '42501';
  end if;
  perform 1 from public.ai_execution_step_progress
    where configured_step_id = attempt.configured_step_id
      and organization_id = p_organization_id for update;
  select * into claim from private.ai_execution_dispatch_claims
    where attempt_id = attempt.id and organization_id = p_organization_id;
  select * into reservation from private.ai_execution_step_budget_reservations
    where id = attempt.reservation_id and organization_id = p_organization_id;
  if claim.id is null or reservation.id is null or reservation.status <> 'reserved'
    or p_priority > jsonb_array_length(attempt.route_snapshot)
    or (p_priority > 1 and not exists (
      select 1 from private.ai_execution_fallback_claims fallback
      where fallback.claim_id = claim.id and fallback.priority = p_priority
    )) or exists (
      select 1 from public.ai_execution_step_outputs output
      where output.attempt_id = attempt.id
    ) then
    raise exception 'Only an outstanding claimed route can record rejection.' using errcode = '55000';
  end if;
  select * into prior from private.ai_execution_route_rejections
    where claim_id = claim.id and priority = p_priority;
  if found then
    if prior.provider_http_status <> p_http_status
      or prior.provider_error_code <> p_error_code
      or prior.provider_request_id <> coalesce(p_provider_request_id,'') then
      raise exception 'Route already has another rejection.' using errcode = '23505';
    end if;
    return jsonb_build_object('rejection_id', prior.id, 'idempotent_replay', true);
  end if;
  insert into private.ai_execution_route_rejections(
    organization_id, claim_id, priority, provider_http_status,
    provider_error_code, provider_request_id
  ) values (
    p_organization_id, claim.id, p_priority, p_http_status,
    p_error_code, coalesce(p_provider_request_id,'')
  ) returning id into rejection_id;
  return jsonb_build_object('rejection_id', rejection_id, 'idempotent_replay', false);
end;
$$;

create or replace function public.claim_pipeline_ai_fallback(
  p_organization_id uuid, p_attempt_id uuid, p_priority integer,
  p_dispatch_request_id uuid, p_prompt_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt private.ai_execution_step_attempts;
  claim private.ai_execution_dispatch_claims;
  reservation private.ai_execution_step_budget_reservations;
  step public.ai_execution_configured_steps;
  existing private.ai_execution_fallback_claims;
  current_routes jsonb;
  route jsonb;
  fallback_id uuid;
begin
  if p_organization_id is null or p_attempt_id is null
    or p_priority is null or p_priority not between 2 and 3
    or p_dispatch_request_id is null or p_prompt_sha256 is null or p_prompt_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact scoped fallback claim is required.' using errcode = '22023';
  end if;
  select * into attempt from private.ai_execution_step_attempts
    where id = p_attempt_id and organization_id = p_organization_id;
  if not found then raise exception 'Prepared attempt is unavailable.' using errcode = 'P0002'; end if;
  perform 1 from public.ai_execution_step_progress
    where configured_step_id = attempt.configured_step_id
      and organization_id = p_organization_id for update;
  select * into claim from private.ai_execution_dispatch_claims
    where attempt_id = attempt.id and organization_id = p_organization_id;
  select * into existing from private.ai_execution_fallback_claims
    where claim_id = claim.id and priority = p_priority;
  if found then
    if existing.dispatch_request_id <> p_dispatch_request_id
      or existing.prompt_sha256 <> p_prompt_sha256 then
      raise exception 'Fallback route already has another claim.' using errcode = '23505';
    end if;
    return jsonb_build_object('fallback_claim_id', existing.id,
      'status', 'already_claimed', 'must_not_submit', true);
  end if;
  select * into reservation from private.ai_execution_step_budget_reservations
    where id = attempt.reservation_id and organization_id = p_organization_id;
  select * into step from public.ai_execution_configured_steps
    where id = attempt.configured_step_id and organization_id = p_organization_id;
  if claim.id is null or reservation.id is null or reservation.status <> 'reserved'
    or step.id is null or claim.prompt_sha256 <> p_prompt_sha256
    or p_priority > jsonb_array_length(attempt.route_snapshot)
    or not exists (
      select 1 from private.ai_execution_route_rejections rejection
      where rejection.claim_id = claim.id and rejection.priority = p_priority - 1
    ) or exists (
      select 1 from public.ai_execution_step_outputs output
      where output.attempt_id = attempt.id
    ) or not exists (
      select 1 from public.ai_execution_step_progress progress
      where progress.configured_step_id = attempt.configured_step_id
        and progress.organization_id = p_organization_id
        and progress.status = 'waiting'
    ) then
    raise exception 'Prior confirmed rejection and waiting reservation are required.' using errcode = '55000';
  end if;
  current_routes := public.get_pipeline_ai_text_routes(p_organization_id,
    attempt.job_id, step.definition_step ->> 'department_id', attempt.actor_id);
  if current_routes is distinct from attempt.route_snapshot
    or public.preflight_pipeline_ai_job(p_organization_id, attempt.job_id, attempt.actor_id)
      ->> 'configuration_ready' is distinct from 'true' then
    raise exception 'Pinned route or configured preflight changed.' using errcode = '55000';
  end if;
  route := attempt.route_snapshot -> (p_priority - 1);
  if route ->> 'provider' not in ('openai', 'anthropic', 'google_gemini')
    or route ->> 'priority' is distinct from p_priority::text
    or route ->> 'connection_id' is null
    or route ->> 'model_id' is null then
    raise exception 'Ordered verified text-model fallback route is required.' using errcode = '42501';
  end if;
  insert into private.ai_execution_fallback_claims(
    organization_id, claim_id, priority, dispatch_request_id, route, prompt_sha256
  ) values (
    p_organization_id, claim.id, p_priority, p_dispatch_request_id, route, p_prompt_sha256
  ) returning id into fallback_id;
  return jsonb_build_object('fallback_claim_id', fallback_id, 'status', 'claimed',
    'must_not_submit', false, 'route', route);
end;
$$;

commit;
