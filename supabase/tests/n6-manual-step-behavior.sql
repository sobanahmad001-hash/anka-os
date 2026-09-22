select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  job uuid := '88888888-8888-4888-8888-888888888888';
  draft uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  gate uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  result jsonb;
begin
  if (select count(*) from public.ai_execution_step_progress) <> 3 then
    raise exception 'Existing steps were not initialized';
  end if;
  begin
    perform public.advance_pipeline_manual_step(org,job,gate,
      '01010101-0101-4101-8101-010101010101',1,'approve','reviewed');
    raise exception 'Dependency bypassed';
  exception when sqlstate '55000' then null;
  end;
  result := public.advance_pipeline_manual_step(org,job,draft,
    '02020202-0202-4202-8202-020202020202',1,'start','');
  if result->>'status' <> 'in_progress' then raise exception 'Start failed'; end if;
  if (public.advance_pipeline_manual_step(org,job,draft,
    '02020202-0202-4202-8202-020202020202',1,'start','')
    ->>'idempotent_replay') <> 'true' then raise exception 'Replay failed'; end if;
  perform public.advance_pipeline_manual_step(org,job,draft,
    '03030303-0303-4303-8303-030303030303',2,'pause','waiting for input');
  perform public.advance_pipeline_manual_step(org,job,draft,
    '04040404-0404-4404-8404-040404040404',3,'resume','input ready');
  perform public.advance_pipeline_manual_step(org,job,draft,
    '05050505-0505-4505-8505-050505050505',4,'complete','human output recorded');
  begin
    perform public.advance_pipeline_manual_step(org,job,gate,
      '06060606-0606-4606-8606-060606060606',1,'approve','approved');
    raise exception 'Requester self-approved';
  exception when sqlstate '55000' then null;
  end;
  perform set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
  perform public.advance_pipeline_manual_step(org,job,gate,
    '07070707-0707-4707-8707-070707070707',1,'approve','independent review');
  if (select count(*) from public.ai_execution_step_action_events) <> 5
    or (select status from public.ai_execution_step_progress where configured_step_id=gate) <> 'completed' then
    raise exception 'Manual event history or gate failed';
  end if;
  begin
    perform public.advance_pipeline_manual_step(org,
      '99999999-9999-4999-8999-999999999999',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '08080808-0808-4808-8808-080808080808',1,'start','');
    raise exception 'AI step was started manually';
  exception when sqlstate '42501' then null;
  end;
end;
$$;
select 'isolated N6 manual transitions passed' as result;