-- Owner-private conversation video; no project/direction fabricated.
begin;
set local lock_timeout='5s'; set local statement_timeout='120s';
alter table private.design_video_generation_jobs alter column direction_version_id drop not null,
 add column private_conversation_id uuid,
 add constraint design_video_private_conversation_fk foreign key(private_conversation_id,organization_id) references public.department_chat_conversations(id,organization_id) on delete restrict,
 add constraint design_video_exact_context check ((direction_version_id is null) <> (private_conversation_id is null));
create index design_video_private_history on private.design_video_generation_jobs(organization_id,requested_by,private_conversation_id,created_at desc);
do $$ declare item record; begin
 for item in select conname from pg_catalog.pg_constraint where conrelid='private.design_video_generation_jobs'::regclass and contype='c' and pg_catalog.pg_get_constraintdef(oid) like '%output_storage_path%' and pg_catalog.pg_get_constraintdef(oid) like '%direction_version_id%' loop
 execute format('alter table private.design_video_generation_jobs drop constraint %I',item.conname);
 end loop;
end $$;
create function private.require_private_design_video_context(p_organization_id uuid,p_conversation_id uuid,p_actor_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.organizations org join public.organization_memberships member on member.organization_id=org.id
 where org.id=p_organization_id and org.status='active' and member.user_id=p_actor_id and member.status='active' and member.member_kind='team'
 and (member.role in ('system_owner','operations_admin','executive') or member.department_id='design') for share of org,member;
 if not found then raise exception 'Current Design team authority required' using errcode='42501'; end if;
 perform 1 from public.department_chat_conversations c where c.id=p_conversation_id and c.organization_id=p_organization_id
 and c.owner_id=p_actor_id and c.context_kind='department_private' and c.department_id='design' and c.project_id is null and c.engagement_id is null and c.state='active' for share;
 if not found then raise exception 'Active owner-private Design conversation required' using errcode='42501'; end if;
end;
$$;
revoke all on function private.require_private_design_video_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function private.design_video_storage_path(job private.design_video_generation_jobs)
returns text language sql immutable security invoker set search_path='' as $$
 select job.organization_id::text||'/'||case when job.private_conversation_id is null then job.direction_version_id::text else 'private/'||job.requested_by::text||'/'||job.private_conversation_id::text end||'/'||job.id::text||'/output.'||job.output_format;
$$;
revoke all on function private.design_video_storage_path(private.design_video_generation_jobs) from public,anon,authenticated,service_role;
alter table private.design_video_generation_jobs add constraint design_video_exact_storage_path check(output_storage_path is null or output_storage_path=private.design_video_storage_path(design_video_generation_jobs));


create or replace function public.get_private_design_video_quote(
  p_organization_id uuid, p_private_conversation_id uuid, p_actor_id uuid,
  p_duration_seconds integer, p_resolution text, p_aspect_ratio text,
  p_output_format text, p_generate_audio boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  quote private.design_video_price_quotes;
  cap_configured boolean;
  spend_guard_mode text;
begin
  perform private.require_private_design_video_context(p_organization_id,p_private_conversation_id,p_actor_id);
  select budget.spend_guard_mode into spend_guard_mode
    from private.ai_execution_budget_limits budget
    where budget.organization_id=p_organization_id;
  cap_configured := coalesce(spend_guard_mode='local_monthly_cap',false);
  select * into quote from private.design_video_price_quotes price
    where price.organization_id=p_organization_id
      and price.provider='higgsfield'
      and price.model_id='bytedance/seedance-2.5/text-to-video'
      and price.duration_seconds=p_duration_seconds
      and price.resolution=p_resolution
      and price.aspect_ratio=p_aspect_ratio
      and price.output_format=p_output_format
      and price.generate_audio=p_generate_audio
      and price.verified_at<=clock_timestamp()
      and price.valid_until>clock_timestamp()
      and price.max_charge_microusd between 1 and 2000000
    order by price.verified_at desc,price.id desc limit 1;
  return jsonb_build_object('organization_cap_configured',cap_configured,
    'spend_guard_mode',spend_guard_mode,
    'spend_tracking_configured',spend_guard_mode is not null,
    'quote',case when quote.id is null then null else jsonb_build_object(
      'id',quote.id,'provider',quote.provider,'model_id',quote.model_id,
      'duration_seconds',quote.duration_seconds,'resolution',quote.resolution,
      'aspect_ratio',quote.aspect_ratio,'output_format',quote.output_format,
      'generate_audio',quote.generate_audio,'currency',quote.currency,
      'max_charge_microusd',quote.max_charge_microusd,
      'source_url',quote.source_url,'verified_at',quote.verified_at,
      'valid_until',quote.valid_until) end);
end;
$$;

create or replace function public.create_private_design_video_job(
  p_organization_id uuid, p_private_conversation_id uuid, p_actor_id uuid,
  p_connector_connection_id uuid, p_quote_id uuid, p_operation_key text,
  p_prompt text, p_mode text, p_duration_seconds integer,
  p_resolution text, p_aspect_ratio text, p_output_format text,
  p_generate_audio boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  quote private.design_video_price_quotes;
  connector public.integration_connections;
  existing private.design_video_generation_jobs;
  checksum text;
  new_id uuid;
begin
  if p_organization_id is null or p_private_conversation_id is null
    or p_actor_id is null or p_connector_connection_id is null
    or p_quote_id is null or length(btrim(coalesce(p_operation_key,''))) not between 8 and 200
    or p_operation_key<>btrim(p_operation_key)
    or length(btrim(coalesce(p_prompt,''))) not between 1 and 12000
    or p_mode not in ('explore','production')
    or p_duration_seconds not between 4 and 30
    or p_resolution not in ('480p','720p')
    or p_aspect_ratio not in ('16:9','4:3','1:1','3:4','9:16','21:9')
    or p_output_format not in ('mp4','mov')
    or p_generate_audio is null
    or (p_mode='explore' and p_duration_seconds>5)
    or (p_mode='production' and p_resolution<>'720p') then
    raise exception 'Exact supported video request is required' using errcode='22023';
  end if;
  perform private.require_private_design_video_context(p_organization_id,p_private_conversation_id,p_actor_id);
  perform 1 from private.ai_execution_budget_limits budget
    where budget.organization_id=p_organization_id
      and budget.spend_guard_mode in ('local_monthly_cap','provider_managed');
  if not found then
    raise exception 'Organization budget is not configured' using errcode='42501';
  end if;
  select * into connector from public.integration_connections
    where id=p_connector_connection_id and organization_id=p_organization_id for share;
  if not found or connector.provider<>'higgsfield'
    or connector.status<>'verified' or connector.archived_at is not null
    or connector.secret_name is null
    or not starts_with(connector.secret_name,'ANKA_HIGGSFIELD_')
    or exists (select 1 from public.integration_connection_departments mapping
      where mapping.connection_id=connector.id
        and mapping.organization_id=p_organization_id)
    or exists (select 1 from public.integration_connection_engagements mapping
      where mapping.connection_id=connector.id
        and mapping.organization_id=p_organization_id) then
    raise exception 'Verified Design video connection is required' using errcode='42501';
  end if;
  select * into quote from private.design_video_price_quotes
    where id=p_quote_id and organization_id=p_organization_id for share;
  if not found or quote.verified_at>clock_timestamp()
    or quote.valid_until<=clock_timestamp()
    or quote.duration_seconds<>p_duration_seconds
    or quote.resolution<>p_resolution or quote.aspect_ratio<>p_aspect_ratio
    or quote.output_format<>p_output_format
    or quote.generate_audio<>p_generate_audio
    or quote.max_charge_microusd>2000000 then
    raise exception 'Fresh exact video price under $2 is required' using errcode='42501';
  end if;
  checksum:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'private_conversation_id',p_private_conversation_id,
    'actor_id',p_actor_id,'connector_connection_id',p_connector_connection_id,
    'quote_id',p_quote_id,'prompt',btrim(p_prompt),'mode',p_mode,
    'duration_seconds',p_duration_seconds,'resolution',p_resolution,
    'aspect_ratio',p_aspect_ratio,'output_format',p_output_format,
    'generate_audio',p_generate_audio)::text,'UTF8')),'hex');
  insert into private.design_video_generation_jobs(
    organization_id,private_conversation_id,requested_by,connector_connection_id,
    operation_key,request_checksum,prompt,mode,duration_seconds,resolution,
    aspect_ratio,output_format,generate_audio,quote_id)
    values(p_organization_id,p_private_conversation_id,p_actor_id,
      p_connector_connection_id,p_operation_key,checksum,btrim(p_prompt),p_mode,
      p_duration_seconds,p_resolution,p_aspect_ratio,p_output_format,
      p_generate_audio,p_quote_id)
    on conflict (organization_id,requested_by,operation_key) do nothing
    returning id into new_id;
  if new_id is not null then
    return jsonb_build_object('job_id',new_id,'status','queued',
      'request_checksum',checksum,'idempotent_replay',false);
  end if;
  select * into existing from private.design_video_generation_jobs
    where organization_id=p_organization_id and requested_by=p_actor_id
      and operation_key=p_operation_key;
  if not found or existing.request_checksum<>checksum then
    raise exception 'Operation key already binds another video request' using errcode='23505';
  end if;
  return jsonb_build_object('job_id',existing.id,'status',existing.status,
    'request_checksum',existing.request_checksum,'idempotent_replay',true);
