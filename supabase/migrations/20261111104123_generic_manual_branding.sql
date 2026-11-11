begin;
set local lock_timeout='5s';
alter table public.brand_deliverable_cards add column brand_kind text check(brand_kind in ('brand_statement','messaging_guide','tone_of_voice','mood_board','logo_suite','visual_identity_guide'));

create or replace function public.save_brand_deliverable_card(p_organization uuid,p_actor uuid,p_project uuid,p_service uuid,p_deliverable uuid,p_plan jsonb,
 p_expected_revision bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare
 dept text; kind text:=nullif(p_plan->>'brandKind','');
 actor uuid:=p_actor; project public.projects; service public.engagement_services; deliverable public.deliverables;
 card public.brand_deliverable_cards; work public.work_items; final_version public.deliverable_versions;
 stage_name text:=p_plan->>'stage'; next_step text:=btrim(p_plan->>'next'); evidence text:=btrim(p_plan->>'evidence');
 title_text text:=btrim(p_plan->>'title'); brief text:=btrim(p_plan->>'brief'); work_status text; source_version uuid; supplied_file uuid;
begin
 select * into strict project from public.projects where id=p_project and organization_id=p_organization and archived_at is null for share;
 perform private.n1c_require_scope(project.organization_id,p_project,actor);
 select s.* into strict service from public.engagement_services s
 join public.engagements e on e.id=s.engagement_id and e.organization_id=s.organization_id
 join public.service_catalog c on c.id=s.service_id and c.organization_id=s.organization_id
 where e.project_id=p_project and s.organization_id=project.organization_id and s.id=p_service
 and s.status in ('planned','active') and (
   (c.department_id='design' and c.slug in ('setup_design_logo_design','setup_design_visual_identity','setup_design_brand_guidelines','brand_visual_identity','setup_design_moodboard'))
   or (c.department_id='content' and c.slug in ('setup_content_brand_positioning','setup_content_value_proposition','setup_content_tone_of_voice','vision_positioning'))
 )
 for update of s;
 select c.department_id into strict dept from public.service_catalog c where c.id=service.service_id and c.organization_id=p_organization for share;
 if actor is null or not private.n1c_can_assign_department(p_organization,p_project,dept,actor) then raise exception 'Branding service management authority required' using errcode='42501'; end if;
 if stage_name is null or stage_name not in ('brief','in_progress','in_review','handoff','done') then raise exception 'Choose a valid stage'; end if;
 if length(next_step)>1000 or length(evidence)>4000 or length(brief)>4000 or length(title_text)>200
 or (stage_name<>'done' and coalesce(next_step,'')='') then raise exception 'Invalid card details'; end if;
 select * into deliverable from public.deliverables where id=p_deliverable and project_id=p_project
 and organization_id=project.organization_id and archived_at is null for update;
 if deliverable.id is null then
   if p_expected_revision is not null or coalesce(title_text,'')='' or coalesce(brief,'')='' then raise exception 'New card requires a title and brief'; end if;
   perform pg_advisory_xact_lock(hashtextextended(p_project::text||':'||lower(title_text),0));
   if exists(select 1 from public.deliverables where project_id=p_project and lower(btrim(title))=lower(title_text) and archived_at is null)
   then raise exception 'Open the existing deliverable with this title'; end if;
   perform 1 from public.workstreams where id=(p_plan->>'workstream')::uuid and project_id=p_project and organization_id=project.organization_id and department_id=dept for share;
   if not found then raise exception 'Select a workstream for the selected service'; end if;
   insert into public.deliverables(id,organization_id,project_id,workstream_id,title,description,created_by)
   values(p_deliverable,project.organization_id,p_project,(p_plan->>'workstream')::uuid,title_text,brief,actor) returning * into deliverable;
 end if;
 perform 1 from public.workstreams where id=deliverable.workstream_id and project_id=p_project
   and organization_id=p_organization and department_id=dept for share;
 if not found then raise exception 'Select an existing deliverable in the service department'; end if;
 select * into card from public.brand_deliverable_cards where deliverable_id=p_deliverable for update;
 if not (p_plan ? 'brandKind') then kind:=card.brand_kind; end if;
 if card.work_item_id is not null then
   if card.engagement_service_id<>p_service then raise exception 'Service changed'; end if;
   select * into strict work from public.work_items where id=card.work_item_id and project_id=p_project
   and organization_id=project.organization_id and engagement_id=service.engagement_id and deleted_at is null for update;
   if work.row_version is distinct from p_expected_revision then raise exception 'Reopen the current card' using errcode='40001'; end if;
 elsif p_expected_revision is not null then raise exception 'Card unavailable';
 elsif stage_name<>'brief' and coalesce(evidence,'')='' then raise exception 'Record the evidence for the starting stage'; end if;
 if p_plan ? 'sourceVersion' then
   source_version:=nullif(p_plan->>'sourceVersion','')::uuid;
 else
   source_version:=card.source_version_id;
 end if;
 if p_plan ? 'sourceFile' then supplied_file:=nullif(p_plan->>'sourceFile','')::uuid;
 else supplied_file:=card.supplied_file_id; end if;
 if supplied_file is not null then
   perform 1 from public.brand_supplied_assets a join public.files f on f.id=a.file_id
   where a.file_id=supplied_file and a.project_id=p_project and a.organization_id=p_organization
   and f.project_id=p_project and f.organization_id=p_organization and f.archived_at is null for share of a,f;
   if not found or source_version is not null then raise exception 'Choose one available source in this project'; end if;
 end if;
 if source_version is not null then
   perform 1 from public.deliverable_versions v join public.deliverables d on d.id=v.deliverable_id
   where v.id=source_version and v.project_id=p_project and v.organization_id=p_organization
     and d.project_id=p_project and d.organization_id=p_organization and d.archived_at is null and d.id<>p_deliverable
     and v.withdrawn_at is null and (v.file_id is not null or v.preview_metadata->>'preview_url' ~ '^https://(www[.])?figma[.]com/(design|file|proto)/')
     and exists(select 1 from public.approvals a where a.deliverable_version_id=v.id and a.deliverable_id=d.id
       and a.project_id=p_project and a.organization_id=p_organization and a.decision='approved'
       and a.approval_type=case when v.client_approval_required then 'client_approval' else 'internal_quality' end)
     and (v.review_status in ('client_approved','delivered_published') or
       (not v.client_approval_required and v.review_status in ('ready_for_client_review','client_reviewing')))
   for share of v,d;
   if not found then raise exception 'Choose an approved source version in this project'; end if;
 end if;
 if stage_name in ('handoff','done') then
   select * into strict final_version from public.deliverable_versions where id=(p_plan->>'version')::uuid
    and deliverable_id=p_deliverable and project_id=p_project and organization_id=project.organization_id and withdrawn_at is null
    and (review_status in ('client_approved','delivered_published') or (not client_approval_required and review_status='ready_for_client_review'))
    and exists(select 1 from public.approvals a where a.deliverable_version_id=public.deliverable_versions.id and a.project_id=p_project and a.organization_id=p_organization and a.decision='approved' and a.approval_type=case when public.deliverable_versions.client_approval_required then 'client_approval' else 'internal_quality' end)
    and (file_id is not null or preview_metadata->>'preview_url' ~ '^https://(www[.])?figma[.]com/(design|file|proto)/') for share;
 end if;
 work_status:=case stage_name when 'brief' then 'not_started' when 'done' then 'done' else 'in_progress' end;
 work:=public.save_work_item(work.id,service.engagement_id,deliverable.title,deliverable.description,'task',coalesce(work.priority,'medium'),
 work_status,(p_plan->>'owner')::uuid,dept,work.linked_artifact_id,work.linked_artifact_version_id,work.linked_engagement_stage_instance_id,
 work.start_date,work.due_date,coalesce(work.position,0),work.parent_work_item_id,actor,'manual');
 insert into public.brand_deliverable_cards(work_item_id,organization_id,project_id,engagement_service_id,deliverable_id,stage,next_action,intake_evidence,final_version_id,source_version_id,supplied_file_id,brand_kind) values(work.id,project.organization_id,p_project,p_service,p_deliverable,stage_name,
 coalesce(next_step,''),coalesce(evidence,''),final_version.id,source_version,supplied_file,kind)
 on conflict(work_item_id) do update set brand_kind=excluded.brand_kind,stage=excluded.stage,next_action=excluded.next_action,final_version_id=excluded.final_version_id,source_version_id=excluded.source_version_id,supplied_file_id=excluded.supplied_file_id;
 return work.id;
end; $$;

create table public.brand_asset_uses (
  organization_id uuid not null,
  project_id uuid not null references public.projects(id),
  brand_kind text not null check(brand_kind in ('brand_statement','messaging_guide','tone_of_voice','mood_board','logo_suite','visual_identity_guide')),
  file_id uuid not null references public.brand_supplied_assets(file_id),
  primary key(project_id,brand_kind,file_id)
);
alter table public.brand_asset_uses enable row level security;
revoke all on public.brand_asset_uses from public,anon,authenticated;
grant select on public.brand_asset_uses to authenticated;
create policy read_project_brand_asset_uses on public.brand_asset_uses for select to authenticated
using(private.can_access_project(project_id) and public.is_team_organization_member(organization_id));

create function public.link_project_brand_asset(p_project uuid,p_organization uuid,p_kind text,p_file uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 perform 1 from public.projects where id=p_project and organization_id=p_organization and archived_at is null for share;
 if actor is null or not found then raise exception 'Project unavailable' using errcode='42501'; end if;
 perform private.n1c_require_scope(p_organization,p_project,actor);
 if not (private.n1c_can_assign_department(p_organization,p_project,'design',actor) or
   (p_kind in ('brand_statement','messaging_guide','tone_of_voice') and private.n1c_can_assign_department(p_organization,p_project,'content',actor)))
 then raise exception 'Branding management authority required' using errcode='42501'; end if;
 perform 1 from public.brand_supplied_assets a join public.files f on f.id=a.file_id
 where a.organization_id=p_organization and a.project_id=p_project and a.file_id=p_file and
 f.organization_id=p_organization and f.project_id=p_project and f.archived_at is null for share of a,f;
 if not found then raise exception 'Select a supplied file from this project'; end if;
 insert into public.brand_asset_uses(organization_id,project_id,brand_kind,file_id) values(p_organization,p_project,p_kind,p_file)
 on conflict do nothing;
end; $$;
revoke all on function public.link_project_brand_asset(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.link_project_brand_asset(uuid,uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
