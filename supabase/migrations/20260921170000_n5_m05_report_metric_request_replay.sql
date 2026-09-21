-- M05b: raw-request receipt lookup survives later changes to source metric rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

alter table private.m05_report_save_requests
  add column request_payload_sha256 text check(request_payload_sha256 ~ '^[a-f0-9]{64}$');

create function private.m05_report_raw_payload_sha(
  p_organization_id uuid,p_engagement_id uuid,p_artifact_id uuid,p_expected_latest_version_id uuid,
  p_title text,p_content jsonb,p_change_summary text,p_ai_use_allowed boolean,p_actor_id uuid
) returns text language sql immutable security invoker set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'engagement_id',p_engagement_id,'artifact_id',p_artifact_id,
    'expected_latest_version_id',p_expected_latest_version_id,'title',trim(p_title),
    'content',p_content - 'metric_snapshots',
    'change_summary',left(coalesce(p_change_summary,''),1000),
    'ai_use_allowed',coalesce(p_ai_use_allowed,false),'actor_id',p_actor_id
  )::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function private.m05_report_raw_payload_sha(uuid,uuid,uuid,uuid,text,jsonb,text,boolean,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.m05_report_raw_payload_sha(uuid,uuid,uuid,uuid,text,jsonb,text,boolean,uuid)
  to service_role;

create or replace function public.save_marketing_report_version(
  p_organization_id uuid,p_engagement_id uuid,p_artifact_id uuid,p_expected_latest_version_id uuid,
  p_title text,p_content jsonb,p_content_checksum text,p_change_summary text,p_ai_use_allowed boolean,
  p_request_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  member_role text;
  member_department text;
  engagement record;
  prior private.m05_report_save_requests%rowtype;
  artifact public.artifacts%rowtype;
  latest public.artifact_versions%rowtype;
  version public.artifact_versions%rowtype;
  payload_sha text;
  request_payload_sha text;
begin
  perform private.n1c_set_actor(p_actor_id);
  if p_request_id is null or p_engagement_id is null or p_content is null
    or jsonb_typeof(p_content)<>'object' or length(trim(coalesce(p_title,''))) not between 1 and 240
    or p_content_checksum is null or p_content_checksum !~ '^[a-f0-9]{64}$'
    or p_content->>'report_title' is distinct from trim(p_title) then
    raise exception 'Complete exact Marketing report save required' using errcode='22023';
  end if;
  select e.id,e.brand_id,e.project_id into engagement from public.engagements e
    where e.id=p_engagement_id and e.organization_id=p_organization_id for share;
  if not found then raise exception 'Exact Marketing engagement required' using errcode='42501'; end if;
  member_role:=private.n1c_require_scope(p_organization_id,engagement.project_id,p_actor_id);
  select department_id into member_department from public.organization_memberships
    where organization_id=p_organization_id and user_id=p_actor_id and member_kind='team' and status='active' for share;
  if member_role not in ('system_owner','operations_admin','executive') and member_department is distinct from 'marketing' then
    raise exception 'Marketing department access required' using errcode='42501';
  end if;
  perform 1 from public.engagement_services es join public.service_catalog sc
    on sc.id=es.service_id and sc.organization_id=es.organization_id
    where es.organization_id=p_organization_id and es.engagement_id=p_engagement_id
      and es.status='active' and sc.is_active and sc.department_id='marketing' for share of es,sc;
  if not found then raise exception 'Active Marketing service required' using errcode='42501'; end if;
  if p_artifact_id is null and p_expected_latest_version_id is not null then
    raise exception 'New report cannot name an existing version' using errcode='22023';
  end if;
  payload_sha:=encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'engagement_id',p_engagement_id,'artifact_id',p_artifact_id,
    'expected_latest_version_id',p_expected_latest_version_id,'title',trim(p_title),
    'content',p_content,'content_checksum',p_content_checksum,
    'change_summary',left(coalesce(p_change_summary,''),1000),
    'ai_use_allowed',coalesce(p_ai_use_allowed,false),'actor_id',p_actor_id
  )::text,'UTF8'),'sha256'),'hex');
  request_payload_sha:=private.m05_report_raw_payload_sha(p_organization_id,p_engagement_id,
    p_artifact_id,p_expected_latest_version_id,p_title,p_content,p_change_summary,p_ai_use_allowed,p_actor_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'm05-report-request:'||p_organization_id::text||':'||p_request_id::text,0));
  select * into prior from private.m05_report_save_requests where request_id=p_request_id;
  if found then
    if prior.organization_id is distinct from p_organization_id or prior.engagement_id is distinct from p_engagement_id
      or prior.actor_id is distinct from p_actor_id or prior.payload_sha256 is distinct from payload_sha then
      raise exception 'Report request ID already used with different inputs' using errcode='23505';
    end if;
    select * into version from public.artifact_versions
      where id=prior.artifact_version_id and organization_id=p_organization_id;
    if not found then raise exception 'Saved report version is unavailable' using errcode='23503'; end if;
    return to_jsonb(version)||jsonb_build_object('artifact_id',prior.artifact_id,'request_id',p_request_id,'replayed',true);
  end if;
  if p_artifact_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'm05-report-lineage:'||p_organization_id::text||':'||p_artifact_id::text,0));
    select * into artifact from public.artifacts where id=p_artifact_id and organization_id=p_organization_id for update;
    if not found or artifact.artifact_type<>'marketing_report' or artifact.engagement_id<>p_engagement_id
      or artifact.brand_id<>engagement.brand_id then
      raise exception 'Report does not match the exact engagement' using errcode='42501';
    end if;
    select * into latest from public.artifact_versions where artifact_id=artifact.id and organization_id=p_organization_id
      order by version_number desc limit 1 for update;
    if latest.id is distinct from p_expected_latest_version_id then
      raise exception 'Report changed since it was loaded; refresh before saving' using errcode='40001';
    end if;
    update public.artifacts set title=trim(p_title) where id=artifact.id and organization_id=p_organization_id;
  else
    insert into public.artifacts(organization_id,engagement_id,brand_id,artifact_type,title,created_by)
      values(p_organization_id,p_engagement_id,engagement.brand_id,'marketing_report',trim(p_title),p_actor_id)
      returning * into artifact;
  end if;
  insert into public.artifact_versions(organization_id,artifact_id,version_number,parent_version_id,
    content,content_checksum,change_summary,ai_use_allowed,data_classification,created_by)
    values(p_organization_id,artifact.id,coalesce(latest.version_number,0)+1,latest.id,
      p_content,p_content_checksum,left(coalesce(p_change_summary,''),1000),
      coalesce(p_ai_use_allowed,false),'internal',p_actor_id) returning * into version;
  insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
    values(p_organization_id,p_engagement_id,'artifact_version_created',p_actor_id,
      jsonb_build_object('record_type','artifact','record_id',artifact.id,'version_id',version.id,
      'action','version_created','artifact_type','marketing_report'));
  insert into private.m05_report_save_requests(request_id,organization_id,engagement_id,actor_id,payload_sha256,
    request_payload_sha256,artifact_id,artifact_version_id)
    values(p_request_id,p_organization_id,p_engagement_id,p_actor_id,payload_sha,request_payload_sha,artifact.id,version.id);
  return to_jsonb(version)||jsonb_build_object('artifact_id',artifact.id,'request_id',p_request_id,'replayed',false);
