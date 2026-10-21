begin;
set local lock_timeout='5s';
-- Legacy amount/timestamp column names are retained for compatibility. price_basis
-- distinguishes reviewed reference estimates from verified maximum billing bounds.
alter table private.design_media_rates add column price_basis text not null default 'verified' check(price_basis in ('verified','estimated'));
alter table private.design_media_quotes add column price_basis text not null default 'verified' check(price_basis in ('verified','estimated'));
alter table private.design_media_test_budgets drop constraint design_media_test_budgets_state_check, drop constraint design_media_test_budgets_check;
alter table private.design_media_test_budgets add column estimated_risk_accepted_by uuid references auth.users(id), add column estimated_risk_accepted_at timestamptz, add column estimated_valid_until timestamptz,
 add column overage_microusd bigint not null default 0 check(overage_microusd>=0),
 add constraint design_media_test_budgets_state_check check(state in ('blocked','verified','estimated')),
 add constraint design_media_test_budgets_check check(state='blocked' or
 (state='verified' and evidence_reference is not null and length(btrim(evidence_reference))>0 and verified_at is not null and verified_until is not null and verified_until>verified_at and jsonb_array_length(configurations)>0) or
 (state='estimated' and estimated_risk_accepted_by is not null and estimated_risk_accepted_at is not null and estimated_valid_until is not null and estimated_valid_until>estimated_risk_accepted_at and estimated_valid_until<=estimated_risk_accepted_at+interval '24 hours'));
create or replace function public.configure_design_media_reference_rate(p_org uuid,p_actor uuid,p_provider text,p_model text,p_settings jsonb,p_unit_max bigint,p_source text,p_reviewed_at timestamptz,p_valid_until timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.design_media_rates;
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and o.status='active'
 and m.member_kind='team' and m.role in ('system_owner','operations_admin') for share of m,o;
 if not found then raise exception 'Administrator pricing authority required.' using errcode='42501';end if;
 if p_provider<>'higgsfield' then raise exception 'Estimated test mode supports the approved Higgsfield lineup only' using errcode='22023';end if;
 if p_reviewed_at>clock_timestamp() or p_valid_until<=clock_timestamp() or jsonb_typeof(p_settings)<>'object'
 or p_provider not in ('openai','higgsfield') or nullif(btrim(p_model),'') is null then raise exception 'Current reviewed reference estimate required.' using errcode='22023';end if;
 -- Serialize exact rate publication with quote and acceptance snapshots.
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('design_media_rate',p_org,p_provider,p_model,p_settings)::text,0));
 if p_reviewed_at>clock_timestamp() or p_valid_until<=clock_timestamp() then raise exception 'Reviewed rate expired while waiting.' using errcode='40001';end if;
 if (p_provider='higgsfield' and p_source not like 'https://open.higgsfield.ai/%') or (p_provider='openai' and p_source not like 'https://developers.openai.com/%' and p_source not like 'https://openai.com/%') then raise exception 'Official source for selected provider required.' using errcode='22023';end if;
 insert into private.design_media_rates(organization_id,provider,model_id,settings,unit_max_charge_microusd,source_url,verified_at,valid_until,created_by,price_basis)
 values(p_org,p_provider,p_model,p_settings,p_unit_max,p_source,p_reviewed_at,p_valid_until,p_actor,'estimated') returning * into r;
 return to_jsonb(r);
end;$$;
revoke all on function public.configure_design_media_reference_rate(uuid,uuid,text,text,jsonb,bigint,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.configure_design_media_reference_rate(uuid,uuid,text,text,jsonb,bigint,text,timestamptz,timestamptz) to service_role;
create or replace function public.quote_design_media_request(p_org uuid,p_actor uuid,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.design_media_rates;q private.design_media_quotes;b public.design_creative_briefs;v public.design_creative_brief_versions;n integer;kind text;
begin
 perform private.require_design_media_request_context(p_org,p_actor,p_request);
 n:=(p_request->>'output_count')::integer;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('design_media_rate',p_org,p_request->>'provider',p_request->>'model_id',p_request->'settings')::text,0));
 select * into r from private.design_media_rates where organization_id=p_org and provider=p_request->>'provider' and model_id=p_request->>'model_id' and settings=p_request->'settings' order by created_at desc,id desc limit 1;
 if not found or r.verified_at>clock_timestamp() or r.valid_until<=clock_timestamp() then raise exception 'Fresh reviewed exact price unavailable.' using errcode='55000';end if;
 insert into private.design_media_quotes(organization_id,actor_id,rate_id,request,request_checksum,unit_max_charge_microusd,total_max_charge_microusd,verified_at,valid_until,price_basis)
 values(p_org,p_actor,r.id,p_request,encode(sha256(convert_to(p_request::text,'UTF8')),'hex'),r.unit_max_charge_microusd,r.unit_max_charge_microusd*n,r.verified_at,r.valid_until,r.price_basis) returning * into q;
 return to_jsonb(q)||jsonb_build_object('reviewed_at',q.verified_at,'verified_at',case when q.price_basis='verified' then q.verified_at else null end);
