begin;
set local lock_timeout='5s';

create table public.social_monthly_cycles (
  project_id uuid not null references public.projects,
  engagement_service_id uuid not null references public.engagement_services,
  month_start date not null check(extract(day from month_start)=1),
  post_goal integer not null check(post_goal between 0 and 10000),
  reel_goal integer not null check(reel_goal between 0 and 10000),
  revision integer not null default 1,
  primary key(project_id,engagement_service_id,month_start)
);
create table public.social_work_cards (
  id uuid primary key,
  work_item_id uuid not null unique references public.work_items,
  project_id uuid not null references public.projects,
  engagement_service_id uuid not null references public.engagement_services,
  original_month date not null,
  kind text not null check(kind in ('post','reel')),
  planned_date date not null,
  scheduled_date date,
  published_date date,
  asset_version_id uuid references public.deliverable_versions,
  stage text not null check(stage in ('draft','in_review','approved','scheduled','published')),
  reviewed_by uuid references auth.users,
  reviewed_at timestamptz,
  reviewed_title text,
  reviewed_brief text,
  foreign key(project_id,engagement_service_id,original_month)
    references public.social_monthly_cycles(project_id,engagement_service_id,month_start)
);
alter table public.social_monthly_cycles enable row level security;
alter table public.social_work_cards enable row level security;
revoke all on public.social_monthly_cycles,public.social_work_cards from public,anon,authenticated;
grant select on public.social_monthly_cycles,public.social_work_cards to authenticated;
create policy social_cycle_project_read on public.social_monthly_cycles for select to authenticated
using (exists(select 1 from public.engagement_services s join public.engagements e on e.id=s.engagement_id
              where s.id=engagement_service_id and e.project_id=social_monthly_cycles.project_id));
create policy social_card_work_read on public.social_work_cards for select to authenticated
using (exists(select 1 from public.work_items w where w.id=work_item_id and w.project_id=social_work_cards.project_id and w.deleted_at is null));

create function private.social_management_service(p_project uuid,p_service uuid,p_actor uuid)
returns public.engagement_services language plpgsql security invoker set search_path='' as $$
declare s public.engagement_services;
begin
 select es.* into strict s from public.engagement_services es
 join public.engagements e on e.id=es.engagement_id and e.organization_id=es.organization_id
 join public.projects p on p.id=e.project_id and p.organization_id=e.organization_id
 join public.service_catalog c on c.id=es.service_id and c.organization_id=es.organization_id
 where p.id=p_project and es.id=p_service and p.archived_at is null and es.status in ('planned','active')
 and c.department_id='marketing' and c.slug in ('social_planning','setup_marketing_social_calendar','setup_marketing_social_scheduling_and_publishing')
 for share of es,e,p,c;
 perform private.n1c_require_scope(s.organization_id,p_project,p_actor);
 if private.n1c_can_assign_department(s.organization_id,p_project,'marketing',p_actor) is not true then
   raise exception 'Marketing management authority required' using errcode='42501';
 end if;
 return s;
