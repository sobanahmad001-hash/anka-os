-- T04: bind one existing canonical private brief version to one existing canonical video job.
-- Historic jobs remain unchanged; no quote, connector, budget or provider permission is seeded.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$declare required record; actual text;begin
 for required in select * from (values
 ('public.create_design_video_job(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text,text,boolean)','434367ddf1d769427a8030bf2834d119'),
 ('public.create_private_design_video_job(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text,text,boolean)','0645356afa6c0e7e5cb98aaefb2fc7d8'),
 ('private.require_private_design_video_context(uuid,uuid,uuid)','a41abe32a6de27556eb8fb7781733165'),
 ('private.guard_design_video_job()','b3f09fdcdf58e59a33986f50cb6421ef'),
 ('private.guard_design_video_unsettled_request()','6306ea1a385d4df503d2655b409a3714')
 ) sources(signature,checksum) loop
 select md5(replace(pg_get_functiondef(to_regprocedure(required.signature)),chr(13),'')) into actual;
 if actual is distinct from required.checksum then raise exception 'Exact installed video prerequisite differs: %',required.signature using errcode='55000';end if;
 end loop;
end;$$;
create table private.design_video_job_brief_bindings(
 job_id uuid primary key,organization_id uuid not null,requested_by uuid not null references auth.users(id) on delete restrict,
 operation_key uuid not null,creative_brief_version_id uuid not null,brief_checksum text not null check(brief_checksum ~ '^[0-9a-f]{64}$'),
 job_request_checksum text not null check(job_request_checksum ~ '^[0-9a-f]{64}$'),bound_at timestamptz not null default clock_timestamp(),
 unique(organization_id,requested_by,operation_key),
 foreign key(job_id,organization_id) references private.design_video_generation_jobs(id,organization_id) on delete restrict,
 foreign key(creative_brief_version_id,organization_id) references public.design_creative_brief_versions(id,organization_id) on delete restrict
);
alter table private.design_video_job_brief_bindings enable row level security;
revoke all on private.design_video_job_brief_bindings from public,anon,authenticated,service_role;
create function private.guard_design_video_job_brief_binding() returns trigger language plpgsql security invoker set search_path='' as $$begin
 raise exception 'Canonical video job brief binding is immutable' using errcode='55000';end;$$;
