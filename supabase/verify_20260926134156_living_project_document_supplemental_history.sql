-- Catalog/ACL verifier only: no users, source records or provider calls.
-- Run after v2 migration in a disposable database or master rollback-only preflight.
begin;
set local statement_timeout='30s';
do $$
declare serializer regprocedure:='private.build_living_project_snapshot_projection(uuid,uuid,text,bigint,timestamptz)'::regprocedure;
  invalidator regprocedure:='private.invalidate_living_project_supplemental_source()'::regprocedure;
  preserve regprocedure:='public.preserve_living_project_snapshot(uuid,uuid,uuid,text,bigint,uuid,text)'::regprocedure;
  trigger_count integer;
begin
  if not exists(select 1 from pg_proc where oid=serializer and not prosecdef and provolatile='s'
    and proconfig=array['search_path=""'] and prosrc like '%''schema_version'', 2%') then
    raise exception 'LivingDoc v2 serializer contract mismatch';
  end if;
  if has_function_privilege('authenticated',serializer,'execute')
    or has_function_privilege('anon',serializer,'execute')
    or has_function_privilege('service_role',serializer,'execute')
    or has_function_privilege('authenticated',invalidator,'execute')
    or has_function_privilege('anon',invalidator,'execute')
    or has_function_privilege('service_role',invalidator,'execute') then
    raise exception 'LivingDoc internal helper execute boundary mismatch';
  end if;
  if not has_function_privilege('authenticated',preserve,'execute')
    or has_function_privilege('anon',preserve,'execute')
    or has_function_privilege('service_role',preserve,'execute') then
    raise exception 'LivingDoc preservation RPC ACL changed';
  end if;
  select count(*) into trigger_count from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and t.tgname='living_document_supplemental_source' and not t.tgisinternal
    and t.tgfoid=invalidator and t.tgenabled='O';
  if trigger_count<>11 then raise exception 'LivingDoc supplemental source triggers incomplete'; end if;
  if has_table_privilege('authenticated','public.living_project_document_snapshots','insert')
    or has_table_privilege('authenticated','public.living_project_documents','update') then
    raise exception 'LivingDoc browser checkpoint bypass';
  end if;
end;
$$;
select 'PASS catalog ACL and eleven source triggers; native behavior is separately verified' as result;
rollback;