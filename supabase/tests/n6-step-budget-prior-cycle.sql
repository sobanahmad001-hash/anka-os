update private.ai_execution_step_budget_reservations
  set cycle_month = date_trunc('month', current_date - interval '1 month')::date;
do $$
begin
  begin
    perform private.n6_reserve_step_budget(
      '11111111-1111-4111-8111-111111111111',
      '99999999-9999-4999-8999-999999999999',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '22222222-2222-4222-8222-222222222222',10);
    raise exception 'Prior-cycle unresolved reservation did not block';
  exception when sqlstate '55000' then null;
  end;
end;
$$;
select 'prior-cycle unresolved hold passed' as result;
