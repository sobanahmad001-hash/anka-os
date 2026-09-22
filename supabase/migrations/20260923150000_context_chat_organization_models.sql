-- Approved organization-private text models. Configuration never dispatches a provider call.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table public.context_chat_organization_models (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 connector_connection_id uuid not null,
 model_id text not null check (char_length(btrim(model_id)) between 1 and 120),
 verified_at timestamptz not null,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 revoked_by uuid references auth.users(id) on delete restrict,
 revoked_at timestamptz,
 foreign key (connector_connection_id, organization_id)
   references public.integration_connections(id, organization_id) on delete restrict,
 check ((revoked_at is null and revoked_by is null) or (revoked_at is not null and revoked_by is not null)),
 unique (id, organization_id)
);
create unique index idx_context_chat_organization_models_active
 on public.context_chat_organization_models(organization_id, connector_connection_id, model_id)
 where revoked_at is null;
alter table public.context_chat_organization_models enable row level security;
create policy "Team can read approved organization conversation models"
 on public.context_chat_organization_models for select to authenticated
 using (public.is_team_organization_member(organization_id));
revoke all on public.context_chat_organization_models from public, anon, authenticated;
grant select on public.context_chat_organization_models to authenticated;
grant all on public.context_chat_organization_models to service_role;
create function private.protect_context_chat_organization_model()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if new.id is distinct from old.id
  or new.organization_id is distinct from old.organization_id
  or new.connector_connection_id is distinct from old.connector_connection_id
  or new.model_id is distinct from old.model_id
  or new.verified_at is distinct from old.verified_at
  or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at
  or old.revoked_at is not null
  or new.revoked_at is null or new.revoked_by is null
  or new.revoked_at is not distinct from old.revoked_at then
  raise exception 'Organization conversation model identity is immutable.' using errcode = '23514';
 end if;
 return new;
end;
$$;
create trigger trg_context_chat_organization_models_protect
 before update on public.context_chat_organization_models
 for each row execute function private.protect_context_chat_organization_model();
revoke all on function private.protect_context_chat_organization_model() from public, anon, authenticated;
create function public.configure_context_chat_organization_models(
 p_organization_id uuid, p_connector_connection_id uuid, p_actor_id uuid, p_model_ids jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare v_connection public.integration_connections; v_model_id text;
begin
 if coalesce(jsonb_typeof(p_model_ids), '') <> 'array' then
  raise exception 'Model selections must be an array.' using errcode = '22023';
 end if;
 if jsonb_array_length(p_model_ids) > 20
  or exists (select 1 from jsonb_array_elements(p_model_ids) item(value) where jsonb_typeof(value) <> 'string') then
  raise exception 'Model selections must contain up to 20 identifiers.' using errcode = '22023';
 end if;
 if not exists (
  select 1 from public.organization_memberships member
  join public.organizations organization on organization.id = member.organization_id and organization.status = 'active'
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
   and member.status = 'active' and member.member_kind = 'team'
   and member.role in ('system_owner', 'operations_admin', 'executive')
 ) then raise exception 'Leadership access required.' using errcode = '42501'; end if;
 select connection.* into v_connection from public.integration_connections connection
 where connection.id = p_connector_connection_id and connection.organization_id = p_organization_id
  and connection.provider in ('openai', 'anthropic', 'google_gemini')
  and connection.status = 'verified' and connection.archived_at is null
  and connection.secret_name is not null
  and not exists (select 1 from public.integration_connection_engagements engagement
   where engagement.connection_id = connection.id and engagement.organization_id = connection.organization_id)
  and not exists (select 1 from public.integration_connection_departments department
   where department.connection_id = connection.id and department.organization_id = connection.organization_id)
 for update;
 if not found then
  raise exception 'A verified organization-level text connector is required.' using errcode = '23514';
 end if;
 for v_model_id in select btrim(value) from jsonb_array_elements_text(p_model_ids) item(value) loop
  if char_length(v_model_id) not between 1 and 120 or not (
   v_connection.public_config ->> 'model_id' = v_model_id
   or coalesce(v_connection.public_config -> 'verified_model_ids', '[]'::jsonb) ? v_model_id
  ) then raise exception 'Model selection contains an unverified model.' using errcode = '23514'; end if;
 end loop;
 update public.context_chat_organization_models set revoked_at = now(), revoked_by = p_actor_id
 where organization_id = p_organization_id and connector_connection_id = p_connector_connection_id
  and revoked_at is null;
 insert into public.context_chat_organization_models
  (organization_id, connector_connection_id, model_id, verified_at, created_by)
 select p_organization_id, p_connector_connection_id, selected.model_id,
  coalesce(v_connection.last_checked_at, v_connection.updated_at), p_actor_id
 from (select distinct btrim(value) as model_id from jsonb_array_elements_text(p_model_ids) item(value)) selected;
end;
$$;
revoke all on function public.configure_context_chat_organization_models(uuid, uuid, uuid, jsonb)
 from public, anon, authenticated;
grant execute on function public.configure_context_chat_organization_models(uuid, uuid, uuid, jsonb) to service_role;
create function public.assert_context_chat_organization_model(
 p_configuration_id uuid, p_organization_id uuid, p_actor_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
begin
 if not exists (
  select 1 from public.organization_memberships member
  join public.organizations organization on organization.id = member.organization_id and organization.status = 'active'
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
   and member.status = 'active' and member.member_kind = 'team'
 ) then raise exception 'Organization conversation authority changed.' using errcode = '42501'; end if;
 if not exists (
  select 1 from public.context_chat_organization_models model
  join public.integration_connections connection on connection.id = model.connector_connection_id
   and connection.organization_id = model.organization_id
  where model.id = p_configuration_id and model.organization_id = p_organization_id
   and model.revoked_at is null
   and connection.provider in ('openai', 'anthropic', 'google_gemini')
   and connection.status = 'verified' and connection.archived_at is null
   and connection.secret_name is not null
   and not exists (select 1 from public.integration_connection_engagements engagement
    where engagement.connection_id = connection.id and engagement.organization_id = connection.organization_id)
   and not exists (select 1 from public.integration_connection_departments department
    where department.connection_id = connection.id and department.organization_id = connection.organization_id)
   and (connection.public_config ->> 'model_id' = model.model_id
    or coalesce(connection.public_config -> 'verified_model_ids', '[]'::jsonb) ? model.model_id)
 ) then raise exception 'Selected organization conversation model is stale or unavailable.' using errcode = '23514'; end if;
end;
$$;
revoke all on function public.assert_context_chat_organization_model(uuid, uuid, uuid)
 from public, anon, authenticated;
grant execute on function public.assert_context_chat_organization_model(uuid, uuid, uuid) to service_role;
comment on table public.context_chat_organization_models is
 'Leadership-approved verified organization-level text models; configuration alone never authorizes paid execution.';
commit;
