-- Permit approved Claude and Gemini models in the existing governed Workshop
-- allowlist. Edge dispatch must independently verify the pinned connector/model.
-- Do not release this model approval without the atomic Workshop dispatch path.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
create or replace function private.department_chat_model_configuration_is_current(
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
      and connection.provider in ('openai', 'anthropic', 'google_gemini')
      and connection.status = 'verified'
      and connection.archived_at is null
      and (
        connection.public_config ->> 'model_id' = configuration.model_id
        or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb) ? configuration.model_id
      )
  );
$$;

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
  if not found then raise exception 'A verified text connector is required.' using errcode = '23514'; end if;

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

revoke all on function private.department_chat_model_configuration_is_current(uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function private.department_chat_model_configuration_is_current(uuid, uuid, uuid, text, uuid, text)
  to service_role;
revoke all on function public.configure_department_chat_model_allowlist(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.configure_department_chat_model_allowlist(uuid, uuid, uuid, jsonb)
  to service_role;
commit;
