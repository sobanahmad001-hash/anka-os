do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  actor uuid := '22222222-2222-4222-8222-222222222222';
  first_job uuid := '88888888-8888-4888-8888-888888888888';
  second_job uuid := '99999999-9999-4999-8999-999999999999';
  first_step uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  second_step uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  third_step uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  run_id uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  first_result jsonb;
  replay_result jsonb;
begin
  if has_function_privilege('service_role','public.reserve_pipeline_ai_budget(uuid,uuid,uuid,bigint)','EXECUTE') then
    raise exception 'Legacy reservation grant was not retired';
  end if;
  if has_function_privilege('service_role','private.n6_reserve_step_budget(uuid,uuid,uuid,uuid,bigint)','EXECUTE')
    or has_table_privilege('authenticated','private.ai_execution_step_budget_reservations','INSERT')
    or has_table_privilege('service_role','private.ai_execution_step_budget_reservations','SELECT') then
    raise exception 'Budget access grant leaked';
  end if;
  first_result := private.n6_reserve_step_budget(org,first_job,first_step,actor,60);
  replay_result := private.n6_reserve_step_budget(org,first_job,first_step,actor,60);
  if first_result ->> 'status' <> 'reserved'
    or first_result ->> 'reservation_id' <> replay_result ->> 'reservation_id'
    or replay_result ->> 'idempotent_replay' <> 'true' then
    raise exception 'Reservation replay failed';
  end if;
  begin
    perform private.n6_reserve_step_budget(org,first_job,third_step,actor,30);
    raise exception 'Local cap was not enforced';
  exception when sqlstate '22003' then null;
  end;
  begin
    perform private.n6_reserve_step_budget(org,second_job,second_step,actor,50);
    raise exception 'Organization cap was not enforced';
  exception when sqlstate '22003' then null;
  end;
  insert into public.ai_runs(id,organization_id,status,estimated_cost_microusd)
    values(run_id,org,'completed',40);
  perform private.n6_reconcile_step_budget(org,first_step,'settled',40,run_id,'verified local receipt');
  perform private.n6_reserve_step_budget(org,second_job,second_step,actor,50);
  begin
    perform private.n6_reserve_step_budget(org,first_job,third_step,actor,50);
    raise exception 'Local cap after settlement was not enforced';
  exception when sqlstate '22003' then null;
  end;
  perform private.n6_reconcile_step_budget(org,second_step,'released',null,null,'no provider submission');
  perform private.n6_reserve_step_budget(org,first_job,third_step,actor,30);
  perform private.n6_reconcile_step_budget(org,third_step,'uncertain',null,null,'outcome pending');
  if (private.n6_reconcile_step_budget(org,third_step,'uncertain',null,null,'outcome pending')
      ->> 'idempotent_replay') <> 'true' then
    raise exception 'Uncertain reconciliation replay failed';
  end if;
  perform private.n6_reconcile_step_budget(org,third_step,'released',null,null,'confirmed no charge');
  if (select count(*) from private.ai_execution_step_budget_reservations) <> 3
    or (select count(*) from private.ai_execution_step_budget_events) <> 7 then
    raise exception 'Budget ledger event count failed';
  end if;
end;
$$;
select 'isolated step budget behavior passed' as result;
