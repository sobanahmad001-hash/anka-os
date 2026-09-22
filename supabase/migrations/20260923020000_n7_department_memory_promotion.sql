-- N7 department learning is deliberate, sanitized and independently reviewed.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table public.ai_department_memory (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  department_id text not null references public.departments(id) on delete restrict,
  source_project_memory_id uuid not null,
  generalized_statement text not null check(length(trim(generalized_statement)) between 1 and 1000),
  sanitization_note text not null check(length(trim(sanitization_note)) between 20 and 1000),
  status text not null default 'candidate' check(status in ('candidate','confirmed','rejected','retired')),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default clock_timestamp(),
  candidate_expires_at timestamptz not null default (clock_timestamp()+interval '30 days'),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_evidence text check(review_evidence is null or length(trim(review_evidence)) between 1 and 1000),
  check ((status='candidate' and reviewed_by is null and reviewed_at is null and review_evidence is null)
    or (status<>'candidate' and reviewed_by is not null and reviewed_at is not null and review_evidence is not null))
);
create index ai_department_memory_current on public.ai_department_memory
  (organization_id,department_id,reviewed_at desc,id desc) where status='confirmed';
create index ai_department_memory_candidates on public.ai_department_memory
  (organization_id,department_id,proposed_at desc,id desc) where status='candidate';
alter table public.ai_department_memory enable row level security;
revoke all on public.ai_department_memory from public,anon,authenticated,service_role;

create table private.ai_department_memory_decisions (
  id uuid primary key,
  memory_id uuid not null references public.ai_department_memory(id) on delete restrict,
  decision text not null check(decision in ('confirm','reject','retire')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  evidence text not null check(length(trim(evidence)) between 1 and 1000),
  decided_at timestamptz not null default clock_timestamp(),
  unique(memory_id,decision)
);
alter table private.ai_department_memory_decisions enable row level security;
revoke all on private.ai_department_memory_decisions from public,anon,authenticated,service_role;
create function private.n7_department_actor(p_org uuid,p_department text,p_actor uuid)
returns text language plpgsql security definer set search_path='' as $$
declare actor_role text;
begin
  perform 1 from public.organizations where id=p_org and status='active' for share;
  if not found then raise exception 'Active organization required.' using errcode='42501'; end if;
  select role into actor_role from public.organization_memberships
    where organization_id=p_org and user_id=p_actor and member_kind='team' and status='active'
      and (department_id=p_department or role in ('system_owner','operations_admin','executive')) for share;
  if not found then raise exception 'Active department member required.' using errcode='42501'; end if;
  return actor_role;
end; $$;
revoke all on function private.n7_department_actor(uuid,text,uuid)
  from public,anon,authenticated,service_role;

create function public.propose_department_ai_memory(
  p_organization_id uuid,p_project_id uuid,p_department_id text,p_request_id uuid,
  p_source_project_memory_id uuid,p_statement text,p_sanitization_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); source public.ai_project_memory; prior public.ai_department_memory;
  lesson text:=trim(coalesce(p_statement,'')); note text:=trim(coalesce(p_sanitization_note,''));
begin
  if actor is null or p_request_id is null or p_source_project_memory_id is null
    or length(lesson) not between 1 and 1000 or length(note) not between 20 and 1000 then
    raise exception 'Exact source and sanitization explanation required.' using errcode='22023'; end if;
  perform private.n1c_require_scope(p_organization_id,p_project_id,actor);
  perform private.n7_department_actor(p_organization_id,p_department_id,actor);
  perform 1 from public.project_department_participation where organization_id=p_organization_id
    and project_id=p_project_id and department_id=p_department_id and status='active' for share;
  if not found then raise exception 'Department is not active on source project.' using errcode='42501'; end if;
  select * into source from public.ai_project_memory where id=p_source_project_memory_id
    and organization_id=p_organization_id and project_id=p_project_id and status='confirmed' for share;
  if not found then raise exception 'Confirmed source project lesson required.' using errcode='42501'; end if;
  perform 1 from public.comments c where c.id=source.source_comment_id
    and c.organization_id=p_organization_id and c.project_id=p_project_id
    and c.entity_type='project' and c.entity_id=p_project_id and c.visibility='internal_only'
    and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=source.source_sha256 for share;
  if not found then raise exception 'Live unchanged source required.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n7-dept:'||p_request_id::text,0));
  select * into prior from public.ai_department_memory where id=p_request_id;
  if found then
    if prior.organization_id<>p_organization_id or prior.department_id<>p_department_id
      or prior.source_project_memory_id<>p_source_project_memory_id
      or prior.generalized_statement<>lesson or prior.sanitization_note<>note
      or prior.proposed_by<>actor then
      raise exception 'Department lesson request already used for another scope.' using errcode='23505'; end if;
    return jsonb_build_object('memory_id',prior.id,'status',prior.status,'idempotent_replay',true);
  end if;
  insert into public.ai_department_memory(id,organization_id,department_id,
    source_project_memory_id,generalized_statement,sanitization_note,proposed_by)
    values(p_request_id,p_organization_id,p_department_id,p_source_project_memory_id,
      lesson,note,actor);
  return jsonb_build_object('memory_id',p_request_id,'status','candidate','idempotent_replay',false);
