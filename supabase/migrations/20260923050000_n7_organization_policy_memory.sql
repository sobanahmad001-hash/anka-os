-- N7 organization policy is a deliberately authored, independently approved
-- canonical draft. It is never inferred from project, department or private memory.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table public.ai_organization_policy_memory (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 statement text not null check(length(trim(statement)) between 1 and 1000),
 source_note text not null check(length(trim(source_note)) between 20 and 1000),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 supersedes_id uuid references public.ai_organization_policy_memory(id) on delete restrict,
 superseded_by uuid references public.ai_organization_policy_memory(id) on delete restrict,
 status text not null default 'candidate'
   check(status in ('candidate','confirmed','rejected','superseded','retired')),
 proposed_by uuid not null references auth.users(id) on delete restrict,
 proposed_at timestamptz not null default clock_timestamp(),
 candidate_expires_at timestamptz not null default (clock_timestamp()+interval '30 days'),
 reviewed_by uuid references auth.users(id) on delete restrict,
 reviewed_at timestamptz,
 review_evidence text check(review_evidence is null or length(trim(review_evidence)) between 1 and 1000),
 check(supersedes_id is distinct from id and superseded_by is distinct from id),
 check((status='candidate' and reviewed_by is null and reviewed_at is null and review_evidence is null)
   or (status<>'candidate' and reviewed_by is not null and reviewed_at is not null and review_evidence is not null))
);
create index ai_organization_policy_current on public.ai_organization_policy_memory
 (organization_id,reviewed_at desc,id desc) where status='confirmed';
create index ai_organization_policy_candidates on public.ai_organization_policy_memory
 (organization_id,proposed_at desc,id desc) where status='candidate';
create unique index ai_organization_policy_one_successor
 on public.ai_organization_policy_memory(supersedes_id)
 where supersedes_id is not null and status='confirmed';
alter table public.ai_organization_policy_memory enable row level security;
revoke all on public.ai_organization_policy_memory from public,anon,authenticated,service_role;
create table private.ai_organization_policy_decisions (
 id uuid primary key,
 policy_id uuid not null references public.ai_organization_policy_memory(id) on delete restrict,
 decision text not null check(decision in ('confirm','reject','retire')),
 actor_id uuid not null references auth.users(id) on delete restrict,
 evidence text not null check(length(trim(evidence)) between 1 and 1000),
 decided_at timestamptz not null default clock_timestamp(),
 unique(policy_id,decision)
);
alter table private.ai_organization_policy_decisions enable row level security;
revoke all on private.ai_organization_policy_decisions from public,anon,authenticated,service_role;

create function private.n7_organization_policy_actor(p_org uuid,p_actor uuid)
returns text language plpgsql security definer set search_path='' as $$
declare actor_role text;
begin
 perform 1 from public.organizations where id=p_org and status='active' for share;
 if not found then raise exception 'Active organization required.' using errcode='42501'; end if;
 select role into actor_role from public.organization_memberships where organization_id=p_org
   and user_id=p_actor and member_kind='team' and status='active' for share;
 if not found then raise exception 'Active team member required.' using errcode='42501'; end if;
 return actor_role;
end; $$;
revoke all on function private.n7_organization_policy_actor(uuid,uuid)
 from public,anon,authenticated,service_role;

create function public.propose_organization_ai_policy(
 p_organization_id uuid,p_request_id uuid,p_statement text,p_source_note text,
 p_supersedes_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); statement text:=trim(coalesce(p_statement,''));
 note text:=trim(coalesce(p_source_note,'')); digest text;
 prior public.ai_organization_policy_memory; old_policy public.ai_organization_policy_memory;
begin
 if actor is null or p_request_id is null
   or length(statement) not between 1 and 1000 or length(note) not between 20 and 1000 then
   raise exception 'Policy statement and source basis required.' using errcode='22023'; end if;
 perform private.n7_organization_policy_actor(p_organization_id,actor);
 digest:=encode(extensions.digest(convert_to(statement||chr(31)||note,'UTF8'),'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n7-org-policy:'||p_request_id::text,0));
 select * into prior from public.ai_organization_policy_memory where id=p_request_id;
 if found then
   if prior.organization_id<>p_organization_id or prior.statement<>statement
     or prior.source_note<>note or prior.source_sha256<>digest
     or prior.supersedes_id is distinct from p_supersedes_id or prior.proposed_by<>actor then
     raise exception 'Policy request ID already used for another draft.' using errcode='23505'; end if;
   return jsonb_build_object('policy_id',prior.id,'status',prior.status,'idempotent_replay',true);
 end if;
 if p_supersedes_id is not null then
   select * into old_policy from public.ai_organization_policy_memory
     where id=p_supersedes_id and organization_id=p_organization_id and status='confirmed' for share;
   if not found then raise exception 'Current organization policy required for correction.' using errcode='55000'; end if;
 end if;
 insert into public.ai_organization_policy_memory(id,organization_id,statement,source_note,
   source_sha256,supersedes_id,proposed_by)
 values(p_request_id,p_organization_id,statement,note,digest,p_supersedes_id,actor);
 return jsonb_build_object('policy_id',p_request_id,'status','candidate','idempotent_replay',false);
end; $$;

