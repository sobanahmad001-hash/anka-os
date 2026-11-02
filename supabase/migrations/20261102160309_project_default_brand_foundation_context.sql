-- LOCAL implementation: authorized canonical sources for an explicit default-plan
-- review. This reader creates no plan, approval, work, scheduler or publication.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
-- Canonical approvals are immutable positive decisions, one per exact version.
-- Rejection/revocation is not another state in this store; never infer it from
-- unrelated delivery-event history. Abort if that source contract changes.
do $$begin
 if not exists(select 1 from pg_constraint c where c.conrelid='public.artifact_approvals'::regclass and c.conname='artifact_approvals_artifact_version_id_key' and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (artifact_version_id)')
  or not exists(select 1 from pg_constraint c where c.conrelid='public.artifact_approvals'::regclass and c.conname='artifact_approvals_decision_check' and pg_get_constraintdef(c.oid)='CHECK ((decision = ''approved''::text))')
  or not exists(select 1 from pg_trigger t where t.tgrelid='public.artifact_approvals'::regclass and t.tgname='trg_artifact_approvals_immutable' and t.tgenabled in ('O','A') and t.tgtype=27 and t.tgfoid=to_regprocedure('private.reject_immutable_artifact_history_change()'))
  or md5(replace(pg_get_functiondef(to_regprocedure('private.reject_immutable_artifact_history_change()')),chr(13),'')) is distinct from '4f090fa2e3d4a92595ce5a3772476473' then raise exception 'Exact immutable canonical approval contract changed' using errcode='55000';end if;
end;$$;
create function public.get_project_default_plan_context(
 p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,
 p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.engagements; setup jsonb; sources jsonb; total bigint; packet jsonb;
begin
 if auth.uid() is null then raise exception 'Authenticated project context required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then raise exception 'Bounded source page required' using errcode='22023';end if;
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 select engagement.* into e from public.engagements engagement
 join public.brands b on b.id=engagement.brand_id and b.organization_id=engagement.organization_id and b.client_id=engagement.client_id and b.status='active'
 join public.agency_clients client on client.id=engagement.client_id and client.organization_id=engagement.organization_id and client.status='active'
 where engagement.id=p_engagement_id and engagement.organization_id=p_organization_id and engagement.project_id=p_project_id and engagement.status in ('planning','active')
 for share of engagement,b,client;
 if e.id is null then raise exception 'Exact current project, client and brand required' using errcode='42501';end if;
 setup:=public.get_project_setup(p_organization_id,p_project_id);
 -- Only canonical project outputs with their actual same-output approval qualify.
 -- Type is candidate eligibility, never an inferred claim that it is a guideline.
 with available as (
  select a.id as artifact_id,a.artifact_type,a.title,a.engagement_id,v.id as version_id,v.version_number,v.content_checksum as checksum,
   v.created_at,approval.id as approval_id,approval.approved_by,approval.approved_at,
   case when a.artifact_type in ('design_system','brand_identity','design_direction') then jsonb_build_array('visual') else jsonb_build_array('written') end as eligible_roles
  from public.artifacts a join public.artifact_versions v on v.artifact_id=a.id and v.organization_id=a.organization_id
  join public.artifact_approvals approval on approval.artifact_version_id=v.id and approval.artifact_id=a.id and approval.organization_id=a.organization_id and approval.engagement_id=a.engagement_id and approval.decision='approved'
  join public.engagements source_engagement on source_engagement.id=a.engagement_id and source_engagement.organization_id=a.organization_id and source_engagement.project_id=a.project_id and source_engagement.brand_id=a.brand_id and source_engagement.client_id=e.client_id and source_engagement.status<>'cancelled'
  where a.organization_id=p_organization_id and a.project_id=p_project_id and a.brand_id=e.brand_id
   and a.artifact_type in ('discovery','vision','audience','content','design_system','brand_identity','design_direction')
 ), page as (select * from available order by created_at desc,version_id limit p_limit offset p_offset)
 select (select count(*) from available),coalesce((select jsonb_agg(to_jsonb(page)||jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'brand_id',e.brand_id) order by page.created_at desc,page.version_id) from page),'[]'::jsonb) into total,sources;
 packet:=jsonb_build_object('schema_version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',e.id,'brand_id',e.brand_id,'client_id',e.client_id,
  'setup_token',setup->>'token','service_lines',coalesce(setup->'state'->'plan'->'contributions','[]'::jsonb),'scopes',setup->'scopes','leaves',setup->'leaves',
  'approved_sources',sources,'source_total',total,'limit',p_limit,'offset',p_offset,'has_more',p_offset+jsonb_array_length(sources)<total,
  'requires_explicit_review',true,'creates_work',false,'ready_for_preparation',false,'ready_for_traffic',false);
 return packet||jsonb_build_object('source_page_token',encode(sha256(convert_to(packet::text,'UTF8')),'hex'));
end;$$;
revoke all on function public.get_project_default_plan_context(uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_project_default_plan_context(uuid,uuid,uuid,integer,integer) to authenticated;
commit;
