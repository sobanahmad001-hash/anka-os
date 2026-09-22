\ir n6-ai-outcome-fixture.sql
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
$$;
create function private.n1e_org_authority(uuid,uuid,uuid)
returns boolean language sql as 'select true';
create function private.n1e_department_head(uuid,uuid,text,uuid)
returns boolean language sql as 'select false';
create table public.engagements(
 id uuid primary key, organization_id uuid not null, project_id uuid not null,
 status text not null
);
insert into public.engagements values(
 '55555555-5555-4555-8555-555555555555',
 '11111111-1111-4111-8111-111111111111',
 'ffffffff-ffff-4fff-8fff-ffffffffffff','active');
alter table public.project_pipeline_activations add column activation_number integer default 1;
alter table public.ai_execution_step_progress add column state_version bigint default 1;
alter table public.ai_execution_step_progress add column started_by uuid;
alter table public.ai_execution_step_progress add column started_at timestamptz;
alter table public.ai_execution_step_progress add column completed_by uuid;
alter table public.ai_execution_step_progress add column completed_at timestamptz;
alter table public.ai_execution_step_progress add column updated_at timestamptz;
insert into auth.users values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');