end;$$;
create or replace function public.accept_design_media_quote(p_org uuid,p_actor uuid,p_quote uuid,p_operation uuid,p_request jsonb,p_acceptance jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q private.design_media_quotes;r private.design_media_rates;a private.design_media_acceptances;
begin
 if p_operation is null then raise exception 'Stable operation identity required.' using errcode='22023';end if;
 perform private.require_design_media_request_context(p_org,p_actor,p_request);
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_actor::text||':'||p_operation::text,0));
 select * into q from private.design_media_quotes where id=p_quote and organization_id=p_org and actor_id=p_actor for share;
 if not found or q.request is distinct from p_request or q.valid_until<=clock_timestamp() or q.verified_at>clock_timestamp() then raise exception 'Fresh exact actor-owned quote required.' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('design_media_rate',p_org,p_request->>'provider',p_request->>'model_id',p_request->'settings')::text,0));
 select * into r from private.design_media_rates where organization_id=p_org and provider=p_request->>'provider' and model_id=p_request->>'model_id' and settings=p_request->'settings' order by created_at desc,id desc limit 1;
 if r.price_basis is distinct from q.price_basis or r.id is distinct from q.rate_id or r.valid_until<=clock_timestamp() or q.total_max_charge_microusd<>r.unit_max_charge_microusd*(p_request->>'output_count')::integer then raise exception 'Price changed; review a fresh quote.' using errcode='40001';end if;
 if q.price_basis='estimated' and p_acceptance->>'accept_estimated_price_risk' is distinct from 'true' then raise exception 'Explicit estimated-price risk acceptance required' using errcode='42501';end if;
 if p_acceptance->>'generate' is distinct from 'true' or p_acceptance->>'quote_id' is distinct from q.id::text
 or p_acceptance->>'request_checksum' is distinct from q.request_checksum
 or p_acceptance->>'total_max_charge_microusd' is distinct from q.total_max_charge_microusd::text
 or (q.total_max_charge_microusd>2000000 and p_acceptance->>'confirm_above_threshold' is distinct from 'true') then
 raise exception 'Explicit pre-charge acceptance of the exact total required.' using errcode='42501';end if;
 select * into a from private.design_media_acceptances where organization_id=p_org and actor_id=p_actor and operation_key=p_operation;
 if found then
  if a.quote_id<>q.id or a.request_checksum<>q.request_checksum or a.total_max_charge_microusd<>q.total_max_charge_microusd then raise exception 'Operation already belongs to another media request.' using errcode='23505';end if;
  return to_jsonb(a)||jsonb_build_object('idempotent_replay',true);
 end if;
 insert into private.design_media_acceptances(organization_id,actor_id,operation_key,quote_id,request_checksum,total_max_charge_microusd,confirmed_above_threshold)
 values(p_org,p_actor,p_operation,q.id,q.request_checksum,q.total_max_charge_microusd,q.total_max_charge_microusd>2000000) returning * into a;
 return to_jsonb(a)||jsonb_build_object('idempotent_replay',false);
end;$$;
create or replace function private.preserve_design_media_test_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'UPDATE' then raise exception 'One-time test accounting cannot be removed' using errcode='42501';end if;
 if tg_table_name='design_media_test_debits' then raise exception 'Test debit is immutable' using errcode='42501';end if;
 if new.organization_id<>old.organization_id or new.purpose<>old.purpose or new.limit_microusd<>old.limit_microusd or new.created_at<>old.created_at or new.consumed_microusd<old.consumed_microusd or new.overage_microusd<old.overage_microusd then
  raise exception 'One-time test allowance cannot be reset or increased' using errcode='42501';
 end if;
 return new;
