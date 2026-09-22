\ir n6-step-budget-fixture.sql
create function private.reject_pipeline_template_mutation()
returns trigger language plpgsql as $$ begin raise exception 'immutable'; end; $$;
alter table public.ai_execution_jobs add column input_sha256 text;
update public.ai_execution_jobs set input_sha256=repeat('a',64);
create table public.ai_execution_step_progress(
 configured_step_id uuid primary key, organization_id uuid not null,
 job_id uuid not null, status text not null
);
insert into public.ai_execution_step_progress
select id, organization_id, job_id, 'waiting'
from public.ai_execution_configured_steps;
alter table public.ai_execution_configured_steps add column step_key text;
update public.ai_execution_configured_steps
set definition_step=case
  when id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    then '{"kind":"ai_assisted","department_id":"design","depends_on":["draft"]}'::jsonb
  else '{"kind":"ai_assisted","department_id":"design","depends_on":[]}'::jsonb end,
 step_key=case when id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then 'draft'
               when id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' then 'review'
               else 'other' end;
create function public.get_pipeline_ai_text_routes(uuid,uuid,text,uuid)
returns jsonb language sql as $$
 select '[{"priority":1,"provider":"openai","connection_id":"44444444-4444-4444-8444-444444444444","model_id":"verified-local-test"}]'::jsonb;
$$;