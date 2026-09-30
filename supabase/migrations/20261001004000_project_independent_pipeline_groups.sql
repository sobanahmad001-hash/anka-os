-- Approved separately versioned Website/Marketing pipelines; existing IDs/history remain Legacy.
-- No existing row is rewritten. Draft/activation/run intent are separate reviewed commands.
begin;
set local lock_timeout='5s'; set local statement_timeout='120s';
do $baseline$ begin
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='build_living_project_snapshot_projection' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_project_id uuid, p_projection_kind text, p_source_version bigint, p_generated_at timestamp with time zone' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='b37856e994e51389f93d1d1e3e24a40a') then raise exception 'Installed pipeline contract changed: private.build_living_project_snapshot_projection' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='n6_pin_current_project_activation' and pg_get_function_identity_arguments(p.oid)='' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='a1d3e6c39a7c6b1dbd171a6fee458685') then raise exception 'Installed pipeline contract changed: private.n6_pin_current_project_activation' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='n6_reserve_step_budget' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_job_id uuid, p_step_id uuid, p_actor_id uuid, p_max_cost_microusd bigint' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='ddcf113e9243ed9877f5f95f5fc0fd4f') then raise exception 'Installed pipeline contract changed: private.n6_reserve_step_budget' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='advance_pipeline_manual_step' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_job_id uuid, p_step_id uuid, p_request_id uuid, p_expected_version bigint, p_action text, p_evidence text' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='7a26e542f35fb5044911b13f1a324010') then raise exception 'Installed pipeline contract changed: public.advance_pipeline_manual_step' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='n6_require_output_reviewer' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_output_id uuid, p_actor_id uuid' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='ed9fc6da31bea3eb1b53577d8f4fa5da') then raise exception 'Installed pipeline contract changed: private.n6_require_output_reviewer' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='preflight_pipeline_ai_job' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_job_id uuid, p_actor_id uuid' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='2fb37b695e92190bde282a91bd4f5921') then raise exception 'Installed pipeline contract changed: public.preflight_pipeline_ai_job' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='n6_project_pipeline_impact' and pg_get_function_identity_arguments(p.oid)='p_configuration_id uuid' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='e712262dd792f1706f02b3b38f304596') then raise exception 'Installed pipeline contract changed: private.n6_project_pipeline_impact' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='n6_project_configuration_authorized' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_project_id uuid, p_actor_id uuid' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='df8858457687f677a50eb9eef2ceecf4') then raise exception 'Installed pipeline contract changed: private.n6_project_configuration_authorized' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_project_pipeline_configuration' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_engagement_id uuid, p_definition_publication_id uuid, p_request_id uuid, p_selected_steps jsonb, p_max_ai_cost_microusd bigint' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='2b916301d1b03cf975482b878c759ddb') then raise exception 'Installed pipeline contract changed: public.create_project_pipeline_configuration' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='activate_project_pipeline_configuration' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_configuration_id uuid, p_request_id uuid, p_impact_token_sha256 text, p_impact_acknowledged boolean' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='66e9700d9590731190e4eedb2beda820') then raise exception 'Installed pipeline contract changed: public.activate_project_pipeline_configuration' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_pipeline_ai_text_routes' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_job_id uuid, p_department_id text, p_actor_id uuid' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='fb9c2ce299c0eb3e886e33ae195a2b3a') then raise exception 'Installed pipeline contract changed: public.get_pipeline_ai_text_routes' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='n6_materialize_configured_steps' and pg_get_function_identity_arguments(p.oid)='p_job_id uuid' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='1e99c9d11ed79a457e761a206a7b3e44') then raise exception 'Installed pipeline contract changed: private.n6_materialize_configured_steps' using errcode='55000'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='start_pipeline_run_intent' and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_engagement_id uuid, p_request_id uuid, p_asset_ids uuid[]' and md5(replace(pg_get_functiondef(p.oid),chr(13),''))='16a3bbdd9e73cfdcdbdbb2dc26870cae') then raise exception 'Installed pipeline contract changed: public.start_pipeline_run_intent' using errcode='55000'; end if;
end; $baseline$;
create table public.project_pipeline_groups(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 engagement_id uuid not null,project_id uuid not null,
 kind text not null check(kind in ('website','marketing')),
 name text not null check(name=btrim(name) and length(name) between 1 and 80),
 preset_publication_id uuid not null references public.pipeline_template_publications(id) on delete restrict,
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id) on delete restrict,
 unique(organization_id,request_id),unique(engagement_id,kind,name),unique(id,engagement_id,organization_id)
);
alter table public.project_pipeline_groups enable row level security;
revoke all on public.project_pipeline_groups from public,anon,authenticated,service_role;
grant select on public.project_pipeline_groups to authenticated,service_role;
create policy "Current team reads project pipeline groups" on public.project_pipeline_groups for select to authenticated using(private.is_active_pipeline_team_member(organization_id));
create trigger living_document_supplemental_source after insert on public.project_pipeline_groups for each row execute function private.invalidate_living_project_supplemental_source();
create trigger protect_project_pipeline_groups before update or delete on public.project_pipeline_groups for each row execute function private.reject_pipeline_template_mutation();
alter table public.project_pipeline_configurations add column pipeline_group_id uuid,add column group_revision integer,
 add constraint project_pipeline_configuration_group foreign key(pipeline_group_id,engagement_id,organization_id) references public.project_pipeline_groups(id,engagement_id,organization_id) on delete restrict,
 add constraint project_pipeline_configuration_group_pair check((pipeline_group_id is null)=(group_revision is null) and (group_revision is null or group_revision>0)),
 add constraint project_pipeline_configuration_group_revision unique(pipeline_group_id,group_revision),
 add constraint project_pipeline_configuration_group_identity unique(id,pipeline_group_id,engagement_id,organization_id);
alter table public.project_pipeline_activations add column pipeline_group_id uuid,add column group_activation_number integer,
 add constraint project_pipeline_activation_group foreign key(configuration_id,pipeline_group_id,engagement_id,organization_id) references public.project_pipeline_configurations(id,pipeline_group_id,engagement_id,organization_id) on delete restrict,
 add constraint project_pipeline_activation_group_pair check((pipeline_group_id is null)=(group_activation_number is null) and (group_activation_number is null or group_activation_number>0)),
 add constraint project_pipeline_activation_group_number unique(pipeline_group_id,group_activation_number),
 add constraint project_pipeline_activation_group_identity unique(id,pipeline_group_id,organization_id);
alter table public.pipeline_run_intents add column pipeline_group_id uuid,
 add constraint pipeline_run_intent_group foreign key(pipeline_group_id,engagement_id,organization_id) references public.project_pipeline_groups(id,engagement_id,organization_id) on delete restrict,
 add constraint pipeline_run_intent_group_activation foreign key(project_activation_id,pipeline_group_id,organization_id) references public.project_pipeline_activations(id,pipeline_group_id,organization_id) on delete restrict;
create index project_pipeline_group_config_history on public.project_pipeline_configurations(organization_id,pipeline_group_id,group_revision desc) where pipeline_group_id is not null;
create index project_pipeline_group_activation_history on public.project_pipeline_activations(organization_id,pipeline_group_id,group_activation_number desc) where pipeline_group_id is not null;
comment on column public.project_pipeline_configurations.pipeline_group_id is 'Null retains exact Legacy history; non-null is an explicitly selected independent pipeline.';


