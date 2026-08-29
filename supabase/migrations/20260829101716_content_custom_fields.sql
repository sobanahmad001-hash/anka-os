begin;

create table public.artifact_custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  artifact_type text not null check (artifact_type in (
    'discovery', 'vision', 'audience', 'website_architecture',
    'keyword_strategy', 'content', 'campaign_messaging', 'scripts'
  )),
  name text not null check (length(trim(name)) between 1 and 80),
  field_type text not null check (field_type in (
    'text', 'number', 'date', 'single_select', 'multi_select', 'checkbox'
  )),
  options jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, artifact_type, name),
  unique (id, organization_id)
);

create table public.artifact_custom_field_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  artifact_version_id uuid not null,
  field_def_id uuid not null,
  value jsonb not null,
  foreign key (artifact_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete cascade,
  foreign key (field_def_id, organization_id)
    references public.artifact_custom_field_defs(id, organization_id) on delete cascade,
  unique (artifact_version_id, field_def_id),
  unique (id, organization_id)
);

create index artifact_custom_field_values_field_def_idx
  on public.artifact_custom_field_values (organization_id, field_def_id);

alter table public.artifact_custom_field_defs enable row level security;
alter table public.artifact_custom_field_values enable row level security;

create policy "Team can read artifact custom field definitions"
  on public.artifact_custom_field_defs for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can read artifact custom field values"
  on public.artifact_custom_field_values for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.artifact_custom_field_defs from anon, authenticated;
revoke all on public.artifact_custom_field_values from anon, authenticated;
grant select on public.artifact_custom_field_defs, public.artifact_custom_field_values to authenticated;
grant all on public.artifact_custom_field_defs, public.artifact_custom_field_values to service_role;

create or replace function private.validate_artifact_custom_field_definition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  option_count integer;
  distinct_option_count integer;
begin
  new.name := btrim(new.name);

  if new.field_type in ('single_select', 'multi_select') then
    if new.options is null
      or jsonb_typeof(new.options) <> 'array'
      or jsonb_array_length(new.options) = 0
      or jsonb_array_length(new.options) > 50
      or exists (
        select 1 from jsonb_array_elements(new.options) selected(option_value)
        where jsonb_typeof(option_value) <> 'string'
      )
    then
      raise exception 'Select fields require between 1 and 50 text options';
    end if;

    select count(*), count(distinct btrim(option_value))
    into option_count, distinct_option_count
    from jsonb_array_elements_text(new.options) selected(option_value);

    if option_count <> distinct_option_count or exists (
      select 1 from jsonb_array_elements_text(new.options) selected(option_value)
      where length(btrim(option_value)) not between 1 and 80
    ) then
      raise exception 'Select options must be unique non-empty values up to 80 characters';
    end if;

    select jsonb_agg(to_jsonb(btrim(option_value)) order by ordinal)
    into new.options
    from jsonb_array_elements_text(new.options) with ordinality selected(option_value, ordinal);
  elsif new.options is not null then
    raise exception 'Only select fields can define options';
  end if;

  return new;
end;
$$;

create trigger validate_artifact_custom_field_definition
before insert or update on public.artifact_custom_field_defs
for each row execute function private.validate_artifact_custom_field_definition();

create or replace function private.validate_artifact_custom_field_value()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  definition public.artifact_custom_field_defs%rowtype;
  version_artifact_type text;
  item_count integer;
  distinct_item_count integer;
