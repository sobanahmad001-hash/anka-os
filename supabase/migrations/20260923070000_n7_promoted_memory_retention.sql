-- N7 owner retention controls for deliberate department and client/brand promotions.
-- Source revocation already stops reuse; this erases protected promotion history
-- only after an exact owner preview and explicit confirmation.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table private.ai_promoted_memory_purges (
 memory_kind text not null check(memory_kind in ('department','client_brand')),
 memory_id uuid not null,
 purge_request_id uuid not null unique,
 organization_id uuid not null,
 source_project_memory_id uuid not null,
 prior_status text not null,
 preview_fingerprint text not null check(preview_fingerprint ~ '^[0-9a-f]{64}$'),
 purged_by uuid not null,
 purged_at timestamptz not null default clock_timestamp(),
 reason_sha256 text not null check(reason_sha256 ~ '^[0-9a-f]{64}$'),
 primary key(memory_kind,memory_id)
);
alter table private.ai_promoted_memory_purges enable row level security;
revoke all on private.ai_promoted_memory_purges from public,anon,authenticated,service_role;

create function private.n7_promoted_memory_owner(p_org uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.organizations o
 join public.organization_memberships m on m.organization_id=o.id
 where o.id=p_org and o.status='active' and m.user_id=p_actor
   and m.member_kind='team' and m.status='active' and m.role='system_owner'
 for share of o,m;
 if not found then raise exception 'Active system owner required for promoted memory retention.' using errcode='42501'; end if;
end; $$;
revoke all on function private.n7_promoted_memory_owner(uuid,uuid)
 from public,anon,authenticated,service_role;

create function public.get_promoted_ai_memory_history(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); departments jsonb; client_brands jsonb;
begin
 perform private.n7_promoted_memory_owner(p_organization_id,actor);
 with rows as (
   select m.id,m.department_id,m.source_project_memory_id,m.generalized_statement,
     m.status,m.proposed_at,m.reviewed_at
   from public.ai_department_memory m where m.organization_id=p_organization_id
   order by m.proposed_at desc,m.id desc limit 200
 ) select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into departments from rows;
 with rows as (
   select m.id,m.client_id,m.brand_id,m.scope_kind,m.source_project_memory_id,
     m.status,m.proposed_at,m.reviewed_at
   from public.ai_client_brand_memory m where m.organization_id=p_organization_id
   order by m.proposed_at desc,m.id desc limit 200
 ) select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into client_brands from rows;
 return jsonb_build_object('organization_id',p_organization_id,
   'department',departments,'client_brand',client_brands);
end; $$;

create function public.preview_promoted_ai_memory_purge(
 p_organization_id uuid,p_memory_kind text,p_memory_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); record jsonb; fingerprint text;
begin
 perform private.n7_promoted_memory_owner(p_organization_id,actor);
 if p_memory_id is null or p_memory_kind is null
   or p_memory_kind not in ('department','client_brand') then
   raise exception 'Exact promoted memory required.' using errcode='22023'; end if;
 if p_memory_kind='department' then
   select to_jsonb(m) into record from public.ai_department_memory m
     where m.id=p_memory_id and m.organization_id=p_organization_id;
 else
   select to_jsonb(m) into record from public.ai_client_brand_memory m
     where m.id=p_memory_id and m.organization_id=p_organization_id;
 end if;
 if record is null then raise exception 'Scoped promoted memory unavailable.' using errcode='P0002'; end if;
 fingerprint:=encode(extensions.digest(convert_to(record::text,'UTF8'),'sha256'),'hex');
 return jsonb_build_object('organization_id',p_organization_id,
   'memory_kind',p_memory_kind,'memory_id',p_memory_id,
   'status',record->>'status',
   'source_project_memory_id',record->>'source_project_memory_id',
   'statement',case when p_memory_kind='department' then record->>'generalized_statement' else null end,
   'scope',case when p_memory_kind='department'
     then jsonb_build_object('department_id',record->>'department_id')
     else jsonb_build_object('client_id',record->>'client_id','brand_id',record->>'brand_id',
       'scope_kind',record->>'scope_kind') end,
   'fingerprint',fingerprint);
end; $$;

create function public.purge_promoted_ai_memory(
 p_organization_id uuid,p_memory_kind text,p_memory_id uuid,
 p_request_id uuid,p_expected_fingerprint text,p_confirmation text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); record jsonb; fingerprint text;
 reason_text text:=trim(coalesce(p_reason,'')); reason_hash text;
 prior private.ai_promoted_memory_purges;
begin
 if p_memory_id is null or p_request_id is null or p_memory_kind is null
   or p_memory_kind not in ('department','client_brand')
   or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[0-9a-f]{64}$'
   or p_confirmation is distinct from 'PURGE'
   or length(reason_text) not between 10 and 1000 then
   raise exception 'Exact preview, confirmation and reason required.' using errcode='22023'; end if;
 perform private.n7_promoted_memory_owner(p_organization_id,actor);
 reason_hash:=encode(extensions.digest(convert_to(reason_text,'UTF8'),'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'n7-promoted-purge:'||p_organization_id::text||':'||p_memory_kind||':'||p_memory_id::text,0));
 select * into prior from private.ai_promoted_memory_purges where purge_request_id=p_request_id;
 if found then
   if prior.organization_id<>p_organization_id or prior.memory_kind<>p_memory_kind
     or prior.memory_id<>p_memory_id or prior.purged_by<>actor
     or prior.reason_sha256<>reason_hash
     or prior.preview_fingerprint<>p_expected_fingerprint then
     raise exception 'Purge request already used for another record.' using errcode='23505'; end if;
   return jsonb_build_object('purged_memory_id',p_memory_id,'memory_kind',p_memory_kind,
     'idempotent_replay',true);
 end if;
 if p_memory_kind='department' then
   select to_jsonb(m) into record from public.ai_department_memory m
     where m.id=p_memory_id and m.organization_id=p_organization_id for update;
 else
   select to_jsonb(m) into record from public.ai_client_brand_memory m
     where m.id=p_memory_id and m.organization_id=p_organization_id for update;
 end if;
 if record is null then raise exception 'Scoped promoted memory unavailable.' using errcode='P0002'; end if;
 fingerprint:=encode(extensions.digest(convert_to(record::text,'UTF8'),'sha256'),'hex');
 if fingerprint<>p_expected_fingerprint then
   raise exception 'Promoted memory changed; preview and confirm again.' using errcode='40001'; end if;
 insert into private.ai_promoted_memory_purges(memory_kind,memory_id,purge_request_id,
   organization_id,source_project_memory_id,prior_status,preview_fingerprint,purged_by,reason_sha256)
 values(p_memory_kind,p_memory_id,p_request_id,p_organization_id,
   (record->>'source_project_memory_id')::uuid,record->>'status',fingerprint,actor,reason_hash);
 if p_memory_kind='department' then
   delete from private.ai_department_memory_decisions where memory_id=p_memory_id;
   delete from public.ai_department_memory where id=p_memory_id;
 else
   delete from private.ai_client_brand_memory_decisions where memory_id=p_memory_id;
   delete from public.ai_client_brand_memory where id=p_memory_id;
 end if;
 return jsonb_build_object('purged_memory_id',p_memory_id,'memory_kind',p_memory_kind,
   'idempotent_replay',false);
end; $$;
revoke all on function public.get_promoted_ai_memory_history(uuid),
 public.preview_promoted_ai_memory_purge(uuid,text,uuid),
 public.purge_promoted_ai_memory(uuid,text,uuid,uuid,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.get_promoted_ai_memory_history(uuid),
 public.preview_promoted_ai_memory_purge(uuid,text,uuid),
 public.purge_promoted_ai_memory(uuid,text,uuid,uuid,text,text,text) to authenticated;
commit;
