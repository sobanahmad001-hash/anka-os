-- N7 project memory: a discussion message proposes a lesson; a separate
-- project authority confirms it. Reads recheck source content and access.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.ai_project_memory (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  source_comment_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  statement text not null check (length(trim(statement)) between 1 and 1000),
  supersedes_id uuid references public.ai_project_memory(id) on delete restrict,
  status text not null default 'candidate'
    check (status in ('candidate','confirmed','rejected','superseded','retired')),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default clock_timestamp(),
  candidate_expires_at timestamptz not null default (clock_timestamp() + interval '30 days'),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  superseded_by uuid references public.ai_project_memory(id) on delete restrict,
  check (supersedes_id is distinct from id and superseded_by is distinct from id),
  check ((status = 'candidate' and reviewed_by is null and reviewed_at is null)
    or (status <> 'candidate' and reviewed_by is not null and reviewed_at is not null))
);
create index ai_project_memory_current on public.ai_project_memory
  (organization_id, project_id, reviewed_at desc, id desc)
  where status = 'confirmed';
create index ai_project_memory_candidates on public.ai_project_memory
  (organization_id, project_id, proposed_at desc, id desc)
  where status = 'candidate';
create unique index ai_project_memory_single_successor
  on public.ai_project_memory(supersedes_id) where supersedes_id is not null
    and status = 'confirmed';
alter table public.ai_project_memory enable row level security;
revoke all on public.ai_project_memory from public, anon, authenticated, service_role;

