do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  attempt uuid;
  result jsonb;
begin
  select id into attempt from private.ai_execution_step_attempts
    where configured_step_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if not exists (select 1 from private.ai_execution_dispatch_claims
      where attempt_id=attempt) then
    raise exception 'Two-session first-route claim is missing';
  end if;
  perform public.record_pipeline_ai_retryable_rejection(
    org,attempt,1,429,'slow_down','req-rate-race');
  result := private.n6_reconcile_step_budget(
    org,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'released',null,null,'confirmed OpenAI 429 before fallback');
  if result->>'status' <> 'released' then
    raise exception 'Confirmed no-charge release failed';
  end if;
  begin
    perform public.claim_pipeline_ai_fallback(org,attempt,2,
      '10101010-1010-4010-8010-101010101010',repeat('d',64));
    raise exception 'Released attempt permitted backup dispatch';
  exception when sqlstate '55000' then null;
  end;
end;
$$;
select 'isolated N6 confirmed-refusal release passed' as result;
