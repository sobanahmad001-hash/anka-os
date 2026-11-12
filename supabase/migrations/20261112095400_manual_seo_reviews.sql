begin;
set local lock_timeout='5s';
create table public.seo_work_cards (
 id uuid primary key, work_item_id uuid unique not null references public.work_items,
 project_id uuid not null references public.projects, service_id uuid not null references public.engagement_services,
 month_start date not null check(extract(day from month_start)=1), page_id uuid not null,
 page_path text not null, target jsonb not null, parent_review uuid references public.seo_work_cards,
 state text not null check(state in ('open','reviewed','verified')),
 evidence text, verified_date date, recorded_by uuid references auth.users, recorded_at timestamptz
);
create unique index seo_monthly_review_identity on public.seo_work_cards
 (project_id,service_id,page_id,(target->>'query'),(target->>'locale'),month_start) where parent_review is null;
create table public.seo_ranking_observations (
 id uuid primary key, card_id uuid not null references public.seo_work_cards, observed_date date not null,
 average_position numeric not null check(average_position >= 1 and average_position < 100000),
 source_note text not null check(length(btrim(source_note)) between 1 and 1500),
 recorded_by uuid not null references auth.users, recorded_at timestamptz not null default now(),
 unique(card_id,observed_date)
);
alter table public.seo_work_cards enable row level security;
alter table public.seo_ranking_observations enable row level security;
revoke all on public.seo_work_cards,public.seo_ranking_observations from public,anon,authenticated;
grant select on public.seo_work_cards,public.seo_ranking_observations to authenticated;
create policy seo_work_read on public.seo_work_cards for select to authenticated using (
 exists(select 1 from public.work_items w where w.id=work_item_id and w.project_id=seo_work_cards.project_id and w.deleted_at is null));
create policy seo_measure_read on public.seo_ranking_observations for select to authenticated using (
 exists(select 1 from public.seo_work_cards c where c.id=card_id));

create function public.save_manual_seo_work(p_org uuid,p_actor uuid,p_project uuid,p_service uuid,p_card uuid,p_revision bigint,p_details jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 s public.engagement_services; c public.seo_work_cards; parent public.seo_work_cards; w public.work_items;
 operation text:=p_details->>'operation'; page jsonb; chosen_target jsonb; keyword_rows jsonb;
 month_start date:=(p_details->>'month_start')::date; parent_id uuid:=(p_details->>'parent_review')::uuid;
 owner_id uuid:=(p_details->>'owner')::uuid; title_text text:=btrim(p_details->>'title');
 proof text:=btrim(p_details->>'evidence'); evidence_date date:=(p_details->>'date')::date;
begin
 perform private.n1c_require_scope(p_org,p_project,p_actor);
 if private.n1c_can_assign_department(p_org,p_project,'marketing',p_actor) is not true then
   raise exception 'Marketing management authority required' using errcode='42501'; end if;
 select es.* into strict s from public.engagement_services es join public.engagements e on e.id=es.engagement_id and e.organization_id=p_org
 join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=p_org
 where es.id=p_service and es.organization_id=p_org and e.project_id=p_project and es.status in ('planned','active')
 and sc.department_id='marketing' and sc.slug in ('seo_operations','setup_marketing_on_page_seo_audit','setup_marketing_page_seo_optimization',
 'setup_marketing_internal_linking','setup_marketing_technical_seo_audit','setup_marketing_seo_issue_prioritization','setup_marketing_seo_implementation_verification','setup_marketing_local_page_optimization')
 for share of es,e,sc;
 if operation='create' then
   if p_revision is not null or owner_id is null or coalesce(length(title_text),0) not between 1 and 200 then raise exception 'Enter title and owner'; end if;
   if parent_id is not null then
     select * into strict parent from public.seo_work_cards where id=parent_id and project_id=p_project and service_id=p_service and parent_review is null for share;
     perform 1 from public.work_items where id=parent.work_item_id and project_id=p_project and deleted_at is null for share;
     if not found then raise exception 'Review Work is unavailable'; end if;
     month_start:=parent.month_start;
   end if;
   select item into strict page from private.website_inventory_rows(p_org,p_project) item
    where item->>'id'=coalesce(parent.page_id::text,p_details->>'page_id');
   if page->>'mode'='undecided' then
     select coalesce(jsonb_agg(jsonb_build_object('query',v->'source'->>'term','intent',v->'source'->>'intent',
       'locale',v->'source'->>'locale','role',v->>'role')),'[]'::jsonb) into keyword_rows from jsonb_array_elements(page->'sourceTargets') v;
   else keyword_rows:=page->'targets'; end if;
   select t into strict chosen_target from jsonb_array_elements(keyword_rows)t where t=coalesce(parent.target,p_details->'target');
   w:=public.save_p5_work_item(p_org,null,s.engagement_id,title_text,null,'task','medium','not_started',owner_id,'marketing',
     null,null,null,null,(month_start+interval '1 month - 1 day')::date,0,parent.work_item_id,p_actor,null,'manual');
   insert into public.seo_work_cards(id,work_item_id,project_id,service_id,month_start,page_id,page_path,target,parent_review,state)
    values(p_card,w.id,p_project,p_service,month_start,(page->>'id')::uuid,page->>'path',chosen_target,parent_id,'open');
   insert into private.website_page_work_links values(p_project,(page->>'id')::uuid,'engagement_work_item',w.id,true);
   return w.id;
 end if;
 select * into strict c from public.seo_work_cards where id=p_card and project_id=p_project and service_id=p_service for update;
 select * into strict w from public.work_items where id=c.work_item_id and organization_id=p_org and project_id=p_project
   and engagement_id=s.engagement_id and deleted_at is null for update;
 if p_revision is distinct from w.row_version then raise exception 'Reopen current SEO Work' using errcode='40001'; end if;
 if coalesce(length(proof),0) not between 1 and 1500 or evidence_date is null or evidence_date>current_date then
   raise exception 'Enter dated evidence'; end if;
 if operation='measure' then
   if c.state<>'verified' or c.verified_date>=evidence_date then raise exception 'Measure rankings after the verified fix date'; end if;
   insert into public.seo_ranking_observations(id,card_id,observed_date,average_position,source_note,recorded_by)
   values((p_details->>'observation')::uuid,c.id,evidence_date,(p_details->>'position')::numeric,proof,p_actor);
 elsif operation='complete' and c.state='open' then
   w:=public.save_p5_work_item(p_org,w.id,s.engagement_id,w.title,w.description,w.work_item_type,w.priority,'done',w.assignee_id,
     'marketing',w.linked_artifact_id,w.linked_artifact_version_id,w.linked_engagement_stage_instance_id,w.start_date,w.due_date,
     w.position,w.parent_work_item_id,p_actor,p_revision,'manual');
   update public.seo_work_cards set state=case when c.parent_review is null then 'reviewed' else 'verified' end,
     evidence=proof,verified_date=evidence_date,recorded_by=p_actor,recorded_at=now() where id=c.id;
 else raise exception 'Invalid SEO workflow transition'; end if;
 return w.id;
end; $$;
revoke all on function public.save_manual_seo_work(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_manual_seo_work(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
