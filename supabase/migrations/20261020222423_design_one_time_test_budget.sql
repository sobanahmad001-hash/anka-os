begin;
set local lock_timeout='5s';
-- One lifetime allowance per enrolled organization. No API can enroll, activate,
-- reset, top up, refund or alter its evidence. Activation is a separate review.
create table private.design_media_test_budgets (
 organization_id uuid primary key references public.organizations(id),
 purpose text not null default 'design-model-test-once-v1' check(purpose='design-model-test-once-v1'),
 limit_microusd bigint not null default 10000000 check(limit_microusd=10000000),
 consumed_microusd bigint not null default 0 check(consumed_microusd between 0 and 10000000),
 state text not null default 'blocked' check(state in ('blocked','verified')),
 evidence_reference text,
 verified_at timestamptz,
 verified_until timestamptz,
 configurations jsonb not null default '[]'::jsonb check(jsonb_typeof(configurations)='array'),
 created_at timestamptz not null default clock_timestamp(),
 check(state='blocked' or (evidence_reference is not null and length(btrim(evidence_reference))>0 and verified_at is not null and verified_until is not null and verified_until>verified_at and jsonb_array_length(configurations)>0))
);
create table private.design_media_test_debits (
 reservation_id uuid primary key references private.ai_execution_budget_reservations(id),
 organization_id uuid not null references private.design_media_test_budgets(organization_id),
 job_id uuid not null unique references private.design_media_generation_jobs(id),
 actor_id uuid not null,
 amount_microusd bigint not null check(amount_microusd between 1 and 10000000),
 created_at timestamptz not null default clock_timestamp()
);
alter table private.design_media_test_budgets enable row level security;
alter table private.design_media_test_debits enable row level security;
revoke all on private.design_media_test_budgets,private.design_media_test_debits from public,anon,authenticated,service_role;

create function private.preserve_design_media_test_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'UPDATE' then raise exception 'One-time test accounting cannot be removed' using errcode='42501';end if;
 if tg_table_name='design_media_test_debits' then raise exception 'Test debit is immutable' using errcode='42501';end if;
 if new.organization_id<>old.organization_id or new.purpose<>old.purpose or new.limit_microusd<>old.limit_microusd or new.created_at<>old.created_at or new.consumed_microusd<old.consumed_microusd then
  raise exception 'One-time test allowance cannot be reset or increased' using errcode='42501';
 end if;
 return new;
end;$$;
revoke all on function private.preserve_design_media_test_budget() from public,anon,authenticated,service_role;
create trigger design_media_test_budget_preserve before update or delete on private.design_media_test_budgets for each row execute function private.preserve_design_media_test_budget();
create trigger design_media_test_debit_preserve before update or delete on private.design_media_test_debits for each row execute function private.preserve_design_media_test_budget();
create trigger design_media_test_budget_no_truncate before truncate on private.design_media_test_budgets for each statement execute function private.preserve_design_media_test_budget();
create trigger design_media_test_debit_no_truncate before truncate on private.design_media_test_debits for each statement execute function private.preserve_design_media_test_budget();

create function private.reserve_design_media_test_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
declare budget private.design_media_test_budgets;job private.design_media_generation_jobs;
begin
 -- Pipeline/chat reservations are outside this explicitly scoped media test.
 if new.design_media_job_id is null and new.design_video_job_id is null then return new;end if;
 select * into budget from private.design_media_test_budgets where organization_id=new.organization_id for update;
 if not found then return new;end if;
 if budget.state<>'verified' or budget.verified_at>clock_timestamp() or budget.verified_until<=clock_timestamp() then
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
 if not exists(select 1 from jsonb_array_elements(budget.configurations) c where c->>'provider'=job.request->>'provider' and c->>'model_id'=job.request->>'model_id'
  and c->'settings'=job.request->'settings' and c->'output_count'=job.request->'output_count'
  and jsonb_typeof(c->'max_charge_microusd')='number' and (c->>'max_charge_microusd')::numeric>=new.max_cost_microusd) then
  raise exception 'Exact test configuration lacks a verified charge bound' using errcode='42501';
 end if;
 -- Counter update and debit share the original claim transaction. No calendar,
 -- settlement, failure, cancellation or unknown outcome releases this allowance.
 if new.max_cost_microusd>budget.limit_microusd-budget.consumed_microusd then
  raise exception 'Shared one-time USD10 test budget exhausted' using errcode='22003';
 end if;
 update private.design_media_test_budgets set consumed_microusd=consumed_microusd+new.max_cost_microusd where organization_id=new.organization_id;
 insert into private.design_media_test_debits(reservation_id,organization_id,job_id,actor_id,amount_microusd)
 values(new.id,new.organization_id,job.id,new.actor_id,new.max_cost_microusd);
 return new;
end;$$;
revoke all on function private.reserve_design_media_test_budget() from public,anon,authenticated,service_role;
create trigger design_media_test_budget_reserve after insert on private.ai_execution_budget_reservations for each row execute function private.reserve_design_media_test_budget();

-- Only the user-designated organization is enrolled, and it remains BLOCKED.
-- Existing receipts, jobs, rates, organization budget mode and choices unchanged.
insert into private.design_media_test_budgets(organization_id)
 select id from public.organizations where id='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25';
commit;
