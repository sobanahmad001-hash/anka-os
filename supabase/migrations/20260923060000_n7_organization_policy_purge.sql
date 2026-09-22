-- N7 explicit owner purge of a whole organization-policy correction chain.
-- Tombstones retain IDs, source hashes and audit metadata, never policy text.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table private.ai_organization_policy_purges (
 policy_id uuid primary key,
 purge_request_id uuid not null,
 organization_id uuid not null,
 source_sha256 text not null,
 prior_status text not null,
 purged_by uuid not null,
 purged_at timestamptz not null default clock_timestamp(),
 reason_sha256 text not null check(reason_sha256 ~ '^[0-9a-f]{64}$')
);
create index ai_organization_policy_purge_request on private.ai_organization_policy_purges(purge_request_id);
alter table private.ai_organization_policy_purges enable row level security;
revoke all on private.ai_organization_policy_purges from public,anon,authenticated,service_role;

create function public.preview_organization_ai_policy_purge(
 p_organization_id uuid,p_policy_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rows jsonb;
begin
 if private.n7_organization_policy_actor(p_organization_id,actor)<>'system_owner' then
   raise exception 'Active system owner required for policy purge.' using errcode='42501'; end if;
 if not exists(select 1 from public.ai_organization_policy_memory where id=p_policy_id
   and organization_id=p_organization_id) then
   raise exception 'Scoped policy unavailable.' using errcode='P0002'; end if;
 with recursive lineage(id) as (
   select p_policy_id
   union
   select linked.id from lineage l
     join public.ai_organization_policy_memory current_policy on current_policy.id=l.id
     join public.ai_organization_policy_memory linked on linked.organization_id=p_organization_id
       and (linked.id=current_policy.supersedes_id
         or linked.id=current_policy.superseded_by
         or linked.supersedes_id=l.id or linked.superseded_by=l.id)
 ) select jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,
     'statement',p.statement,'source_note',p.source_note) order by p.proposed_at,p.id)
   into rows from public.ai_organization_policy_memory p join lineage l on l.id=p.id;
 return jsonb_build_object('organization_id',p_organization_id,
   'policy_ids',coalesce((select jsonb_agg((value->>'id')::uuid order by value->>'id')
     from jsonb_array_elements(rows) value),'[]'::jsonb),
   'records',coalesce(rows,'[]'::jsonb));
end; $$;

create function public.purge_organization_ai_policy(
 p_organization_id uuid,p_policy_id uuid,p_request_id uuid,
 p_expected_policy_ids uuid[],p_confirmation text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); preview jsonb; actual uuid[]; expected uuid[];
 purge_reason text:=trim(coalesce(p_reason,'')); reason_hash text; prior_count int;
begin
 if p_request_id is null or p_policy_id is null or p_confirmation is distinct from 'PURGE'
   or length(purge_reason) not between 10 and 1000 or p_expected_policy_ids is null
   or cardinality(p_expected_policy_ids) not between 1 and 100 then
   raise exception 'Exact purge preview, confirmation and reason required.' using errcode='22023'; end if;
 if private.n7_organization_policy_actor(p_organization_id,actor)<>'system_owner' then
   raise exception 'Active system owner required for policy purge.' using errcode='42501'; end if;
 reason_hash:=encode(extensions.digest(convert_to(purge_reason,'UTF8'),'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'n7-org-policy-purge:'||p_organization_id::text,0));
 select count(*) into prior_count from private.ai_organization_policy_purges
   where purge_request_id=p_request_id;
 if prior_count>0 then
   select array_agg(policy_id order by policy_id) into actual
     from private.ai_organization_policy_purges where purge_request_id=p_request_id
       and organization_id=p_organization_id and purged_by=actor and reason_sha256=reason_hash;
   select array_agg(distinct id order by id) into expected from unnest(p_expected_policy_ids) id;
   if actual is distinct from expected or not p_policy_id=any(actual)
     or cardinality(expected)<>cardinality(p_expected_policy_ids) then
     raise exception 'Purge request already belongs to another scope or record set.' using errcode='23505'; end if;
   return jsonb_build_object('purged_policy_ids',to_jsonb(actual),'idempotent_replay',true);
 end if;
 preview:=public.preview_organization_ai_policy_purge(p_organization_id,p_policy_id);
 select array_agg((value#>>'{}')::uuid order by (value#>>'{}')::uuid) into actual
   from jsonb_array_elements(preview->'policy_ids') value;
 select array_agg(distinct id order by id) into expected from unnest(p_expected_policy_ids) id;
 if actual is distinct from expected or cardinality(actual)<>cardinality(p_expected_policy_ids) then
   raise exception 'Policy lineage changed; preview and confirm again.' using errcode='40001'; end if;
 perform 1 from public.ai_organization_policy_memory
   where id=any(actual) and organization_id=p_organization_id for update;
 if (select count(*) from public.ai_organization_policy_memory where id=any(actual))<>cardinality(actual) then
   raise exception 'Policy lineage changed; preview and confirm again.' using errcode='40001'; end if;
 insert into private.ai_organization_policy_purges(policy_id,purge_request_id,
   organization_id,source_sha256,prior_status,purged_by,reason_sha256)
   select p.id,p_request_id,p.organization_id,p.source_sha256,p.status,actor,reason_hash
     from public.ai_organization_policy_memory p where p.id=any(actual);
 delete from private.ai_organization_policy_decisions where policy_id=any(actual);
 update public.ai_organization_policy_memory set supersedes_id=null,superseded_by=null
   where id=any(actual);
 delete from public.ai_organization_policy_memory where id=any(actual);
 return jsonb_build_object('purged_policy_ids',to_jsonb(actual),'idempotent_replay',false);
end; $$;
revoke all on function public.preview_organization_ai_policy_purge(uuid,uuid),
 public.purge_organization_ai_policy(uuid,uuid,uuid,uuid[],text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.preview_organization_ai_policy_purge(uuid,uuid),
 public.purge_organization_ai_policy(uuid,uuid,uuid,uuid[],text,text) to authenticated;
commit;