create function public.review_organization_ai_policy(
 p_organization_id uuid,p_policy_id uuid,p_request_id uuid,p_decision text,p_evidence text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; policy public.ai_organization_policy_memory;
 previous public.ai_organization_policy_memory; prior private.ai_organization_policy_decisions;
 evidence text:=trim(coalesce(p_evidence,''));
begin
 if actor is null or p_policy_id is null or p_request_id is null
   or p_decision is null or p_decision not in ('confirm','reject','retire')
   or length(evidence) not between 1 and 1000 then
   raise exception 'Exact policy decision and evidence required.' using errcode='22023'; end if;
 actor_role:=private.n7_organization_policy_actor(p_organization_id,actor);
 if actor_role not in ('system_owner','operations_admin') then
   raise exception 'Organization policy authority required.' using errcode='42501'; end if;
 select * into policy from public.ai_organization_policy_memory where id=p_policy_id
   and organization_id=p_organization_id for update;
 if not found then raise exception 'Scoped policy unavailable.' using errcode='P0002'; end if;
 select * into prior from private.ai_organization_policy_decisions where id=p_request_id;
 if found then
   if prior.policy_id<>p_policy_id or prior.decision<>p_decision
     or prior.actor_id<>actor or prior.evidence<>evidence then
     raise exception 'Review ID already used for another decision.' using errcode='23505'; end if;
   return jsonb_build_object('policy_id',policy.id,
     'status',case prior.decision when 'confirm' then 'confirmed'
       when 'reject' then 'rejected' else 'retired' end,'idempotent_replay',true);
 end if;
 if p_decision='retire' then
   if policy.status<>'confirmed' then raise exception 'Only current policy can retire.' using errcode='55000'; end if;
 elsif policy.status<>'candidate' or policy.candidate_expires_at<=clock_timestamp()
   or policy.proposed_by=actor then
   raise exception 'Fresh policy draft requires independent owner review.' using errcode='55000';
 end if;
 if p_decision='confirm' then
   if encode(extensions.digest(convert_to(policy.statement||chr(31)||policy.source_note,'UTF8'),'sha256'),'hex')
     <>policy.source_sha256 then
     raise exception 'Policy source changed.' using errcode='55000'; end if;
   if policy.supersedes_id is not null then
     select * into previous from public.ai_organization_policy_memory
       where id=policy.supersedes_id and organization_id=p_organization_id
         and status='confirmed' for update;
     if not found then raise exception 'Original policy is no longer current.' using errcode='55000'; end if;
     update public.ai_organization_policy_memory set status='superseded',
       superseded_by=policy.id where id=previous.id;
   end if;
 end if;
 update public.ai_organization_policy_memory
   set status=case p_decision when 'confirm' then 'confirmed'
     when 'reject' then 'rejected' else 'retired' end,
   reviewed_by=actor,reviewed_at=clock_timestamp(),review_evidence=evidence
   where id=policy.id;
 insert into private.ai_organization_policy_decisions(id,policy_id,decision,actor_id,evidence)
   values(p_request_id,p_policy_id,p_decision,actor,evidence);
 return jsonb_build_object('policy_id',policy.id,
   'status',case p_decision when 'confirm' then 'confirmed'
     when 'reject' then 'rejected' else 'retired' end,'idempotent_replay',false);
end; $$;

create function public.get_organization_ai_policy(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; confirmed jsonb; candidates jsonb; history jsonb;
begin
 actor_role:=private.n7_organization_policy_actor(p_organization_id,actor);
 with current_rows as (
   select id,statement,source_note,source_sha256,proposed_by,reviewed_by,
     reviewed_at,supersedes_id
   from public.ai_organization_policy_memory
   where organization_id=p_organization_id and status='confirmed'
     and encode(extensions.digest(convert_to(statement||chr(31)||source_note,'UTF8'),'sha256'),'hex')=source_sha256
   order by reviewed_at desc,id desc limit 50
 ) select coalesce(jsonb_agg(to_jsonb(current_rows)),'[]'::jsonb)
   into confirmed from current_rows;
 if actor_role in ('system_owner','operations_admin') then
   with pending as (
     select id,statement,source_note,proposed_by,proposed_at,supersedes_id
     from public.ai_organization_policy_memory where organization_id=p_organization_id
       and status='candidate' and candidate_expires_at>clock_timestamp()
       and encode(extensions.digest(convert_to(statement||chr(31)||source_note,'UTF8'),'sha256'),'hex')=source_sha256
     order by proposed_at desc,id desc limit 50
   ) select coalesce(jsonb_agg(to_jsonb(pending)),'[]'::jsonb) into candidates from pending;
   with past as (
     select id,statement,source_note,status,supersedes_id,superseded_by,reviewed_at
     from public.ai_organization_policy_memory where organization_id=p_organization_id
       and status in ('superseded','rejected','retired')
     order by reviewed_at desc,id desc limit 100
   ) select coalesce(jsonb_agg(to_jsonb(past)),'[]'::jsonb) into history from past;
 else candidates:='[]'::jsonb; history:='[]'::jsonb; end if;
 return jsonb_build_object('organization_id',p_organization_id,
   'confirmed',confirmed,'candidates',candidates,'history',history);
end; $$;
revoke all on function public.propose_organization_ai_policy(uuid,uuid,text,text,uuid),
 public.review_organization_ai_policy(uuid,uuid,uuid,text,text),
 public.get_organization_ai_policy(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.propose_organization_ai_policy(uuid,uuid,text,text,uuid),
 public.review_organization_ai_policy(uuid,uuid,uuid,text,text),
 public.get_organization_ai_policy(uuid) to authenticated;
commit;
