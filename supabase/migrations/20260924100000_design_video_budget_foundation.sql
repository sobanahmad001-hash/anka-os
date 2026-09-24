-- No price row, organization cap, connector, or dispatch permission is seeded.
-- Video reservations share the existing monthly organization budget lock/ledger.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check check (provider in (
    'github','figma','wordpress','openai','google_analytics',
    'google_search_console','google_ads','meta','anthropic','google_gemini',
    'higgsfield'));
alter table public.integration_events
  drop constraint if exists integration_events_provider_check;
alter table public.integration_events
  add constraint integration_events_provider_check check (provider in (
    'github','figma','wordpress','openai','google_analytics',
    'google_search_console','google_ads','meta','anthropic','google_gemini',
    'higgsfield'));
alter table public.integration_connections
  drop constraint if exists integration_connections_secret_name_check;
alter table public.integration_connections
  add constraint integration_connections_secret_name_check check (
    secret_name is null or (
      secret_name ~ '^ANKA_[A-Z0-9_]+$'
      and ((provider='github' and starts_with(secret_name,'ANKA_GITHUB_'))
        or (provider='figma' and starts_with(secret_name,'ANKA_FIGMA_'))
        or (provider='wordpress' and starts_with(secret_name,'ANKA_WORDPRESS_'))
        or (provider='openai' and starts_with(secret_name,'ANKA_OPENAI_'))
        or (provider='anthropic' and starts_with(secret_name,'ANKA_ANTHROPIC_'))
        or (provider='google_gemini' and starts_with(secret_name,'ANKA_GEMINI_'))
        or (provider='higgsfield' and starts_with(secret_name,'ANKA_HIGGSFIELD_')))));

create table private.design_video_price_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null check (provider = 'higgsfield'),
  model_id text not null check (model_id = 'bytedance/seedance-2.5/text-to-video'),
  duration_seconds integer not null check (duration_seconds between 4 and 30),
  resolution text not null check (resolution in ('480p','720p')),
  aspect_ratio text not null check (aspect_ratio in ('16:9','4:3','1:1','3:4','9:16','21:9')),
  output_format text not null check (output_format in ('mp4','mov')),
  generate_audio boolean not null,
  currency text not null default 'USD' check (currency = 'USD'),
  max_charge_microusd bigint not null check (max_charge_microusd between 1 and 2000000),
  source_url text not null check (source_url like
    'https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video%'),
  verified_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  check (valid_until > verified_at and valid_until <= verified_at + interval '24 hours')
);
alter table private.design_video_price_quotes enable row level security;
revoke all on private.design_video_price_quotes from public, anon, authenticated, service_role;
create function private.guard_design_video_price_quote()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'Verified video price rows are immutable';
end;
$$;
create trigger guard_design_video_price_quote
before update or delete on private.design_video_price_quotes
for each row execute function private.guard_design_video_price_quote();

