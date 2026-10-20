begin;
set local lock_timeout='5s';
-- Read-only aggregate over retained media accounting. No table grants or historical rewrites.
create function private.read_design_media_spending(p_org uuid,p_actor uuid,p_month date) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare result jsonb; current_month date:=date_trunc('month',timezone('UTC',clock_timestamp()))::date; guard jsonb;
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and m.member_kind='team'
 and m.role in ('system_owner','operations_admin') and o.status='active' for share of m,o;
 if not found then raise exception 'Current organization administrator required' using errcode='42501';end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month>current_month or p_month<current_month-interval '24 months' then raise exception 'Choose a month in the last 24 months' using errcode='22023';end if;
 if exists(select 1 from private.ai_execution_budget_reservations r join private.design_media_generation_jobs j on j.id=r.design_media_job_id where r.organization_id=p_org and r.cycle_month=p_month and (j.organization_id<>p_org or j.actor_id<>r.actor_id)) then raise exception 'Accounting scope could not be verified' using errcode='55000';end if;
 select jsonb_build_object('mode',b.spend_guard_mode,'monthly_limit_microusd',case when b.spend_guard_mode='local_monthly_cap' then b.monthly_limit_microusd::text else null end,'external_provider_limit_verified',false) into guard from private.ai_execution_budget_limits b where b.organization_id=p_org;
 with media as (
 select r.actor_id,r.status,r.max_cost_microusd,r.actual_cost_microusd,
 j.request->>'provider' provider,j.request->>'model_id' model_id,
 case when j.request#>>'{context,kind}'='private' then 'private' when e.project_id is not null then e.project_id::text else 'unavailable' end project_key
 from private.ai_execution_budget_reservations r join private.design_media_generation_jobs j on j.id=r.design_media_job_id and j.organization_id=r.organization_id
 left join public.engagements e on j.request#>>'{context,kind}'='engagement' and e.id::text=j.request#>>'{context,id}' and e.organization_id=r.organization_id
 where r.organization_id=p_org and r.cycle_month=p_month
 ), grouped as (
 select case when grouping(actor_id)=0 then 'user' when grouping(project_key)=0 then 'project' when grouping(model_id)=0 then 'model' else 'total' end dimension,
 actor_id::text user_id,project_key,provider,model_id,count(*)::int request_count,
 coalesce(sum(max_cost_microusd) filter(where status='reserved'),0)::text reserved_microusd,
 coalesce(sum(max_cost_microusd) filter(where status='uncertain'),0)::text uncertain_microusd,
 coalesce(sum(actual_cost_microusd) filter(where status='settled'),0)::text reconciled_microusd,
 count(*) filter(where status='settled')::int reconciled_count,count(*) filter(where status='released')::int released_count
 from media group by grouping sets ((actor_id),(project_key),(provider,model_id),())
 ) select coalesce(jsonb_agg(to_jsonb(g) order by dimension,user_id,project_key,provider,model_id),'[]'::jsonb) into result from grouped g;
 if jsonb_array_length(result)>1501 then raise exception 'Spending breakdown exceeds the bounded view' using errcode='54000';end if;
 return jsonb_build_object('organization_id',p_org,'month',p_month,'currency','USD','scope','design_media_reservations','agent_attribution','not_recorded','guard',guard,'groups',result);
end;$$;
revoke all on function private.read_design_media_spending(uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function private.read_design_media_spending(uuid,uuid,date) to service_role;
create function public.get_design_media_spending(p_org uuid,p_actor uuid,p_month date) returns jsonb
language sql security invoker set search_path='' as $$select private.read_design_media_spending(p_org,p_actor,p_month)$$;
revoke all on function public.get_design_media_spending(uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.get_design_media_spending(uuid,uuid,date) to service_role;
commit;
