-- Run only on a disposable migrated database with an artifact fixture.
-- All fixture writes roll back; exercises the real constraints and immutable trigger.
begin;
do $$
declare
  source public.artifacts;
  artifact uuid := gen_random_uuid();
  original uuid := gen_random_uuid();
  successor uuid := gen_random_uuid();
  payload jsonb := '{"schema_version":2,"body":"Exact published wording","source_citations":["https://example.test/"]}';
  checksum text := repeat('a',64);
begin
  select * into strict source from public.artifacts limit 1;
  insert into public.artifacts(id,organization_id,brand_id,engagement_id,artifact_type,title,created_by)
    values(artifact,source.organization_id,source.brand_id,source.engagement_id,'content','Consent regression',source.created_by);
  insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum,ai_use_allowed,created_by)
    values(original,source.organization_id,artifact,1,payload,checksum,false,source.created_by);
  insert into public.artifact_versions(id,organization_id,artifact_id,version_number,parent_version_id,content,content_checksum,ai_use_allowed,created_by)
    values(successor,source.organization_id,artifact,2,original,payload,checksum,true,source.created_by);
  if (select count(*) from public.artifact_versions where artifact_id=artifact and content=payload and content_checksum=checksum) <> 2
    then raise exception 'Exact content/provenance was not preserved'; end if;
  if exists(select from public.artifact_approvals where artifact_version_id=successor)
    then raise exception 'Consent must not imply approval'; end if;
  begin
    insert into public.artifact_versions(organization_id,artifact_id,version_number,content,content_checksum,ai_use_allowed,created_by)
      values(source.organization_id,artifact,3,payload,checksum,true,source.created_by);
    raise exception 'Duplicate consent state accepted';
  exception when unique_violation then null; end;
  begin
    update public.artifact_versions set ai_use_allowed=true where id=original;
    raise exception 'Original immutable consent changed';
  exception when sqlstate '55000' then null; end;
  if not exists(select from public.artifact_versions where id=original and ai_use_allowed=false)
    then raise exception 'Original consent was changed'; end if;
end;
$$;
rollback;
