\ir n6-step-budget-fixture.sql
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
$$;
create function private.is_active_pipeline_team_member(uuid)
returns boolean language sql as 'select true';
create function private.reject_pipeline_template_mutation()
returns trigger language plpgsql as $$ begin raise exception 'immutable'; end; $$;
create function private.n6_project_configuration_authorized(uuid,uuid,uuid)
returns boolean language sql as 'select true';
create function private.n1e_department_head(uuid,uuid,text,uuid)
returns boolean language sql as 'select false';
alter table public.project_pipeline_configurations add column selected_steps jsonb;
update public.project_pipeline_configurations
set selected_steps='[{"key":"draft","quantity":1},{"key":"review","quantity":1}]'::jsonb,
    selected_steps_sha256=encode(extensions.digest(convert_to(
      '[{"key":"draft","quantity":1},{"key":"review","quantity":1}]'::jsonb::text,
      'UTF8'),'sha256'),'hex');
update public.pipeline_run_intents intent set selected_steps_sha256=(
  select selected_steps_sha256 from public.project_pipeline_configurations limit 1);
create table public.ai_execution_job_steps(
  job_id uuid not null, organization_id uuid not null, work_item_id uuid,
  source_row_version bigint, department_id text
);
create table public.work_items(
  id uuid primary key, organization_id uuid, engagement_id uuid,
  deleted_at timestamptz, row_version bigint, status text, department_id text
);
alter table public.project_pipeline_activations add column activation_number integer default 1;
alter table public.pipeline_run_intents add column input_manifest jsonb;
alter table public.pipeline_run_intents add column input_sha256 text;
alter table public.pipeline_run_plans add column run_intent_id uuid;
alter table public.pipeline_run_plans add column work_manifest jsonb;
alter table public.pipeline_run_plans add column work_sha256 text;
alter table public.ai_execution_jobs add column run_plan_id uuid;
alter table public.ai_execution_jobs add column input_manifest jsonb;
alter table public.ai_execution_jobs add column input_sha256 text;
create table public.engagements(
 id uuid primary key, organization_id uuid not null, project_id uuid not null,
 status text not null
);
create table public.engagement_services(
 id uuid primary key, organization_id uuid not null, engagement_id uuid not null,
 status text not null
);
create table public.ai_execution_input_approvals(
 id uuid primary key, organization_id uuid not null, job_id uuid not null,
 job_input_sha256 text not null, work_sha256 text not null
);
alter table public.ai_execution_configured_steps add column step_key text;
alter table public.ai_execution_configured_steps
 add constraint ai_execution_configured_steps_id_job_org unique(id,job_id,organization_id);
insert into auth.users values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
insert into public.engagements values(
 '55555555-5555-4555-8555-555555555555',
 '11111111-1111-4111-8111-111111111111',
 'ffffffff-ffff-4fff-8fff-ffffffffffff','active');
update public.pipeline_run_intents
 set input_manifest='{"services":[]}'::jsonb,
     input_sha256=encode(extensions.digest(convert_to('{"services": []}'::jsonb::text,'UTF8'),'sha256'),'hex');
insert into public.pipeline_run_plans
select '12121212-1212-4212-8212-121212121212', organization_id,id,
 '[]'::jsonb,encode(extensions.digest(convert_to('[]','UTF8'),'sha256'),'hex')
from public.pipeline_run_intents where id='66666666-6666-4666-8666-666666666666';
insert into public.pipeline_run_plans
select '13131313-1313-4313-8313-131313131313', organization_id,id,
 '[]'::jsonb,encode(extensions.digest(convert_to('[]','UTF8'),'sha256'),'hex')
from public.pipeline_run_intents where id='77777777-7777-4777-8777-777777777777';
update public.ai_execution_jobs job
 set run_plan_id=plan.id,
     input_manifest=jsonb_build_object('input_sha256',intent.input_sha256,
       'work_sha256',plan.work_sha256,'project_activation_id',intent.project_activation_id,
       'selected_steps_sha256',intent.selected_steps_sha256),
     input_sha256=encode(extensions.digest(convert_to(jsonb_build_object(
       'input_sha256',intent.input_sha256,'work_sha256',plan.work_sha256,
       'project_activation_id',intent.project_activation_id,
       'selected_steps_sha256',intent.selected_steps_sha256)::text,
       'UTF8'),'sha256'),'hex')
from public.pipeline_run_intents intent
join public.pipeline_run_plans plan on plan.run_intent_id=intent.id
where job.run_intent_id=intent.id;
insert into public.ai_execution_input_approvals
select gen_random_uuid(),organization_id,id,input_sha256,
 (select work_sha256 from public.pipeline_run_plans where id=run_plan_id)
from public.ai_execution_jobs;
update public.ai_execution_configured_steps
set step_key=case when id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then 'draft'
                  when id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' then 'review'
                  else 'automatic' end,
 definition_step=case when id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                      then '{"kind":"human","department_id":"design","depends_on":[]}'::jsonb
                      when id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
                      then '{"kind":"approval_gate","department_id":"design","depends_on":["draft"]}'::jsonb
                      else '{"kind":"ai_assisted","department_id":"design","depends_on":[]}'::jsonb end;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);