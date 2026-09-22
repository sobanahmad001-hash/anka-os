insert into auth.users values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.organization_memberships values (
  '11111111-1111-4111-8111-111111111111',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd','team','active','operations_admin'
);
do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  requester uuid := '22222222-2222-4222-8222-222222222222';
  reviewer uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  step uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  attempt uuid;
  unknown_attempt uuid;
  result jsonb;
begin
  if not has_function_privilege('authenticated',
      'public.release_pipeline_ai_confirmed_refusal(uuid,uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon',
      'public.release_pipeline_ai_confirmed_refusal(uuid,uuid,uuid,text)','EXECUTE')
    or has_table_privilege('authenticated',
      'private.ai_execution_confirmed_release_reviews','SELECT') then
    raise exception 'Confirmed release grant boundary failed';
  end if;
  result := public.prepare_pipeline_ai_step(org,
    '99999999-9999-4999-8999-999999999999',step,requester,
    '11111111-2222-4333-8444-555555555555',50);
  attempt := (result->>'attempt_id')::uuid;
  perform public.claim_pipeline_ai_step_dispatch(org,attempt,
    '22222222-3333-4444-8555-666666666666',repeat('e',64));
  perform public.record_pipeline_ai_retryable_rejection(
    org,attempt,1,429,'rate_limit_error','req-release-1');
  perform public.claim_pipeline_ai_fallback(org,attempt,2,
    '33333333-4444-4555-8666-777777777777',repeat('e',64));
  perform public.record_pipeline_ai_retryable_rejection(
    org,attempt,2,503,'server_is_overloaded','req-release-2');
  perform public.claim_pipeline_ai_fallback(org,attempt,3,
    '44444444-5555-4666-8777-888888888888',repeat('e',64));
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  begin
    perform public.release_pipeline_ai_confirmed_refusal(org,attempt,
      '55555555-6666-4777-8888-999999999999','all routes refused');
    raise exception 'Unproven third route released budget';
  exception when sqlstate '55000' then null;
  end;
  select id into unknown_attempt from private.ai_execution_step_attempts
    where configured_step_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  begin
    perform public.release_pipeline_ai_confirmed_refusal(org,unknown_attempt,
      '66666666-7777-4888-8999-aaaaaaaaaaaa','unknown third route');
    raise exception 'Unknown dependent route released budget';
  exception when sqlstate '55000' then null;
  end;
  perform public.record_pipeline_ai_retryable_rejection(
    org,attempt,3,429,'rate_limit_error','req-release-3');
  perform set_config('request.jwt.claim.sub',requester::text,true);
  begin
    perform public.release_pipeline_ai_confirmed_refusal(org,attempt,
      '55555555-6666-4777-8888-999999999999','all routes refused');
    raise exception 'Requester approved own release';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  result := public.release_pipeline_ai_confirmed_refusal(org,attempt,
    '55555555-6666-4777-8888-999999999999','all routes refused');
  if result->>'status' <> 'released'
    or result->>'idempotent_replay' <> 'false' then
    raise exception 'Confirmed second-owner release failed: %',result;
  end if;
  result := public.release_pipeline_ai_confirmed_refusal(org,attempt,
    '55555555-6666-4777-8888-999999999999','all routes refused');
  if result->>'idempotent_replay' <> 'true' then
    raise exception 'Confirmed release replay failed';
  end if;
  begin
    perform public.release_pipeline_ai_confirmed_refusal(org,attempt,
      '55555555-6666-4777-8888-999999999999','changed evidence');
    raise exception 'Changed release replay accepted';
  exception when unique_violation then null;
  end;
  if (select count(*) from private.ai_execution_confirmed_release_reviews) <> 1
    or (select status from private.ai_execution_step_budget_reservations
        where configured_step_id=step) <> 'released'
    or (select count(*) from public.ai_runs) <> 0 then
    raise exception 'Release audit, budget or provider-free fixture failed';
  end if;
end;
$$;
select 'isolated N6 second-owner confirmed release passed' as result;
