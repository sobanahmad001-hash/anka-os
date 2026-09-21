do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  first_run uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  second_run uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
begin
  begin
    insert into private.ai_execution_budget_reservations(
      id,organization_id,cycle_month,max_cost_microusd,actual_cost_microusd,status,ai_run_id)
    values(gen_random_uuid(),org,current_date,1,1,'settled',first_run);
    raise exception 'Legacy ledger accepted an already settled step AI run';
  exception when unique_violation then null;
  end;
  insert into public.ai_runs(id,organization_id,status,estimated_cost_microusd)
    values(second_run,org,'completed',1);
  insert into private.ai_execution_budget_reservations(
    id,organization_id,cycle_month,max_cost_microusd,actual_cost_microusd,status,ai_run_id)
  values(gen_random_uuid(),org,current_date,1,1,'settled',second_run);
  begin
    update private.ai_execution_step_budget_reservations
      set ai_run_id=second_run where configured_step_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'Step ledger accepted an already settled legacy AI run';
  exception when unique_violation then null;
  end;
end;
$$;
select 'cross-ledger AI run uniqueness passed' as result;
