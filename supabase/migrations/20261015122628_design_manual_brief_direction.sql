begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Receipts are internal; canonical sessions/directions/versions remain the only draft records.
create table public.design_manual_direction_receipts (
 organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references auth.users(id),
 operation_key uuid not null,
 request jsonb not null check(jsonb_typeof(request)='object'),
 creative_brief_version_id uuid not null,
 direction_version_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(organization_id,actor_id,operation_key),
 foreign key(creative_brief_version_id,organization_id) references public.design_creative_brief_versions(id,organization_id),
 foreign key(direction_version_id,organization_id) references public.design_direction_versions(id,organization_id)
);
alter table public.design_manual_direction_receipts enable row level security;
revoke all on public.design_manual_direction_receipts from public,anon,authenticated,service_role;
grant select,insert on public.design_manual_direction_receipts to service_role;
create index design_manual_direction_brief on public.design_manual_direction_receipts(organization_id,creative_brief_version_id);

create function public.create_design_manual_direction(
 p_organization_id uuid,p_actor_id uuid,p_creative_brief_id uuid,
 p_creative_brief_version_id uuid,p_expected_revision integer,p_operation_key uuid,
 p_engagement_id uuid,p_engagement_service_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 b public.design_creative_briefs%rowtype;
 bv public.design_creative_brief_versions%rowtype;
 receipt public.design_manual_direction_receipts%rowtype;
 sv public.design_direction_versions%rowtype;
 session_id uuid; direction_id uuid; family text; slug text;
 request_value jsonb; content_value jsonb; manifest jsonb; digest_value text;
begin
 if p_operation_key is null or p_expected_revision is null or p_expected_revision<1 then
  raise exception 'Exact saved brief revision and operation key required.' using errcode='22023';
 end if;
 -- Lock current authority before any replay. Revocation committed first prevents all writes/readback.
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_organization_id and m.user_id=p_actor_id and m.status='active'
 and o.status='active' and m.member_kind='team'
 and (m.role in ('system_owner','operations_admin','executive') or m.department_id='design')
 for share of m,o;
 if not found then raise exception 'Current Design draft authority required.' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||p_actor_id::text||':'||p_operation_key::text,0));
 select * into b from public.design_creative_briefs where id=p_creative_brief_id and organization_id=p_organization_id for update;
 if not found or b.visibility<>'official' or b.engagement_id is distinct from p_engagement_id
 or b.engagement_service_id is distinct from p_engagement_service_id
 or b.frozen_version_id is distinct from p_creative_brief_version_id then
  raise exception 'Exact official frozen brief and service required.' using errcode='23514';
 end if;
 select * into bv from public.design_creative_brief_versions
 where id=p_creative_brief_version_id and organization_id=p_organization_id and creative_brief_id=b.id;
 if not found or bv.validation_snapshot->>'valid' is distinct from 'true' then
  raise exception 'Validated frozen brief required.' using errcode='23514';
 end if;
 select sc.slug into slug from public.engagement_services es
 join public.service_catalog sc on sc.id=es.service_id
 join public.engagements e on e.id=es.engagement_id and e.organization_id=es.organization_id
 join public.projects p on p.id=e.project_id and p.organization_id=e.organization_id
 where es.id=b.engagement_service_id and es.organization_id=p_organization_id and es.engagement_id=b.engagement_id
 and es.status='active' and sc.organization_id=p_organization_id and sc.department_id='design' and sc.is_active
 and e.brand_id=b.brand_id and e.status in ('planning','active') and p.archived_at is null
 for share of es,sc,e,p;
 if not found then raise exception 'Active Design service and project context required.' using errcode='42501'; end if;
 family:=case slug when 'brand_visual_identity' then 'brand_identity' when 'design_systems' then 'brand_identity'
 when 'website_ux_ui' then 'website_design' when 'campaign_creative' then 'marketing_asset'
 when 'social_assets' then 'marketing_asset' when 'advertising_assets' then 'marketing_asset'
 when 'video_concepts_storyboards' then 'video_motion' when 'visual_production' then 'marketing_asset' end;
 if family is null then raise exception 'Unsupported Design service.' using errcode='22023'; end if;
 request_value:=jsonb_build_object('brief_id',b.id,'version_id',bv.id,'revision',p_expected_revision,'engagement_id',p_engagement_id,'service_id',p_engagement_service_id);
 select * into receipt from public.design_manual_direction_receipts
 where organization_id=p_organization_id and actor_id=p_actor_id and operation_key=p_operation_key;
 if found then
  if receipt.request is distinct from request_value then raise exception 'Operation key already belongs to another request.' using errcode='23505'; end if;
  select * into sv from public.design_direction_versions where id=receipt.direction_version_id and organization_id=p_organization_id;
  return jsonb_build_object('version',to_jsonb(sv),'idempotent_replay',true);
 end if;
 if b.revision<>p_expected_revision then raise exception 'Brief changed; reload the exact saved version.' using errcode='40001'; end if;
 -- A repeated selection of this same frozen version reuses its canonical manual draft.
 select v.* into sv from public.design_manual_direction_receipts r
 join public.design_direction_versions v on v.id=r.direction_version_id and v.organization_id=r.organization_id
 where r.organization_id=p_organization_id and r.creative_brief_version_id=bv.id order by r.created_at limit 1;
 if not found then
  manifest:=jsonb_build_object('source','human_confirmed_creative_brief','creative_brief_version_id',bv.id,'content_checksum',bv.content_checksum,'business_approved',false);
  content_value:=bv.content||jsonb_build_object('provenance',manifest,'draft_kind','manual_brief_direction');
  digest_value:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(content_value::text,'UTF8')),'hex');
  insert into public.design_workshop_sessions(organization_id,engagement_id,brand_id,engagement_service_id,
   project_task_id,engagement_work_item_id,output_family,output_brief,designer_instructions,context_manifest,context_checksum,created_by)
  values(p_organization_id,b.engagement_id,b.brand_id,b.engagement_service_id,b.project_task_id,b.engagement_work_item_id,
   family,bv.content,coalesce(bv.content->>'instructions',''),manifest,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(manifest::text,'UTF8')),'hex'),p_actor_id) returning id into session_id;
  insert into public.design_directions(organization_id,session_id,direction_slot) values(p_organization_id,session_id,1) returning id into direction_id;
  insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id)
  values(p_organization_id,direction_id,1,content_value,digest_value,digest_value,p_actor_id,bv.id) returning * into sv;
 end if;
 insert into public.design_manual_direction_receipts(organization_id,actor_id,operation_key,request,creative_brief_version_id,direction_version_id)
 values(p_organization_id,p_actor_id,p_operation_key,request_value,bv.id,sv.id);
 return jsonb_build_object('version',to_jsonb(sv),'idempotent_replay',false);
end;
$$;
revoke all on function public.create_design_manual_direction(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_design_manual_direction(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid) to service_role;
commit;
