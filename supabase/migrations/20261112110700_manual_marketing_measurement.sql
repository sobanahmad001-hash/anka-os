begin;
set local lock_timeout='5s';
create table public.marketing_measurement_plans (
 id uuid primary key, project_id uuid not null references public.projects,
 card_id uuid not null unique references public.marketing_delivery_cards,
 question text not null check(length(btrim(question)) between 1 and 2000),
 metric text not null check(length(btrim(metric)) between 1 and 180),
 unit text not null check(length(btrim(unit)) between 1 and 60),baseline numeric,target numeric,
 starts_on date not null, ends_on date not null check(ends_on>=starts_on),
 source_note text not null check(length(btrim(source_note)) between 1 and 1000),
 recorded_by uuid not null references auth.users, recorded_at timestamptz not null default now()
);
create table public.marketing_measurement_results (
 id uuid primary key,plan_id uuid not null references public.marketing_measurement_plans,
 observed_on date not null, actual numeric, source_note text not null check(length(btrim(source_note)) between 1 and 1500),
 conclusion text not null check(length(btrim(conclusion)) between 1 and 2000),
 decision text not null check(decision in ('continue','revise','stop','monitor','inconclusive')),
 next_action text not null check(length(btrim(next_action)) between 1 and 1000),next_work_id uuid references public.work_items,
 recorded_by uuid not null references auth.users,recorded_at timestamptz not null default now(),unique(plan_id,observed_on)
);
create table public.marketing_period_reviews (
 id uuid primary key, period_id uuid not null unique references public.marketing_service_periods,
 results jsonb not null,summary text not null check(length(btrim(summary)) between 1 and 2000),
 next_action text not null check(length(btrim(next_action)) between 1 and 1000),next_work_id uuid references public.work_items,
 recorded_by uuid not null references auth.users,recorded_at timestamptz not null default now()
);
alter table public.marketing_measurement_plans add check (abs(baseline)<1e30 and abs(target)<1e30);
alter table public.marketing_measurement_results add check (abs(actual)<1e30);
create index marketing_measurement_plans_project on public.marketing_measurement_plans(project_id);
alter table public.marketing_measurement_plans enable row level security;
alter table public.marketing_measurement_results enable row level security;
alter table public.marketing_period_reviews enable row level security;
revoke all on public.marketing_measurement_plans,public.marketing_measurement_results,public.marketing_period_reviews from public,anon,authenticated;
grant select on public.marketing_measurement_plans,public.marketing_measurement_results,public.marketing_period_reviews to authenticated;
create policy measurement_plan_work_read on public.marketing_measurement_plans for select to authenticated using
 (exists(select 1 from public.marketing_delivery_cards c where c.id=card_id and c.project_id=marketing_measurement_plans.project_id));
create policy measurement_result_work_read on public.marketing_measurement_results for select to authenticated using
 (exists(select 1 from public.marketing_measurement_plans p where p.id=plan_id));
create policy marketing_period_review_read on public.marketing_period_reviews for select to authenticated using
 (exists(select 1 from public.marketing_service_periods p where p.id=period_id));

create function public.record_marketing_measurement(p_org uuid,p_project uuid,p_service uuid,p_id uuid,p_details jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();s public.engagement_services;c public.marketing_delivery_cards;
 period public.marketing_service_periods;plan public.marketing_measurement_plans;
 op text:=p_details->>'operation';next_work uuid:=(p_details->>'next_work')::uuid;observation date:=(p_details->>'observed_on')::date;
 quantities jsonb;
begin
 s:=private.marketing_delivery_service(p_org,p_project,p_service,actor);
 if next_work is not null then
  perform 1 from public.work_items where id=next_work and organization_id=p_org and project_id=p_project and engagement_id=s.engagement_id and deleted_at is null for share;
  if not found then raise exception 'Choose next Work in this engagement'; end if;
 end if;
 if op='close_period' then
  select * into strict period from public.marketing_service_periods where id=(p_details->>'period_id')::uuid and project_id=p_project and service_id=p_service for update;
  if period.ends_on>current_date then raise exception 'Review the period after its final day';end if;
  select jsonb_build_object('original_goal',period.original_goal,'goal',period.goal,'unit',period.unit,
   'committed',coalesce(sum(d.committed_units) filter(where d.period_id=period.id),0),
   'open_committed',coalesce(sum(d.committed_units) filter(where d.period_id=period.id and d.stage<>'delivered'),0),
   'delivered',coalesce(sum(d.delivered_units) filter(where d.delivered_on between period.starts_on and period.ends_on and source.unit=period.unit),0),
   'actual_by_unit',(select coalesce(jsonb_object_agg(t.unit,t.units),'{}'::jsonb) from
      (select x.unit,sum(y.delivered_units) units from public.marketing_delivery_cards y join public.marketing_service_periods x on x.id=y.period_id
       join public.work_items live on live.id=y.work_item_id and live.deleted_at is null
       where y.project_id=p_project and y.service_id=p_service and y.delivered_on between period.starts_on and period.ends_on group by x.unit)t))
  into quantities from public.marketing_delivery_cards d join public.marketing_service_periods source on source.id=d.period_id
  join public.work_items w on w.id=d.work_item_id and w.deleted_at is null where d.project_id=p_project and d.service_id=p_service;
  insert into public.marketing_period_reviews(id,period_id,results,summary,next_action,next_work_id,recorded_by)
   values(p_id,period.id,quantities,btrim(p_details->>'summary'),btrim(p_details->>'next_action'),next_work,actor);
  return p_id;
 end if;
 select d.* into strict c from public.marketing_delivery_cards d join public.work_items w on w.id=d.work_item_id
  where d.id=(p_details->>'card_id')::uuid and d.project_id=p_project and d.service_id=p_service and w.project_id=p_project
   and w.engagement_id=s.engagement_id and w.organization_id=p_org and w.deleted_at is null for share of d,w;
 if op='plan' then
  insert into public.marketing_measurement_plans(id,project_id,card_id,question,metric,unit,baseline,target,starts_on,ends_on,source_note,recorded_by)
  values(p_id,p_project,c.id,btrim(p_details->>'question'),btrim(p_details->>'metric'),btrim(p_details->>'unit'),
  (p_details->>'baseline')::numeric,(p_details->>'target')::numeric,(p_details->>'starts_on')::date,(p_details->>'ends_on')::date,btrim(p_details->>'source_note'),actor);
 elsif op='result' then
  select * into strict plan from public.marketing_measurement_plans where id=(p_details->>'plan_id')::uuid and project_id=p_project and card_id=c.id for share;
  if observation is null or observation<plan.ends_on or observation>current_date then raise exception 'Choose an observation date on or after the measurement window';end if;
  if p_details->>'actual' is null and p_details->>'decision' is distinct from 'inconclusive' then raise exception 'Missing measurement requires an inconclusive decision';end if;
  insert into public.marketing_measurement_results(id,plan_id,observed_on,actual,source_note,conclusion,decision,next_action,next_work_id,recorded_by)
   values(p_id,plan.id,observation,(p_details->>'actual')::numeric,btrim(p_details->>'source_note'),btrim(p_details->>'conclusion'),
   p_details->>'decision',btrim(p_details->>'next_action'),next_work,actor);
 else raise exception 'Unknown measurement operation';end if;return p_id;
end; $$;
revoke all on function public.record_marketing_measurement(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_marketing_measurement(uuid,uuid,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