create table private.design_video_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  direction_version_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  connector_connection_id uuid not null,
  operation_key text not null check (length(operation_key) between 8 and 200),
  request_checksum text not null check (request_checksum ~ '^[0-9a-f]{64}$'),
  prompt text not null check (length(btrim(prompt)) between 1 and 12000),
  mode text not null check (mode in ('explore','production')),
  duration_seconds integer not null check (duration_seconds between 4 and 30),
  resolution text not null check (resolution in ('480p','720p')),
  aspect_ratio text not null check (aspect_ratio in ('16:9','4:3','1:1','3:4','9:16','21:9')),
  output_format text not null check (output_format in ('mp4','mov')),
  generate_audio boolean not null,
  quote_id uuid not null,
  status text not null default 'queued' check (status in
    ('queued','claimed','provider_pending','provider_completed','ready',
     'provider_failed','safety_refused','outcome_unknown')),
  dispatch_claim_id uuid unique,
  dispatch_request_id uuid unique,
  provider_request_id text unique check (
    provider_request_id is null or provider_request_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  output_storage_path text,
  failure_reason text check (failure_reason is null or length(failure_reason) <= 1000),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  unique (organization_id, requested_by, operation_key),
  foreign key (direction_version_id, organization_id)
    references public.design_direction_versions(id, organization_id) on delete restrict,
  foreign key (connector_connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete restrict,
  foreign key (quote_id, organization_id)
    references private.design_video_price_quotes(id, organization_id) on delete restrict,
  check (mode <> 'explore' or duration_seconds <= 5),
  check (mode <> 'production' or resolution = '720p'),
  check ((status = 'queued' and dispatch_claim_id is null and dispatch_request_id is null
      and claimed_at is null
      and provider_request_id is null and completed_at is null)
    or (status <> 'queued' and dispatch_claim_id is not null
      and dispatch_request_id is not null and claimed_at is not null)),
  check (status <> 'ready' or
    (output_storage_path is not null and provider_request_id is not null and completed_at is not null)),
  check (output_storage_path is null or
    output_storage_path like organization_id::text || '/' || direction_version_id::text || '/%')
);
create index design_video_generation_jobs_scope
  on private.design_video_generation_jobs(organization_id,direction_version_id,created_at desc);
alter table private.design_video_generation_jobs enable row level security;
revoke all on private.design_video_generation_jobs from public, anon, authenticated, service_role;
create function private.guard_design_video_job()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    raise exception 'Video job history cannot be deleted';
  end if;
  if tg_op='UPDATE' then
    if (new.organization_id,new.direction_version_id,new.requested_by,
      new.connector_connection_id,new.operation_key,new.request_checksum,new.prompt,new.mode,
      new.duration_seconds,new.resolution,new.aspect_ratio,new.output_format,
      new.generate_audio,new.quote_id,new.created_at)
      is distinct from
      (old.organization_id,old.direction_version_id,old.requested_by,
      old.connector_connection_id,old.operation_key,old.request_checksum,old.prompt,old.mode,
      old.duration_seconds,old.resolution,old.aspect_ratio,old.output_format,
      old.generate_audio,old.quote_id,old.created_at)
      or (old.dispatch_claim_id is not null and new.dispatch_claim_id is distinct from old.dispatch_claim_id)
      or (old.dispatch_request_id is not null and new.dispatch_request_id is distinct from old.dispatch_request_id)
      or (old.provider_request_id is not null and new.provider_request_id is distinct from old.provider_request_id)
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
create trigger guard_design_video_job
before update or delete on private.design_video_generation_jobs
for each row execute function private.guard_design_video_job();

-- The legacy reservation table is already counted by all current paid paths.
-- Its retired pipeline reserve entry point remains revoked.
alter table private.ai_execution_budget_reservations
  alter column run_plan_id drop not null,
  add column design_video_job_id uuid unique
    references private.design_video_generation_jobs(id) on delete restrict,
  add constraint ai_execution_budget_reservations_one_source
    check ((run_plan_id is not null) <> (design_video_job_id is not null));

create function public.get_design_video_quote(
  p_organization_id uuid, p_direction_version_id uuid, p_actor_id uuid,
  p_duration_seconds integer, p_resolution text, p_aspect_ratio text,
  p_output_format text, p_generate_audio boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  quote private.design_video_price_quotes;
  cap_configured boolean;
begin
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    join public.design_direction_versions version
      on version.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active'
      and member.member_kind='team'
      and (member.role in ('system_owner','operations_admin','executive')
        or member.department_id='design')
      and version.id=p_direction_version_id;
  if not found then
    raise exception 'Current Design context is required' using errcode='42501';
  end if;
  select exists(select 1 from private.ai_execution_budget_limits budget
    where budget.organization_id=p_organization_id
      and budget.monthly_limit_microusd>0) into cap_configured;
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
revoke all on function public.get_design_video_quote(
  uuid,uuid,uuid,integer,text,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_design_video_quote(
  uuid,uuid,uuid,integer,text,text,text,boolean)
  to service_role;

create function public.create_design_video_job(
  p_organization_id uuid, p_direction_version_id uuid, p_actor_id uuid,
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
  if p_organization_id is null or p_direction_version_id is null
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
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    join public.design_direction_versions version on version.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active'
      and member.member_kind='team'
      and (member.role in ('system_owner','operations_admin','executive')
        or member.department_id='design')
      and version.id=p_direction_version_id;
  if not found then
    raise exception 'Current Design context is required' using errcode='42501';
  end if;
  perform 1 from private.ai_execution_budget_limits budget
    where budget.organization_id=p_organization_id
      and budget.monthly_limit_microusd>0;
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
    'organization_id',p_organization_id,'direction_version_id',p_direction_version_id,
    'actor_id',p_actor_id,'connector_connection_id',p_connector_connection_id,
    'quote_id',p_quote_id,'prompt',btrim(p_prompt),'mode',p_mode,
    'duration_seconds',p_duration_seconds,'resolution',p_resolution,
    'aspect_ratio',p_aspect_ratio,'output_format',p_output_format,
    'generate_audio',p_generate_audio)::text,'UTF8')),'hex');
  insert into private.design_video_generation_jobs(
    organization_id,direction_version_id,requested_by,connector_connection_id,
    operation_key,request_checksum,prompt,mode,duration_seconds,resolution,
    aspect_ratio,output_format,generate_audio,quote_id)
    values(p_organization_id,p_direction_version_id,p_actor_id,
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
revoke all on function public.create_design_video_job(
  uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.create_design_video_job(
  uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text,text,boolean)
  to service_role;

create function public.reserve_design_video_budget(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  budget private.ai_execution_budget_limits;
  job private.design_video_generation_jobs;
  quote private.design_video_price_quotes;
  connector public.integration_connections;
  existing private.ai_execution_budget_reservations;
  cycle date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  organization_total numeric;
  unlinked_total numeric;
  unmeasured_count bigint;
  new_id uuid;
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null then
    raise exception 'Exact video job and actor are required' using errcode='22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id=p_organization_id for update;
  if not found then
    raise exception 'Organization budget is not configured' using errcode='42501';
  end if;
  select * into job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id for update;
  if not found or job.requested_by<>p_actor_id or job.status<>'queued' then
    raise exception 'Current actor-owned queued video job is required' using errcode='42501';
  end if;
  select * into connector from public.integration_connections
    where id=job.connector_connection_id and organization_id=p_organization_id for share;
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
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active'
      and member.member_kind='team'
      and (member.role in ('system_owner','operations_admin','executive')
        or member.department_id='design');
  if not found then
    raise exception 'Current Design team authority is required' using errcode='42501';
  end if;
  select * into quote from private.design_video_price_quotes
    where id=job.quote_id and organization_id=p_organization_id for share;
  if not found or quote.verified_at>clock_timestamp()
    or quote.valid_until<=clock_timestamp()
    or quote.provider<>'higgsfield'
    or quote.model_id<>'bytedance/seedance-2.5/text-to-video'
    or quote.duration_seconds<>job.duration_seconds
    or quote.resolution<>job.resolution
    or quote.aspect_ratio<>job.aspect_ratio
    or quote.output_format<>job.output_format
    or quote.generate_audio<>job.generate_audio
    or quote.max_charge_microusd>2000000 then
    raise exception 'Fresh exact video price under $2 is required' using errcode='42501';
  end if;
  select * into existing from private.ai_execution_budget_reservations
    where design_video_job_id=p_job_id and organization_id=p_organization_id;
  if found then
    if existing.actor_id<>p_actor_id
      or existing.max_cost_microusd<>quote.max_charge_microusd then
      raise exception 'Video reservation changed' using errcode='23505';
    end if;
    return jsonb_build_object('reservation_id',existing.id,'status',existing.status,
      'max_cost_microusd',existing.max_cost_microusd,'idempotent_replay',true);
  end if;
  if exists (select 1 from private.ai_execution_budget_reservations r
      where r.organization_id=p_organization_id and r.cycle_month<>cycle
        and r.status in ('reserved','uncertain'))
    or exists (select 1 from private.ai_execution_step_budget_reservations r
      where r.organization_id=p_organization_id and r.cycle_month<>cycle
        and r.status in ('reserved','uncertain')) then
    raise exception 'Prior-cycle unresolved costs require reconciliation' using errcode='55000';
  end if;
  select coalesce(sum(case when r.status='settled'
    then r.actual_cost_microusd else r.max_cost_microusd end),0)
    into organization_total from private.ai_execution_budget_reservations r
    where r.organization_id=p_organization_id and r.cycle_month=cycle
      and r.status in ('reserved','uncertain','settled');
  select organization_total+coalesce(sum(case when r.status='settled'
    then r.actual_cost_microusd else r.max_cost_microusd end),0)
    into organization_total from private.ai_execution_step_budget_reservations r
    where r.organization_id=p_organization_id and r.cycle_month=cycle
      and r.status in ('reserved','uncertain','settled');
  select count(*) filter (where run.estimated_cost_microusd is null),
    coalesce(sum(run.estimated_cost_microusd),0)
    into unmeasured_count,unlinked_total from public.ai_runs run
    where run.organization_id=p_organization_id
      and run.created_at>=timezone('UTC',cycle::timestamp)
      and run.created_at<timezone('UTC',cycle::timestamp+interval '1 month')
      and run.status='completed'
      and not exists (select 1 from private.ai_execution_budget_reservations r
        where r.ai_run_id=run.id)
      and not exists (select 1 from private.ai_execution_step_budget_reservations r
        where r.ai_run_id=run.id);
  if unmeasured_count>0 then
    raise exception 'Unmeasured AI cost requires reconciliation' using errcode='55000';
  end if;
  if organization_total+unlinked_total+quote.max_charge_microusd
    >budget.monthly_limit_microusd then
    raise exception 'Video would exceed the organization monthly cap' using errcode='22003';
  end if;
  insert into private.ai_execution_budget_reservations(
    organization_id,run_plan_id,design_video_job_id,actor_id,cycle_month,
    max_cost_microusd,status)
  values(p_organization_id,null,p_job_id,p_actor_id,cycle,
    quote.max_charge_microusd,'reserved')
  returning id into new_id;
  insert into private.ai_execution_budget_events(reservation_id,organization_id,transition)
    values(new_id,p_organization_id,'reserved');
  return jsonb_build_object('reservation_id',new_id,'status','reserved',
    'max_cost_microusd',quote.max_charge_microusd,'idempotent_replay',false);
end;
$$;
revoke all on function public.reserve_design_video_budget(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.reserve_design_video_budget(uuid,uuid,uuid)
  to service_role;

create function public.claim_design_video_dispatch(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid,
  p_dispatch_request_id uuid, p_request_checksum text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  budget private.ai_execution_budget_limits;
  job private.design_video_generation_jobs;
  reservation private.ai_execution_budget_reservations;
  quote private.design_video_price_quotes;
  connector public.integration_connections;
  claim_id uuid;
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null
    or p_dispatch_request_id is null or p_request_checksum is null then
    raise exception 'Exact video dispatch identity is required' using errcode='22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id=p_organization_id for update;
  if not found then
    raise exception 'Organization budget is unavailable' using errcode='42501';
  end if;
  select * into job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id for update;
  if not found or job.requested_by<>p_actor_id
    or job.request_checksum<>p_request_checksum then
    raise exception 'Exact actor-owned video request is required' using errcode='42501';
  end if;
  if job.dispatch_claim_id is not null then
    return jsonb_build_object('status',job.status,'must_not_submit',true,
      'claim_id',job.dispatch_claim_id,'provider_request_id',job.provider_request_id);
  end if;
  perform 1 from public.organizations org
    join public.organization_memberships member on member.organization_id=org.id
    where org.id=p_organization_id and org.status='active'
      and member.user_id=p_actor_id and member.status='active'
      and member.member_kind='team'
      and (member.role in ('system_owner','operations_admin','executive')
        or member.department_id='design');
  if not found then
    raise exception 'Current Design team authority is required' using errcode='42501';
  end if;
  select * into connector from public.integration_connections
    where id=job.connector_connection_id and organization_id=p_organization_id for share;
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
    raise exception 'Verified pinned Design video connection is required' using errcode='42501';
  end if;
  select * into quote from private.design_video_price_quotes
    where id=job.quote_id and organization_id=p_organization_id for share;
  if not found or quote.valid_until<=clock_timestamp()
    or quote.verified_at>clock_timestamp()
    or quote.max_charge_microusd>2000000 then
    raise exception 'Current capped video quote is required' using errcode='42501';
  end if;
  select * into reservation from private.ai_execution_budget_reservations
    where design_video_job_id=p_job_id and organization_id=p_organization_id for update;
  if not found or reservation.status<>'reserved'
    or reservation.actor_id<>p_actor_id
    or reservation.max_cost_microusd<>quote.max_charge_microusd then
    raise exception 'Exact reserved video cost is required' using errcode='42501';
  end if;
  if job.status<>'queued' then
    raise exception 'Video job is no longer queued' using errcode='55000';
  end if;
  claim_id:=gen_random_uuid();
  update private.design_video_generation_jobs
    set status='claimed',dispatch_claim_id=claim_id,
      dispatch_request_id=p_dispatch_request_id,claimed_at=clock_timestamp()
    where id=p_job_id and organization_id=p_organization_id;
  return jsonb_build_object('status','claimed','must_not_submit',false,
    'claim_id',claim_id,'max_cost_microusd',reservation.max_cost_microusd);
end;
$$;
revoke all on function public.claim_design_video_dispatch(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_design_video_dispatch(uuid,uuid,uuid,uuid,text)
  to service_role;

create function public.record_design_video_provider_state(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid,
  p_claim_id uuid, p_state text, p_provider_request_id text,
  p_evidence text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  budget private.ai_execution_budget_limits;
  job private.design_video_generation_jobs;
  reservation private.ai_execution_budget_reservations;
  target text:=btrim(coalesce(p_state,''));
  evidence text:=btrim(coalesce(p_evidence,''));
  changed_reservation_id uuid;
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null
    or p_claim_id is null or target not in
      ('provider_pending','provider_completed','provider_failed',
       'safety_refused','outcome_unknown')
    or length(evidence) not between 1 and 1000
    or (p_provider_request_id is not null
      and p_provider_request_id !~ '^[A-Za-z0-9_-]{1,128}$')
    or (target<>'outcome_unknown' and p_provider_request_id is null) then
    raise exception 'Exact sanitized video provider result is required' using errcode='22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id=p_organization_id for update;
  if not found then raise exception 'Organization budget is unavailable' using errcode='42501'; end if;
  select * into job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id for update;
  if not found or job.requested_by<>p_actor_id
    or job.dispatch_claim_id<>p_claim_id then
    raise exception 'Exact claimed video job is required' using errcode='42501';
  end if;
  select * into reservation from private.ai_execution_budget_reservations
    where design_video_job_id=p_job_id and organization_id=p_organization_id for update;
  if not found or reservation.actor_id<>p_actor_id
    or reservation.status not in ('reserved','uncertain') then
    raise exception 'Original video reservation is required' using errcode='42501';
  end if;
  if job.status=target and job.provider_request_id is not distinct from p_provider_request_id then
    return jsonb_build_object('status',target,'idempotent_replay',true);
  end if;
  if job.provider_request_id is not null
    and job.provider_request_id is distinct from p_provider_request_id then
    raise exception 'Provider request identity cannot change' using errcode='23505';
  end if;
  update private.design_video_generation_jobs
    set status=target,provider_request_id=p_provider_request_id,
      completed_at=case when target in ('provider_failed','safety_refused')
        then clock_timestamp() else null end,
      failure_reason=case when target in ('provider_failed','safety_refused','outcome_unknown')
        then evidence else null end
    where id=p_job_id and organization_id=p_organization_id;
  if target not in ('provider_pending','provider_completed') then
    update private.ai_execution_budget_reservations
      set status='uncertain',outcome_evidence=evidence,reconciled_at=clock_timestamp()
      where id=reservation.id and status='reserved'
      returning id into changed_reservation_id;
    if changed_reservation_id is not null then
      insert into private.ai_execution_budget_events(
        reservation_id,organization_id,transition,evidence)
        values(changed_reservation_id,p_organization_id,'uncertain',evidence);
    end if;
  end if;
  return jsonb_build_object('status',target,'provider_request_id',p_provider_request_id,
    'idempotent_replay',false);
end;
$$;
revoke all on function public.record_design_video_provider_state(
  uuid,uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_design_video_provider_state(
  uuid,uuid,uuid,uuid,text,text,text)
  to service_role;

-- Billing evidence is reconciled separately from provider completion. Unknown
-- requests keep their immutable dispatch claim even after the cost is known.
create function public.reconcile_design_video_budget(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid,
  p_claim_id uuid, p_actual_cost_microusd bigint, p_evidence text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  budget private.ai_execution_budget_limits;
  job private.design_video_generation_jobs;
  reservation private.ai_execution_budget_reservations;
  evidence text:=btrim(coalesce(p_evidence,''));
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null
    or p_claim_id is null or p_actual_cost_microusd is null
    or p_actual_cost_microusd<0 or length(evidence) not between 1 and 1000 then
    raise exception 'Verified video billing evidence is required' using errcode='22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id=p_organization_id for update;
  if not found then raise exception 'Organization budget is unavailable' using errcode='42501'; end if;
  select * into job from private.design_video_generation_jobs
    where id=p_job_id and organization_id=p_organization_id for update;
  if not found or job.requested_by<>p_actor_id
    or job.dispatch_claim_id<>p_claim_id
    or job.status not in ('provider_completed','ready','provider_failed',
      'safety_refused','outcome_unknown') then
    raise exception 'Terminal claimed video evidence is required' using errcode='42501';
  end if;
  select * into reservation from private.ai_execution_budget_reservations
    where design_video_job_id=p_job_id and organization_id=p_organization_id for update;
  if not found or reservation.actor_id<>p_actor_id
    or p_actual_cost_microusd>reservation.max_cost_microusd then
    raise exception 'Cost exceeds the exact video reservation' using errcode='22003';
  end if;
  if reservation.status='settled' then
    if reservation.actual_cost_microusd<>p_actual_cost_microusd
      or reservation.outcome_evidence<>evidence then
      raise exception 'Conflicting video cost reconciliation' using errcode='23505';
    end if;
    return jsonb_build_object('status','settled','idempotent_replay',true);
  end if;
  if reservation.status not in ('reserved','uncertain') then
    raise exception 'Video cost is not reconcilable' using errcode='55000';
  end if;
  update private.ai_execution_budget_reservations
    set status='settled',actual_cost_microusd=p_actual_cost_microusd,
      outcome_evidence=evidence,reconciled_at=clock_timestamp()
    where id=reservation.id;
  insert into private.ai_execution_budget_events(
    reservation_id,organization_id,transition,actual_cost_microusd,evidence)
    values(reservation.id,p_organization_id,'settled',p_actual_cost_microusd,evidence);
  return jsonb_build_object('status','settled',
    'actual_cost_microusd',p_actual_cost_microusd,'idempotent_replay',false);
end;
$$;
revoke all on function public.reconcile_design_video_budget(
  uuid,uuid,uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_design_video_budget(
  uuid,uuid,uuid,uuid,bigint,text)
  to service_role;
commit;