create table private.ai_project_memory_decisions (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  memory_id uuid not null references public.ai_project_memory(id) on delete restrict,
  decision text not null check (decision in ('confirm','reject','retire')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  evidence text not null check (length(trim(evidence)) between 1 and 1000),
  decided_at timestamptz not null default clock_timestamp(),
  unique (memory_id, decision)
);
create index ai_project_memory_decisions_scope
  on private.ai_project_memory_decisions(organization_id,project_id,memory_id);
alter table private.ai_project_memory_decisions enable row level security;
revoke all on private.ai_project_memory_decisions
  from public, anon, authenticated, service_role;

create function public.propose_project_ai_memory(
  p_organization_id uuid, p_project_id uuid, p_request_id uuid,
  p_source_comment_id uuid, p_statement text, p_supersedes_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  source public.comments;
  previous public.ai_project_memory;
  old_memory public.ai_project_memory;
  lesson text := trim(coalesce(p_statement,''));
  digest text;
begin
  if actor is null or p_request_id is null or p_source_comment_id is null
    or length(lesson) not between 1 and 1000 then
    raise exception 'Exact project lesson, source and request are required.' using errcode = '22023';
  end if;
  perform private.n1c_require_scope(p_organization_id,p_project_id,actor);
  select * into source from public.comments
    where id=p_source_comment_id and organization_id=p_organization_id
      and project_id=p_project_id and entity_type='project'
      and entity_id=p_project_id and visibility='internal_only' for share;
  if not found then raise exception 'Current same-project discussion source required.' using errcode='42501'; end if;
  digest := encode(extensions.digest(convert_to(source.content,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('n7-memory:'||p_request_id::text,0));
  select * into previous from public.ai_project_memory
    where id=p_request_id for update;
  if found then
    if previous.organization_id <> p_organization_id or previous.project_id <> p_project_id
      or previous.source_comment_id <> p_source_comment_id
      or previous.source_sha256 <> digest or previous.statement <> lesson
      or previous.supersedes_id is distinct from p_supersedes_id
      or previous.proposed_by <> actor then
      raise exception 'Memory request already belongs to another source or lesson.' using errcode='23505';
    end if;
    return jsonb_build_object('memory_id',previous.id,'status',previous.status,
      'idempotent_replay',true);
  end if;
  if p_supersedes_id is not null then
    select * into old_memory from public.ai_project_memory
      where id=p_supersedes_id and organization_id=p_organization_id
        and project_id=p_project_id and status='confirmed' for share;
    if not found then raise exception 'Only a confirmed same-project lesson can be revised.' using errcode='42501'; end if;
  end if;
  insert into public.ai_project_memory(
    id,organization_id,project_id,source_comment_id,source_sha256,
    statement,supersedes_id,proposed_by
  ) values (
    p_request_id,p_organization_id,p_project_id,p_source_comment_id,digest,
    lesson,p_supersedes_id,actor
  );
  return jsonb_build_object('memory_id',p_request_id,'status','candidate',
    'idempotent_replay',false);
end;
$$;

create function public.review_project_ai_memory(
  p_organization_id uuid, p_project_id uuid, p_memory_id uuid,
  p_request_id uuid, p_decision text, p_evidence text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  lesson public.ai_project_memory;
  source public.comments;
  prior private.ai_project_memory_decisions;
  old_memory public.ai_project_memory;
  evidence text := trim(coalesce(p_evidence,''));
begin
  if actor is null or p_memory_id is null or p_request_id is null
    or p_decision is null or p_decision not in ('confirm','reject','retire')
    or length(evidence) not between 1 and 1000 then
    raise exception 'Exact memory review and evidence required.' using errcode='22023';
  end if;
  perform private.n1c_require_scope(p_organization_id,p_project_id,actor);
  if not private.n1c_can_assign(p_organization_id,p_project_id,actor) then
    raise exception 'Current project management authority required.' using errcode='42501';
  end if;
  select * into lesson from public.ai_project_memory
    where id=p_memory_id and organization_id=p_organization_id
      and project_id=p_project_id for update;
  if not found then raise exception 'Scoped memory unavailable.' using errcode='P0002'; end if;
  select * into prior from private.ai_project_memory_decisions
    where id=p_request_id;
  if found then
    if prior.memory_id <> p_memory_id or prior.decision <> p_decision
      or prior.actor_id <> actor or prior.evidence <> evidence then
      raise exception 'Memory review request already belongs to another decision.' using errcode='23505';
    end if;
    return jsonb_build_object('memory_id',lesson.id,
      'status',case prior.decision when 'confirm' then 'confirmed'
        when 'reject' then 'rejected' else 'retired' end,
      'idempotent_replay',true);
  end if;
  if exists (select 1 from private.ai_project_memory_decisions
      where memory_id=p_memory_id and decision=p_decision) then
    raise exception 'Memory already has this decision under another request.' using errcode='23505';
  end if;
  if p_decision='retire' then
    if lesson.status <> 'confirmed' then
      raise exception 'Only current confirmed memory can be retired.' using errcode='55000';
    end if;
  elsif lesson.status <> 'candidate' or lesson.candidate_expires_at <= clock_timestamp()
    or lesson.proposed_by=actor then
    raise exception 'Fresh candidate requires an independent reviewer.' using errcode='55000';
  end if;
  if p_decision='confirm' then
    select * into source from public.comments where id=lesson.source_comment_id
      and organization_id=p_organization_id and project_id=p_project_id
      and entity_type='project' and entity_id=p_project_id
      and visibility='internal_only' for share;
    if not found or encode(extensions.digest(convert_to(source.content,'UTF8'),'sha256'),'hex')
        <> lesson.source_sha256 then
      raise exception 'Lesson source changed or is unavailable.' using errcode='55000';
    end if;
  end if;
  if p_decision='confirm' and lesson.supersedes_id is not null then
    select * into old_memory from public.ai_project_memory
      where id=lesson.supersedes_id and organization_id=p_organization_id
        and project_id=p_project_id and status='confirmed' for update;
    if not found then raise exception 'Preceding lesson changed; review again.' using errcode='40001'; end if;
    update public.ai_project_memory set status='superseded',superseded_by=lesson.id,
      reviewed_by=actor,reviewed_at=clock_timestamp()
      where id=old_memory.id;
  end if;
  update public.ai_project_memory set
    status=case p_decision when 'confirm' then 'confirmed'
      when 'reject' then 'rejected' else 'retired' end,
    reviewed_by=actor,reviewed_at=clock_timestamp()
    where id=lesson.id;
  insert into private.ai_project_memory_decisions(
    id,organization_id,project_id,memory_id,decision,actor_id,evidence
  ) values (p_request_id,p_organization_id,p_project_id,p_memory_id,p_decision,actor,evidence);
  return jsonb_build_object('memory_id',lesson.id,
    'status',case p_decision when 'confirm' then 'confirmed'
      when 'reject' then 'rejected' else 'retired' end,
    'idempotent_replay',false);
end;
$$;

create function public.get_project_ai_memory(
  p_organization_id uuid, p_project_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  confirmed jsonb;
  candidates jsonb;
  reviewer boolean;
begin
  perform private.n1c_require_scope(p_organization_id,p_project_id,actor);
  reviewer := private.n1c_can_assign(p_organization_id,p_project_id,actor);
  with current_lessons as (
    select m.id,m.statement,m.source_comment_id,m.source_sha256,m.proposed_by,
      m.proposed_at,m.reviewed_by,m.reviewed_at,m.supersedes_id
    from public.ai_project_memory m
    join public.comments c on c.id=m.source_comment_id
      and c.organization_id=m.organization_id and c.project_id=m.project_id
      and c.entity_type='project' and c.entity_id=m.project_id
      and c.visibility='internal_only'
    where m.organization_id=p_organization_id and m.project_id=p_project_id
      and m.status='confirmed'
      and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=m.source_sha256
    order by m.reviewed_at desc,m.id desc limit 50
  )
  select coalesce(jsonb_agg(to_jsonb(current_lessons)),'[]'::jsonb)
    into confirmed from current_lessons;
  if reviewer then
    with pending as (
      select m.id,m.statement,m.source_comment_id,m.source_sha256,m.proposed_by,
        m.proposed_at,m.supersedes_id
      from public.ai_project_memory m
      join public.comments c on c.id=m.source_comment_id
        and c.organization_id=m.organization_id and c.project_id=m.project_id
        and c.entity_type='project' and c.entity_id=m.project_id
        and c.visibility='internal_only'
      where m.organization_id=p_organization_id and m.project_id=p_project_id
        and m.status='candidate' and m.candidate_expires_at>clock_timestamp()
        and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=m.source_sha256
      order by m.proposed_at desc,m.id desc limit 50
    )
    select coalesce(jsonb_agg(to_jsonb(pending)),'[]'::jsonb)
      into candidates from pending;
  else candidates := '[]'::jsonb; end if;
  return jsonb_build_object('organization_id',p_organization_id,
    'project_id',p_project_id,'confirmed',confirmed,'candidates',candidates);
end;
$$;
revoke all on function public.propose_project_ai_memory(uuid,uuid,uuid,uuid,text,uuid),
  public.review_project_ai_memory(uuid,uuid,uuid,uuid,text,text),
  public.get_project_ai_memory(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.propose_project_ai_memory(uuid,uuid,uuid,uuid,text,uuid),
  public.review_project_ai_memory(uuid,uuid,uuid,uuid,text,text),
  public.get_project_ai_memory(uuid,uuid) to authenticated;
commit;
