create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role;
create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key, status text not null);
create table public.organization_memberships(
  organization_id uuid not null, user_id uuid not null, member_kind text not null,
  status text not null, role text not null
);
create table public.ai_runs(
  id uuid primary key, organization_id uuid not null, created_at timestamptz default now(),
  status text not null, estimated_cost_microusd bigint
);
create table public.pipeline_run_plans(id uuid primary key, organization_id uuid not null);
create table public.pipeline_run_intents(
  id uuid primary key, organization_id uuid not null, engagement_id uuid not null,
  project_activation_id uuid, selected_steps_sha256 text
);
create table public.project_pipeline_activations(
  id uuid primary key, organization_id uuid not null, engagement_id uuid not null,
  configuration_id uuid not null
);
create table public.project_pipeline_configurations(
  id uuid primary key, organization_id uuid not null, engagement_id uuid not null,
  selected_steps_sha256 text not null, max_ai_cost_microusd bigint not null
);
create table public.ai_execution_jobs(
  id uuid primary key, organization_id uuid not null, run_intent_id uuid not null,
  requested_by uuid not null, status text not null
);
create table public.ai_execution_configured_steps(
  id uuid primary key, organization_id uuid not null, job_id uuid not null,
  project_activation_id uuid not null, definition_step jsonb not null
);
create table private.ai_execution_budget_limits(
  organization_id uuid primary key, monthly_limit_microusd bigint not null
);
create table private.ai_execution_budget_reservations(
  id uuid primary key, organization_id uuid not null, cycle_month date not null,
  max_cost_microusd bigint not null, actual_cost_microusd bigint,
  status text not null, ai_run_id uuid
);
create function public.reserve_pipeline_ai_budget(uuid, uuid, uuid, bigint)
returns jsonb language sql as 'select null::jsonb';
revoke all on function public.reserve_pipeline_ai_budget(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_pipeline_ai_budget(uuid, uuid, uuid, bigint) to service_role;
create function public.preflight_pipeline_ai_job(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid
) returns jsonb language sql as $$
  select jsonb_build_object('configuration_ready', true,
    'project_activation_id', intent.project_activation_id)
  from public.ai_execution_jobs job
  join public.pipeline_run_intents intent on intent.id = job.run_intent_id
  where job.id = p_job_id and job.organization_id = p_organization_id
    and job.requested_by = p_actor_id;
$$;
insert into auth.users values ('22222222-2222-4222-8222-222222222222');
insert into public.organizations values ('11111111-1111-4111-8111-111111111111','active');
insert into public.organization_memberships values (
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 'team','active','system_owner'
);
insert into public.project_pipeline_configurations values (
 '44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',
 '55555555-5555-4555-8555-555555555555',repeat('a',64),80
);
insert into public.project_pipeline_activations values (
 '33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
 '55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444'
);
insert into public.pipeline_run_intents values
 ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333',repeat('a',64)),
 ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333',repeat('a',64));
insert into public.ai_execution_jobs values
 ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','blocked_configuration'),
 ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111',
  '77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222','blocked_configuration');
insert into public.ai_execution_configured_steps values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
  '88888888-8888-4888-8888-888888888888','33333333-3333-4333-8333-333333333333','{"kind":"ai_assisted"}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
  '99999999-9999-4999-8999-999999999999','33333333-3333-4333-8333-333333333333','{"kind":"automatic"}'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111',
  '88888888-8888-4888-8888-888888888888','33333333-3333-4333-8333-333333333333','{"kind":"ai_assisted"}');
insert into private.ai_execution_budget_limits values ('11111111-1111-4111-8111-111111111111',100);