revoke all on function private.guard_design_video_job_brief_binding() from public,anon,authenticated,service_role;
create trigger guard_design_video_job_brief_binding before update or delete on private.design_video_job_brief_bindings for each row execute function private.guard_design_video_job_brief_binding();
create function public.create_confirmed_design_video_job(
 p_organization_id uuid,p_actor_id uuid,p_private_conversation_id uuid,p_direction_version_id uuid,p_creative_brief_version_id uuid,
 p_connector_connection_id uuid,p_quote_id uuid,p_operation_key uuid,p_prompt text,p_mode text,p_duration_seconds integer,
 p_resolution text,p_aspect_ratio text,p_output_format text,p_generate_audio boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb;version public.design_creative_brief_versions;root public.design_creative_briefs;
 binding private.design_video_job_brief_bindings;job private.design_video_generation_jobs;brief jsonb;content jsonb;created jsonb;checksum text;
begin
 if p_operation_key is null or p_creative_brief_version_id is null then raise exception 'Exact confirmed brief version and original operation required' using errcode='22023';end if;
 perform private.require_design_video_brief_context(p_organization_id,p_actor_id,p_private_conversation_id,p_direction_version_id);
 scope:=case when p_private_conversation_id is not null then jsonb_build_object('private_conversation_id',p_private_conversation_id) else jsonb_build_object('direction_version_id',p_direction_version_id) end;
 -- Same scoped serialization as confirmation, followed by this job operation and canonical root locks.
 perform pg_advisory_xact_lock(hashtextextended('video-brief:'||p_organization_id::text||':'||p_actor_id::text||':'||scope::text,0));
 perform pg_advisory_xact_lock(hashtextextended('video-job-brief:'||p_organization_id::text||':'||p_actor_id::text||':'||p_operation_key::text,0));
 select * into binding from private.design_video_job_brief_bindings where organization_id=p_organization_id and requested_by=p_actor_id and operation_key=p_operation_key;
 if found then
  select * into job from private.design_video_generation_jobs where id=binding.job_id and organization_id=p_organization_id and requested_by=p_actor_id;
  if binding.creative_brief_version_id<>p_creative_brief_version_id or job.private_conversation_id is distinct from p_private_conversation_id
   or job.direction_version_id is distinct from p_direction_version_id or job.connector_connection_id is distinct from p_connector_connection_id or job.quote_id is distinct from p_quote_id
   or job.prompt is distinct from p_prompt or job.mode is distinct from p_mode or job.duration_seconds is distinct from p_duration_seconds
   or job.resolution is distinct from p_resolution or job.aspect_ratio is distinct from p_aspect_ratio or job.output_format is distinct from p_output_format
   or job.generate_audio is distinct from p_generate_audio or job.operation_key<>p_operation_key::text or job.request_checksum<>binding.job_request_checksum then
   raise exception 'Original operation binds a different exact brief or video request' using errcode='23505';end if;
  return jsonb_build_object('job_id',job.id,'status',job.status,'request_checksum',job.request_checksum,'creative_brief_version_id',binding.creative_brief_version_id,'brief_checksum',binding.brief_checksum,'idempotent_replay',true);
 end if;
 -- An old unbound request can be inspected through legacy history, never silently adopted.
 if exists(select 1 from private.design_video_generation_jobs where organization_id=p_organization_id and requested_by=p_actor_id and operation_key=p_operation_key::text) then raise exception 'Original historical video request has no confirmed brief binding' using errcode='23505';end if;
 select * into version from public.design_creative_brief_versions where id=p_creative_brief_version_id and organization_id=p_organization_id and created_by=p_actor_id;
 if not found then raise exception 'Exact owned immutable video brief version required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||version.creative_brief_id::text,0));
 select * into root from public.design_creative_briefs where id=version.creative_brief_id and organization_id=p_organization_id for share;
 brief:=version.content->'video_brief';
 if root.id is null or root.created_by<>p_actor_id or root.visibility<>'private' or root.engagement_id is not null or root.brand_id is not null
  or root.engagement_service_id is not null or root.project_task_id is not null or root.engagement_work_item_id is not null or root.frozen_version_id is distinct from version.id
  or private.valid_design_video_brief(brief) is distinct from true or version.validation_snapshot->'valid' is distinct from 'true'::jsonb
  or version.validation_snapshot->'video_confirmation'->>'action' is distinct from 'confirm_video_brief'
  or version.validation_snapshot->'video_confirmation'->>'actor_id' is distinct from p_actor_id::text then
  raise exception 'Current confirmed owner-private video brief required' using errcode='42501';end if;
 content:=private.design_video_brief_content(brief,scope);
 if version.content is distinct from content or content->>'instructions' is distinct from p_prompt
  or brief->>'mode' is distinct from p_mode or (brief->>'duration_seconds')::integer is distinct from p_duration_seconds
  or brief->>'resolution' is distinct from p_resolution or brief->>'aspect_ratio' is distinct from p_aspect_ratio
  or brief->>'output_format' is distinct from p_output_format or (brief->>'generate_audio')::boolean is distinct from p_generate_audio then
  raise exception 'Generate must use the exact confirmed complete prompt, settings and context' using errcode='22023';end if;
 checksum:=encode(sha256(convert_to(content::text,'UTF8')),'hex');
 if p_private_conversation_id is not null then
  created:=public.create_private_design_video_job(p_organization_id,p_private_conversation_id,p_actor_id,p_connector_connection_id,p_quote_id,p_operation_key::text,p_prompt,p_mode,p_duration_seconds,p_resolution,p_aspect_ratio,p_output_format,p_generate_audio);
 else
  created:=public.create_design_video_job(p_organization_id,p_direction_version_id,p_actor_id,p_connector_connection_id,p_quote_id,p_operation_key::text,p_prompt,p_mode,p_duration_seconds,p_resolution,p_aspect_ratio,p_output_format,p_generate_audio);
 end if;
 if coalesce((created->>'idempotent_replay')::boolean,false) then raise exception 'Unbound historical request cannot adopt a brief' using errcode='23505';end if;
 insert into private.design_video_job_brief_bindings(job_id,organization_id,requested_by,operation_key,creative_brief_version_id,brief_checksum,job_request_checksum)
 values((created->>'job_id')::uuid,p_organization_id,p_actor_id,p_operation_key,version.id,checksum,created->>'request_checksum');
 return created||jsonb_build_object('creative_brief_version_id',version.id,'brief_checksum',checksum);
end;$$;
revoke all on function public.create_confirmed_design_video_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.create_confirmed_design_video_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,text,text,text,boolean) to service_role;
-- New service requests must use the atomic confirmed wrapper. SQL signatures and historical receipts are preserved.
revoke execute on function public.create_design_video_job(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text,text,boolean) from service_role;
revoke execute on function public.create_private_design_video_job(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text,text,boolean) from service_role;
create function public.get_design_video_job_brief_binding(p_organization_id uuid,p_job_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare job jsonb;binding private.design_video_job_brief_bindings;begin
 job:=public.get_design_video_job(p_organization_id,p_job_id,p_actor_id);
 select * into binding from private.design_video_job_brief_bindings where job_id=p_job_id and organization_id=p_organization_id and requested_by=p_actor_id;
 return case when binding.job_id is null then jsonb_build_object('creative_brief_version_id',null,'brief_checksum',null) else jsonb_build_object('creative_brief_version_id',binding.creative_brief_version_id,'brief_checksum',binding.brief_checksum) end;
end;$$;
revoke all on function public.get_design_video_job_brief_binding(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_design_video_job_brief_binding(uuid,uuid,uuid) to service_role;
commit;
