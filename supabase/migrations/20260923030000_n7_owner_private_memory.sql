-- N7 owner-private memory never promotes into shared scopes implicitly.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table public.ai_private_memory (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_kind text not null check(source_kind in ('owner_note','design_experiment')),
  source_note text check(source_note is null or length(trim(source_note)) between 1 and 2000),
  source_job_id uuid,
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  statement text not null check(length(trim(statement)) between 1 and 1000),
  status text not null default 'confirmed' check(status in ('confirmed','superseded','retired')),
  supersedes_id uuid references public.ai_private_memory(id) on delete restrict,
  superseded_by uuid references public.ai_private_memory(id) on delete restrict,
  saved_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check ((source_kind='owner_note' and source_note is not null and source_job_id is null)
    or (source_kind='design_experiment' and source_note is null and source_job_id is not null)),
  check (supersedes_id is distinct from id and superseded_by is distinct from id)
);
create index ai_private_memory_owner on public.ai_private_memory
  (organization_id,owner_id,saved_at desc,id desc);
alter table public.ai_private_memory enable row level security;
revoke all on public.ai_private_memory from public,anon,authenticated,service_role;
create table private.ai_private_memory_events (
  id uuid primary key,
  memory_id uuid not null references public.ai_private_memory(id) on delete restrict,
  event_type text not null check(event_type in ('retire')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check(length(trim(reason)) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  unique(memory_id,event_type)
);
alter table private.ai_private_memory_events enable row level security;
revoke all on private.ai_private_memory_events from public,anon,authenticated,service_role;

create function private.n7_private_owner(p_org uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.organizations o join public.organization_memberships m
    on m.organization_id=o.id where o.id=p_org and o.status='active'
      and m.user_id=p_actor and m.member_kind='team' and m.status='active' for share of o,m;
  if not found then raise exception 'Active private memory owner required.' using errcode='42501'; end if;
end; $$;
revoke all on function private.n7_private_owner(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.save_private_ai_memory(
  p_organization_id uuid,p_request_id uuid,p_source_kind text,
  p_source_note text,p_source_job_id uuid,p_statement text,p_supersedes_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); lesson text:=trim(coalesce(p_statement,''));
  source_note text:=trim(coalesce(p_source_note,'')); source_hash text;
  job public.design_private_experiment_jobs; prior public.ai_private_memory;
  previous public.ai_private_memory;
begin
  if actor is null or p_request_id is null or length(lesson) not between 1 and 1000
    or p_source_kind is null or p_source_kind not in ('owner_note','design_experiment') then
    raise exception 'Exact private source and statement required.' using errcode='22023'; end if;
  perform private.n7_private_owner(p_organization_id,actor);
  if p_source_kind='owner_note' then
    if p_source_job_id is not null or length(source_note) not between 1 and 2000 then
      raise exception 'Exact private note required.' using errcode='22023'; end if;
    source_hash:=encode(extensions.digest(convert_to(source_note,'UTF8'),'sha256'),'hex');
  else
    if p_source_job_id is null or source_note<>'' then
      raise exception 'Exact private experiment required.' using errcode='22023'; end if;
    select * into job from public.design_private_experiment_jobs
      where id=p_source_job_id and organization_id=p_organization_id
        and owner_id=actor and status='succeeded' for share;
    if not found then raise exception 'Completed owner-private experiment required.' using errcode='42501'; end if;
    source_hash:=encode(extensions.digest(convert_to(job.prompt,'UTF8'),'sha256'),'hex');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n7-private:'||p_request_id::text,0));
  select * into prior from public.ai_private_memory where id=p_request_id for update;
  if found then
    if prior.organization_id<>p_organization_id or prior.owner_id<>actor
      or prior.source_kind<>p_source_kind or prior.source_note is distinct from nullif(source_note,'')
      or prior.source_job_id is distinct from p_source_job_id
      or prior.source_sha256<>source_hash or prior.statement<>lesson
      or prior.supersedes_id is distinct from p_supersedes_id then
      raise exception 'Private memory request already belongs to another source.' using errcode='23505'; end if;
    return jsonb_build_object('memory_id',prior.id,'status',prior.status,'idempotent_replay',true);
  end if;
  if p_supersedes_id is not null then
    select * into previous from public.ai_private_memory where id=p_supersedes_id
      and organization_id=p_organization_id and owner_id=actor and status='confirmed' for update;
    if not found then raise exception 'Current owner-private memory required for correction.' using errcode='42501'; end if;
  end if;
  insert into public.ai_private_memory(id,organization_id,owner_id,source_kind,
    source_note,source_job_id,source_sha256,statement,supersedes_id)
    values(p_request_id,p_organization_id,actor,p_source_kind,
      nullif(source_note,''),p_source_job_id,source_hash,lesson,p_supersedes_id);
  if p_supersedes_id is not null then
    update public.ai_private_memory set status='superseded',superseded_by=p_request_id
      where id=p_supersedes_id;
  end if;
  return jsonb_build_object('memory_id',p_request_id,'status','confirmed','idempotent_replay',false);
end; $$;

create function public.retire_private_ai_memory(
  p_organization_id uuid,p_memory_id uuid,p_request_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); memory public.ai_private_memory;
  prior private.ai_private_memory_events; reason text:=trim(coalesce(p_reason,''));
begin
  if actor is null or p_memory_id is null or p_request_id is null
    or length(reason) not between 1 and 1000 then
    raise exception 'Exact private retirement required.' using errcode='22023'; end if;
  perform private.n7_private_owner(p_organization_id,actor);
  select * into memory from public.ai_private_memory where id=p_memory_id
    and organization_id=p_organization_id and owner_id=actor for update;
  if not found then raise exception 'Owner-private memory unavailable.' using errcode='P0002'; end if;
  select * into prior from private.ai_private_memory_events where id=p_request_id;
  if found then
    if prior.memory_id<>p_memory_id or prior.actor_id<>actor or prior.reason<>reason then
      raise exception 'Private retirement request already used.' using errcode='23505'; end if;
    return jsonb_build_object('memory_id',p_memory_id,'status','retired','idempotent_replay',true);
  end if;
  if memory.status<>'confirmed' then
    raise exception 'Only current private memory can retire.' using errcode='55000'; end if;
  update public.ai_private_memory set status='retired',retired_at=clock_timestamp()
    where id=p_memory_id;
  insert into private.ai_private_memory_events(id,memory_id,event_type,actor_id,reason)
    values(p_request_id,p_memory_id,'retire',actor,reason);
  return jsonb_build_object('memory_id',p_memory_id,'status','retired','idempotent_replay',false);
end; $$;

create function public.get_private_ai_memory(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); current_lessons jsonb; history jsonb;
begin
  perform private.n7_private_owner(p_organization_id,actor);
  with verified as (
    select m.id,m.statement,m.source_kind,m.source_note,m.source_job_id,m.source_sha256,
      m.saved_at,m.supersedes_id from public.ai_private_memory m
      left join public.design_private_experiment_jobs j on j.id=m.source_job_id
        and j.organization_id=m.organization_id and j.owner_id=m.owner_id
        and j.status='succeeded'
    where m.organization_id=p_organization_id and m.owner_id=actor and m.status='confirmed'
      and ((m.source_kind='owner_note'
        and encode(extensions.digest(convert_to(m.source_note,'UTF8'),'sha256'),'hex')=m.source_sha256)
        or (m.source_kind='design_experiment' and j.id is not null
          and encode(extensions.digest(convert_to(j.prompt,'UTF8'),'sha256'),'hex')=m.source_sha256))
    order by m.saved_at desc,m.id desc limit 50
  ) select coalesce(jsonb_agg(to_jsonb(verified)),'[]'::jsonb)
      into current_lessons from verified;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'statement',m.statement,
      'source_kind',m.source_kind,'source_note',m.source_note,'source_job_id',m.source_job_id,
      'status',m.status,'saved_at',m.saved_at,'supersedes_id',m.supersedes_id)
      order by m.saved_at desc,m.id desc),'[]'::jsonb)
    into history from public.ai_private_memory m
    where m.organization_id=p_organization_id and m.owner_id=actor;
  return jsonb_build_object('organization_id',p_organization_id,'owner_id',actor,
    'confirmed',current_lessons,'history',history);
end; $$;
create table private.ai_private_memory_purges (
  memory_id uuid primary key,
  purge_request_id uuid not null,
  organization_id uuid not null,
  owner_id uuid not null,
  source_sha256 text not null,
  prior_status text not null,
  purged_at timestamptz not null default clock_timestamp(),
  reason text not null check(length(trim(reason)) between 10 and 1000)
);
alter table private.ai_private_memory_purges enable row level security;
revoke all on private.ai_private_memory_purges from public,anon,authenticated,service_role;

create function public.preview_private_ai_memory_purge(p_organization_id uuid,p_memory_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); records jsonb;
begin
  perform private.n7_private_owner(p_organization_id,actor);
  if not exists (select 1 from public.ai_private_memory where id=p_memory_id
    and organization_id=p_organization_id and owner_id=actor) then
    raise exception 'Owner-private memory unavailable.' using errcode='P0002'; end if;
  with recursive lineage(id) as (
    select p_memory_id
    union
    select linked.id from lineage l
      join public.ai_private_memory current_memory on current_memory.id=l.id
      join public.ai_private_memory linked on linked.organization_id=p_organization_id
        and linked.owner_id=actor
        and (linked.id=current_memory.supersedes_id or linked.id=current_memory.superseded_by
          or linked.supersedes_id=l.id or linked.superseded_by=l.id)
  ) select jsonb_agg(jsonb_build_object('id',m.id,'status',m.status)
      order by m.saved_at,m.id) into records
    from public.ai_private_memory m join lineage l on l.id=m.id;
  return jsonb_build_object('organization_id',p_organization_id,'owner_id',actor,
    'memory_ids',coalesce((select jsonb_agg((value->>'id')::uuid order by value->>'id')
      from jsonb_array_elements(records) value),'[]'::jsonb),
    'records',coalesce(records,'[]'::jsonb));
end; $$;

create function public.purge_private_ai_memory(
  p_organization_id uuid,p_memory_id uuid,p_request_id uuid,
  p_expected_memory_ids uuid[],p_confirmation text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); preview jsonb; actual uuid[]; expected uuid[];
  purge_reason text:=trim(coalesce(p_reason,'')); prior_count int;
begin
  if actor is null or p_memory_id is null or p_request_id is null
    or p_confirmation is distinct from 'PURGE' or length(purge_reason) not between 10 and 1000
    or p_expected_memory_ids is null or cardinality(p_expected_memory_ids) not between 1 and 100 then
    raise exception 'Exact private purge preview, confirmation and reason required.' using errcode='22023'; end if;
  perform private.n7_private_owner(p_organization_id,actor);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'n7-private-purge:'||p_organization_id::text||':'||actor::text,0));
  select count(*) into prior_count from private.ai_private_memory_purges where purge_request_id=p_request_id;
  if prior_count>0 then
    select array_agg(memory_id order by memory_id) into actual
      from private.ai_private_memory_purges where purge_request_id=p_request_id
        and organization_id=p_organization_id and owner_id=actor and reason=purge_reason;
    select array_agg(distinct id order by id) into expected from unnest(p_expected_memory_ids) id;
    if actual is distinct from expected or not p_memory_id=any(actual) then
      raise exception 'Private purge request already used for another record set.' using errcode='23505'; end if;
    return jsonb_build_object('purged_memory_ids',to_jsonb(actual),'idempotent_replay',true);
  end if;
  preview:=public.preview_private_ai_memory_purge(p_organization_id,p_memory_id);
  select array_agg(value::uuid order by value::uuid) into actual
    from jsonb_array_elements_text(preview->'memory_ids') value;
  select array_agg(distinct id order by id) into expected from unnest(p_expected_memory_ids) id;
  if actual is distinct from expected or cardinality(actual)<>cardinality(p_expected_memory_ids) then
    raise exception 'Private memory lineage changed; preview again.' using errcode='40001'; end if;
  perform 1 from public.ai_private_memory where id=any(actual)
    and organization_id=p_organization_id and owner_id=actor for update;
  if (select count(*) from public.ai_private_memory where id=any(actual))<>cardinality(actual) then
    raise exception 'Private memory lineage changed; preview again.' using errcode='40001'; end if;
  insert into private.ai_private_memory_purges(memory_id,purge_request_id,
    organization_id,owner_id,source_sha256,prior_status,reason)
    select m.id,p_request_id,m.organization_id,m.owner_id,m.source_sha256,m.status,purge_reason
      from public.ai_private_memory m where m.id=any(actual);
  delete from private.ai_private_memory_events where memory_id=any(actual);
  update public.ai_private_memory set supersedes_id=null,superseded_by=null where id=any(actual);
  delete from public.ai_private_memory where id=any(actual);
  return jsonb_build_object('purged_memory_ids',to_jsonb(actual),'idempotent_replay',false);
end; $$;
revoke all on function public.save_private_ai_memory(uuid,uuid,text,text,uuid,text,uuid),
  public.retire_private_ai_memory(uuid,uuid,uuid,text),
  public.get_private_ai_memory(uuid),
  public.preview_private_ai_memory_purge(uuid,uuid),
  public.purge_private_ai_memory(uuid,uuid,uuid,uuid[],text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.save_private_ai_memory(uuid,uuid,text,text,uuid,text,uuid),
  public.retire_private_ai_memory(uuid,uuid,uuid,text),
  public.get_private_ai_memory(uuid),
  public.preview_private_ai_memory_purge(uuid,uuid),
  public.purge_private_ai_memory(uuid,uuid,uuid,uuid[],text,text) to authenticated;
commit;
