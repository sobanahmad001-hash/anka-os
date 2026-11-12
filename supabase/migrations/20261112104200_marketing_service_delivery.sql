begin;
set local lock_timeout='5s';
create table public.marketing_service_periods (
 id uuid primary key, project_id uuid not null references public.projects,
 service_id uuid not null references public.engagement_services,
 starts_on date not null, ends_on date not null check(ends_on>=starts_on),
 cadence text not null check(cadence in ('once','per_batch','weekly','monthly','quarterly','custom')),
 unit text not null check(length(btrim(unit)) between 1 and 60),
 original_goal integer not null check(original_goal between 0 and 100000),
 goal integer not null check(goal between 0 and 100000),
 scope_note text not null check(length(scope_note)<=2000),revision int not null default 1,
 unique(project_id,service_id,starts_on)
);
create table public.marketing_delivery_cards (
 id uuid primary key, project_id uuid not null references public.projects, service_id uuid not null references public.engagement_services,
 period_id uuid not null references public.marketing_service_periods, work_item_id uuid unique not null references public.work_items,
 campaign_id uuid references public.marketing_campaigns, asset_version_id uuid references public.deliverable_versions,
 subject text not null check(length(btrim(subject)) between 1 and 350), brief text not null check(length(brief)<=4000),
 committed_units integer not null check(committed_units between 1 and 100000),
 original_date date not null, planned_date date not null, delivered_on date,
 delivered_units integer check(delivered_units between 1 and 100000),
 delivery_evidence text check(length(delivery_evidence)<=2000),
 stage text not null check(stage in ('draft','in_review','approved','scheduled','delivered')),
 channel text not null default '' check(length(channel)<=100), contact_ref text not null default '' check(length(contact_ref)<=350),
 follow_up_on date, scheduled_on date, result_url text check(length(result_url)<=2048 and result_url ~ '^https?://[^/@?#[:space:]]+(/[^[:space:]]*)?$'),
 review_snapshot jsonb,reviewer uuid references auth.users,reviewed_at timestamptz,review_note text,
 delivered_by uuid references auth.users
);
create index marketing_delivery_scope on public.marketing_delivery_cards(project_id,service_id,planned_date);
create index marketing_delivery_actual on public.marketing_delivery_cards(project_id,service_id,delivered_on) where delivered_on is not null;
alter table public.marketing_service_periods enable row level security;
alter table public.marketing_delivery_cards enable row level security;
revoke all on public.marketing_service_periods,public.marketing_delivery_cards from public,anon,authenticated;
grant select on public.marketing_service_periods,public.marketing_delivery_cards to authenticated;
create policy marketing_period_read on public.marketing_service_periods for select to authenticated using (
 exists(select 1 from public.engagement_services s join public.engagements e on e.id=s.engagement_id
 where s.id=marketing_service_periods.service_id and e.project_id=marketing_service_periods.project_id));
create policy marketing_delivery_read on public.marketing_delivery_cards for select to authenticated using (
 exists(select 1 from public.work_items w where w.id=work_item_id and w.project_id=marketing_delivery_cards.project_id and w.deleted_at is null));

create function private.marketing_delivery_service(p_org uuid,p_project uuid,p_service uuid,p_actor uuid)
returns public.engagement_services language plpgsql security invoker set search_path='' as $$
declare s public.engagement_services; dept text;
begin
 perform private.n1c_require_scope(p_org,p_project,p_actor);
 select es.* into strict s from public.engagement_services es join public.engagements e on e.id=es.engagement_id and e.organization_id=p_org
 join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=p_org
 where es.id=p_service and es.organization_id=p_org and e.project_id=p_project and es.status in ('planned','active') and sc.slug not in ('social_planning','setup_marketing_social_calendar','setup_marketing_social_scheduling_and_publishing') and (sc.department_id='marketing' or exists(select 1 from private.service_setup_leaves l where l.organization_id=p_org and l.service_id=sc.id and l.definition->'business_groups' ? 'marketing'))
 for update of es;
 select department_id into strict dept from public.service_catalog where id=s.service_id and organization_id=p_org for share;
 if private.n1c_can_assign_department(p_org,p_project,dept,p_actor) is not true then raise exception 'Service department management authority required' using errcode='42501';end if;
 return s;
