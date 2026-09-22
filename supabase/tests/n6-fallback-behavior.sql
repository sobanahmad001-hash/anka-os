do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  attempt uuid;
  result jsonb;
  claim_id uuid;
begin
  if not has_function_privilege('service_role',
      'public.claim_pipeline_ai_fallback(uuid,uuid,integer,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.claim_pipeline_ai_fallback(uuid,uuid,integer,uuid,text)','EXECUTE')
    or has_table_privilege('service_role','private.ai_execution_fallback_claims','SELECT')
    or has_table_privilege('authenticated','private.ai_execution_route_rejections','SELECT') then
    raise exception 'Fallback grant boundary failed';
  end if;
  select id into attempt from private.ai_execution_step_attempts
    where configured_step_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  select id into claim_id from private.ai_execution_dispatch_claims
    where attempt_id=attempt;
  if claim_id is null then raise exception 'Initial dispatch claim is missing'; end if;
  begin
    perform private.n6_reconcile_step_budget(org,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'released',null,null,'no-charge assertion without third-route proof');
    raise exception 'Unknown third-route outcome released budget';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform public.record_pipeline_ai_retryable_rejection(org,attempt,1,401,'rate_limit_error','');
    raise exception 'Permission refusal allowed as retryable';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.claim_pipeline_ai_fallback(org,attempt,2,
      '08080808-0808-4808-8808-080808080808',repeat('b',64));
    raise exception 'Backup claimed before confirmed rejection';
  exception when sqlstate '55000' then null;
  end;
  result := public.record_pipeline_ai_retryable_rejection(
    org,attempt,1,429,'rate_limit_error','req-rate-1');
  if result->>'idempotent_replay' <> 'false' then raise exception 'Initial rejection missing'; end if;
  result := public.claim_pipeline_ai_fallback(org,attempt,2,
    '08080808-0808-4808-8808-080808080808',repeat('b',64));
  if result->>'status' <> 'claimed' or result->>'must_not_submit' <> 'false'
    or result->'route'->>'model_id' <> 'backup-local-test' then
    raise exception 'Ordered backup claim failed: %', result;
  end if;
  result := public.claim_pipeline_ai_fallback(org,attempt,2,
    '08080808-0808-4808-8808-080808080808',repeat('b',64));
  if result->>'must_not_submit' <> 'true' then
    raise exception 'Backup replay allowed another provider submission';
  end if;
  begin
    perform public.claim_pipeline_ai_fallback(org,attempt,3,
      '09090909-0909-4909-8909-090909090909',repeat('b',64));
    raise exception 'Third route skipped a confirmed backup rejection';
  exception when sqlstate '55000' then null;
  end;
  perform public.record_pipeline_ai_retryable_rejection(
    org,attempt,2,503,'server_is_overloaded','req-overload-2');
  result := public.claim_pipeline_ai_fallback(org,attempt,3,
    '09090909-0909-4909-8909-090909090909',repeat('b',64));
  if result->>'status' <> 'claimed'
    or result->'route'->>'model_id' <> 'third-local-test' then
    raise exception 'Third route claim failed';
  end if;
  perform private.n6_reconcile_step_budget(org,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'uncertain',null,null,'provider result unknown');
  begin
    perform private.n6_reconcile_step_budget(org,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'released',null,null,'no-charge assertion without third-route proof');
    raise exception 'Unknown third-route outcome released budget';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform public.record_pipeline_ai_retryable_rejection(
      org,attempt,3,429,'rate_limit_error','req-late-3');
    raise exception 'Unknown outcome allowed later fallback';
  exception when sqlstate '55000' then null;
  end;
  if (select count(*) from private.ai_execution_fallback_claims) <> 2
    or (select count(*) from private.ai_execution_route_rejections) <> 2
    or (select count(*) from public.ai_runs) <> 0 then
    raise exception 'Fallback event count or provider-free fixture failed';
  end if;
end;
$$;
select 'isolated N6 ordered fallback passed' as result;
