-- Provider URLs never become released assets. Only a checked private object
-- under the exact organization/version/job path can mark a video ready.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('design-generated-video','design-generated-video',false,52428800,
  array['video/mp4','video/quicktime']::text[])
on conflict (id) do update
  set public=false,file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

alter table private.design_video_generation_jobs
  add column output_sha256 text check (
    output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  add column output_byte_length bigint check (
    output_byte_length is null or output_byte_length between 12 and 52428800),
  add column output_mime_type text check (
    output_mime_type is null or output_mime_type in ('video/mp4','video/quicktime')),
  add constraint design_video_ready_private_object check (
    (status='ready') =
    (output_storage_path is not null and output_sha256 is not null
      and output_byte_length is not null and output_mime_type is not null));

create function public.complete_design_video_storage(
  p_organization_id uuid,p_job_id uuid,p_actor_id uuid,p_claim_id uuid,
  p_storage_path text,p_sha256 text,p_byte_length bigint,p_mime_type text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  job private.design_video_generation_jobs;
  expected_path text;
  expected_mime text;
begin
  select * into job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id for update;
  if not found or job.requested_by<>p_actor_id
    or job.dispatch_claim_id<>p_claim_id
    or job.status<>'provider_completed'
    or job.provider_request_id is null then
    raise exception 'Completed actor-owned video receipt is required' using errcode='42501';
  end if;
  expected_path:=p_organization_id::text||'/'||
    job.direction_version_id::text||'/'||p_job_id::text||'/output.'||
    job.output_format;
  expected_mime:=case job.output_format when 'mp4' then 'video/mp4'
    when 'mov' then 'video/quicktime' else null end;
  if p_storage_path is distinct from expected_path
    or p_mime_type is distinct from expected_mime
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_byte_length not between 12 and 52428800 then
    raise exception 'Exact checked private video object is required' using errcode='22023';
  end if;
  perform 1 from storage.objects object
    where object.bucket_id='design-generated-video'
      and object.name=p_storage_path;
  if not found then
    raise exception 'Private video storage object is unavailable' using errcode='P0002';
  end if;
  update private.design_video_generation_jobs
    set status='ready',output_storage_path=p_storage_path,
      output_sha256=p_sha256,output_byte_length=p_byte_length,
      output_mime_type=p_mime_type,completed_at=clock_timestamp()
    where id=p_job_id and organization_id=p_organization_id;
  return jsonb_build_object('job_id',p_job_id,'status','ready',
    'storage_path',p_storage_path);
end;
$$;
revoke all on function public.complete_design_video_storage(
  uuid,uuid,uuid,uuid,text,text,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.complete_design_video_storage(
  uuid,uuid,uuid,uuid,text,text,bigint,text)
  to service_role;

comment on table private.design_video_generation_jobs is
  'Private immutable Design video requests; only exact checked private output objects can become ready.';
commit;