begin
  select * into definition
  from public.artifact_custom_field_defs
  where id = new.field_def_id and organization_id = new.organization_id;
  if not found then raise exception 'Custom field definition not found'; end if;

  select artifact.artifact_type into version_artifact_type
  from public.artifact_versions version
  join public.artifacts artifact
    on artifact.id = version.artifact_id
   and artifact.organization_id = version.organization_id
  where version.id = new.artifact_version_id
    and version.organization_id = new.organization_id;
  if not found then raise exception 'Artifact version not found'; end if;
  if version_artifact_type <> definition.artifact_type then
    raise exception 'Custom field definition does not match the artifact type';
  end if;

  if definition.field_type = 'text' then
    if jsonb_typeof(new.value) <> 'string' or length(new.value #>> '{}') > 12000 then
      raise exception 'Text custom field values must be text up to 12000 characters';
    end if;
  elsif definition.field_type = 'number' then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception 'Number custom field values must be numeric';
    end if;
  elsif definition.field_type = 'date' then
    if jsonb_typeof(new.value) <> 'string'
      or (new.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$'
      or ((new.value #>> '{}')::date)::text <> (new.value #>> '{}')
    then
      raise exception 'Date custom field values must use YYYY-MM-DD';
    end if;
  elsif definition.field_type = 'single_select' then
    if jsonb_typeof(new.value) <> 'string'
      or not definition.options @> jsonb_build_array(new.value)
    then
      raise exception 'Single-select value must be one of the defined options';
    end if;
  elsif definition.field_type = 'multi_select' then
    if jsonb_typeof(new.value) <> 'array'
      or jsonb_array_length(new.value) > 50
      or exists (
        select 1 from jsonb_array_elements(new.value) selected(item_value)
        where jsonb_typeof(item_value) <> 'string'
          or not definition.options @> jsonb_build_array(item_value)
      )
    then
      raise exception 'Multi-select values must use only defined options';
    end if;

    select count(*), count(distinct item_value)
    into item_count, distinct_item_count
    from jsonb_array_elements_text(new.value) selected(item_value);
    if item_count <> distinct_item_count then
      raise exception 'Multi-select values must be unique';
    end if;
  elsif definition.field_type = 'checkbox' and jsonb_typeof(new.value) <> 'boolean' then
    raise exception 'Checkbox custom field values must be boolean';
  end if;

  return new;
exception
  when datetime_field_overflow then
    raise exception 'Date custom field values must use YYYY-MM-DD';
end;
$$;

create trigger validate_artifact_custom_field_value
before insert or update on public.artifact_custom_field_values
for each row execute function private.validate_artifact_custom_field_value();

create or replace function private.can_edit_content_artifacts(
  target_organization_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
      and (
        membership.department_id = 'content'
        or membership.role in ('system_owner', 'operations_admin', 'executive')
      )
  );
$$;

create or replace function public.create_artifact_custom_field_definition(
  p_organization_id uuid,
  p_artifact_type text,
  p_name text,
  p_field_type text,
  p_options jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.artifact_custom_field_defs%rowtype;
begin
  if not private.can_edit_content_artifacts(p_organization_id, p_actor_id) then
    raise exception 'Content artifact edit access required';
  end if;

  insert into public.artifact_custom_field_defs (
    organization_id, artifact_type, name, field_type, options, created_by
  ) values (
    p_organization_id, p_artifact_type, p_name, p_field_type, p_options, p_actor_id
  ) returning * into saved;

  return to_jsonb(saved);
end;
$$;

create or replace function public.save_artifact_custom_field_value(
  p_artifact_version_id uuid,
  p_field_def_id uuid,
  p_value jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization_id uuid;
  saved public.artifact_custom_field_values%rowtype;
begin
  select organization_id into target_organization_id
  from public.artifact_versions
  where id = p_artifact_version_id;
  if not found then raise exception 'Artifact version not found'; end if;
  if not private.can_edit_content_artifacts(target_organization_id, p_actor_id) then
    raise exception 'Content artifact edit access required';
  end if;

  if p_value is null or p_value = 'null'::jsonb then
    delete from public.artifact_custom_field_values
    where organization_id = target_organization_id
      and artifact_version_id = p_artifact_version_id
      and field_def_id = p_field_def_id;
    return jsonb_build_object('deleted', true);
  end if;

  insert into public.artifact_custom_field_values (
    organization_id, artifact_version_id, field_def_id, value
  ) values (
    target_organization_id, p_artifact_version_id, p_field_def_id, p_value
  )
  on conflict (artifact_version_id, field_def_id)
  do update set value = excluded.value
  returning * into saved;

  return to_jsonb(saved);
end;
$$;

revoke all on function private.validate_artifact_custom_field_definition() from public, anon, authenticated;
revoke all on function private.validate_artifact_custom_field_value() from public, anon, authenticated;
revoke all on function private.can_edit_content_artifacts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_artifact_custom_field_definition(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.save_artifact_custom_field_value(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.validate_artifact_custom_field_definition() to service_role;
grant execute on function private.validate_artifact_custom_field_value() to service_role;
grant execute on function private.can_edit_content_artifacts(uuid, uuid) to service_role;
grant execute on function public.create_artifact_custom_field_definition(uuid, text, text, text, jsonb, uuid) to service_role;
grant execute on function public.save_artifact_custom_field_value(uuid, uuid, jsonb, uuid) to service_role;

insert into public.artifact_custom_field_defs (
  organization_id, artifact_type, name, field_type, options, created_by
)
select organization.id, 'content', seed.name, seed.field_type, seed.options, actor.user_id
from public.organizations organization
cross join lateral (
  select membership.user_id
  from public.organization_memberships membership
  where membership.organization_id = organization.id
    and membership.member_kind = 'team'
    and membership.status = 'active'
  order by case membership.role
    when 'system_owner' then 1 when 'operations_admin' then 2
    when 'executive' then 3 else 4 end, membership.created_at
  limit 1
) actor
cross join (values
  ('word_count'::text, 'number'::text, null::jsonb),
  ('seo_score'::text, 'number'::text, null::jsonb),
  ('target_keyword'::text, 'text'::text, null::jsonb),
  ('channel'::text, 'single_select'::text, '["blog", "social", "email", "landing_page"]'::jsonb)
) seed(name, field_type, options)
on conflict (organization_id, artifact_type, name) do nothing;

commit;