end; $$;

create function public.review_department_ai_memory(
  p_organization_id uuid,p_department_id text,p_memory_id uuid,p_request_id uuid,
  p_decision text,p_evidence text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; lesson public.ai_department_memory;
  source public.ai_project_memory; prior private.ai_department_memory_decisions;
  evidence text:=trim(coalesce(p_evidence,''));
begin
  if actor is null or p_memory_id is null or p_request_id is null
    or p_decision is null or p_decision not in ('confirm','reject','retire')
    or length(evidence) not between 1 and 1000 then
    raise exception 'Exact department review required.' using errcode='22023'; end if;
  actor_role:=private.n7_department_actor(p_organization_id,p_department_id,actor);
  if actor_role not in ('system_owner','operations_admin','executive','department_manager') then
    raise exception 'Department review authority required.' using errcode='42501'; end if;
  select * into lesson from public.ai_department_memory where id=p_memory_id
    and organization_id=p_organization_id and department_id=p_department_id for update;
  if not found then raise exception 'Scoped department lesson unavailable.' using errcode='P0002'; end if;
  select * into prior from private.ai_department_memory_decisions where id=p_request_id;
  if found then
    if prior.memory_id<>p_memory_id or prior.decision<>p_decision
      or prior.actor_id<>actor or prior.evidence<>evidence then
      raise exception 'Review request already belongs to another decision.' using errcode='23505'; end if;
    return jsonb_build_object('memory_id',lesson.id,
      'status',case prior.decision when 'confirm' then 'confirmed'
        when 'reject' then 'rejected' else 'retired' end,'idempotent_replay',true);
  end if;
  if exists (select 1 from private.ai_department_memory_decisions
      where memory_id=p_memory_id and decision=p_decision) then
    raise exception 'Department memory already has this decision.' using errcode='23505'; end if;
  if p_decision='retire' then
    if lesson.status<>'confirmed' then raise exception 'Only current memory can retire.' using errcode='55000'; end if;
  elsif lesson.status<>'candidate' or lesson.candidate_expires_at<=clock_timestamp()
    or lesson.proposed_by=actor then
    raise exception 'Fresh candidate requires an independent reviewer.' using errcode='55000';
  end if;
  if p_decision='confirm' then
    select * into source from public.ai_project_memory where id=lesson.source_project_memory_id
      and organization_id=p_organization_id and status='confirmed' for share;
    if not found then raise exception 'Confirmed source lesson no longer available.' using errcode='55000'; end if;
    perform 1 from public.projects p where p.id=source.project_id
      and p.organization_id=p_organization_id and p.archived_at is null for share;
    if not found then raise exception 'Source project is no longer active.' using errcode='55000'; end if;
    perform 1 from public.project_department_participation where organization_id=p_organization_id
      and project_id=source.project_id and department_id=p_department_id and status='active' for share;
    if not found then raise exception 'Source department participation changed.' using errcode='55000'; end if;
    perform 1 from public.comments c where c.id=source.source_comment_id
      and c.organization_id=source.organization_id and c.project_id=source.project_id
      and c.entity_type='project' and c.entity_id=source.project_id and c.visibility='internal_only'
      and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=source.source_sha256 for share;
    if not found then raise exception 'Source changed or was revoked.' using errcode='55000'; end if;
  end if;
  update public.ai_department_memory set status=case p_decision when 'confirm' then 'confirmed'
      when 'reject' then 'rejected' else 'retired' end,
    reviewed_by=actor,reviewed_at=clock_timestamp(),review_evidence=evidence
    where id=lesson.id;
  insert into private.ai_department_memory_decisions(id,memory_id,decision,actor_id,evidence)
    values(p_request_id,p_memory_id,p_decision,actor,evidence);
  return jsonb_build_object('memory_id',lesson.id,
    'status',case p_decision when 'confirm' then 'confirmed'
      when 'reject' then 'rejected' else 'retired' end,'idempotent_replay',false);
end; $$;

create function public.get_department_ai_memory(p_organization_id uuid,p_department_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; confirmed jsonb; candidates jsonb;
begin
  actor_role:=private.n7_department_actor(p_organization_id,p_department_id,actor);
  with current_lessons as (
    select m.id,m.generalized_statement,m.source_project_memory_id,
      s.project_id,s.source_comment_id,m.reviewed_at,m.reviewed_by
    from public.ai_department_memory m
    join public.ai_project_memory s on s.id=m.source_project_memory_id
      and s.organization_id=m.organization_id and s.status='confirmed'
    join public.projects p on p.id=s.project_id and p.organization_id=m.organization_id
      and p.archived_at is null
    join public.comments c on c.id=s.source_comment_id and c.organization_id=s.organization_id
      and c.project_id=s.project_id and c.entity_type='project' and c.entity_id=s.project_id
      and c.visibility='internal_only'
    where m.organization_id=p_organization_id and m.department_id=p_department_id
      and m.status='confirmed'
      and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=s.source_sha256
    order by m.reviewed_at desc,m.id desc limit 50
  ) select coalesce(jsonb_agg(to_jsonb(current_lessons)),'[]'::jsonb)
      into confirmed from current_lessons;
  if actor_role in ('system_owner','operations_admin','executive','department_manager') then
    with pending as (
      select m.id,m.generalized_statement,m.sanitization_note,m.source_project_memory_id,
        s.project_id,s.source_comment_id,m.proposed_at,m.proposed_by
      from public.ai_department_memory m
      join public.ai_project_memory s on s.id=m.source_project_memory_id
        and s.organization_id=m.organization_id and s.status='confirmed'
      join public.projects p on p.id=s.project_id and p.organization_id=m.organization_id
        and p.archived_at is null
      join public.comments c on c.id=s.source_comment_id and c.organization_id=s.organization_id
        and c.project_id=s.project_id and c.entity_type='project' and c.entity_id=s.project_id
        and c.visibility='internal_only'
      where m.organization_id=p_organization_id and m.department_id=p_department_id
        and m.status='candidate' and m.candidate_expires_at>clock_timestamp()
        and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=s.source_sha256
      order by m.proposed_at desc,m.id desc limit 50
    ) select coalesce(jsonb_agg(to_jsonb(pending)),'[]'::jsonb) into candidates from pending;
  else candidates:='[]'::jsonb; end if;
  return jsonb_build_object('organization_id',p_organization_id,
    'department_id',p_department_id,'confirmed',confirmed,'candidates',candidates);
end; $$;
revoke all on function public.propose_department_ai_memory(uuid,uuid,text,uuid,uuid,text,text),
  public.review_department_ai_memory(uuid,text,uuid,uuid,text,text),
  public.get_department_ai_memory(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.propose_department_ai_memory(uuid,uuid,text,uuid,uuid,text,text),
  public.review_department_ai_memory(uuid,text,uuid,uuid,text,text),
  public.get_department_ai_memory(uuid,text) to authenticated;
commit;
