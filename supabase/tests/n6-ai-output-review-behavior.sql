select set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  first_output uuid;
  dependent_output uuid;
  dependent_step uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  dependent_attempt uuid;
  new_run uuid := 'abababab-abab-4aba-8aba-abababababab';
  content jsonb;
begin
  if has_function_privilege('anon','public.review_pipeline_ai_step_output(uuid,uuid,uuid,bigint,text,text)','EXECUTE')
    or has_table_privilege('authenticated','public.ai_execution_step_output_reviews','INSERT') then
    raise exception 'Output review grant boundary failed';
  end if;
  select id into first_output from public.ai_execution_step_outputs
    where configured_step_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  update public.ai_runs set model='changed-after-settlement'
    where id=(select ai_run_id from public.ai_execution_step_outputs where id=first_output);
  begin
    perform public.get_pipeline_ai_step_output_for_review(org,first_output);
    raise exception 'Changed provider lineage was readable';
  exception when sqlstate '55000' then null;
  end;
  update public.ai_runs set model='verified-local-test'
    where id=(select ai_run_id from public.ai_execution_step_outputs where id=first_output);
  content := public.get_pipeline_ai_step_output_for_review(org,first_output);
  if content->>'content' <> 'draft text'
    or content->>'output_sha256' <> (select output_sha256 from public.ai_execution_step_outputs where id=first_output) then
    raise exception 'Exact output retrieval failed';
  end if;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  begin
    perform public.review_pipeline_ai_step_output(org,first_output,
      '11111111-1111-4111-8111-111111111111',1,'accepted','self review');
    raise exception 'Requester self-review was accepted';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
  update public.ai_execution_step_progress set status='waiting'
    where configured_step_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  perform public.review_pipeline_ai_step_output(org,first_output,
    '12121212-1212-4212-8212-121212121212',1,'accepted','reviewed exact draft');
  if (public.review_pipeline_ai_step_output(org,first_output,
    '12121212-1212-4212-8212-121212121212',1,'accepted','reviewed exact draft')
    ->>'idempotent_replay') <> 'true' then
    raise exception 'Output review replay failed';
  end if;
  if (select status from public.ai_execution_step_progress
      where configured_step_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'completed'
    or (select count(*) from public.ai_execution_step_output_reviews) <> 1 then
    raise exception 'Accepted output did not complete the step';
  end if;
  select id into dependent_attempt from private.ai_execution_step_attempts
    where configured_step_id=dependent_step;
  insert into public.ai_runs(id,organization_id,status,estimated_cost_microusd,
    user_id,engagement_id,output_text,provider,model,context_manifest)
  values(new_run,org,'completed',10,'22222222-2222-4222-8222-222222222222',
    '55555555-5555-4555-8555-555555555555','needs revision','openai',
    'verified-local-test',jsonb_build_object('attempt_id',dependent_attempt,
      'job_id','88888888-8888-4888-8888-888888888888',
      'configured_step_id',dependent_step,'job_input_sha256',repeat('a',64),
      'connector_connection_id','44444444-4444-4444-8444-444444444444'));
  perform public.reconcile_pipeline_ai_step_attempt(org,dependent_attempt,'settled',10,new_run,
    'measured provider receipt 3');
  select id into dependent_output from public.ai_execution_step_outputs
    where configured_step_id=dependent_step;
  perform public.review_pipeline_ai_step_output(org,dependent_output,
    '13131313-1313-4313-8313-131313131313',1,'rejected','revision needed');
  if (select status from public.ai_execution_step_progress
      where configured_step_id=dependent_step) <> 'paused'
    or (select count(*) from public.ai_execution_step_output_reviews) <> 2 then
    raise exception 'Rejected output did not pause the step';
  end if;
end;
$$;
select 'isolated N6 output review passed' as result;