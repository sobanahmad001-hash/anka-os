-- Qualify the configuration identifier; preserve installed authority, locks, API and replay.
begin;
set local lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.configure_pipeline_ai_text_routes(p_organization_id uuid, p_department_id text, p_request_id uuid, p_model_configuration_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  request_sha text;
  existing private.pipeline_ai_text_route_sets;
  next_revision bigint;
  route_set_id uuid;
  v_model_configuration_id uuid;
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
  for v_model_configuration_id, position in
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
      where configuration.id = v_model_configuration_id
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
$function$
;
commit;
