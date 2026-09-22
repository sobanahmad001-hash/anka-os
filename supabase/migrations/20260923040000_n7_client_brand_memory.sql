-- N7 explicit client/brand promotion of a live, confirmed project lesson.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table public.ai_client_brand_memory (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 client_id uuid not null references public.agency_clients(id) on delete restrict,
 brand_id uuid references public.brands(id) on delete restrict,
 scope_kind text not null check(scope_kind in ('client','brand')),
 source_project_memory_id uuid not null,
 source_statement_sha256 text not null check(source_statement_sha256 ~ '^[0-9a-f]{64}$'),
 status text not null default 'candidate' check(status in ('candidate','confirmed','rejected','retired')),
 proposed_by uuid not null references auth.users(id) on delete restrict,
 proposed_at timestamptz not null default clock_timestamp(),
 candidate_expires_at timestamptz not null default (clock_timestamp()+interval '30 days'),
 reviewed_by uuid references auth.users(id) on delete restrict,
 reviewed_at timestamptz,
 review_evidence text check(review_evidence is null or length(trim(review_evidence)) between 1 and 1000),
 check ((scope_kind='client' and brand_id is null) or (scope_kind='brand' and brand_id is not null)),
 check ((status='candidate' and reviewed_by is null and reviewed_at is null and review_evidence is null)
   or (status<>'candidate' and reviewed_by is not null and reviewed_at is not null and review_evidence is not null))
);
create index ai_client_brand_memory_current on public.ai_client_brand_memory
 (organization_id,client_id,brand_id,reviewed_at desc,id desc) where status='confirmed';
create index ai_client_brand_memory_candidates on public.ai_client_brand_memory
 (organization_id,client_id,brand_id,proposed_at desc,id desc) where status='candidate';
alter table public.ai_client_brand_memory enable row level security;
revoke all on public.ai_client_brand_memory from public,anon,authenticated,service_role;
create table private.ai_client_brand_memory_decisions (
 id uuid primary key,
 memory_id uuid not null references public.ai_client_brand_memory(id) on delete restrict,
 decision text not null check(decision in ('confirm','reject','retire')),
 actor_id uuid not null references auth.users(id) on delete restrict,
 evidence text not null check(length(trim(evidence)) between 1 and 1000),
 decided_at timestamptz not null default clock_timestamp(),
 unique(memory_id,decision)
);
alter table private.ai_client_brand_memory_decisions enable row level security;
revoke all on private.ai_client_brand_memory_decisions from public,anon,authenticated,service_role;

create function private.n7_client_brand_scope(p_org uuid,p_project uuid,p_actor uuid)
returns public.engagements language plpgsql security definer set search_path='' as $$
declare scope public.engagements;
begin
 perform private.n1c_require_scope(p_org,p_project,p_actor);
 select e.* into scope from public.engagements e
 join public.agency_clients cl on cl.id=e.client_id
   and cl.organization_id=e.organization_id and cl.status='active'
 join public.brands b on b.id=e.brand_id and b.client_id=e.client_id
   and b.organization_id=e.organization_id and b.status='active'
 where e.organization_id=p_org and e.project_id=p_project
   and e.status<>'cancelled' for share of e,cl,b;
 if not found then raise exception 'Active canonical client and brand required.' using errcode='42501'; end if;
 return scope;