end; $$;
revoke all on function private.social_management_service(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.save_social_cycle(p_project uuid,p_service uuid,p_month date,p_posts integer,p_reels integer,p_revision integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.social_management_service(p_project,p_service,auth.uid());
 if p_revision is null then
   insert into public.social_monthly_cycles(project_id,engagement_service_id,month_start,post_goal,reel_goal)
   values(p_project,p_service,p_month,p_posts,p_reels);
 else
   update public.social_monthly_cycles set post_goal=p_posts,reel_goal=p_reels,revision=revision+1
   where project_id=p_project and engagement_service_id=p_service and month_start=p_month and revision=p_revision;
   if not found then raise exception 'Reopen the current month' using errcode='40001'; end if;
 end if;
end; $$;

create function public.save_social_work_card(p_org uuid,p_actor uuid,p_project uuid,p_service uuid,p_card uuid,p_revision bigint,p_details jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 s public.engagement_services; card public.social_work_cards; work public.work_items;
 planned date:=(p_details->>'planned_date')::date; scheduled date:=(p_details->>'scheduled_date')::date;
 published date:=(p_details->>'published_date')::date; asset uuid:=(p_details->>'asset_version_id')::uuid;
 stage_name text:=p_details->>'stage'; title_text text:=btrim(p_details->>'title'); brief text:=coalesce(p_details->>'description','');
 actor uuid:=p_actor; assignee uuid:=(p_details->>'assignee_id')::uuid;
begin
 s:=private.social_management_service(p_project,p_service,p_actor);
 if s.organization_id is distinct from p_org then raise exception 'Invalid organization' using errcode='42501'; end if;
 select * into card from public.social_work_cards where id=p_card and project_id=p_project and engagement_service_id=p_service for update;
 if card.id is not null then
   select * into strict work from public.work_items where id=card.work_item_id and project_id=p_project
   and organization_id=s.organization_id and engagement_id=s.engagement_id and deleted_at is null for update;
   if work.row_version is distinct from p_revision then raise exception 'Reopen the current card' using errcode='40001'; end if;
   if card.kind is distinct from p_details->>'kind' or card.stage='published' then raise exception 'Card type and delivered history are fixed'; end if;
 elsif p_revision is not null or stage_name is distinct from 'draft' then raise exception 'New cards start as drafts'; end if;
 if coalesce(length(title_text),0) not between 1 and 200 or length(brief)>4000 or planned is null or assignee is null then
   raise exception 'Enter a title, owner and planned date'; end if;
 if asset is not null then
   perform 1 from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id
   where d.project_id=p_project and v.project_id=p_project and d.organization_id=s.organization_id and v.organization_id=s.organization_id
   and d.archived_at is null and v.id=asset and v.withdrawn_at is null for share of d,v;
   if not found then raise exception 'Choose a current asset version from this project'; end if;
 end if;
 if stage_name in ('approved','scheduled','published') then
   if asset is null or asset is distinct from card.asset_version_id or title_text is distinct from work.title
      or brief is distinct from coalesce(work.description,'') then raise exception 'Submit the current content for internal review'; end if;
   if stage_name='approved' and card.stage='in_review' then card.reviewed_by:=actor; card.reviewed_at:=now();
     card.reviewed_title:=title_text; card.reviewed_brief:=brief;
   elsif card.reviewed_at is null or card.reviewed_title is distinct from title_text or card.reviewed_brief is distinct from brief then raise exception 'Internal review required'; end if;
 else card.reviewed_at:=null; card.reviewed_by:=null; card.reviewed_title:=null; card.reviewed_brief:=null; end if;
 if (stage_name in ('scheduled','published')) is distinct from (scheduled is not null)
    or (stage_name='published') is distinct from (published is not null)
    or (published is not null and (card.stage is distinct from 'scheduled' or published>current_date))
    then raise exception 'Check scheduling and actual publication dates'; end if;
 if not exists(select 1 from public.social_monthly_cycles where project_id=p_project and engagement_service_id=p_service
   and month_start=date_trunc('month',planned)::date) then raise exception 'Configure the planned month first'; end if;
 work:=public.save_p5_work_item(p_org,work.id,s.engagement_id,title_text,brief,'task',coalesce(work.priority,'medium'),
   case stage_name when 'draft' then 'not_started' when 'published' then 'done' else 'in_progress' end,
   assignee,'marketing',work.linked_artifact_id,work.linked_artifact_version_id,work.linked_engagement_stage_instance_id,
   null,coalesce(published,scheduled,planned),coalesce(work.position,0),work.parent_work_item_id,actor,p_revision,'manual');
 if card.id is null then
   insert into public.social_work_cards(id,work_item_id,project_id,engagement_service_id,original_month,kind,planned_date,stage,asset_version_id)
   values(p_card,work.id,p_project,p_service,date_trunc('month',planned)::date,p_details->>'kind',planned,stage_name,asset);
 else
   update public.social_work_cards set planned_date=planned,scheduled_date=scheduled,published_date=published,stage=stage_name,
     asset_version_id=asset,reviewed_by=card.reviewed_by,reviewed_at=card.reviewed_at,reviewed_title=card.reviewed_title,reviewed_brief=card.reviewed_brief where id=p_card;
 end if;
 return work.id;
end; $$;
revoke all on function public.save_social_cycle(uuid,uuid,date,integer,integer,integer),public.save_social_work_card(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_social_cycle(uuid,uuid,date,integer,integer,integer) to authenticated;
grant execute on function public.save_social_work_card(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