create function public.create_project_pipeline_group(p_organization_id uuid,p_engagement_id uuid,p_preset_publication_id uuid,p_kind text,p_name text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); e public.engagements; preset public.pipeline_template_publications; existing public.project_pipeline_groups; sha text; group_id uuid;
begin
 if actor is null or p_request_id is null or p_preset_publication_id is null or p_kind is null or p_kind not in ('website','marketing') or p_name is null or p_name<>btrim(p_name) or length(p_name) not between 1 and 80 then raise exception 'Exact scoped named pipeline and published preset required' using errcode='22023'; end if;
 -- Lifecycle order: project, organization/member/PM binding, then engagement.
 select * into e from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
 if e.id is null or not private.n6_project_configuration_authorized(p_organization_id,e.project_id,actor) then raise exception 'Exact-project manager authority required' using errcode='42501'; end if;
 select * into e from public.engagements where id=p_engagement_id and organization_id=p_organization_id for update;
 if e.status not in ('planning','active') then raise exception 'Current engagement required' using errcode='42501'; end if;
 select * into preset from public.pipeline_template_publications where id=p_preset_publication_id and organization_id=p_organization_id;
 if preset.id is null then raise exception 'Exact published organization preset required' using errcode='42501'; end if;
 sha:=encode(pg_catalog.sha256(convert_to(jsonb_build_object('engagement_id',e.id,'preset_publication_id',preset.id,'kind',p_kind,'name',p_name)::text,'UTF8')),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pipeline-group:'||p_organization_id::text||':'||p_request_id::text,0));
 select * into existing from public.project_pipeline_groups where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if existing.created_by<>actor or existing.request_sha256<>sha then raise exception 'Request binds a different pipeline group' using errcode='23505'; end if;
  return jsonb_build_object('group',to_jsonb(existing),'idempotent_replay',true);
 end if;
 insert into public.project_pipeline_groups(organization_id,engagement_id,project_id,kind,name,preset_publication_id,request_id,request_sha256,created_by) values(p_organization_id,e.id,e.project_id,p_kind,p_name,preset.id,p_request_id,sha,actor) returning id into group_id;
 select * into existing from public.project_pipeline_groups where id=group_id;
 return jsonb_build_object('group',to_jsonb(existing),'idempotent_replay',false);
end; $$;
revoke all on function public.create_project_pipeline_group(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_project_pipeline_group(uuid,uuid,uuid,text,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.n6_project_configuration_authorized(p_organization_id uuid, p_project_id uuid, p_actor_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare member_role text;
begin
  perform 1 from public.projects p where p.id=p_project_id and p.organization_id=p_organization_id and p.archived_at is null for share;
  if not found then return false; end if;
  select membership.role into member_role
    from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    join public.projects project
      on project.id = p_project_id and project.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and project.archived_at is null and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
    for share of organization, membership;
  if not found then return false; end if;
  if member_role in ('system_owner', 'operations_admin') then return true; end if;
  return private.n1e_exact_project_manager(p_organization_id, p_project_id, p_actor_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_project_pipeline_configuration(p_organization_id uuid, p_engagement_id uuid, p_definition_publication_id uuid, p_request_id uuid, p_selected_steps jsonb, p_max_ai_cost_microusd bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  engagement public.engagements;
  origin public.engagement_pipeline_origins;
  definition_publication public.pipeline_execution_publications;
  definition public.pipeline_execution_definitions;
  existing public.project_pipeline_configurations;
  selected jsonb;
  selected_key text;
  selected_quantity integer;
  definition_step jsonb;
  selected_keys text[] := '{}'::text[];
  total_quantity integer := 0;
  has_paid_step boolean := false;
  next_revision integer;
  request_sha text;
  selected_sha text;
  new_id uuid;
begin
  if actor is null or p_organization_id is null or p_engagement_id is null
    or p_definition_publication_id is null or p_request_id is null
    or p_max_ai_cost_microusd is null or p_max_ai_cost_microusd < 0 then
    raise exception 'A complete scoped project configuration is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_selected_steps) is distinct from 'array' then
    raise exception 'Selected steps must be an ordered array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_selected_steps) not between 1 and 50
    or pg_catalog.octet_length(p_selected_steps::text) > 8192 then
    raise exception 'Choose 1–50 bounded steps.' using errcode = '22023';
  end if;
  select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
  if engagement.id is null or not private.n6_project_configuration_authorized(p_organization_id,engagement.project_id,actor) then raise exception 'Exact-project manager authority required' using errcode='42501'; end if;
  select * into engagement from public.engagements
    where id = p_engagement_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'Project engagement is unavailable.' using errcode = '42501';
  end if;
  if not private.n6_project_configuration_authorized(p_organization_id, engagement.project_id, actor) then
    raise exception 'Current exact-project manager authority is required.' using errcode = '42501';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'engagement_id', p_engagement_id,
    'definition_publication_id', p_definition_publication_id,
    'selected_steps', p_selected_steps,
    'max_ai_cost_microusd', p_max_ai_cost_microusd
  )::text, 'UTF8'), 'sha256'), 'hex');
  select * into existing from public.project_pipeline_configurations
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.configured_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request ID belongs to another project configuration.' using errcode = '23505';
    end if;
    return jsonb_build_object('configuration_id', existing.id,
      'revision', existing.revision, 'idempotent_replay', true);
  end if;
  if engagement.status not in ('planning', 'active') then
    raise exception 'Current project engagement is required.' using errcode = '42501';
  end if;
  select * into origin from public.engagement_pipeline_origins
    where engagement_id = engagement.id and organization_id = p_organization_id;
  select * into definition_publication from public.pipeline_execution_publications
    where id = p_definition_publication_id and organization_id = p_organization_id;
  select * into definition from public.pipeline_execution_definitions
    where id = definition_publication.definition_id and organization_id = p_organization_id;
  if origin.engagement_id is null or definition.id is null or not exists (
    select 1 from public.pipeline_template_publications preset
    where preset.id = definition.preset_publication_id
      and preset.organization_id = p_organization_id
      and preset.pipeline_template_version_id = origin.pipeline_template_version_id
  ) then
    raise exception 'Published execution definition must match this project preset.' using errcode = '42501';
  end if;
  if encode(extensions.digest(convert_to(definition.steps::text, 'UTF8'), 'sha256'), 'hex')
       <> definition.steps_sha256 then
    raise exception 'Execution definition integrity failed.' using errcode = '55000';
  end if;
  for selected in select value from jsonb_array_elements(p_selected_steps)
  loop
    if jsonb_typeof(selected) is distinct from 'object'
      or selected - 'key' - 'quantity' <> '{}'::jsonb then
      raise exception 'Each selected step requires only a key and quantity.' using errcode = '22023';
    end if;
    selected_key := selected ->> 'key';
    if selected_key is null or selected_key = any(selected_keys)
      or jsonb_typeof(selected -> 'quantity') is distinct from 'number'
      or coalesce((selected ->> 'quantity') ~ '^[0-9]{1,2}$', false) is false then
      raise exception 'Step keys must be distinct with a bounded quantity.' using errcode = '22023';
    end if;
    selected_quantity := (selected ->> 'quantity')::integer;
    if selected_quantity not between 1 and 50 then
      raise exception 'Each step quantity must be 1–50.' using errcode = '22023';
    end if;
    select value into definition_step from jsonb_array_elements(definition.steps)
      where value ->> 'key' = selected_key;
    if not found then
      raise exception 'Selected step is absent from the published definition.' using errcode = '42501';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(definition_step -> 'depends_on') dependency(value)
      where dependency.value <> all(selected_keys)
    ) then
      raise exception 'Selected steps must include earlier dependencies in order.' using errcode = '22023';
    end if;
    perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id
      where es.organization_id=p_organization_id and es.engagement_id=engagement.id
        and es.service_id=(definition_step->>'service_id')::uuid and es.status in ('planned','active')
        and sc.is_active and sc.department_id=definition_step->>'department_id' for share of es,sc;
    if not found then raise exception 'Selected current service/catalog required' using errcode='55000'; end if;
    perform 1 from public.project_department_participation pd where pd.project_id=engagement.project_id and pd.organization_id=p_organization_id and pd.department_id=definition_step->>'department_id' and pd.status='active' for share;
    if not found then raise exception 'Selected active project department required' using errcode='55000'; end if;
    if not exists (
      select 1 from public.engagement_services service
      where service.engagement_id = engagement.id
        and service.organization_id = p_organization_id
        and service.service_id = (definition_step ->> 'service_id')::uuid
        and service.status in ('planned', 'active')
    ) then
      raise exception 'A selected step service is not current in this project.' using errcode = '55000';
    end if;
    if not exists (
      select 1 from public.project_department_participation participation
      where participation.project_id = engagement.project_id
        and participation.organization_id = p_organization_id
        and participation.department_id = (definition_step ->> 'department_id')
        and participation.status = 'active'
    ) then
      raise exception 'Selected step department is not active on this project.' using errcode = '55000';
    end if;
    has_paid_step := has_paid_step or ((definition_step ->> 'kind') in ('ai_assisted', 'automatic'));
    total_quantity := total_quantity + selected_quantity;
    if total_quantity > 50 then
      raise exception 'Total selected quantity exceeds 50.' using errcode = '22023';
    end if;
    selected_keys := array_append(selected_keys, selected_key);
  end loop;
  if (has_paid_step and p_max_ai_cost_microusd = 0)
    or (not has_paid_step and p_max_ai_cost_microusd <> 0) then
    raise exception 'AI-capable steps require a positive local limit; human-only plans use zero.'
      using errcode = '22023';
  end if;
  select coalesce(max(revision), 0) + 1 into next_revision
    from public.project_pipeline_configurations
    where engagement_id = engagement.id;
  selected_sha := encode(extensions.digest(convert_to(p_selected_steps::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.project_pipeline_configurations(
    organization_id, engagement_id, project_id, definition_publication_id,
    revision, request_id, request_sha256, selected_steps, selected_steps_sha256,
    max_ai_cost_microusd, configured_by
  ) values (
    p_organization_id, engagement.id, engagement.project_id,
    definition_publication.id, next_revision, p_request_id, request_sha,
    p_selected_steps, selected_sha, p_max_ai_cost_microusd, actor
  ) returning id into new_id;
  return jsonb_build_object('configuration_id', new_id,
    'revision', next_revision, 'selected_steps_sha256', selected_sha,
    'idempotent_replay', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_project_pipeline_group_configuration(p_organization_id uuid, p_engagement_id uuid, p_definition_publication_id uuid, p_pipeline_group_id uuid, p_request_id uuid, p_selected_steps jsonb, p_max_ai_cost_microusd bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  engagement public.engagements;
  origin public.engagement_pipeline_origins;
  definition_publication public.pipeline_execution_publications;
  definition public.pipeline_execution_definitions;
  existing public.project_pipeline_configurations;
  selected jsonb;
  selected_key text;
  selected_quantity integer;
  definition_step jsonb;
  selected_keys text[] := '{}'::text[];
  total_quantity integer := 0;
  has_paid_step boolean := false;
  next_revision integer;
  request_sha text;
  selected_sha text;
  new_id uuid;
  pipeline_group public.project_pipeline_groups; group_revision integer;
begin
  if actor is null or p_organization_id is null or p_engagement_id is null
    or p_definition_publication_id is null or p_request_id is null
    or p_max_ai_cost_microusd is null or p_max_ai_cost_microusd < 0 then
    raise exception 'A complete scoped project configuration is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_selected_steps) is distinct from 'array' then
    raise exception 'Selected steps must be an ordered array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_selected_steps) not between 1 and 50
    or pg_catalog.octet_length(p_selected_steps::text) > 8192 then
    raise exception 'Choose 1–50 bounded steps.' using errcode = '22023';
  end if;
  select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
  if engagement.id is null or not private.n6_project_configuration_authorized(p_organization_id,engagement.project_id,actor) then raise exception 'Exact-project manager authority required' using errcode='42501'; end if;
  select * into engagement from public.engagements
    where id = p_engagement_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'Project engagement is unavailable.' using errcode = '42501';
  end if;
  if not private.n6_project_configuration_authorized(p_organization_id, engagement.project_id, actor) then
    raise exception 'Current exact-project manager authority is required.' using errcode = '42501';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'engagement_id', p_engagement_id, 'pipeline_group_id',p_pipeline_group_id,
    'definition_publication_id', p_definition_publication_id,
    'selected_steps', p_selected_steps,
    'max_ai_cost_microusd', p_max_ai_cost_microusd
  )::text, 'UTF8'), 'sha256'), 'hex');
  select * into existing from public.project_pipeline_configurations
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.configured_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request ID belongs to another project configuration.' using errcode = '23505';
    end if;
    return jsonb_build_object('configuration_id', existing.id,
      'revision', existing.revision, 'idempotent_replay', true);
  end if;
  if engagement.status not in ('planning', 'active') then
    raise exception 'Current project engagement is required.' using errcode = '42501';
  end if;
  select * into pipeline_group from public.project_pipeline_groups where id=p_pipeline_group_id and organization_id=p_organization_id and engagement_id=engagement.id and project_id=engagement.project_id;
  if not found then raise exception 'Exact independent pipeline group required' using errcode='42501'; end if;
  select * into definition_publication from public.pipeline_execution_publications where id=p_definition_publication_id and organization_id=p_organization_id;
  select * into definition from public.pipeline_execution_definitions where id=definition_publication.definition_id and organization_id=p_organization_id;
  if definition.id is null or definition.preset_publication_id<>pipeline_group.preset_publication_id then raise exception 'Published definition must match this exact pipeline preset' using errcode='42501'; end if;
  if encode(extensions.digest(convert_to(definition.steps::text, 'UTF8'), 'sha256'), 'hex')
       <> definition.steps_sha256 then
    raise exception 'Execution definition integrity failed.' using errcode = '55000';
  end if;
  for selected in select value from jsonb_array_elements(p_selected_steps)
  loop
    if jsonb_typeof(selected) is distinct from 'object'
      or selected - 'key' - 'quantity' <> '{}'::jsonb then
      raise exception 'Each selected step requires only a key and quantity.' using errcode = '22023';
    end if;
    selected_key := selected ->> 'key';
    if selected_key is null or selected_key = any(selected_keys)
      or jsonb_typeof(selected -> 'quantity') is distinct from 'number'
      or coalesce((selected ->> 'quantity') ~ '^[0-9]{1,2}$', false) is false then
      raise exception 'Step keys must be distinct with a bounded quantity.' using errcode = '22023';
    end if;
    selected_quantity := (selected ->> 'quantity')::integer;
    if selected_quantity not between 1 and 50 then
      raise exception 'Each step quantity must be 1–50.' using errcode = '22023';
    end if;
    select value into definition_step from jsonb_array_elements(definition.steps)
      where value ->> 'key' = selected_key;
    if not found then
      raise exception 'Selected step is absent from the published definition.' using errcode = '42501';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(definition_step -> 'depends_on') dependency(value)
      where dependency.value <> all(selected_keys)
    ) then
      raise exception 'Selected steps must include earlier dependencies in order.' using errcode = '22023';
    end if;
    perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id
      where es.organization_id=p_organization_id and es.engagement_id=engagement.id
        and es.service_id=(definition_step->>'service_id')::uuid and es.status in ('planned','active')
        and sc.is_active and sc.department_id=definition_step->>'department_id' for share of es,sc;
    if not found then raise exception 'Selected current service/catalog required' using errcode='55000'; end if;
    perform 1 from public.project_department_participation pd where pd.project_id=engagement.project_id and pd.organization_id=p_organization_id and pd.department_id=definition_step->>'department_id' and pd.status='active' for share;
    if not found then raise exception 'Selected active project department required' using errcode='55000'; end if;
    if not exists (
      select 1 from public.engagement_services service
      where service.engagement_id = engagement.id
        and service.organization_id = p_organization_id
        and service.service_id = (definition_step ->> 'service_id')::uuid
        and service.status in ('planned', 'active')
    ) then
      raise exception 'A selected step service is not current in this project.' using errcode = '55000';
    end if;
    if not exists (
      select 1 from public.project_department_participation participation
      where participation.project_id = engagement.project_id
        and participation.organization_id = p_organization_id
        and participation.department_id = (definition_step ->> 'department_id')
        and participation.status = 'active'
    ) then
      raise exception 'Selected step department is not active on this project.' using errcode = '55000';
    end if;
    has_paid_step := has_paid_step or ((definition_step ->> 'kind') in ('ai_assisted', 'automatic'));
    total_quantity := total_quantity + selected_quantity;
    if total_quantity > 50 then
      raise exception 'Total selected quantity exceeds 50.' using errcode = '22023';
    end if;
    selected_keys := array_append(selected_keys, selected_key);
  end loop;
  if (has_paid_step and p_max_ai_cost_microusd = 0)
    or (not has_paid_step and p_max_ai_cost_microusd <> 0) then
    raise exception 'AI-capable steps require a positive local limit; human-only plans use zero.'
      using errcode = '22023';
  end if;
  select coalesce(max(revision), 0) + 1 into next_revision
    from public.project_pipeline_configurations
    where engagement_id = engagement.id;
  selected_sha := encode(extensions.digest(convert_to(p_selected_steps::text, 'UTF8'), 'sha256'), 'hex');
  select coalesce(max(c.group_revision),0)+1 into group_revision from public.project_pipeline_configurations c where c.pipeline_group_id=pipeline_group.id;
  insert into public.project_pipeline_configurations(
    organization_id, engagement_id, project_id, definition_publication_id,
    revision, request_id, request_sha256, selected_steps, selected_steps_sha256,
    max_ai_cost_microusd, configured_by,pipeline_group_id,group_revision
  ) values (
    p_organization_id, engagement.id, engagement.project_id,
    definition_publication.id, next_revision, p_request_id, request_sha,
    p_selected_steps, selected_sha, p_max_ai_cost_microusd, actor,pipeline_group.id,group_revision
  ) returning id into new_id;
  return jsonb_build_object('configuration_id', new_id,
    'revision', next_revision,'group_revision',group_revision,'pipeline_group_id',pipeline_group.id, 'selected_steps_sha256', selected_sha,
    'idempotent_replay', false);
end;
$function$;

revoke all on function public.create_project_pipeline_group_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.create_project_pipeline_group_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint) to authenticated;