end;$$;
create or replace function private.reserve_design_media_test_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
declare budget private.design_media_test_budgets;job private.design_media_generation_jobs;q private.design_media_quotes;
begin
 -- Pipeline/chat reservations are outside this explicitly scoped media test.
 if new.design_media_job_id is null and new.design_video_job_id is null then return new;end if;
 select * into budget from private.design_media_test_budgets where organization_id=new.organization_id for update;
 if not found then
  if new.design_media_job_id is not null and exists(select 1 from private.design_media_generation_jobs j join private.design_media_quotes estimate_quote on estimate_quote.id=j.quote_id and estimate_quote.organization_id=j.organization_id where j.id=new.design_media_job_id and j.organization_id=new.organization_id and estimate_quote.price_basis='estimated') then
   raise exception 'Estimated mode requires the shared test enrollment' using errcode='42501';
  end if;
  return new;
 end if;
 if budget.state='blocked' or (budget.state='verified' and (budget.verified_at>clock_timestamp() or budget.verified_until<=clock_timestamp())) or (budget.state='estimated' and (budget.estimated_risk_accepted_at>clock_timestamp() or budget.estimated_valid_until<=clock_timestamp())) then
  raise exception 'Test activation blocked until maximum billing evidence is verified' using errcode='42501';
 end if;
 if new.design_media_job_id is null then raise exception 'Use the verified unified test route' using errcode='42501';end if;
 select * into job from private.design_media_generation_jobs where id=new.design_media_job_id and organization_id=new.organization_id;
 if not found or job.actor_id<>new.actor_id or job.status<>'claimed' or new.status<>'reserved' or new.max_cost_microusd is null or new.max_cost_microusd<=0 then
  raise exception 'Exact original test reservation required' using errcode='42501';
 end if;
 if job.request->>'provider' is distinct from 'higgsfield' or job.request->>'model_id' not in (
  'ideogram/v4.0','higgsfield-ai/soul/v2/standard','higgsfield-ai/soul/v2/image-to-image','recraft/v4.1/text-to-image','xai/grok-imagine-image-2.0',
  'bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video','kling-video/v3.0/std/text-to-video','kling-video/v3.0/std/image-to-video',
  'alibaba/wan-3.0/text-to-video','alibaba/wan-3.0/image-to-video','lightricks/ltx-2.5/image-to-video/fast','minimax/h3/text-to-video') then
  raise exception 'Model is outside the approved test lineup' using errcode='42501';
 end if;
 select * into q from private.design_media_quotes where id=job.quote_id and organization_id=new.organization_id;
 if not found or q.price_basis is distinct from budget.state or q.total_max_charge_microusd is distinct from new.max_cost_microusd then raise exception 'Quote basis must match the active test mode' using errcode='42501';end if;
 if budget.state='verified' and not exists(select 1 from jsonb_array_elements(budget.configurations) c where c->>'provider'=job.request->>'provider' and c->>'model_id'=job.request->>'model_id'
  and c->'settings'=job.request->'settings' and c->'output_count'=job.request->'output_count'
  and jsonb_typeof(c->'max_charge_microusd')='number' and (c->>'max_charge_microusd')::numeric>=new.max_cost_microusd) then
  raise exception 'Exact test configuration lacks a verified charge bound' using errcode='42501';
 end if;
 -- Counter update and debit share the original claim transaction. No calendar,
 -- settlement, failure, cancellation or unknown outcome releases this allowance.
 if new.max_cost_microusd>budget.limit_microusd-budget.consumed_microusd-budget.overage_microusd then
  raise exception 'Shared one-time USD10 test budget exhausted' using errcode='22003';
 end if;
 update private.design_media_test_budgets set consumed_microusd=consumed_microusd+new.max_cost_microusd where organization_id=new.organization_id;
 insert into private.design_media_test_debits(reservation_id,organization_id,job_id,actor_id,amount_microusd)
 values(new.id,new.organization_id,job.id,new.actor_id,new.max_cost_microusd);
 return new;
end;$$;

-- No new table grants. The service-only entry point checks current same-org
-- administrators and can only select estimated/blocked; it cannot verify prices.
create function public.set_design_estimated_test_mode(p_org uuid,p_actor uuid,p_enabled boolean,p_accept_risk boolean,p_until timestamptz) returns jsonb
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
 if p_enabled and (p_accept_risk is distinct from true or p_until is null or p_until<=clock_timestamp() or p_until>clock_timestamp()+interval '24 hours') then raise exception 'Explicit risk acceptance and expiry within 24 hours required' using errcode='22023';end if;
 update private.design_media_test_budgets set state=case when p_enabled then 'estimated' else 'blocked' end,
 estimated_risk_accepted_by=case when p_enabled then p_actor else estimated_risk_accepted_by end,
 estimated_risk_accepted_at=case when p_enabled then clock_timestamp() else estimated_risk_accepted_at end,
 estimated_valid_until=case when p_enabled then p_until else estimated_valid_until end where organization_id=p_org returning * into b;
 return jsonb_build_object('organization_id',p_org,'state',b.state,'valid_until',b.estimated_valid_until,'limit_microusd',b.limit_microusd,'consumed_microusd',b.consumed_microusd,'overage_microusd',b.overage_microusd);
