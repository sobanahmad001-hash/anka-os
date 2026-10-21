begin;
set local lock_timeout='5s';
-- Explicit reference-risk testing may last up to seven days. Verified billing
-- bounds retain their 24-hour freshness limit. No rates, enrollment or counters
-- are modified here, and no permissions or dispatch rules are broadened.
alter table private.design_media_rates drop constraint design_media_rates_check;
alter table private.design_media_rates add constraint design_media_rates_check
 check(valid_until>verified_at and valid_until<=verified_at+
 case when price_basis='estimated' then interval '7 days' else interval '24 hours' end);
alter table private.design_media_test_budgets drop constraint design_media_test_budgets_check;
alter table private.design_media_test_budgets add constraint design_media_test_budgets_check check(state='blocked' or
 (state='verified' and evidence_reference is not null and length(btrim(evidence_reference))>0 and verified_at is not null and verified_until is not null and verified_until>verified_at and jsonb_array_length(configurations)>0) or
 (state='estimated' and estimated_risk_accepted_by is not null and estimated_risk_accepted_at is not null and estimated_valid_until is not null and estimated_valid_until>estimated_risk_accepted_at and estimated_valid_until<=estimated_risk_accepted_at+interval '7 days'));
create or replace function public.set_design_estimated_test_mode(p_org uuid,p_actor uuid,p_enabled boolean,p_accept_risk boolean,p_until timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.design_media_test_budgets;
begin
 perform 1 from public.organizations where id=p_org and status='active' for update;
 if not found then raise exception 'Active organization required' using errcode='42501';end if;
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=p_actor and status='active' and member_kind='team' and role in ('system_owner','operations_admin') for share;
 if not found then raise exception 'Current organization administrator required' using errcode='42501';end if;
 select * into b from private.design_media_test_budgets where organization_id=p_org for update;
 if not found or b.state='verified' then raise exception 'Existing non-verified test enrollment required' using errcode='42501';end if;
 if p_enabled is null then raise exception 'Explicit mode required' using errcode='22023';end if;
 if p_enabled and (p_accept_risk is distinct from true or p_until is null or p_until<=clock_timestamp() or p_until>clock_timestamp()+interval '7 days') then raise exception 'Explicit risk acceptance and expiry within 7 days required' using errcode='22023';end if;
 update private.design_media_test_budgets set state=case when p_enabled then 'estimated' else 'blocked' end,
 estimated_risk_accepted_by=case when p_enabled then p_actor else estimated_risk_accepted_by end,
 estimated_risk_accepted_at=case when p_enabled then clock_timestamp() else estimated_risk_accepted_at end,
 estimated_valid_until=case when p_enabled then p_until else estimated_valid_until end where organization_id=p_org returning * into b;
 return jsonb_build_object('organization_id',p_org,'state',b.state,'valid_until',b.estimated_valid_until,'limit_microusd',b.limit_microusd,'consumed_microusd',b.consumed_microusd,'overage_microusd',b.overage_microusd);
end;$$;
commit;
