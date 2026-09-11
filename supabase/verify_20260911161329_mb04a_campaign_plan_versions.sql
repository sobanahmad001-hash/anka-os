begin;

do $$
declare
  failures text[] := '{}'::text[];
  fn oid;
  definition text;
begin
  if to_regclass('public.marketing_campaign_plan_versions') is null then failures := array_append(failures, 'plan_versions_table_exists'); end if;
  if to_regclass('public.marketing_campaign_plan_creative_requirements') is null then failures := array_append(failures, 'creative_requirements_table_exists'); end if;
  if not coalesce((select relrowsecurity from pg_class where oid = 'public.marketing_campaign_plan_versions'::regclass), false) then failures := array_append(failures, 'plan_versions_rls_enabled'); end if;
  if not coalesce((select relrowsecurity from pg_class where oid = 'public.marketing_campaign_plan_creative_requirements'::regclass), false) then failures := array_append(failures, 'creative_requirements_rls_enabled'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_campaign_plan_versions' and roles = array['authenticated']::name[] and cmd = 'SELECT' and qual like '%is_team_organization_member%') then failures := array_append(failures, 'plan_versions_team_read_policy'); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_campaign_plan_creative_requirements' and roles = array['authenticated']::name[] and cmd = 'SELECT' and qual like '%is_team_organization_member%') then failures := array_append(failures, 'requirements_team_read_policy'); end if;
  if has_table_privilege('authenticated', 'public.marketing_campaign_plan_versions', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.marketing_campaign_plan_creative_requirements', 'INSERT,UPDATE,DELETE')
  then failures := array_append(failures, 'authenticated_tables_read_only'); end if;
  if not has_table_privilege('authenticated', 'public.marketing_campaign_plan_versions', 'SELECT')
    or not has_table_privilege('authenticated', 'public.marketing_campaign_plan_creative_requirements', 'SELECT')
  then failures := array_append(failures, 'authenticated_select_granted'); end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.marketing_campaign_plan_versions'::regclass and tgname = 'trg_marketing_campaign_plan_versions_immutable' and tgenabled <> 'D') then failures := array_append(failures, 'plan_versions_immutable_trigger'); end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.marketing_campaign_plan_creative_requirements'::regclass and tgname = 'trg_marketing_campaign_plan_requirements_immutable' and tgenabled <> 'D') then failures := array_append(failures, 'requirements_immutable_trigger'); end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.marketing_campaign_plan_versions'::regclass
      and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (campaign_id, version_number)'
  ) then failures := array_append(failures, 'campaign_version_unique'); end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.marketing_campaign_plan_versions'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) like '%lifecycle_status%draft%'
  ) then failures := array_append(failures, 'draft_only_lifecycle'); end if;

  fn := to_regprocedure('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)');
  if fn is null then
    failures := array_append(failures, 'save_rpc_exact_signature');
  else
    select pg_get_functiondef(fn) into definition;
    if (select prosecdef from pg_proc where oid = fn) then failures := array_append(failures, 'save_rpc_security_invoker'); end if;
    if not exists (select 1 from pg_proc where oid = fn and proconfig @> array['search_path=']) then failures := array_append(failures, 'save_rpc_empty_search_path'); end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then failures := array_append(failures, 'save_rpc_not_client_callable'); end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then failures := array_append(failures, 'save_rpc_service_role_execute'); end if;
    if definition not like '%member_kind = ''team'' and status = ''active''%' then failures := array_append(failures, 'save_rpc_active_team_check'); end if;
    if definition not like '%sc.department_id = ''marketing'' and sc.is_active%' then failures := array_append(failures, 'save_rpc_active_marketing_service_check'); end if;
    if definition not like '%v_latest.id is distinct from p_expected_latest_version_id%' then failures := array_append(failures, 'save_rpc_optimistic_concurrency'); end if;
    if definition not like '%join public.artifact_approvals approval%' or definition not like '%campaign_messaging%' or definition not like '%measurement_plan%' then failures := array_append(failures, 'save_rpc_exact_source_checks'); end if;
    if definition like '%insert into public.work_items%' or definition like '%planned_budget%' or definition like '%currency_code%' then failures := array_append(failures, 'save_rpc_scope_boundary'); end if;
  end if;

  if cardinality(failures) > 0 then raise exception 'MB04A verification failed: %', array_to_string(failures, ', '); end if;
end
$$;

select 'PASS' as mb04a_final_result;
rollback;
