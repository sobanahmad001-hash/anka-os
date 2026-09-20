-- N3: link an official canonical handoff request to an internal project discussion message.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.requests add column source_project_comment_id uuid references public.comments(id) on delete restrict;
create index n3_project_handoff_source on public.requests(organization_id,project_id,created_at desc,id desc)
  where request_type='internal_handoff' and request_origin='team' and visibility='internal_only';
create index n3_handoff_comment_reference on public.requests(source_project_comment_id)
  where source_project_comment_id is not null;

create function private.n3_guard_request_discussion_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.source_project_comment_id is distinct from old.source_project_comment_id then
    raise exception 'Handoff discussion source is immutable.' using errcode='42501'; end if;
  if new.source_project_comment_id is not null then
    if tg_op='INSERT' and (new.status<>'submitted' or new.receiving_workstream_id is null
      or new.receiving_workstream_id is not distinct from new.requesting_workstream_id
      or length(trim(new.title)) not between 1 and 240
      or length(trim(new.requested_output)) not between 1 and 8000
      or length(trim(new.acceptance_criteria))>4000) then
      raise exception 'Complete submitted handoff contract required.' using errcode='42501'; end if;
    if (tg_op='INSERT' and current_setting('role',true)='authenticated'
      and new.requested_by is distinct from auth.uid())
      or (tg_op='UPDATE' and (new.organization_id is distinct from old.organization_id
        or new.project_id is distinct from old.project_id or new.requested_by is distinct from old.requested_by)) then
      raise exception 'Handoff source identity is immutable and actor-bound.' using errcode='42501'; end if;
    if tg_op='INSERT' and (
      not exists(select 1 from public.workstreams w where w.id=new.receiving_workstream_id
        and w.organization_id=new.organization_id and w.project_id=new.project_id and w.status='active')
      or (new.requesting_workstream_id is not null and not exists(
        select 1 from public.workstreams w where w.id=new.requesting_workstream_id
          and w.organization_id=new.organization_id and w.project_id=new.project_id and w.status='active'))
    ) then raise exception 'Same-project active handoff workstreams required.' using errcode='42501'; end if;
    if tg_op='UPDATE' and (new.requesting_workstream_id is distinct from old.requesting_workstream_id
      or new.receiving_workstream_id is distinct from old.receiving_workstream_id
      or new.request_type is distinct from old.request_type or new.request_origin is distinct from old.request_origin
      or new.title is distinct from old.title or new.requested_output is distinct from old.requested_output
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.priority is distinct from old.priority or new.required_by is distinct from old.required_by) then
      raise exception 'Discussion-linked handoff contract is immutable; create a new request.' using errcode='42501'; end if;
    if new.request_type<>'internal_handoff' or new.request_origin<>'team' or new.visibility<>'internal_only'
      or not exists(select 1 from public.comments c where c.id=new.source_project_comment_id
        and c.organization_id=new.organization_id and c.project_id=new.project_id
        and c.entity_type='project' and c.entity_id=new.project_id and c.visibility='internal_only') then
      raise exception 'Same-project internal discussion source required.' using errcode='42501'; end if;
  end if;
  return new;
end; $$;
create trigger n3_guard_request_discussion_source before insert or update on public.requests
  for each row execute function private.n3_guard_request_discussion_source();
revoke all on function private.n3_guard_request_discussion_source() from public,anon,authenticated,service_role;

create function public.create_project_handoff_request(
  p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_source_comment_id uuid,
  p_requesting_workstream_id uuid,p_receiving_workstream_id uuid,p_title text,
  p_requested_output text,p_acceptance_criteria text,p_priority text,p_required_by date
) returns public.requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.requests%rowtype; created public.requests%rowtype;
begin
  perform private.n3_require_project_member(p_organization_id,p_project_id);
  if p_request_id is null or p_source_comment_id is null or p_receiving_workstream_id is null
    or p_receiving_workstream_id is not distinct from p_requesting_workstream_id
    or length(trim(coalesce(p_title,''))) not between 1 and 240
    or length(trim(coalesce(p_requested_output,''))) not between 1 and 8000
    or length(trim(coalesce(p_acceptance_criteria,'')))>4000
    or p_priority is null or p_priority not in ('low','medium','high','urgent') then
    raise exception 'Complete bounded handoff request required.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n3-handoff:'||p_request_id::text,0));
  select * into existing from public.requests where id=p_request_id;
  if found then
    if existing.organization_id is distinct from p_organization_id or existing.project_id is distinct from p_project_id
      or existing.request_type<>'internal_handoff' or existing.request_origin<>'team'
      or existing.visibility<>'internal_only' or existing.requested_by is distinct from actor
      or existing.source_project_comment_id is distinct from p_source_comment_id
      or existing.requesting_workstream_id is distinct from p_requesting_workstream_id
      or existing.receiving_workstream_id is distinct from p_receiving_workstream_id
      or existing.title is distinct from trim(p_title) or existing.requested_output is distinct from trim(p_requested_output)
      or existing.acceptance_criteria is distinct from trim(coalesce(p_acceptance_criteria,''))
      or existing.priority is distinct from p_priority or existing.required_by is distinct from p_required_by then
      raise exception 'Request ID already used with different handoff inputs.' using errcode='23505'; end if;
    return existing;
  end if;
  perform 1 from public.workstreams w where w.id=p_receiving_workstream_id
    and w.organization_id=p_organization_id and w.project_id=p_project_id and w.status='active' for share;
  if not found then raise exception 'Active receiving project workstream required.' using errcode='42501'; end if;
  if p_requesting_workstream_id is not null then
    perform 1 from public.workstreams w where w.id=p_requesting_workstream_id
      and w.organization_id=p_organization_id and w.project_id=p_project_id and w.status='active' for share;
    if not found then raise exception 'Active requesting project workstream required.' using errcode='42501'; end if;
  end if;
  insert into public.requests(id,organization_id,project_id,requesting_workstream_id,receiving_workstream_id,
    request_type,request_origin,title,requested_output,acceptance_criteria,priority,status,visibility,
    requested_by,required_by,source_project_comment_id)
  values(p_request_id,p_organization_id,p_project_id,p_requesting_workstream_id,p_receiving_workstream_id,
    'internal_handoff','team',trim(p_title),trim(p_requested_output),trim(coalesce(p_acceptance_criteria,'')),
    p_priority,'submitted','internal_only',actor,p_required_by,p_source_comment_id)
  returning * into created;
  return created;
end; $$;
revoke all on function public.create_project_handoff_request(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,date)
  from public,anon,authenticated,service_role;
grant execute on function public.create_project_handoff_request(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,date)
  to authenticated;
commit;
