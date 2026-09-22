do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  actor uuid := '22222222-2222-4222-8222-222222222222';
  engagement uuid := '55555555-5555-4555-8555-555555555555';
  first_job uuid := '88888888-8888-4888-8888-888888888888';
  second_job uuid := '99999999-9999-4999-8999-999999999999';
  first_step uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  second_step uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  dependent_step uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  first_run uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  wrong_run uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  first_attempt uuid;
  second_attempt uuid;
  dependent_attempt uuid;
begin
  if not has_function_privilege('service_role','public.reconcile_pipeline_ai_step_attempt(uuid,uuid,text,bigint,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.reconcile_pipeline_ai_step_attempt(uuid,uuid,text,bigint,uuid,text)','EXECUTE')
    or has_table_privilege('authenticated','public.ai_execution_step_outputs','INSERT') then
    raise exception 'Outcome grant boundary failed';
  end if;
  first_attempt := (public.prepare_pipeline_ai_step(org,first_job,first_step,actor,
    '01010101-0101-4101-8101-010101010101',60)->>'attempt_id')::uuid;
  perform public.reconcile_pipeline_ai_step_attempt(org,first_attempt,'uncertain',null,null,
    'provider outcome unconfirmed');
  if (public.reconcile_pipeline_ai_step_attempt(org,first_attempt,'uncertain',null,null,
    'provider outcome unconfirmed')->>'idempotent_replay') <> 'true' then
    raise exception 'Uncertain replay failed';
  end if;
  insert into public.ai_runs(id,organization_id,status,estimated_cost_microusd,
    user_id,engagement_id,output_text,provider,model,context_manifest)
  values(first_run,org,'completed',40,actor,engagement,'draft text','openai',
    'verified-local-test',jsonb_build_object(
      'attempt_id',first_attempt,'job_id',first_job,
      'configured_step_id',first_step,'job_input_sha256',repeat('a',64),
      'connector_connection_id','44444444-4444-4444-8444-444444444444'));
  perform public.reconcile_pipeline_ai_step_attempt(org,first_attempt,'settled',40,first_run,
    'measured provider receipt 1');
  if (public.reconcile_pipeline_ai_step_attempt(org,first_attempt,'settled',40,first_run,
    'measured provider receipt 1')->>'idempotent_replay') <> 'true' then
    raise exception 'Settlement replay failed';
  end if;
  if (select count(*) from public.ai_execution_step_outputs) <> 1
    or (select review_status from public.ai_execution_step_outputs where ai_run_id=first_run) <> 'pending'
    or (select actual_cost_microusd from private.ai_execution_step_budget_reservations where configured_step_id=first_step) <> 40 then
    raise exception 'Output lineage or measured settlement failed';
  end if;
  second_attempt := (public.prepare_pipeline_ai_step(org,second_job,second_step,actor,
    '02020202-0202-4202-8202-020202020202',50)->>'attempt_id')::uuid;
  perform public.reconcile_pipeline_ai_step_attempt(org,second_attempt,'released',null,null,
    'confirmed no provider submission');
  update public.ai_execution_step_progress set status='completed'
    where configured_step_id=first_step;
  dependent_attempt := (public.prepare_pipeline_ai_step(org,first_job,dependent_step,actor,
    '03030303-0303-4303-8303-030303030303',20)->>'attempt_id')::uuid;
  insert into public.ai_runs(id,organization_id,status,estimated_cost_microusd,
    user_id,engagement_id,output_text,provider,model,context_manifest)
  values(wrong_run,org,'completed',10,actor,engagement,'wrong model text','openai',
    'unapproved-test-model',jsonb_build_object(
      'attempt_id',dependent_attempt,'job_id',first_job,
      'configured_step_id',dependent_step,'job_input_sha256',repeat('a',64),
      'connector_connection_id','44444444-4444-4444-8444-444444444444'));
  begin
    perform public.reconcile_pipeline_ai_step_attempt(org,dependent_attempt,'settled',10,wrong_run,
      'measured provider receipt 2');
    raise exception 'Unapproved model was settled';
  exception when sqlstate '42501' then null;
  end;
  if (select status from private.ai_execution_step_budget_reservations
      where configured_step_id=dependent_step) <> 'reserved' then
    raise exception 'Rejected output changed reservation';
  end if;
end;
$$;
select 'isolated N6 outcome and output lineage passed' as result;