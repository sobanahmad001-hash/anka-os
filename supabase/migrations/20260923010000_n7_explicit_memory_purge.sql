-- N7 explicit purge: only an active system owner may erase an exact project-memory
-- chain after preview. The compact tombstone retains no lesson or source content.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table private.ai_project_memory_purges (
  memory_id uuid primary key,
  purge_request_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  source_sha256 text not null,
  prior_status text not null,
  purged_by uuid not null,
  purged_at timestamptz not null default clock_timestamp(),
  reason text not null check (length(trim(reason)) between 10 and 1000)
);
create index ai_project_memory_purge_request on private.ai_project_memory_purges(purge_request_id);
alter table private.ai_project_memory_purges enable row level security;
revoke all on private.ai_project_memory_purges from public,anon,authenticated,service_role;

create function public.get_project_ai_memory_history(
  p_organization_id uuid,p_project_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); records jsonb;
begin
  if private.n1c_require_scope(p_organization_id,p_project_id,actor)<>'system_owner' then
    raise exception 'Active system owner required for memory history.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'statement',m.statement,
    'status',m.status,'source_comment_id',m.source_comment_id,
    'proposed_at',m.proposed_at,'supersedes_id',m.supersedes_id,
    'superseded_by',m.superseded_by) order by m.proposed_at desc,m.id desc),'[]'::jsonb)
    into records from public.ai_project_memory m
    where m.organization_id=p_organization_id and m.project_id=p_project_id;
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'records',records);
end; $$;
create function public.preview_project_ai_memory_purge(
  p_organization_id uuid,p_project_id uuid,p_memory_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rows jsonb;
begin
  if private.n1c_require_scope(p_organization_id,p_project_id,actor)<>'system_owner' then
    raise exception 'Active system owner required for memory purge.' using errcode='42501'; end if;
  if not exists (select 1 from public.ai_project_memory where id=p_memory_id
      and organization_id=p_organization_id and project_id=p_project_id) then
    raise exception 'Scoped memory unavailable.' using errcode='P0002'; end if;
  with recursive lineage(id) as (
    select p_memory_id
    union
    select linked.id from lineage l
      join public.ai_project_memory current_memory on current_memory.id=l.id
      join public.ai_project_memory linked on linked.organization_id=p_organization_id
        and linked.project_id=p_project_id
        and (linked.id=current_memory.supersedes_id
          or linked.id=current_memory.superseded_by
          or linked.supersedes_id=l.id or linked.superseded_by=l.id)
  )
  select jsonb_agg(jsonb_build_object('id',m.id,'status',m.status,
      'source_comment_id',m.source_comment_id,'proposed_at',m.proposed_at) order by m.proposed_at,m.id)
    into rows from public.ai_project_memory m join lineage l on l.id=m.id;
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'memory_ids',coalesce((select jsonb_agg((value->>'id')::uuid order by value->>'id')
      from jsonb_array_elements(rows) value),'[]'::jsonb),
    'records',coalesce(rows,'[]'::jsonb));
end; $$;

create function public.purge_project_ai_memory(
  p_organization_id uuid,p_project_id uuid,p_memory_id uuid,p_request_id uuid,
  p_expected_memory_ids uuid[],p_confirmation text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); preview jsonb; actual uuid[]; expected uuid[];
  purge_reason text:=trim(coalesce(p_reason,'')); prior_count int;
begin
  if p_request_id is null or p_memory_id is null or p_confirmation is distinct from 'PURGE'
    or length(purge_reason) not between 10 and 1000 or p_expected_memory_ids is null
    or cardinality(p_expected_memory_ids) not between 1 and 100 then
    raise exception 'Exact purge preview, confirmation and reason required.' using errcode='22023'; end if;
  if private.n1c_require_scope(p_organization_id,p_project_id,actor)<>'system_owner' then
    raise exception 'Active system owner required for memory purge.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'n7-memory-purge:'||p_organization_id::text||':'||p_project_id::text,0));
  select count(*) into prior_count from private.ai_project_memory_purges
    where purge_request_id=p_request_id;
  if prior_count>0 then
    select array_agg(memory_id order by memory_id) into actual
      from private.ai_project_memory_purges where purge_request_id=p_request_id
        and organization_id=p_organization_id and project_id=p_project_id
        and purged_by=actor and reason=purge_reason;
    select array_agg(distinct id order by id) into expected from unnest(p_expected_memory_ids) id;
    if actual is distinct from expected or not p_memory_id=any(actual) then
      raise exception 'Purge request already belongs to another scope or record set.' using errcode='23505'; end if;
    return jsonb_build_object('purged_memory_ids',to_jsonb(actual),'idempotent_replay',true);
  end if;
  preview:=public.preview_project_ai_memory_purge(p_organization_id,p_project_id,p_memory_id);
  select array_agg((value#>>'{}')::uuid order by (value#>>'{}')::uuid) into actual
    from jsonb_array_elements(preview->'memory_ids') value;
  select array_agg(distinct id order by id) into expected from unnest(p_expected_memory_ids) id;
  if actual is distinct from expected or cardinality(actual)<>cardinality(p_expected_memory_ids) then
    raise exception 'Memory lineage changed; preview and confirm again.' using errcode='40001'; end if;
  perform 1 from public.ai_project_memory where id=any(actual)
    and organization_id=p_organization_id and project_id=p_project_id for update;
  if (select count(*) from public.ai_project_memory where id=any(actual))<>cardinality(actual) then
    raise exception 'Memory lineage changed; preview and confirm again.' using errcode='40001'; end if;
  insert into private.ai_project_memory_purges(memory_id,purge_request_id,
    organization_id,project_id,source_sha256,prior_status,purged_by,reason)
    select m.id,p_request_id,m.organization_id,m.project_id,m.source_sha256,
      m.status,actor,purge_reason from public.ai_project_memory m where m.id=any(actual);
  delete from private.ai_project_memory_decisions where memory_id=any(actual);
  update public.ai_project_memory set supersedes_id=null,superseded_by=null
    where id=any(actual);
  delete from public.ai_project_memory where id=any(actual);
  return jsonb_build_object('purged_memory_ids',to_jsonb(actual),'idempotent_replay',false);
end; $$;
revoke all on function public.get_project_ai_memory_history(uuid,uuid),
  public.preview_project_ai_memory_purge(uuid,uuid,uuid),
  public.purge_project_ai_memory(uuid,uuid,uuid,uuid,uuid[],text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_project_ai_memory_history(uuid,uuid),
  public.preview_project_ai_memory_purge(uuid,uuid,uuid),
  public.purge_project_ai_memory(uuid,uuid,uuid,uuid,uuid[],text,text) to authenticated;
commit;