end;$$;
revoke all on function public.set_design_estimated_test_mode(uuid,uuid,boolean,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.set_design_estimated_test_mode(uuid,uuid,boolean,boolean,timestamptz) to service_role;
create or replace function public.reconcile_design_media_budget(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid,
  p_claim_id uuid, p_actual_cost_microusd bigint, p_evidence text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  budget private.ai_execution_budget_limits;
  job private.design_media_generation_jobs;
  reservation private.ai_execution_budget_reservations;
  q private.design_media_quotes;test_budget private.design_media_test_budgets;
  evidence text:=btrim(coalesce(p_evidence,''));
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null
    or p_claim_id is null or p_actual_cost_microusd is null
    or p_actual_cost_microusd<0 or length(evidence) not between 1 and 1000 then
    raise exception 'Verified media billing evidence is required' using errcode='22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id=p_organization_id for update;
  if not found then raise exception 'Organization budget is unavailable' using errcode='42501'; end if;
  select * into job from private.design_media_generation_jobs
    where id=p_job_id and organization_id=p_organization_id for update;
  if not found or job.actor_id<>p_actor_id
    or job.claim_id<>p_claim_id
    or job.status not in ('provider_completed','ready','provider_failed',
      'safety_refused','outcome_unknown') then
    raise exception 'Terminal claimed media evidence is required' using errcode='42501';
  end if;
  select * into reservation from private.ai_execution_budget_reservations
    where design_media_job_id=p_job_id and organization_id=p_organization_id for update;
  if not found or reservation.actor_id<>p_actor_id then
    raise exception 'Cost exceeds the exact media reservation' using errcode='22003';
  end if;
  select * into q from private.design_media_quotes where id=job.quote_id and organization_id=p_organization_id;
  if q.price_basis is distinct from 'estimated' and p_actual_cost_microusd>reservation.max_cost_microusd then raise exception 'Cost exceeds verified reservation' using errcode='22003';end if;
  if reservation.status='settled' then
    if reservation.actual_cost_microusd<>p_actual_cost_microusd
      or reservation.outcome_evidence<>evidence then
      raise exception 'Conflicting media cost reconciliation' using errcode='23505';
    end if;
    return jsonb_build_object('status','settled','idempotent_replay',true);
  end if;
  if reservation.status not in ('reserved','uncertain') then
    raise exception 'Media cost is not reconcilable' using errcode='55000';
  end if;
  if q.price_basis='estimated' then
    select * into test_budget from private.design_media_test_budgets where organization_id=p_organization_id for update;
    if not found or not exists(select 1 from private.design_media_test_debits where reservation_id=reservation.id and organization_id=p_organization_id and job_id=p_job_id) then raise exception 'Original estimated test debit required' using errcode='42501';end if;
    update private.design_media_test_budgets set overage_microusd=overage_microusd+greatest(p_actual_cost_microusd-reservation.max_cost_microusd,0) where organization_id=p_organization_id;
  end if;
  update private.ai_execution_budget_reservations
    set status='settled',actual_cost_microusd=p_actual_cost_microusd,
      outcome_evidence=evidence,reconciled_at=clock_timestamp()
    where id=reservation.id;
  insert into private.ai_execution_budget_events(
    reservation_id,organization_id,transition,actual_cost_microusd,evidence)
    values(reservation.id,p_organization_id,'settled',p_actual_cost_microusd,evidence);
  return jsonb_build_object('status','settled',
    'actual_cost_microusd',p_actual_cost_microusd,'idempotent_replay',false);
end;
$$;

create function public.read_design_test_budget(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and o.status='active' and m.member_kind='team' and m.role in ('system_owner','operations_admin') for share of m,o;
 if not found then raise exception 'Current organization administrator required' using errcode='42501';end if;
 return (select jsonb_build_object('organization_id',organization_id,'state',state,'valid_until',estimated_valid_until,'limit_microusd',limit_microusd,'consumed_microusd',consumed_microusd,'overage_microusd',overage_microusd) from private.design_media_test_budgets where organization_id=p_org);
end;$$;
revoke all on function public.read_design_test_budget(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_design_test_budget(uuid,uuid) to service_role;
commit;
