create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
$$;
alter table public.ai_execution_configured_steps add column ordinal smallint;
update public.ai_execution_configured_steps set ordinal=case
  when id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then 1
  when id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' then 2
  else 1 end;
alter table public.ai_execution_step_outputs add column id uuid;
alter table public.ai_execution_step_outputs add column organization_id uuid;
create table public.ai_execution_step_output_reviews(
  output_id uuid, organization_id uuid, decision text
);