CREATE OR REPLACE FUNCTION private.n6_project_pipeline_impact(p_configuration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  configuration public.project_pipeline_configurations;
  current_activation public.project_pipeline_activations;
  previous public.project_pipeline_configurations;
  new_keys jsonb;
  removed_keys jsonb;
  existing_jobs integer;
  job_ids text;
  token text;
begin
  select * into configuration from public.project_pipeline_configurations
    where id = p_configuration_id;
  if not found then raise exception 'Configuration is unavailable.' using errcode = 'P0002'; end if;
  select * into current_activation from public.project_pipeline_activations
    where engagement_id = configuration.engagement_id
      and organization_id = configuration.organization_id
      and pipeline_group_id is not distinct from configuration.pipeline_group_id
    order by activation_number desc limit 1;
  if current_activation.id is not null then
    select * into previous from public.project_pipeline_configurations
      where id = current_activation.configuration_id
        and organization_id = configuration.organization_id;
  end if;
  select coalesce(jsonb_agg(selected.value ->> 'key' order by selected.position), '[]'::jsonb)
    into new_keys
    from jsonb_array_elements(configuration.selected_steps)
      with ordinality selected(value, position)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(previous.selected_steps, '[]'::jsonb)) old(value)
      where old.value ->> 'key' = selected.value ->> 'key'
    );
  select coalesce(jsonb_agg(old.value ->> 'key' order by old.position), '[]'::jsonb)
    into removed_keys
    from jsonb_array_elements(coalesce(previous.selected_steps, '[]'::jsonb))
      with ordinality old(value, position)
    where not exists (
      select 1 from jsonb_array_elements(configuration.selected_steps) selected(value)
      where selected.value ->> 'key' = old.value ->> 'key'
    );
  select count(*), coalesce(string_agg(job.id::text, ',' order by job.id), '')
    into existing_jobs, job_ids
    from public.pipeline_run_intents intent
    join public.ai_execution_jobs job
      on job.run_intent_id = intent.id and job.organization_id = intent.organization_id
    where intent.engagement_id = configuration.engagement_id
      and intent.organization_id = configuration.organization_id
      and intent.pipeline_group_id is not distinct from configuration.pipeline_group_id;
  token := encode(extensions.digest(convert_to(jsonb_build_object(
    'configuration_id', configuration.id,'pipeline_group_id',configuration.pipeline_group_id,
    'selected_steps_sha256', configuration.selected_steps_sha256,
    'previous_activation_id', current_activation.id,
    'previous_configuration_id', previous.id,
    'existing_job_ids', job_ids
  )::text, 'UTF8'), 'sha256'), 'hex');
  return jsonb_build_object(
    'configuration_id', configuration.id,'pipeline_group_id',configuration.pipeline_group_id,
    'previous_activation_id', current_activation.id,
    'previous_configuration_id', previous.id,
    'added_step_keys', new_keys,
    'removed_step_keys', removed_keys,
    'previous_selected_steps', coalesce(previous.selected_steps, '[]'::jsonb),
    'new_selected_steps', configuration.selected_steps,
    'previous_max_ai_cost_microusd', previous.max_ai_cost_microusd,
    'existing_jobs_preserved', existing_jobs,
    'new_step_count', jsonb_array_length(configuration.selected_steps),
    'new_max_ai_cost_microusd', configuration.max_ai_cost_microusd,
    'impact_token_sha256', token
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.activate_project_pipeline_configuration(p_organization_id uuid, p_configuration_id uuid, p_request_id uuid, p_impact_token_sha256 text, p_impact_acknowledged boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  configuration public.project_pipeline_configurations;
  engagement public.engagements;
  existing public.project_pipeline_activations;
  impact jsonb;
  selected jsonb;
  definition public.pipeline_execution_definitions;
  activation_number integer;
  new_id uuid; group_number integer;
begin
  if actor is null or p_organization_id is null or p_configuration_id is null
    or p_request_id is null or p_impact_acknowledged is distinct from true
    or p_impact_token_sha256 is null
    or p_impact_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Exact impact review and acknowledgement are required.' using errcode = '22023';
  end if;
  select * into configuration from public.project_pipeline_configurations
    where id = p_configuration_id and organization_id = p_organization_id;
  if not found then raise exception 'Configuration is unavailable.' using errcode = 'P0002'; end if;
  if not private.n6_project_configuration_authorized(p_organization_id,configuration.project_id,actor) then raise exception 'Exact-project manager authority required' using errcode='42501'; end if;
  select * into engagement from public.engagements
    where id = configuration.engagement_id and organization_id = p_organization_id
    for update;
  if not found or engagement.project_id <> configuration.project_id then
    raise exception 'Project context has changed.' using errcode = '55000';
  end if;
  if not private.n6_project_configuration_authorized(
    p_organization_id, engagement.project_id, actor
  ) then
    raise exception 'Current exact-project manager authority is required.' using errcode = '42501';
  end if;
  select * into existing from public.project_pipeline_activations
    where organization_id = p_organization_id
      and (configuration_id = configuration.id or request_id = p_request_id);
  if found then
    if existing.configuration_id <> configuration.id or existing.request_id <> p_request_id
      or existing.activated_by <> actor
      or existing.impact_token_sha256 <> p_impact_token_sha256 then
      raise exception 'Request or configuration has a different activation.' using errcode = '23505';
    end if;
    return jsonb_build_object('activation_id', existing.id,
      'activation_number', existing.activation_number, 'idempotent_replay', true);
  end if;
  if engagement.status not in ('planning', 'active') then
    raise exception 'Project is not current for a new activation.' using errcode = '55000';
  end if;
  if encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
       <> configuration.selected_steps_sha256 then
    raise exception 'Configuration integrity failed.' using errcode = '55000';
  end if;
  select source_definition.* into definition
    from public.pipeline_execution_publications publication
    join public.pipeline_execution_definitions source_definition
      on source_definition.id = publication.definition_id
     and source_definition.organization_id = publication.organization_id
    where publication.id = configuration.definition_publication_id
      and publication.organization_id = p_organization_id;
  if not found or encode(extensions.digest(convert_to(definition.steps::text, 'UTF8'), 'sha256'), 'hex')
       <> definition.steps_sha256 then
    raise exception 'Published execution definition is unavailable or changed.' using errcode = '55000';
  end if;
  for selected in select value from jsonb_array_elements(configuration.selected_steps)
  loop
    perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id
      join jsonb_array_elements(definition.steps) ds(value) on (ds.value->>'service_id')::uuid=es.service_id
      where es.organization_id=p_organization_id and es.engagement_id=engagement.id and es.status in ('planned','active')
        and ds.value->>'key'=selected->>'key' and sc.is_active and sc.department_id=ds.value->>'department_id' for share of es,sc;
    if not found then raise exception 'Configured current service/catalog required' using errcode='55000'; end if;
    perform 1 from public.project_department_participation pd join jsonb_array_elements(definition.steps) ds(value) on ds.value->>'department_id'=pd.department_id
      where pd.organization_id=p_organization_id and pd.project_id=engagement.project_id and pd.status='active' and ds.value->>'key'=selected->>'key' for share of pd;
    if not found then raise exception 'Configured active project department required' using errcode='55000'; end if;
    if not exists (
      select 1 from jsonb_array_elements(definition.steps) step(value)
      join public.engagement_services service
        on service.service_id = (step.value ->> 'service_id')::uuid
       and service.organization_id = p_organization_id
       and service.engagement_id = engagement.id
       and service.status in ('planned', 'active')
      join public.project_department_participation participation
        on participation.project_id = engagement.project_id
       and participation.organization_id = p_organization_id
       and participation.department_id = (step.value ->> 'department_id')
       and participation.status = 'active'
      where (step.value ->> 'key') = (selected ->> 'key')
    ) then
      raise exception 'A configured service or department is no longer current.' using errcode = '55000';
    end if;
  end loop;
  impact := private.n6_project_pipeline_impact(configuration.id);
  if impact ->> 'impact_token_sha256' <> p_impact_token_sha256 then
    raise exception 'Project pipeline impact changed; preview again.' using errcode = '40001';
  end if;
  select coalesce(max(a.activation_number), 0) + 1 into activation_number
    from public.project_pipeline_activations a
    where a.engagement_id = engagement.id;
  if configuration.pipeline_group_id is not null then select coalesce(max(a.group_activation_number),0)+1 into group_number from public.project_pipeline_activations a where a.pipeline_group_id=configuration.pipeline_group_id; end if;
  insert into public.project_pipeline_activations(
    organization_id, engagement_id, configuration_id,
    activation_number, request_id, impact_token_sha256, activated_by,pipeline_group_id,group_activation_number
  ) values (
    p_organization_id, engagement.id, configuration.id,
    activation_number, p_request_id, p_impact_token_sha256, actor,configuration.pipeline_group_id,group_number
  ) returning id into new_id;
  return jsonb_build_object('activation_id', new_id,
    'activation_number', activation_number,'group_activation_number',group_number,'pipeline_group_id',configuration.pipeline_group_id, 'idempotent_replay', false);
end;
$function$;

CREATE OR REPLACE FUNCTION private.n6_pin_current_project_activation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pinned_activation uuid;
  pinned_sha text;
begin
  if new.project_activation_id is not null or new.selected_steps_sha256 is not null then
    raise exception 'Project activation is pinned by the server.' using errcode = '42501';
  end if;
  select activation.id, configuration.selected_steps_sha256
    into pinned_activation, pinned_sha
    from public.project_pipeline_activations activation
    join public.project_pipeline_configurations configuration
      on configuration.id = activation.configuration_id
     and configuration.engagement_id = activation.engagement_id
     and configuration.organization_id = activation.organization_id
    where activation.organization_id = new.organization_id
      and activation.engagement_id = new.engagement_id
      and activation.pipeline_group_id is not distinct from new.pipeline_group_id
    order by activation.activation_number desc
    limit 1;
  if new.pipeline_group_id is not null and pinned_activation is null then raise exception 'Explicit group requires a current reviewed activation' using errcode='42501'; end if;
  if pinned_activation is not null then
    new.project_activation_id := pinned_activation;
    new.selected_steps_sha256 := pinned_sha;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.preflight_pipeline_ai_job(p_organization_id uuid, p_job_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  plan public.pipeline_run_plans;
  approval public.ai_execution_input_approvals;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  expected_steps integer;
  configured_steps integer;
  has_ai_steps boolean;
  missing_routes jsonb := '[]'::jsonb;
  step_department text;
  route_count integer;
  has_budget boolean;
  spend_guard_mode text;
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null then
    raise exception 'An exact organization, job and actor are required.' using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = p_actor_id and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin');
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id;
  if not found or job.requested_by <> p_actor_id
    or job.status <> 'blocked_configuration' then
    raise exception 'Actor-owned blocked job is unavailable.' using errcode = '42501';
  end if;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  select * into plan from public.pipeline_run_plans
    where id = job.run_plan_id and run_intent_id = job.run_intent_id
      and organization_id = p_organization_id;
  if intent.id is null or plan.id is null then
    raise exception 'Pinned request or work plan is unavailable.' using errcode = '55000';
  end if;
  if intent.project_activation_id is null or intent.selected_steps_sha256 is null then
    raise exception 'A project activation is required for configured AI execution.' using errcode = '42501';
  end if;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id;
  if activation.id is null or configuration.id is null
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or job.input_manifest ->> 'project_activation_id' is distinct from activation.id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
       <> intent.selected_steps_sha256
    or exists (
      select 1 from public.project_pipeline_activations newer
      where newer.engagement_id = intent.engagement_id
        and newer.organization_id = p_organization_id
        and newer.pipeline_group_id is not distinct from activation.pipeline_group_id
        and newer.activation_number > activation.activation_number
    ) then
    raise exception 'Pinned project activation is unavailable, changed, or superseded.' using errcode = '55000';
  end if;
  select sum((selected.value ->> 'quantity')::integer) into expected_steps
    from jsonb_array_elements(configuration.selected_steps) selected(value);
  select count(*), coalesce(bool_or((step.definition_step ->> 'kind') in ('ai_assisted', 'automatic')), false)
    into configured_steps, has_ai_steps
    from public.ai_execution_configured_steps step
    where step.organization_id = p_organization_id and step.job_id = job.id
      and step.project_activation_id = activation.id;
  if expected_steps not between 1 and 50 or configured_steps <> expected_steps
    or exists (
      select 1 from public.ai_execution_configured_steps step
      where step.job_id = job.id and step.organization_id = p_organization_id
        and step.project_activation_id <> activation.id
    ) then
    raise exception 'Configured step identities are incomplete.' using errcode = '55000';
  end if;
  select * into approval from public.ai_execution_input_approvals
    where job_id = job.id and organization_id = p_organization_id;
  if approval.id is null or approval.approved_by <> p_actor_id
    or approval.job_input_sha256 <> job.input_sha256
    or approval.work_sha256 <> plan.work_sha256 then
    raise exception 'Exact-job input acknowledgement is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.engagements engagement
    where engagement.id = intent.engagement_id
      and engagement.organization_id = p_organization_id
      and engagement.status in ('planning', 'active')
  ) then
    raise exception 'Engagement is no longer current.' using errcode = '55000';
  end if;
  if jsonb_typeof(intent.input_manifest -> 'assets') is distinct from 'array'
    or jsonb_array_length(intent.input_manifest -> 'assets') <> 0 then
    raise exception 'Asset AI-use classification is not available.' using errcode = '42501';
  end if;
  if encode(extensions.digest(convert_to(intent.input_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> intent.input_sha256
    or encode(extensions.digest(convert_to(plan.work_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> plan.work_sha256
    or encode(extensions.digest(convert_to(job.input_manifest::text, 'UTF8'), 'sha256'), 'hex')
       <> job.input_sha256
    or job.input_manifest ->> 'input_sha256' is distinct from intent.input_sha256
    or job.input_manifest ->> 'work_sha256' is distinct from plan.work_sha256 then
    raise exception 'Pinned input integrity failed.' using errcode = '55000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(intent.input_manifest -> 'services') selected(value)
    left join public.engagement_services service
      on service.id = (selected.value ->> 'id')::uuid
     and service.engagement_id = intent.engagement_id
     and service.organization_id = p_organization_id
     and service.status in ('planned', 'active')
    where service.id is null
  ) then
    raise exception 'A pinned service is no longer available.' using errcode = '55000';
  end if;
  if (select count(*) from public.ai_execution_job_steps step where step.job_id = job.id)
       <> jsonb_array_length(plan.work_manifest)
    or exists (
      select 1 from public.ai_execution_job_steps step
      left join public.work_items item
        on item.id = step.work_item_id and item.organization_id = step.organization_id
       and item.engagement_id = intent.engagement_id and item.deleted_at is null
      where step.job_id = job.id and (
        item.id is null or item.row_version <> step.source_row_version
        or item.status = 'done'
        or item.department_id is distinct from step.department_id
      )
    ) then
    raise exception 'Pinned work has changed; start a new run request.' using errcode = '55000';
  end if;
  for step_department in
    select distinct step.definition_step ->> 'department_id'
      from public.ai_execution_configured_steps step
      where step.job_id = job.id and step.organization_id = p_organization_id
        and (step.definition_step ->> 'kind') in ('ai_assisted', 'automatic')
      order by 1
  loop
    if step_department is null then
      missing_routes := missing_routes || jsonb_build_array('unassigned');
    else
      route_count := jsonb_array_length(public.get_pipeline_ai_text_routes(
        p_organization_id, job.id, step_department, p_actor_id
      ));
      if route_count = 0 then
        missing_routes := missing_routes || jsonb_build_array(step_department);
      end if;
    end if;
  end loop;
  select budget.spend_guard_mode into spend_guard_mode
    from private.ai_execution_budget_limits budget
    where budget.organization_id = p_organization_id;
  has_budget := coalesce(spend_guard_mode in ('local_monthly_cap', 'provider_managed'), false);
  return jsonb_build_object(
    'job_id', job.id, 'inputs_current', true,
    'missing_route_departments', missing_routes,
    'budget_cap_configured', coalesce(spend_guard_mode = 'local_monthly_cap', false),
    'spend_guard_mode', spend_guard_mode,
    'spend_tracking_configured', has_budget,
    'project_activation_id', activation.id,
    'configured_step_count', configured_steps,
    'local_ai_cost_limit_microusd', configuration.max_ai_cost_microusd,
    'configuration_ready', has_ai_steps and configuration.max_ai_cost_microusd > 0
      and has_budget and jsonb_array_length(missing_routes) = 0,
    'dispatch_enabled', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.advance_pipeline_manual_step(p_organization_id uuid, p_job_id uuid, p_step_id uuid, p_request_id uuid, p_expected_version bigint, p_action text, p_evidence text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  plan public.pipeline_run_plans;
  activation public.project_pipeline_activations;
  configuration public.project_pipeline_configurations;
  step public.ai_execution_configured_steps;
  progress public.ai_execution_step_progress;
  prior_event public.ai_execution_step_action_events;
  engagement public.engagements;
  approval public.ai_execution_input_approvals;
  dependency text;
  evidence text := trim(coalesce(p_evidence, ''));
  step_kind text;
begin
  if actor is null or p_organization_id is null or p_job_id is null
    or p_step_id is null or p_request_id is null or p_expected_version is null
    or p_expected_version <= 0 or p_action is null or p_action not in ('start', 'complete', 'approve', 'pause', 'resume')
    or length(evidence) > 1000
    or (p_action in ('complete', 'approve') and length(evidence) = 0) then
    raise exception 'Exact manual action, version and completion evidence are required.' using errcode = '22023';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id for share;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id for share;
  select * into plan from public.pipeline_run_plans
    where id = job.run_plan_id and organization_id = p_organization_id
      and run_intent_id = job.run_intent_id for share;
  select * into engagement from public.engagements
    where id = intent.engagement_id and organization_id = p_organization_id for share;
  select * into activation from public.project_pipeline_activations
    where id = intent.project_activation_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id for share;
  select * into configuration from public.project_pipeline_configurations
    where id = activation.configuration_id and organization_id = p_organization_id
      and engagement_id = intent.engagement_id for share;
  if job.id is null or intent.id is null or plan.id is null or engagement.id is null or activation.id is null or configuration.id is null
    or job.status <> 'blocked_configuration'
    or engagement.status not in ('planning', 'active')
    or configuration.selected_steps_sha256 is distinct from intent.selected_steps_sha256
    or job.input_manifest ->> 'project_activation_id' is distinct from activation.id::text
    or job.input_manifest ->> 'selected_steps_sha256' is distinct from intent.selected_steps_sha256
    or encode(extensions.digest(convert_to(configuration.selected_steps::text, 'UTF8'), 'sha256'), 'hex')
      <> intent.selected_steps_sha256
    or exists (select 1 from public.project_pipeline_activations newer
      where newer.organization_id = p_organization_id
        and newer.engagement_id = engagement.id
        and newer.pipeline_group_id is not distinct from activation.pipeline_group_id
        and newer.activation_number > activation.activation_number) then
    raise exception 'Current pinned manual run is required.' using errcode = '55000';
  end if;
  select * into step from public.ai_execution_configured_steps
    where id = p_step_id and job_id = job.id and organization_id = p_organization_id
      and project_activation_id = activation.id;
  step_kind := step.definition_step ->> 'kind';
  if step.id is null or step_kind not in ('human', 'approval_gate') then
    raise exception 'Only a pinned human or approval step may be advanced here.' using errcode = '42501';
  end if;
  if not (private.n6_project_configuration_authorized(
      p_organization_id, engagement.project_id, actor)
    or private.n1e_department_head(p_organization_id, engagement.project_id,
      step.definition_step ->> 'department_id', actor)) then
    raise exception 'Current exact-project or department authority is required.' using errcode = '42501';
  end if;
  select * into approval from public.ai_execution_input_approvals
    where job_id = job.id and organization_id = p_organization_id;
  if approval.id is null or approval.job_input_sha256 <> job.input_sha256
    or approval.work_sha256 <> plan.work_sha256 then
    raise exception 'Exact pinned input acknowledgement is required.' using errcode = '42501';
  end if;
  if encode(extensions.digest(convert_to(intent.input_manifest::text, 'UTF8'), 'sha256'), 'hex') <> intent.input_sha256
    or encode(extensions.digest(convert_to(plan.work_manifest::text, 'UTF8'), 'sha256'), 'hex') <> plan.work_sha256
    or encode(extensions.digest(convert_to(job.input_manifest::text, 'UTF8'), 'sha256'), 'hex') <> job.input_sha256
    or job.input_manifest ->> 'input_sha256' is distinct from intent.input_sha256
    or job.input_manifest ->> 'work_sha256' is distinct from plan.work_sha256 then
    raise exception 'Pinned input integrity failed.' using errcode = '55000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(intent.input_manifest -> 'services') selected(value)
    left join public.engagement_services service
      on service.id = (selected.value ->> 'id')::uuid
      and service.organization_id = p_organization_id
      and service.engagement_id = intent.engagement_id
      and service.status in ('planned', 'active')
    where service.id is null
  ) then
    raise exception 'A pinned service is no longer available.' using errcode = '55000';
  end if;
  if (select count(*) from public.ai_execution_job_steps linked where linked.job_id = job.id)
       <> jsonb_array_length(plan.work_manifest)
    or exists (
      select 1 from public.ai_execution_job_steps linked
      left join public.work_items item
        on item.id = linked.work_item_id and item.organization_id = linked.organization_id
          and item.engagement_id = intent.engagement_id and item.deleted_at is null
      where linked.job_id = job.id and (
        item.id is null or item.row_version <> linked.source_row_version
        or item.status = 'done'
        or item.department_id is distinct from linked.department_id
      )
    ) then
    raise exception 'Pinned work has changed; start a new run request.' using errcode = '55000';
  end if;
  select * into progress from public.ai_execution_step_progress
    where configured_step_id = step.id and organization_id = p_organization_id for update;
  if not found then raise exception 'Step progress is missing.' using errcode = '55000'; end if;
  select * into prior_event from public.ai_execution_step_action_events
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if prior_event.job_id <> job.id or prior_event.configured_step_id <> step.id
      or prior_event.actor_id <> actor or prior_event.action <> p_action
      or prior_event.prior_version <> p_expected_version
      or prior_event.evidence <> evidence then
      raise exception 'Request ID has a different manual action.' using errcode = '23505';
    end if;
    return jsonb_build_object('step_id', step.id, 'status', case when prior_event.action in ('complete', 'approve') then 'completed'
        when prior_event.action = 'pause' then 'paused' else 'in_progress' end,
      'state_version', prior_event.resulting_version, 'idempotent_replay', true);
  end if;
  if progress.state_version <> p_expected_version then
    raise exception 'Step version changed; refresh the run.' using errcode = '40001';
  end if;
  if p_action in ('start', 'approve') then
    for dependency in select value from jsonb_array_elements_text(step.definition_step -> 'depends_on') loop
      if exists (select 1 from public.ai_execution_configured_steps required
        join public.ai_execution_step_progress required_progress
          on required_progress.configured_step_id = required.id
        where required.job_id = job.id and required.organization_id = p_organization_id
          and required.step_key = dependency and required_progress.status <> 'completed') then
        raise exception 'A pinned dependency is not complete.' using errcode = '55000';
      end if;
    end loop;
  end if;
  if (p_action = 'start' and (step_kind <> 'human' or progress.status <> 'waiting'))
    or (p_action = 'complete' and (step_kind <> 'human' or progress.status <> 'in_progress'))
    or (p_action = 'approve' and (step_kind <> 'approval_gate' or progress.status <> 'waiting'
      or actor = job.requested_by))
    or (p_action = 'pause' and (step_kind <> 'human' or progress.status <> 'in_progress'))
    or (p_action = 'resume' and (step_kind <> 'human' or progress.status <> 'paused')) then
    raise exception 'Manual step transition is not permitted.' using errcode = '55000';
  end if;
  update public.ai_execution_step_progress
    set status = case p_action
      when 'start' then 'in_progress' when 'complete' then 'completed'
      when 'approve' then 'completed' when 'pause' then 'paused'
      else 'in_progress' end,
      state_version = state_version + 1,
      started_by = case when p_action = 'start' then actor else started_by end,
      started_at = case when p_action = 'start' then clock_timestamp() else started_at end,
      completed_by = case when p_action in ('complete', 'approve') then actor else completed_by end,
      completed_at = case when p_action in ('complete', 'approve') then clock_timestamp() else completed_at end,
      updated_at = clock_timestamp()
    where configured_step_id = step.id;
  insert into public.ai_execution_step_action_events(
    organization_id, job_id, configured_step_id, request_id, actor_id,
    action, prior_version, resulting_version, evidence
  ) values (
    p_organization_id, job.id, step.id, p_request_id, actor,
    p_action, p_expected_version, p_expected_version + 1, evidence
  );
  return jsonb_build_object('step_id', step.id,
    'status', case when p_action in ('complete', 'approve') then 'completed'
      when p_action = 'pause' then 'paused' else 'in_progress' end,
    'state_version', p_expected_version + 1, 'idempotent_replay', false);
end;
$function$;

CREATE OR REPLACE FUNCTION private.n6_require_output_reviewer(p_organization_id uuid, p_output_id uuid, p_actor_id uuid)
 RETURNS ai_execution_step_outputs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  output public.ai_execution_step_outputs;
  job public.ai_execution_jobs;
  intent public.pipeline_run_intents;
  engagement public.engagements;
  step public.ai_execution_configured_steps;
  attempt private.ai_execution_step_attempts;
begin
  if p_organization_id is null or p_output_id is null or p_actor_id is null then
    raise exception 'Exact output and authenticated actor are required.' using errcode = '22023';
  end if;
  select * into output from public.ai_execution_step_outputs
    where id = p_output_id and organization_id = p_organization_id;
  select * into job from public.ai_execution_jobs
    where id = output.job_id and organization_id = p_organization_id;
  select * into intent from public.pipeline_run_intents
    where id = job.run_intent_id and organization_id = p_organization_id;
  select * into engagement from public.engagements
    where id = intent.engagement_id and organization_id = p_organization_id;
  select * into step from public.ai_execution_configured_steps
    where id = output.configured_step_id and job_id = job.id
      and organization_id = p_organization_id;
  select * into attempt from private.ai_execution_step_attempts
    where id = output.attempt_id and organization_id = p_organization_id;
  if output.id is null or job.id is null or intent.id is null
    or engagement.id is null or step.id is null or attempt.id is null
    or output.job_input_sha256 <> job.input_sha256
    or attempt.job_input_sha256 <> job.input_sha256
    or step.project_activation_id is distinct from intent.project_activation_id
    or engagement.status not in ('planning', 'active')
    or exists (
      select 1 from public.project_pipeline_activations current_activation
      join public.project_pipeline_activations newer
        on newer.organization_id = current_activation.organization_id
        and newer.engagement_id = current_activation.engagement_id
        and newer.pipeline_group_id is not distinct from current_activation.pipeline_group_id
        and newer.activation_number > current_activation.activation_number
      where current_activation.id = intent.project_activation_id
        and current_activation.organization_id = p_organization_id
    ) then
    raise exception 'Current pinned output is unavailable.' using errcode = '55000';
  end if;
  if not (private.n1e_org_authority(p_organization_id, engagement.project_id, p_actor_id)
    or private.n1e_department_head(p_organization_id, engagement.project_id,
      step.definition_step ->> 'department_id', p_actor_id)) then
    raise exception 'Current scoped specialist review authority is required.' using errcode = '42501';
  end if;
  return output;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_pipeline_ai_text_routes(p_organization_id uuid, p_job_id uuid, p_department_id text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       and newer.pipeline_group_id is not distinct from current_activation.pipeline_group_id
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
$function$;

CREATE OR REPLACE FUNCTION private.build_living_project_snapshot_projection(p_organization_id uuid, p_project_id uuid, p_projection_kind text, p_source_version bigint, p_generated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_project public.projects%rowtype;
  v_projection jsonb;
begin
  select project.* into strict v_project
  from public.projects project
  where project.id = p_project_id and project.organization_id = p_organization_id;

  if p_projection_kind = 'internal' then
    select jsonb_build_object(
      'schema_version', 1,
      'projection_kind', 'internal',
      'generated_at', p_generated_at,
      'source_version', p_source_version,
      'project', jsonb_strip_nulls(jsonb_build_object(
        'id', v_project.id, 'name', v_project.name, 'engagement_type', v_project.engagement_type,
        'status', v_project.status, 'health', v_project.health, 'priority', v_project.priority,
        'start_date', v_project.start_date, 'due_date', v_project.due_date,
        'description', v_project.description, 'scope_statement', v_project.scope_statement,
        'exclusions', v_project.exclusions, 'client_id', v_project.client_id, 'owner_id', v_project.owner_id
      )),
      'progress', jsonb_build_object(
        'workstreams', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.workstreams row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'tasks', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.tasks row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'milestones', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.milestones row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'deliverables', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.deliverables row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'requests', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.requests row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb)
      ),
      'workstreams', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'department_id', row.department_id, 'name', row.name,
        'status', row.status, 'owner_id', row.owner_id
      )) order by row.created_at, row.id) from public.workstreams row
        where row.organization_id = p_organization_id and row.project_id = p_project_id), '[]'::jsonb),
      'tasks', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'workstream_id', row.workstream_id, 'title', row.title,
        'description', row.description, 'status', row.status, 'priority', row.priority,
        'due_date', row.due_date, 'assigned_to', row.assigned_to,
        'acceptance_criteria', row.acceptance_criteria, 'completion_evidence', row.completion_evidence
      )) order by row.created_at, row.id) from public.tasks row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'dependencies', coalesce((select jsonb_agg(jsonb_strip_nulls(to_jsonb(row)) order by row.created_at, row.id)
        from public.task_dependencies row
        join public.tasks task on task.id = row.task_id
          and task.organization_id = row.organization_id and task.project_id = p_project_id
        join public.tasks prerequisite on prerequisite.id = row.depends_on_task_id
          and prerequisite.organization_id = row.organization_id and prerequisite.project_id = p_project_id
        where row.organization_id = p_organization_id), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'name', row.name, 'description', row.description, 'status', row.status,
        'target_date', row.target_date, 'completed_at', row.completed_at
      )) order by row.position::text, row.id) from public.milestones row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'research', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'workstream_id', row.workstream_id, 'research_type', row.research_type,
        'title', row.title, 'question', row.question, 'findings', row.findings,
        'recommendation', row.recommendation, 'sources', row.sources,
        'confidence', row.confidence, 'status', row.status
      )) order by row.updated_at desc nulls last, row.id) from public.research_records row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'deliverables', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', deliverable.id, 'workstream_id', deliverable.workstream_id, 'title', deliverable.title,
        'deliverable_type', deliverable.deliverable_type, 'status', deliverable.status,
        'due_date', deliverable.due_date, 'versions', coalesce((select jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', version.id, 'version_number', version.version_number, 'title', version.title,
            'change_summary', version.change_summary, 'review_status', version.review_status,
            'created_at', version.created_at
          )) order by version.version_number::text, version.id)
          from public.deliverable_versions version
          where version.organization_id = p_organization_id
            and version.project_id = p_project_id and version.deliverable_id = deliverable.id
        ), '[]'::jsonb)
      )) order by deliverable.updated_at desc nulls last, deliverable.id) from public.deliverables deliverable
        where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
          and deliverable.archived_at is null), '[]'::jsonb),
      'requests', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'request_type', row.request_type, 'request_origin', row.request_origin,
        'title', row.title, 'requested_output', row.requested_output, 'status', row.status,
        'priority', row.priority, 'required_by', row.required_by, 'owner_id', row.owner_id
      )) order by row.updated_at desc nulls last, row.id) from public.requests row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'recent_activity', coalesce((select jsonb_agg(event.payload order by event.occurred_at desc, event.id desc)
        from (select row.id, row.occurred_at, jsonb_strip_nulls(jsonb_build_object(
          'id', row.id, 'action', row.action, 'target_type', row.target_type,
          'target_id', row.target_id, 'metadata', row.metadata,
          'summary', initcap(replace(replace(row.action, '_', ' '), '.', ' ')),
          'actor_id', row.actor_id, 'occurred_at', row.occurred_at
        )) payload from public.activity_events row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
        order by row.occurred_at desc, row.id desc limit 50) event), '[]'::jsonb),
      'recent_activity_is_complete', false
    ) into v_projection;
  elsif p_projection_kind = 'client' then
    select jsonb_build_object(
      'schema_version', 1,
      'projection_kind', 'client',
      'generated_at', p_generated_at,
      'source_version', p_source_version,
      'project', jsonb_strip_nulls(jsonb_build_object(
        'id', v_project.id, 'name', v_project.name, 'engagement_type', v_project.engagement_type,
        'status', v_project.status, 'health', v_project.health, 'priority', v_project.priority,
        'start_date', v_project.start_date, 'due_date', v_project.due_date,
        'summary', v_project.client_summary
      )),
      'progress', jsonb_build_object(
        'visible_workstreams', (select count(*) from public.workstreams row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.client_visible = true),
        'completed_milestones', (select count(*) from public.milestones row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.archived_at is null and row.status = 'completed'
            and row.visibility in ('client_visible', 'client_restricted')),
        'released_deliverables', (select count(*) from public.deliverables deliverable
          where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
            and deliverable.archived_at is null and exists (
              select 1 from public.deliverable_versions version
              join public.client_portal_items portal
                on portal.organization_id = version.organization_id
               and portal.project_id = version.project_id
               and portal.source_type = 'deliverable_version'
               and portal.source_id = version.id and portal.withdrawn_at is null
              where version.organization_id = p_organization_id and version.project_id = p_project_id
                and version.deliverable_id = deliverable.id
                and version.review_status in ('client_reviewing', 'revision_requested', 'client_approved', 'delivered_published')
            )),
        'open_client_requests', (select count(*) from public.requests row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.archived_at is null and row.visibility = 'client_visible'
            and row.status not in ('completed', 'declined', 'withdrawn'))
      ),
      'workstreams', coalesce((select jsonb_agg(jsonb_build_object(
        'name', row.name, 'status', row.status
      ) order by row.created_at, row.id) from public.workstreams row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.client_visible = true), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', row.name, 'description', row.description, 'status', row.status,
        'target_date', row.target_date, 'completed_at', row.completed_at
      )) order by row.position::text, row.id) from public.milestones row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null and row.visibility in ('client_visible', 'client_restricted')), '[]'::jsonb),
      'deliverables', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', deliverable.id, 'title', deliverable.title, 'deliverable_type', deliverable.deliverable_type,
        'status', deliverable.status, 'due_date', deliverable.due_date,
        'versions', versions.items
      )) order by deliverable.updated_at desc nulls last, deliverable.id)
        from public.deliverables deliverable
        cross join lateral (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', version.id, 'version_number', version.version_number, 'title', version.title,
            'change_summary', version.change_summary, 'review_status', version.review_status,
            'released_at', portal.released_at
          )) order by version.version_number::text, version.id) items
          from public.deliverable_versions version
          join public.client_portal_items portal
            on portal.organization_id = version.organization_id
           and portal.project_id = version.project_id
           and portal.source_type = 'deliverable_version'
           and portal.source_id = version.id and portal.withdrawn_at is null
          where version.organization_id = p_organization_id and version.project_id = p_project_id
            and version.deliverable_id = deliverable.id
            and version.review_status in ('client_reviewing', 'revision_requested', 'client_approved', 'delivered_published')
        ) versions
        where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
          and deliverable.archived_at is null and versions.items is not null), '[]'::jsonb),
      'requests', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'request_type', row.request_type, 'title', row.title, 'status', row.status,
        'priority', row.priority, 'required_by', row.required_by, 'resolution_summary', row.resolution
      )) order by row.updated_at desc nulls last, row.id) from public.requests row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null and row.visibility = 'client_visible'), '[]'::jsonb),
      'recent_activity', coalesce((select jsonb_agg(event.payload order by event.occurred_at desc, event.id desc)
        from (select row.id, row.occurred_at, jsonb_strip_nulls(jsonb_build_object(
          'action', row.action,
          'summary', initcap(replace(replace(row.action, '_', ' '), '.', ' ')), 'occurred_at', row.occurred_at
        )) payload from public.activity_events row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.visibility = 'client_visible'
        order by row.occurred_at desc, row.id desc limit 25) event), '[]'::jsonb),
      'recent_activity_is_complete', false
    ) into v_projection;
  else
    raise exception 'Projection kind must be internal or client.' using errcode = '22023';
  end if;
  if p_projection_kind = 'internal' then
    v_projection := v_projection || jsonb_build_object(
      'schema_version', 2,
      'supplemental', jsonb_build_object(
        'coverage', 'Recorded project services, pipeline, decisions, confirmed sourced preferences and recurring plan versions. Audience is not a separate project field.',
        'services', coalesce((select jsonb_agg(jsonb_build_object(
          'id',s.id,'service_id',s.service_id,'status',s.status,'scope_statement',s.scope_statement,
          'exclusions',s.exclusions,'quantity',s.quantity,'owner_id',s.owner_id,
          'start_date',s.start_date,'target_date',s.target_date,'revision',s.revision,'source',s.source)
          order by s.id) from public.project_service_scopes s
          where s.organization_id=p_organization_id and s.project_id=p_project_id),'[]'::jsonb),
        'engagements', coalesce((select jsonb_agg(jsonb_build_object(
          'id',e.id,'objective',e.objective,'status',e.status,
          'active_configuration',(select jsonb_build_object('id',c.id,'revision',c.revision,
            'definition_publication_id',c.definition_publication_id,'selected_steps',c.selected_steps,
            'selected_steps_sha256',c.selected_steps_sha256,'activated_at',a.activated_at)
            from public.project_pipeline_activations a join public.project_pipeline_configurations c
              on c.id=a.configuration_id and c.organization_id=a.organization_id and c.engagement_id=a.engagement_id
            where a.organization_id=p_organization_id and a.engagement_id=e.id and c.project_id=p_project_id and a.pipeline_group_id is null
            order by a.activation_number desc limit 1),
          'pipeline_groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'kind',g.kind,'name',g.name,'preset_publication_id',g.preset_publication_id,
            'active_configuration',(select jsonb_build_object('id',c.id,'group_revision',c.group_revision,'definition_publication_id',c.definition_publication_id,'selected_steps',c.selected_steps,'selected_steps_sha256',c.selected_steps_sha256,'group_activation_number',a.group_activation_number)
             from public.project_pipeline_activations a join public.project_pipeline_configurations c on c.id=a.configuration_id and c.organization_id=a.organization_id
             where a.pipeline_group_id=g.id and a.organization_id=g.organization_id order by a.group_activation_number desc limit 1)) order by g.kind,g.name,g.id)
             from public.project_pipeline_groups g where g.organization_id=p_organization_id and g.project_id=p_project_id and g.engagement_id=e.id),'[]'::jsonb)) order by e.id)
          from public.engagements e where e.organization_id=p_organization_id and e.project_id=p_project_id),'[]'::jsonb),
        'task_decisions', coalesce((select jsonb_agg(jsonb_build_object(
          'id',p.id,'task_id',p.task_id,'before_status',p.before_status,'proposed_status',p.proposed_status,
          'status',p.status,'source_comment_id',p.source_comment_id,'decided_at',p.decided_at) order by p.id)
          from public.project_task_change_proposals p where p.organization_id=p_organization_id
            and p.project_id=p_project_id and p.status in ('applied','pending','approved_failed')),'[]'::jsonb),
        'confirmed_preferences', coalesce((select jsonb_agg(jsonb_build_object(
          'id',m.id,'statement',m.statement,'source_comment_id',m.source_comment_id,
          'source_sha256',m.source_sha256,'reviewed_at',m.reviewed_at) order by m.id)
          from (select m.id,m.statement,m.source_comment_id,m.source_sha256,m.reviewed_at
            from public.ai_project_memory m join public.comments c on c.id=m.source_comment_id
              and c.organization_id=m.organization_id and c.project_id=m.project_id
              and c.entity_type='project' and c.entity_id=m.project_id and c.visibility='internal_only'
            where m.organization_id=p_organization_id and m.project_id=p_project_id and m.status='confirmed'
              and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=m.source_sha256
            order by m.reviewed_at desc,m.id desc limit 50) m),'[]'::jsonb),
        'recurring_plans', coalesce((select jsonb_agg(jsonb_build_object(
          'id',p.id,'status',p.status,'service_id',p.service_id,'approved_version_id',p.approved_version_id,
          'versions',coalesce((select jsonb_agg(jsonb_build_object(
            'id',v.id,'version_number',v.version_number,'title',v.title,'scope',v.scope,
            'frequency',v.frequency,'timezone',v.timezone,'effective_start',v.effective_start,'effective_end',v.effective_end,
            'approved',exists(select 1 from public.recurring_work_plan_version_approvals a
              where a.organization_id=p_organization_id and a.plan_id=p.id and a.plan_version_id=v.id),
            'items',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'template_key',t.template_key,
              'title',t.title,'department_id',t.department_id,'default_assignee_id',t.default_assignee_id,
              'start_offset_days',t.start_offset_days,'due_offset_days',t.due_offset_days)
              order by t.position,t.id) from public.recurring_work_plan_template_items t
              where t.organization_id=p_organization_id and t.plan_id=p.id and t.plan_version_id=v.id),'[]'::jsonb))
            order by v.version_number,v.id) from public.recurring_work_plan_versions v
            where v.organization_id=p_organization_id and v.plan_id=p.id),'[]'::jsonb)) order by p.id)
          from public.recurring_work_plans p where p.organization_id=p_organization_id and p.project_id=p_project_id),'[]'::jsonb)
      )
    );
  end if;
  return v_projection;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_project_pipeline_group_run(p_organization_id uuid, p_engagement_id uuid, p_request_id uuid, p_pipeline_group_id uuid, p_asset_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  engagement public.engagements;
  origin public.engagement_pipeline_origins;
  publication public.pipeline_template_publications;
  existing public.pipeline_run_intents;
  request_sha text;
  manifest jsonb;
  input_sha text;
  assets jsonb;
  services jsonb;
  new_id uuid; pipeline_group public.project_pipeline_groups; activation public.project_pipeline_activations; configuration public.project_pipeline_configurations; execution_definition public.pipeline_execution_definitions;
begin
  select * into engagement from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
  perform 1 from public.projects p where p.id=engagement.project_id and p.organization_id=p_organization_id and p.archived_at is null for share;
  if not found then raise exception 'Current active project required' using errcode='42501'; end if;
  perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id where o.id=p_organization_id and o.status='active' and m.user_id=actor and m.member_kind='team' and m.status='active' and m.role in ('system_owner','operations_admin') for share of o,m;
  if not found then raise exception 'Current owner or operations authority required' using errcode='42501'; end if;
  if actor is null or p_organization_id is null or p_engagement_id is null or p_request_id is null
    or not private.has_active_pipeline_template_role(p_organization_id, array['system_owner', 'operations_admin']) then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_asset_ids), 0) > 20 or array_position(p_asset_ids, null) is not null
    or (select count(distinct id) from unnest(p_asset_ids) id) <> coalesce(cardinality(p_asset_ids), 0) then
    raise exception 'Choose at most 20 unique assets.' using errcode = '22023';
  end if;
  request_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'engagement_id', p_engagement_id,'pipeline_group_id',p_pipeline_group_id, 'asset_ids', to_jsonb(p_asset_ids)
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_request_id::text, 0));
  select * into existing from public.pipeline_run_intents
    where organization_id = p_organization_id and request_id = p_request_id;
  if found then
    if existing.requested_by <> actor or existing.request_sha256 <> request_sha then
      raise exception 'Request id belongs to another run intent.' using errcode = '23505';
    end if;
    return jsonb_build_object('run_intent_id', existing.id, 'status', existing.status,
      'input_sha256', existing.input_sha256, 'idempotent_replay', true);
  end if;
  select * into engagement from public.engagements
    where id = p_engagement_id and organization_id = p_organization_id for share;
  if not found or engagement.status not in ('planning', 'active') then
    raise exception 'An active or planning engagement is required.' using errcode = '42501';
  end if;
  select * into pipeline_group from public.project_pipeline_groups where id=p_pipeline_group_id and organization_id=p_organization_id and engagement_id=p_engagement_id and project_id=engagement.project_id;
  if not found then raise exception 'Exact pipeline group required' using errcode='42501'; end if;
  select * into publication from public.pipeline_template_publications where id=pipeline_group.preset_publication_id and organization_id=p_organization_id;
  select * into activation from public.project_pipeline_activations where pipeline_group_id=pipeline_group.id and organization_id=p_organization_id order by group_activation_number desc limit 1;
  select * into configuration from public.project_pipeline_configurations where id=activation.configuration_id and pipeline_group_id=pipeline_group.id and organization_id=p_organization_id;
  select d.* into execution_definition from public.pipeline_execution_definitions d join public.pipeline_execution_publications p on p.definition_id=d.id and p.organization_id=d.organization_id where p.id=configuration.definition_publication_id and p.organization_id=p_organization_id;
  if publication.id is null or configuration.id is null or execution_definition.id is null or execution_definition.preset_publication_id<>publication.id then raise exception 'Exact current reviewed group configuration required' using errcode='42501'; end if;
  origin.pipeline_template_id:=publication.pipeline_template_id; origin.pipeline_template_version_id:=publication.pipeline_template_version_id;
  origin.final_selection_sha256:=configuration.selected_steps_sha256; origin.preview_rule_sha256:=publication.published_rule_sha256;
  perform 1 from public.engagement_assets asset join unnest(p_asset_ids) chosen(id) on chosen.id = asset.id where asset.engagement_id = p_engagement_id and asset.organization_id = p_organization_id for share of asset;
  perform 1 from public.engagement_services item where item.engagement_id = p_engagement_id and item.organization_id = p_organization_id for share;
  select coalesce(jsonb_agg(jsonb_build_object('id', asset.id, 'kind', asset.asset_kind,
    'name', asset.name, 'source_url', asset.source_url, 'notes', asset.notes,
    'created_at', asset.created_at) order by chosen.position), '[]'::jsonb)
    into assets
  from unnest(p_asset_ids) with ordinality chosen(id, position)
  join public.engagement_assets asset on asset.id = chosen.id
    and asset.engagement_id = p_engagement_id and asset.organization_id = p_organization_id;
  if jsonb_array_length(assets) <> coalesce(cardinality(p_asset_ids), 0) then
    raise exception 'An asset is unavailable in this engagement.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', item.id, 'service_id', item.service_id,
    'status', item.status, 'owner_id', item.owner_id) order by item.service_id), '[]'::jsonb)
    into services from public.engagement_services item
    where item.engagement_id = p_engagement_id and item.organization_id = p_organization_id
      and item.status in ('planned', 'active')
      and exists(select 1 from jsonb_array_elements(configuration.selected_steps) selected(value) join jsonb_array_elements(execution_definition.steps) step(value) on step.value->>'key'=selected.value->>'key' where (step.value->>'service_id')::uuid=item.service_id);
  if exists(select 1 from jsonb_array_elements(configuration.selected_steps) selected(value)
      join jsonb_array_elements(execution_definition.steps) step(value) on step.value->>'key'=selected.value->>'key'
      left join public.engagement_services es on es.organization_id=p_organization_id and es.engagement_id=engagement.id and es.service_id=(step.value->>'service_id')::uuid and es.status in ('planned','active')
      where es.id is null) then raise exception 'Every selected pipeline service must remain current' using errcode='42501'; end if;
  perform 1 from public.service_catalog sc join jsonb_array_elements(execution_definition.steps) step(value) on (step.value->>'service_id')::uuid=sc.id
    join jsonb_array_elements(configuration.selected_steps) selected(value) on selected.value->>'key'=step.value->>'key' where sc.is_active for share of sc;
  if exists(select 1 from jsonb_array_elements(configuration.selected_steps) selected(value) join jsonb_array_elements(execution_definition.steps) step(value) on step.value->>'key'=selected.value->>'key'
      left join public.service_catalog sc on sc.id=(step.value->>'service_id')::uuid and sc.is_active
      left join public.project_department_participation pd on pd.project_id=engagement.project_id and pd.organization_id=p_organization_id and pd.department_id=step.value->>'department_id' and pd.status='active'
      where sc.id is null or pd.project_id is null) then raise exception 'Selected service catalogue and project departments must remain current' using errcode='42501'; end if;
  perform 1 from public.project_department_participation pd join jsonb_array_elements(execution_definition.steps) step(value) on step.value->>'department_id'=pd.department_id
    join jsonb_array_elements(configuration.selected_steps) selected(value) on selected.value->>'key'=step.value->>'key' where pd.project_id=engagement.project_id and pd.organization_id=p_organization_id and pd.status='active' for share of pd;
  if jsonb_array_length(services) = 0 then
    raise exception 'No active or planned services remain.' using errcode = '22023';
  end if;
  manifest := jsonb_build_object(
    'engagement', jsonb_build_object('id', engagement.id, 'client_id', engagement.client_id,
      'brand_id', engagement.brand_id, 'name', engagement.name,
      'objective', engagement.objective, 'status', engagement.status),
    'pipeline', jsonb_build_object('version_id', origin.pipeline_template_version_id,
      'selection_sha256', origin.final_selection_sha256,
      'preview_rule_sha256', origin.preview_rule_sha256,
      'publication_id', publication.id, 'rule_sha256', publication.published_rule_sha256),
    'services', services, 'assets', assets,'pipeline_group_id',pipeline_group.id);
  if pg_catalog.octet_length(manifest::text) > 32768 then
    raise exception 'Pinned inputs exceed the 32 KiB limit.' using errcode = '22023';
  end if;
  input_sha := encode(extensions.digest(convert_to(manifest::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.pipeline_run_intents(organization_id, engagement_id, pipeline_template_id,
    pipeline_template_version_id, publication_id, request_id, request_sha256,
    input_manifest, input_sha256, requested_by,pipeline_group_id)
  values(p_organization_id, p_engagement_id, origin.pipeline_template_id,
    origin.pipeline_template_version_id, publication.id, p_request_id, request_sha,
    manifest, input_sha, actor,pipeline_group.id) returning id into new_id;
  return jsonb_build_object('run_intent_id', new_id, 'status', 'awaiting_review',
    'input_sha256', input_sha, 'idempotent_replay', false);
end;
$function$;

revoke all on function public.start_project_pipeline_group_run(uuid,uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.start_project_pipeline_group_run(uuid,uuid,uuid,uuid,uuid[]) to authenticated;
commit;