end;
$$;
create function public.replay_marketing_report_request(
  p_organization_id uuid,p_engagement_id uuid,p_artifact_id uuid,p_expected_latest_version_id uuid,
  p_title text,p_content jsonb,p_change_summary text,p_ai_use_allowed boolean,p_request_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  engagement record;
  member_role text;
  member_department text;
  prior private.m05_report_save_requests%rowtype;
  version public.artifact_versions%rowtype;
  request_payload_sha text;
begin
  perform private.n1c_set_actor(p_actor_id);
  if p_request_id is null or p_engagement_id is null or p_content is null
    or jsonb_typeof(p_content)<>'object' or length(trim(coalesce(p_title,''))) not between 1 and 240 then
    raise exception 'Complete exact Marketing report request required' using errcode='22023';
  end if;
  select e.project_id into engagement from public.engagements e
    where e.id=p_engagement_id and e.organization_id=p_organization_id;
  if not found then raise exception 'Exact Marketing engagement required' using errcode='42501'; end if;
  member_role:=private.n1c_require_scope(p_organization_id,engagement.project_id,p_actor_id);
  select department_id into member_department from public.organization_memberships
    where organization_id=p_organization_id and user_id=p_actor_id and member_kind='team' and status='active';
  if member_role not in ('system_owner','operations_admin','executive') and member_department is distinct from 'marketing' then
    raise exception 'Marketing department access required' using errcode='42501';
  end if;
  request_payload_sha:=private.m05_report_raw_payload_sha(p_organization_id,p_engagement_id,
    p_artifact_id,p_expected_latest_version_id,p_title,p_content,p_change_summary,p_ai_use_allowed,p_actor_id);
  select * into prior from private.m05_report_save_requests where request_id=p_request_id;
  if not found then return null; end if;
  if prior.organization_id is distinct from p_organization_id or prior.engagement_id is distinct from p_engagement_id
    or prior.actor_id is distinct from p_actor_id then
    raise exception 'Report request ID already used with different scope' using errcode='23505';
  end if;
  if prior.request_payload_sha256 is null then return null; end if;
  if prior.request_payload_sha256 is distinct from request_payload_sha then
    raise exception 'Report request ID already used with different inputs' using errcode='23505';
  end if;
  select * into version from public.artifact_versions
    where id=prior.artifact_version_id and organization_id=p_organization_id;
  if not found then raise exception 'Saved report version is unavailable' using errcode='23503'; end if;
  return to_jsonb(version)||jsonb_build_object('artifact_id',prior.artifact_id,'request_id',p_request_id,'replayed',true);
end;
$$;
revoke all on function public.replay_marketing_report_request(uuid,uuid,uuid,uuid,text,jsonb,text,boolean,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.replay_marketing_report_request(uuid,uuid,uuid,uuid,text,jsonb,text,boolean,uuid,uuid)
  to service_role;
commit;