end;
$$;

create or replace function public.list_private_design_video_jobs(
  p_organization_id uuid, p_private_conversation_id uuid, p_actor_id uuid,
  p_before_created_at timestamptz default null, p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  result jsonb;
begin
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Complete video history cursor is required' using errcode='22023';
  end if;
  perform private.require_private_design_video_context(p_organization_id,p_private_conversation_id,p_actor_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',job.id,'private_conversation_id',job.private_conversation_id,'direction_version_id',job.direction_version_id,'status',job.status,'mode',job.mode,
    'duration_seconds',job.duration_seconds,'resolution',job.resolution,
    'aspect_ratio',job.aspect_ratio,'output_format',job.output_format,
    'generate_audio',job.generate_audio,'failure_reason',job.failure_reason,
    'created_at',job.created_at,'updated_at',job.updated_at)
    order by job.created_at desc,job.id desc),'[]'::jsonb) into result
    from (select * from private.design_video_generation_jobs
      where organization_id=p_organization_id
        and private_conversation_id=p_private_conversation_id
        and requested_by=p_actor_id
        and (p_before_created_at is null
          or (created_at,id) < (p_before_created_at,p_before_id))
      order by created_at desc,id desc limit 51) job;
  return result;
end;
$$;

create or replace function private.guard_design_video_job()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    raise exception 'Video job history cannot be deleted';
  end if;
  if new.private_conversation_id is not null and (tg_op='INSERT' or (tg_op='UPDATE' and old.status='queued' and new.status='claimed')) then
    perform private.require_private_design_video_context(new.organization_id,new.private_conversation_id,new.requested_by);
  end if;
  if tg_op='UPDATE' then
    if (new.organization_id,new.direction_version_id,new.private_conversation_id,new.requested_by,
      new.connector_connection_id,new.operation_key,new.request_checksum,new.prompt,new.mode,
      new.duration_seconds,new.resolution,new.aspect_ratio,new.output_format,
      new.generate_audio,new.quote_id,new.created_at)
      is distinct from
      (old.organization_id,old.direction_version_id,old.private_conversation_id,old.requested_by,
      old.connector_connection_id,old.operation_key,old.request_checksum,old.prompt,old.mode,
      old.duration_seconds,old.resolution,old.aspect_ratio,old.output_format,
      old.generate_audio,old.quote_id,old.created_at)
      or (old.dispatch_claim_id is not null and new.dispatch_claim_id is distinct from old.dispatch_claim_id)
      or (old.dispatch_request_id is not null and new.dispatch_request_id is distinct from old.dispatch_request_id)
      or (old.provider_request_id is not null and new.provider_request_id is distinct from old.provider_request_id)
      or (old.provider_status_url is not null and new.provider_status_url is distinct from old.provider_status_url)
      or (old.provider_output_url is not null and new.provider_output_url is distinct from old.provider_output_url)
      or (old.output_storage_path is not null and new.output_storage_path is distinct from old.output_storage_path) then
      raise exception 'Video job identity and receipts are immutable';
    end if;
    if not ((old.status='queued' and new.status='claimed')
      or (old.status='claimed' and new.status in
        ('provider_pending','provider_completed','provider_failed','safety_refused','outcome_unknown'))
      or (old.status='provider_pending' and new.status in
        ('provider_completed','provider_failed','safety_refused','outcome_unknown'))
      or (old.status='outcome_unknown' and old.provider_request_id is not null
        and new.status in ('provider_completed','provider_failed','safety_refused'))
      or (old.status='provider_completed' and new.status='ready')) then
      raise exception 'Invalid video job transition: % to %',old.status,new.status;
    end if;
    new.updated_at:=clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function private.guard_design_video_unsettled_request()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.organization_id::text || ':' || new.requested_by::text || ':' ||
      coalesce(new.direction_version_id::text,'private:'||new.private_conversation_id::text), 0));

  if exists (
    select 1 from private.design_video_generation_jobs prior
      where prior.organization_id = new.organization_id
        and prior.requested_by = new.requested_by
        and prior.direction_version_id is not distinct from new.direction_version_id and prior.private_conversation_id is not distinct from new.private_conversation_id
        and prior.operation_key <> new.operation_key
        and prior.status in ('queued', 'claimed', 'provider_pending',
          'provider_completed', 'outcome_unknown')
  ) then
    raise exception 'An earlier video request for this direction must be resolved before another is submitted'
      using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function public.get_design_video_job(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  job private.design_video_generation_jobs;
begin
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active'
      and member.member_kind='team';
  if not found then
    raise exception 'Current team membership is required' using errcode='42501';
  end if;
  select * into job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id
      and requested_by=p_actor_id;
  if not found then
    raise exception 'Actor-owned video job is unavailable' using errcode='42501';
  end if;
  return jsonb_build_object(
    'id',job.id,'organization_id',job.organization_id,
    'direction_version_id',job.direction_version_id,'private_conversation_id',job.private_conversation_id,
    'requested_by',job.requested_by,
    'connector_connection_id',job.connector_connection_id,
    'quote_id',job.quote_id,'request_checksum',job.request_checksum,
    'prompt',job.prompt,'mode',job.mode,
    'duration_seconds',job.duration_seconds,'resolution',job.resolution,
    'aspect_ratio',job.aspect_ratio,'output_format',job.output_format,
    'generate_audio',job.generate_audio,'status',job.status,
    'dispatch_claim_id',job.dispatch_claim_id,
    'provider_request_id',job.provider_request_id,
    'provider_status_url',job.provider_status_url,
    'provider_output_url',job.provider_output_url,
    'output_storage_path',job.output_storage_path,
    'failure_reason',job.failure_reason,'created_at',job.created_at,
    'updated_at',job.updated_at);
end;
$$;

create or replace function public.complete_design_video_storage(
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
    or job.status not in ('provider_completed','ready')
    or job.provider_request_id is null then
    raise exception 'Completed actor-owned video receipt is required' using errcode='42501';
  end if;
  expected_path:=private.design_video_storage_path(job);
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
  if job.status='ready' then
    if job.output_storage_path is distinct from p_storage_path
      or job.output_sha256 is distinct from p_sha256
      or job.output_byte_length is distinct from p_byte_length
      or job.output_mime_type is distinct from p_mime_type then
      raise exception 'Video output receipt cannot change' using errcode='23505';
    end if;
    return jsonb_build_object('job_id',p_job_id,'status','ready',
      'storage_path',p_storage_path,'idempotent_replay',true);
  end if;
  update private.design_video_generation_jobs
    set status='ready',output_storage_path=p_storage_path,
      output_sha256=p_sha256,output_byte_length=p_byte_length,
      output_mime_type=p_mime_type,completed_at=clock_timestamp()
    where id=p_job_id and organization_id=p_organization_id;
  return jsonb_build_object('job_id',p_job_id,'status','ready',
    'storage_path',p_storage_path,'idempotent_replay',false);
end;
$$;

create or replace function public.prepare_design_video_promotion(
  p_organization_id uuid,p_actor_id uuid,p_job_id uuid,p_engagement_id uuid,
  p_service_id uuid,p_operation_key uuid,p_expected_checksum text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  job private.design_video_generation_jobs;
  receipt private.design_video_promotions;
  target public.engagements;
  source_content jsonb;
  source_name text;
  source_rights text;
  fingerprint text;
begin
  -- Reuse current owner/membership gate before both initial and replay paths.
  perform public.get_design_video_job(p_organization_id,p_job_id,p_actor_id);
  select * into strict job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id and requested_by=p_actor_id;
  if job.status <> 'ready' or job.output_sha256 is null or job.output_byte_length is null
    or job.output_mime_type is distinct from (case job.output_format when 'mp4' then 'video/mp4' else 'video/quicktime' end)
    or job.output_storage_path is distinct from private.design_video_storage_path(job) then
    raise exception 'Exact ready private video required' using errcode='42501';
  end if;
  select * into target from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
  if not found or not exists (select 1 from public.engagement_services service
    join public.service_catalog catalog on catalog.id=service.service_id
    where service.id=p_service_id and service.organization_id=p_organization_id
      and service.engagement_id=p_engagement_id and service.status='active'
      and catalog.department_id='design' and catalog.is_active) then
    raise exception 'Active target Design context required' using errcode='42501';
  end if;
  if job.private_conversation_id is not null then
    source_content:=jsonb_build_object('title','Private video','rights_notes','');
  else
  select brief_version.content into source_content from public.design_direction_versions direction
    join public.design_creative_brief_versions brief_version on brief_version.id=direction.creative_brief_version_id
      and brief_version.organization_id=direction.organization_id
    where direction.id=job.direction_version_id and direction.organization_id=p_organization_id;
  if not found then raise exception 'Exact source brief is unavailable' using errcode='42501'; end if;
  end if;
  source_name:=left(coalesce(nullif(trim(source_content->>'title'),''),'Saved video'),180);
  source_rights:=coalesce(source_content->>'rights_notes','');
  -- Never silently truncate or infer licensing terms.
  if length(source_rights)>2000 then raise exception 'Source rights notes exceed canonical asset limit' using errcode='22023'; end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('job',job.id,'sha256',job.output_sha256,
    'bytes',job.output_byte_length,'mime',job.output_mime_type,'direction',job.direction_version_id,'private_conversation',job.private_conversation_id,'source_prompt',job.prompt,
    'engagement',target.id,'brand',target.brand_id,'service',p_service_id,'name',source_name,'rights',source_rights)::text,'sha256'),'hex');
  if p_operation_key is not null then
    if p_expected_checksum is distinct from fingerprint then raise exception 'Promotion preview changed' using errcode='40001'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'design-video-promotion:'||p_organization_id::text||':'||p_actor_id::text||':'||p_operation_key::text,0));
    select * into receipt from private.design_video_promotions where organization_id=p_organization_id
      and actor_id=p_actor_id and operation_key=p_operation_key;
    if found then
      if receipt.request_checksum is distinct from fingerprint or receipt.source_job_id<>p_job_id
        or receipt.target_engagement_id<>p_engagement_id or receipt.target_service_id<>p_service_id then
        raise exception 'Operation key already used for another promotion' using errcode='23505';
      end if;
    else
      insert into private.design_video_promotions(organization_id,actor_id,operation_key,source_job_id,
        target_engagement_id,target_service_id,brand_id,request_checksum,name,rights_notes)
      values(p_organization_id,p_actor_id,p_operation_key,p_job_id,p_engagement_id,p_service_id,
        target.brand_id,fingerprint,source_name,source_rights) returning * into receipt;
    end if;
  end if;
  return jsonb_build_object('job_id',job.id,'direction_version_id',job.direction_version_id,'private_conversation_id',job.private_conversation_id,
    'target_engagement_id',target.id,'target_service_id',p_service_id,'brand_id',target.brand_id,
    'name',source_name,'rights_notes',source_rights,'checksum',fingerprint,
    'source_path',job.output_storage_path,'sha256',job.output_sha256,'byte_length',job.output_byte_length,
    'mime_type',job.output_mime_type,'format',job.output_format,
    'asset_id',receipt.asset_id,'version_id',receipt.version_id);
end;
$$;

revoke all on function public.get_private_design_video_quote(uuid,uuid,uuid,integer,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_private_design_video_quote(uuid,uuid,uuid,integer,text,text,text,boolean) to service_role;

revoke all on function public.create_private_design_video_job(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.create_private_design_video_job(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text,text,boolean) to service_role;

revoke all on function public.list_private_design_video_jobs(uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_private_design_video_jobs(uuid,uuid,uuid,timestamptz,uuid) to service_role;

commit;
