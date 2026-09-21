-- Pin only future run requests to the current immutable project activation.
-- Historical intents and jobs remain unchanged and blocked.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.project_pipeline_activations
  add constraint project_pipeline_activations_id_organization
  unique (id, organization_id);

alter table public.pipeline_run_intents
  add column project_activation_id uuid,
  add column selected_steps_sha256 text,
  add constraint pipeline_run_intents_activation_pair
    check ((project_activation_id is null) = (selected_steps_sha256 is null)),
  add constraint pipeline_run_intents_steps_hash
    check (selected_steps_sha256 is null or selected_steps_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint pipeline_run_intents_project_activation_fk
    foreign key (project_activation_id, organization_id)
    references public.project_pipeline_activations(id, organization_id)
    on delete restrict;

create index pipeline_run_intents_project_activation
  on public.pipeline_run_intents(organization_id, project_activation_id)
  where project_activation_id is not null;

create function private.n6_pin_current_project_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
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
    order by activation.activation_number desc
    limit 1;
  if pinned_activation is not null then
    new.project_activation_id := pinned_activation;
    new.selected_steps_sha256 := pinned_sha;
  end if;
  return new;
end;
$$;
revoke all on function private.n6_pin_current_project_activation()
  from public, anon, authenticated, service_role;
create trigger n6_pin_current_project_activation
  before insert on public.pipeline_run_intents
  for each row execute function private.n6_pin_current_project_activation();

create or replace function private.n6_blocked_execution_manifest(
  p_intent public.pipeline_run_intents, p_plan public.pipeline_run_plans
) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'source_kind', 'pipeline_run',
    'organization_id', p_plan.organization_id,
    'run_intent_id', p_intent.id,
    'run_plan_id', p_plan.id,
    'preset_version_id', p_intent.pipeline_template_version_id,
    'project_activation_id', p_intent.project_activation_id,
    'selected_steps_sha256', p_intent.selected_steps_sha256,
    'input_sha256', p_intent.input_sha256,
    'work_sha256', p_plan.work_sha256
  );
$$;
revoke all on function private.n6_blocked_execution_manifest(public.pipeline_run_intents, public.pipeline_run_plans)
  from public, anon, authenticated, service_role;

comment on column public.pipeline_run_intents.project_activation_id is
  'Server-pinned current project activation at request time. Null marks a historical or unconfigured request; it cannot enter future provider dispatch.';
commit;
