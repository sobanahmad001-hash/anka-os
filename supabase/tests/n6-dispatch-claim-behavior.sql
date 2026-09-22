do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  attempt uuid;
  result jsonb;
  dispatch uuid := '05050505-0505-4505-8505-050505050505';
  digest text := repeat('b',64);
begin
  if not has_function_privilege('service_role',
       'public.claim_pipeline_ai_step_dispatch(uuid,uuid,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated',
       'public.claim_pipeline_ai_step_dispatch(uuid,uuid,uuid,text)','EXECUTE')
    or has_table_privilege('service_role','private.ai_execution_dispatch_claims','SELECT')
    or has_table_privilege('authenticated','private.ai_execution_dispatch_claims','SELECT') then
    raise exception 'Dispatch claim access boundary failed';
  end if;
  select id into attempt from private.ai_execution_step_attempts
    where configured_step_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  result := public.claim_pipeline_ai_step_dispatch(org,attempt,dispatch,digest);
  if result->>'status' <> 'claimed' or result->>'must_not_submit' <> 'false'
    or result->'route'->>'model_id' <> 'verified-local-test' then
    raise exception 'Initial dispatch claim failed: %', result;
  end if;
  result := public.claim_pipeline_ai_step_dispatch(org,attempt,dispatch,digest);
  if result->>'status' <> 'already_claimed' or result->>'must_not_submit' <> 'true' then
    raise exception 'Replay allowed duplicate provider dispatch';
  end if;
  begin
    perform public.claim_pipeline_ai_step_dispatch(org,attempt,
      '06060606-0606-4606-8606-060606060606',digest);
    raise exception 'Second dispatch identity accepted';
  exception when unique_violation then null;
  end;
  begin
    update private.ai_execution_dispatch_claims set prompt_sha256=repeat('c',64);
    raise exception 'Dispatch claim was mutable';
  exception when others then
    if sqlerrm = 'Dispatch claim was mutable' then raise; end if;
  end;
  begin
    perform private.n6_reconcile_step_budget(org,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'released',null,null,'caller says no charge');
    raise exception 'Claimed reservation was released';
  exception when sqlstate '55000' then null;
  end;
  if (select count(*) from private.ai_execution_dispatch_claims) <> 1
    or (select count(*) from public.ai_runs) <> 0 then
    raise exception 'Dispatch claim count/provider-free boundary failed';
  end if;
end;
$$;
select 'isolated N6 single-use dispatch claim passed' as result;
