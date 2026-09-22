do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  actor uuid := '22222222-2222-4222-8222-222222222222';
  first_job uuid := '88888888-8888-4888-8888-888888888888';
  second_job uuid := '99999999-9999-4999-8999-999999999999';
  first_step uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  second_step uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  dependent_step uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  first_request uuid := '01010101-0101-4101-8101-010101010101';
  result jsonb;
begin
  if not has_function_privilege('service_role','public.prepare_pipeline_ai_step(uuid,uuid,uuid,uuid,uuid,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.prepare_pipeline_ai_step(uuid,uuid,uuid,uuid,uuid,bigint)','EXECUTE')
    or has_table_privilege('service_role','private.ai_execution_step_attempts','SELECT') then
    raise exception 'Attempt grant boundary failed';
  end if;
  result := public.prepare_pipeline_ai_step(org,first_job,first_step,actor,first_request,60);
  if result->>'status' <> 'prepared' or result->>'idempotent_replay' <> 'false' then
    raise exception 'Attempt preparation failed';
  end if;
  if (public.prepare_pipeline_ai_step(org,first_job,first_step,actor,first_request,60)
      ->>'idempotent_replay') <> 'true' then
    raise exception 'Attempt replay failed';
  end if;
  begin
    perform public.prepare_pipeline_ai_step(org,second_job,second_step,actor,
      '02020202-0202-4202-8202-020202020202',50);
    raise exception 'Shared organization cap bypassed';
  exception when sqlstate '22003' then null;
  end;
  begin
    perform public.prepare_pipeline_ai_step(org,first_job,dependent_step,actor,
      '03030303-0303-4303-8303-030303030303',20);
    raise exception 'Dependency bypassed';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform public.prepare_pipeline_ai_step(org,first_job,dependent_step,actor,first_request,20);
    raise exception 'Request collision accepted';
  exception when unique_violation then null;
  end;
  update public.ai_execution_step_progress set status='completed'
    where configured_step_id=first_step;
  perform public.prepare_pipeline_ai_step(org,first_job,dependent_step,actor,
    '04040404-0404-4404-8404-040404040404',20);
  if (select count(*) from private.ai_execution_step_attempts) <> 2
    or (select count(*) from private.ai_execution_step_budget_reservations) <> 2
    or (select count(*) from public.ai_runs) <> 0 then
    raise exception 'Attempt or reservation count failed';
  end if;
end;
$$;
select 'isolated N6 provider-free attempt handoff passed' as result;