-- Readiness is advisory. Existing atomic quote/claim guards remain authoritative.
create or replace function public.read_design_media_readiness(p_org uuid,p_actor uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare b private.design_media_test_budgets; limits private.ai_execution_budget_limits;
 cycle date:=date_trunc('month',timezone('UTC',clock_timestamp()))::date;
 remaining numeric:=9007199254740991;used numeric;unknowns bigint; row record;count_value integer;req jsonb;prepared jsonb;
 budget_constrained boolean:=false;configs jsonb:='[]'::jsonb; reason text;expiry timestamptz;basis text;
begin
 -- Reuse exact actor/context/connection/source/version checks; never trust caller org.
 perform public.prepare_design_media_request(p_org,p_actor,p_request);
 select * into limits from private.ai_execution_budget_limits where organization_id=p_org;
 if not found then return jsonb_build_object('configurations',configs,'reason','spend_setup');end if;
 if exists(select 1 from private.ai_execution_budget_reservations where organization_id=p_org and cycle_month<>cycle and status in ('reserved','uncertain')) or exists(select 1 from private.ai_execution_step_budget_reservations where organization_id=p_org and cycle_month<>cycle and status in ('reserved','uncertain')) then return jsonb_build_object('configurations',configs,'reason','reconciliation');end if;
 select count(*) filter(where run.estimated_cost_microusd is null),coalesce(sum(run.estimated_cost_microusd),0) into unknowns,used from public.ai_runs run where run.organization_id=p_org and run.created_at>=timezone('UTC',cycle::timestamp) and run.created_at<timezone('UTC',cycle::timestamp+interval '1 month') and run.status='completed' and not exists(select 1 from private.ai_execution_budget_reservations x where x.ai_run_id=run.id) and not exists(select 1 from private.ai_execution_step_budget_reservations x where x.ai_run_id=run.id);
 if unknowns>0 then return jsonb_build_object('configurations',configs,'reason','reconciliation');end if;
 if limits.spend_guard_mode='local_monthly_cap' then
  select used+coalesce(sum(case when status='settled' then actual_cost_microusd else max_cost_microusd end),0) into used from private.ai_execution_budget_reservations where organization_id=p_org and cycle_month=cycle and status in ('reserved','uncertain','settled');
  select used+coalesce(sum(case when status='settled' then actual_cost_microusd else max_cost_microusd end),0) into used from private.ai_execution_step_budget_reservations where organization_id=p_org and cycle_month=cycle and status in ('reserved','uncertain','settled');
  remaining:=least(remaining,limits.monthly_limit_microusd-used);
 end if;
 select * into b from private.design_media_test_budgets where organization_id=p_org;
 if found then
  if p_request->>'provider'<>'higgsfield' then return jsonb_build_object('configurations',configs,'reason','test_lineup');end if;
  basis:=b.state;expiry:=case when b.state='estimated' then b.estimated_valid_until else b.verified_until end;
  if b.state not in ('estimated','verified') or expiry is null or expiry<=clock_timestamp() or (b.state='estimated' and (b.estimated_risk_accepted_at is null or b.estimated_risk_accepted_at>clock_timestamp())) or (b.state='verified' and (b.verified_at is null or b.verified_at>clock_timestamp())) then return jsonb_build_object('configurations',configs,'reason','test_mode');end if;
  remaining:=least(remaining,b.limit_microusd-b.consumed_microusd-b.overage_microusd);
 end if;
 if remaining<=0 then return jsonb_build_object('configurations',configs,'reason','allowance');end if;
 -- Latest exact configuration wins, even when expired. Never revive an older rate.
 for row in select distinct on(settings) settings,price_basis,unit_max_charge_microusd,verified_at,valid_until from private.design_media_rates where organization_id=p_org and provider=p_request->>'provider' and model_id=p_request->>'model_id' order by settings,created_at desc,id desc loop
  if row.verified_at>clock_timestamp() or row.valid_until<=clock_timestamp() or row.valid_until-row.verified_at>(case when row.price_basis='estimated' then interval '7 days' else interval '24 hours' end) or (basis is not null and row.price_basis<>basis) or (basis is null and row.price_basis='estimated') then continue;end if;
  foreach count_value in array array[1,2,3,4,5,6,7,8,9,10] loop
   if row.unit_max_charge_microusd*count_value>remaining then if count_value=1 then budget_constrained:=true;end if;continue;end if;
   if basis='verified' and not exists(select 1 from jsonb_array_elements(b.configurations)c where c->>'provider'=p_request->>'provider' and c->>'model_id'=p_request->>'model_id' and c->'settings'=row.settings and c->'output_count'=to_jsonb(count_value) and jsonb_typeof(c->'max_charge_microusd')='number' and (c->>'max_charge_microusd')::numeric>=row.unit_max_charge_microusd*count_value) then continue;end if;
   req:=p_request||jsonb_build_object('settings',row.settings,'output_count',count_value);
   begin prepared:=public.prepare_design_media_request(p_org,p_actor,req);exception when invalid_parameter_value or insufficient_privilege or serialization_failure then continue;end;
   configs:=configs||jsonb_build_array(jsonb_build_object('request',prepared->'request','price_basis',row.price_basis,'total_microusd',row.unit_max_charge_microusd*count_value,'valid_until',least(row.valid_until,coalesce(expiry,row.valid_until))));
   if jsonb_array_length(configs)>200 then raise exception 'Readiness configuration limit exceeded';end if;
  end loop;
 end loop;
 return jsonb_build_object('configurations',configs,'reason',case when configs='[]'::jsonb then case when budget_constrained then 'allowance' else 'pricing' end else null end);
end;$fn$;
revoke all on function public.read_design_media_readiness(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_design_media_readiness(uuid,uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