end; $$;
revoke all on function private.n7_client_brand_scope(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;

create function public.propose_client_brand_ai_memory(
 p_organization_id uuid,p_project_id uuid,p_request_id uuid,
 p_source_project_memory_id uuid,p_scope_kind text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); scope public.engagements;
 source public.ai_project_memory; prior public.ai_client_brand_memory; digest text;
begin
 if actor is null or p_request_id is null or p_source_project_memory_id is null
   or p_scope_kind is null or p_scope_kind not in ('client','brand') then
   raise exception 'Exact sourced proposal required.' using errcode='22023'; end if;
 scope:=private.n7_client_brand_scope(p_organization_id,p_project_id,actor);
 select * into source from public.ai_project_memory where id=p_source_project_memory_id
   and organization_id=p_organization_id and project_id=p_project_id
   and status='confirmed' for share;
 if not found then raise exception 'Confirmed source lesson required.' using errcode='42501'; end if;
 perform 1 from public.comments c where c.id=source.source_comment_id
   and c.organization_id=p_organization_id and c.project_id=p_project_id
   and c.entity_type='project' and c.entity_id=p_project_id and c.visibility='internal_only'
   and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=source.source_sha256 for share;
 if not found then raise exception 'Live unchanged source required.' using errcode='42501'; end if;
 digest:=encode(extensions.digest(convert_to(source.statement,'UTF8'),'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n7-client-brand:'||p_request_id::text,0));
 select * into prior from public.ai_client_brand_memory where id=p_request_id;
 if found then
   if prior.organization_id<>p_organization_id or prior.client_id<>scope.client_id
     or prior.brand_id is distinct from (case when p_scope_kind='brand' then scope.brand_id else null end)
     or prior.scope_kind<>p_scope_kind or prior.source_project_memory_id<>source.id
     or prior.source_statement_sha256<>digest or prior.proposed_by<>actor then
     raise exception 'Request ID already used for another scope.' using errcode='23505'; end if;
   return jsonb_build_object('memory_id',prior.id,'status',prior.status,'idempotent_replay',true);
 end if;
 insert into public.ai_client_brand_memory(id,organization_id,client_id,brand_id,
   scope_kind,source_project_memory_id,source_statement_sha256,proposed_by)
 values(p_request_id,p_organization_id,scope.client_id,
   case when p_scope_kind='brand' then scope.brand_id else null end,
   p_scope_kind,source.id,digest,actor);
 return jsonb_build_object('memory_id',p_request_id,'status','candidate','idempotent_replay',false);
end; $$;

create function public.review_client_brand_ai_memory(
 p_organization_id uuid,p_project_id uuid,p_memory_id uuid,p_request_id uuid,
 p_decision text,p_evidence text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; scope public.engagements;
 memory public.ai_client_brand_memory; source public.ai_project_memory;
 prior private.ai_client_brand_memory_decisions; evidence text:=trim(coalesce(p_evidence,''));
begin
 if actor is null or p_memory_id is null or p_request_id is null
   or p_decision is null or p_decision not in ('confirm','reject','retire')
   or length(evidence) not between 1 and 1000 then
   raise exception 'Exact review required.' using errcode='22023'; end if;
 actor_role:=private.n1c_require_scope(p_organization_id,p_project_id,actor);
 if actor_role not in ('system_owner','operations_admin') then
   raise exception 'Leadership review required.' using errcode='42501'; end if;
 scope:=private.n7_client_brand_scope(p_organization_id,p_project_id,actor);
 select * into memory from public.ai_client_brand_memory where id=p_memory_id
   and organization_id=p_organization_id and client_id=scope.client_id
   and (brand_id is null or brand_id=scope.brand_id) for update;
 if not found then raise exception 'Scoped memory unavailable.' using errcode='P0002'; end if;
 select * into prior from private.ai_client_brand_memory_decisions where id=p_request_id;
 if found then
   if prior.memory_id<>p_memory_id or prior.decision<>p_decision
     or prior.actor_id<>actor or prior.evidence<>evidence then
     raise exception 'Review ID belongs to another decision.' using errcode='23505'; end if;
   return jsonb_build_object('memory_id',memory.id,
     'status',case prior.decision when 'confirm' then 'confirmed'
       when 'reject' then 'rejected' else 'retired' end,'idempotent_replay',true);
 end if;
 if p_decision='retire' then
   if memory.status<>'confirmed' then raise exception 'Only confirmed memory can retire.' using errcode='55000'; end if;
 elsif memory.status<>'candidate' or memory.candidate_expires_at<=clock_timestamp()
   or memory.proposed_by=actor then
   raise exception 'Fresh candidate requires independent review.' using errcode='55000';
 end if;
 if p_decision='confirm' then
   select * into source from public.ai_project_memory where id=memory.source_project_memory_id
     and organization_id=p_organization_id and status='confirmed'
     and encode(extensions.digest(convert_to(statement,'UTF8'),'sha256'),'hex')=memory.source_statement_sha256 for share;
   if not found then raise exception 'Unchanged confirmed source required.' using errcode='55000'; end if;
   perform private.n7_client_brand_scope(p_organization_id,source.project_id,actor);
   perform 1 from public.engagements e where e.project_id=source.project_id
     and e.organization_id=p_organization_id and e.client_id=memory.client_id
     and (memory.brand_id is null or e.brand_id=memory.brand_id) for share;
   if not found then raise exception 'Source scope changed.' using errcode='55000'; end if;
   perform 1 from public.comments c where c.id=source.source_comment_id
     and c.organization_id=p_organization_id and c.project_id=source.project_id
     and c.entity_type='project' and c.entity_id=source.project_id and c.visibility='internal_only'
     and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=source.source_sha256 for share;
   if not found then raise exception 'Source changed or was revoked.' using errcode='55000'; end if;
 end if;
 update public.ai_client_brand_memory set status=case p_decision when 'confirm' then 'confirmed'
   when 'reject' then 'rejected' else 'retired' end,
   reviewed_by=actor,reviewed_at=clock_timestamp(),review_evidence=evidence where id=memory.id;
 insert into private.ai_client_brand_memory_decisions(id,memory_id,decision,actor_id,evidence)
   values(p_request_id,p_memory_id,p_decision,actor,evidence);
 return jsonb_build_object('memory_id',memory.id,
   'status',case p_decision when 'confirm' then 'confirmed'
     when 'reject' then 'rejected' else 'retired' end,'idempotent_replay',false);
end; $$;

create function public.get_client_brand_ai_memory(p_organization_id uuid,p_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; scope public.engagements;
 confirmed jsonb; candidates jsonb;
begin
 actor_role:=private.n1c_require_scope(p_organization_id,p_project_id,actor);
 scope:=private.n7_client_brand_scope(p_organization_id,p_project_id,actor);
 with valid_rows as (
   select m.id,m.scope_kind,m.client_id,m.brand_id,m.source_project_memory_id,
     s.project_id,s.source_comment_id,s.statement,m.reviewed_at,m.reviewed_by,
     m.proposed_at,m.proposed_by,m.candidate_expires_at,m.status
   from public.ai_client_brand_memory m
   join public.ai_project_memory s on s.id=m.source_project_memory_id
     and s.organization_id=m.organization_id and s.status='confirmed'
     and encode(extensions.digest(convert_to(s.statement,'UTF8'),'sha256'),'hex')=m.source_statement_sha256
   join public.projects p on p.id=s.project_id and p.organization_id=m.organization_id
     and p.archived_at is null
   join public.engagements e on e.project_id=s.project_id and e.organization_id=m.organization_id
     and e.client_id=m.client_id and (m.brand_id is null or e.brand_id=m.brand_id)
     and e.status<>'cancelled'
   join public.agency_clients cl on cl.id=e.client_id and cl.organization_id=m.organization_id
     and cl.status='active'
   join public.brands b on b.id=e.brand_id and b.client_id=e.client_id
     and b.organization_id=m.organization_id and b.status='active'
   join public.comments c on c.id=s.source_comment_id and c.organization_id=s.organization_id
     and c.project_id=s.project_id and c.entity_type='project' and c.entity_id=s.project_id
     and c.visibility='internal_only'
     and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=s.source_sha256
   where m.organization_id=p_organization_id and m.client_id=scope.client_id
     and (m.brand_id is null or m.brand_id=scope.brand_id)
 ), current_rows as (
   select id,scope_kind,client_id,brand_id,source_project_memory_id,
     project_id,source_comment_id,statement,reviewed_at,reviewed_by
   from valid_rows where status='confirmed'
   order by reviewed_at desc,id desc limit 50
 ) select coalesce(jsonb_agg(to_jsonb(current_rows)),'[]'::jsonb)
   into confirmed from current_rows;
 if actor_role in ('system_owner','operations_admin') then
   with pending as (
     select m.id,m.scope_kind,m.client_id,m.brand_id,m.source_project_memory_id,
       s.project_id,s.source_comment_id,s.statement,m.proposed_at,m.proposed_by
     from public.ai_client_brand_memory m
     join public.ai_project_memory s on s.id=m.source_project_memory_id
       and s.organization_id=m.organization_id and s.status='confirmed'
       and encode(extensions.digest(convert_to(s.statement,'UTF8'),'sha256'),'hex')=m.source_statement_sha256
     join public.projects p on p.id=s.project_id and p.organization_id=m.organization_id
       and p.archived_at is null
     join public.engagements e on e.project_id=s.project_id and e.organization_id=m.organization_id
       and e.client_id=m.client_id and (m.brand_id is null or e.brand_id=m.brand_id)
       and e.status<>'cancelled'
     join public.agency_clients cl on cl.id=e.client_id and cl.organization_id=m.organization_id
       and cl.status='active'
     join public.brands b on b.id=e.brand_id and b.client_id=e.client_id
       and b.organization_id=m.organization_id and b.status='active'
     join public.comments c on c.id=s.source_comment_id and c.organization_id=s.organization_id
       and c.project_id=s.project_id and c.entity_type='project' and c.entity_id=s.project_id
       and c.visibility='internal_only'
       and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=s.source_sha256
     where m.organization_id=p_organization_id and m.client_id=scope.client_id
       and (m.brand_id is null or m.brand_id=scope.brand_id)
       and m.status='candidate' and m.candidate_expires_at>clock_timestamp()
     order by m.proposed_at desc,m.id desc limit 50
   ) select coalesce(jsonb_agg(to_jsonb(pending)),'[]'::jsonb)
     into candidates from pending;
 else candidates:='[]'::jsonb; end if;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
   'client_id',scope.client_id,'brand_id',scope.brand_id,
   'confirmed',confirmed,'candidates',candidates);
end; $$;
revoke all on function public.propose_client_brand_ai_memory(uuid,uuid,uuid,uuid,text),
 public.review_client_brand_ai_memory(uuid,uuid,uuid,uuid,text,text),
 public.get_client_brand_ai_memory(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.propose_client_brand_ai_memory(uuid,uuid,uuid,uuid,text),
 public.review_client_brand_ai_memory(uuid,uuid,uuid,uuid,text,text),
 public.get_client_brand_ai_memory(uuid,uuid) to authenticated;
commit;