end; $$;
revoke all on function private.marketing_delivery_service(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.save_marketing_service_period(p_org uuid,p_project uuid,p_service uuid,p_id uuid,p_revision int,p_plan jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare first_day date:=(p_plan->>'starts_on')::date; last_day date:=(p_plan->>'ends_on')::date;
begin
 perform private.marketing_delivery_service(p_org,p_project,p_service,auth.uid());
 if p_revision is null then
  if exists(select 1 from public.marketing_service_periods where project_id=p_project and service_id=p_service
   and starts_on<=last_day and ends_on>=first_day) then raise exception 'This service already has a period covering these dates'; end if;
  insert into public.marketing_service_periods(id,project_id,service_id,starts_on,ends_on,cadence,unit,original_goal,goal,scope_note)
  values(p_id,p_project,p_service,first_day,last_day,p_plan->>'cadence',btrim(p_plan->>'unit'),(p_plan->>'goal')::int,(p_plan->>'goal')::int,coalesce(p_plan->>'scope_note',''));
 else
  update public.marketing_service_periods set goal=(p_plan->>'goal')::int,scope_note=coalesce(p_plan->>'scope_note',''),revision=revision+1
  where id=p_id and project_id=p_project and service_id=p_service and revision=p_revision;
  if not found then raise exception 'Reopen the current period' using errcode='40001'; end if;
 end if; return p_id;
end; $$;
revoke all on function public.save_marketing_service_period(uuid,uuid,uuid,uuid,int,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_marketing_service_period(uuid,uuid,uuid,uuid,int,jsonb) to authenticated;

create function public.save_marketing_delivery_card(p_org uuid,p_actor uuid,p_project uuid,p_service uuid,p_card uuid,p_revision bigint,p_details jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.engagement_services; c public.marketing_delivery_cards; w public.work_items; period public.marketing_service_periods;
 op text:=p_details->>'operation'; title_text text; owner_id uuid; snapshot jsonb; note text:=btrim(p_details->>'note');
begin
 if length(note)>2000 then raise exception 'Review or delivery note exceeds 2000 characters';end if;
 s:=private.marketing_delivery_service(p_org,p_project,p_service,p_actor);
 if op='create' then
  if p_revision is not null then raise exception 'New card cannot supply a revision'; end if;
  select * into strict period from public.marketing_service_periods where id=(p_details->>'period_id')::uuid
   and project_id=p_project and service_id=p_service for share;
  c.id:=p_card; c.project_id:=p_project;c.service_id:=p_service;c.period_id:=period.id;c.stage:='draft';
  c.original_date:=(p_details->>'planned_date')::date;c.committed_units:=(p_details->>'committed_units')::int;
  if c.original_date not between period.starts_on and period.ends_on then raise exception 'Choose a commitment date within this period'; end if;
 else
  select * into strict c from public.marketing_delivery_cards where id=p_card and project_id=p_project and service_id=p_service for update;
  select * into strict w from public.work_items where id=c.work_item_id and organization_id=p_org and project_id=p_project and engagement_id=s.engagement_id and deleted_at is null for update;
  if p_revision is distinct from w.row_version then raise exception 'Reopen the current Work card' using errcode='40001'; end if;
 end if;
 if op in ('create','edit') then
  if c.stage<>'draft' then raise exception 'Return card to draft before editing'; end if;
  title_text:=btrim(p_details->>'title');owner_id:=(p_details->>'owner')::uuid;c.subject:=btrim(p_details->>'subject');
  c.channel:=btrim(coalesce(p_details->>'channel',''));c.contact_ref:=btrim(coalesce(p_details->>'contact_ref',''));c.follow_up_on:=(p_details->>'follow_up_on')::date;
  c.brief:=btrim(coalesce(p_details->>'brief',''));c.planned_date:=(p_details->>'planned_date')::date;
  c.campaign_id:=(p_details->>'campaign_id')::uuid;c.asset_version_id:=(p_details->>'asset_version_id')::uuid;
  if owner_id is null or coalesce(length(title_text),0) not between 1 and 200 then raise exception 'Enter title and owner';end if;
 else
  title_text:=w.title;owner_id:=w.assignee_id;
 end if;
 if c.campaign_id is not null then
  perform 1 from public.marketing_campaigns where id=c.campaign_id and organization_id=p_org and engagement_id=s.engagement_id for share;
  if not found then raise exception 'Campaign unavailable in this engagement';end if;
 end if;
 if c.asset_version_id is not null then
  perform 1 from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id
   where v.id=c.asset_version_id and v.organization_id=p_org and v.project_id=p_project and d.organization_id=p_org and d.project_id=p_project
   and d.archived_at is null and v.withdrawn_at is null for share of d,v;
  if not found then raise exception 'Asset version unavailable in this project';end if;
 end if;
 snapshot:=jsonb_build_object('title',title_text,'brief',coalesce(w.description,''),'subject',c.subject,'channel',c.channel,'contact',c.contact_ref,'campaign',c.campaign_id,'asset',c.asset_version_id);
 if op='submit' and c.stage='draft' then c.stage:='in_review';c.review_snapshot:=snapshot;
 elsif op='return' and c.stage in ('in_review','approved','scheduled') then
  c.stage:='draft';c.scheduled_on:=null;c.review_snapshot:=null;c.reviewer:=null;c.reviewed_at:=null;c.review_note:=note;
 elsif op='approve' and c.stage='in_review' then
  if c.review_snapshot is distinct from snapshot then raise exception 'Content changed since submission';end if;
  c.stage:='approved';c.reviewer:=p_actor;c.reviewed_at:=now();c.review_note:=note;
 elsif op='schedule' and c.stage in ('approved','scheduled') then
  if c.review_snapshot is distinct from snapshot or nullif(p_details->>'scheduled_on','') is null then raise exception 'Choose a date for the approved card';end if;
  c.scheduled_on:=(p_details->>'scheduled_on')::date;c.stage:='scheduled';
 elsif op='deliver' and c.stage in ('approved','scheduled') then
  if c.review_snapshot is distinct from snapshot then raise exception 'Content changed since review';end if;
  c.delivered_on:=(p_details->>'delivered_on')::date;c.delivered_units:=(p_details->>'delivered_units')::int;
  if c.delivered_on is null or c.delivered_on>current_date or c.delivered_units is null or coalesce(length(note),0) not between 1 and 2000 then
   raise exception 'Enter actual date, quantity and delivery evidence'; end if;
  c.result_url:=nullif(btrim(p_details->>'result_url'),'');c.delivery_evidence:=note;c.delivered_by:=p_actor;c.stage:='delivered';
 elsif op not in ('create','edit') or op is null then raise exception 'Invalid delivery transition';end if;
 if op not in ('create','edit') then c.brief:=coalesce(w.description,''); end if;
 w:=public.save_p5_work_item(p_org,w.id,s.engagement_id,title_text,c.brief,'task',coalesce(w.priority,'medium'),
  case c.stage when 'draft' then 'not_started' when 'delivered' then 'done' else 'in_progress' end,owner_id,(select department_id from public.service_catalog where id=s.service_id and organization_id=p_org),
  w.linked_artifact_id,w.linked_artifact_version_id,w.linked_engagement_stage_instance_id,w.start_date,coalesce(c.scheduled_on,c.planned_date),coalesce(w.position,0),w.parent_work_item_id,p_actor,p_revision,'manual');
 c.work_item_id:=w.id;
 if op='create' then insert into public.marketing_delivery_cards select c.*;
 else update public.marketing_delivery_cards set subject=c.subject,brief=c.brief,planned_date=c.planned_date,asset_version_id=c.asset_version_id,campaign_id=c.campaign_id,
 channel=c.channel,contact_ref=c.contact_ref,follow_up_on=c.follow_up_on,scheduled_on=c.scheduled_on,result_url=c.result_url,stage=c.stage,review_snapshot=c.review_snapshot,reviewer=c.reviewer,reviewed_at=c.reviewed_at,review_note=c.review_note,
 delivered_on=c.delivered_on,delivered_units=c.delivered_units,delivery_evidence=c.delivery_evidence,delivered_by=c.delivered_by where id=p_card;end if;
 return w.id;
end; $$;
revoke all on function public.save_marketing_delivery_card(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_marketing_delivery_card(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
