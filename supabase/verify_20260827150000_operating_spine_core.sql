with required_tables(table_name) as (
  values
    ('agency_clients'), ('brands'), ('engagements'), ('service_catalog'),
    ('blueprint_stage_catalog'), ('blueprint_stage_dependencies'),
    ('service_stage_rules'), ('engagement_assets'), ('engagement_services'),
    ('engagement_stage_instances'), ('engagement_stage_services'),
    ('engagement_prerequisites'), ('engagement_stage_dependencies'),
    ('engagement_events'), ('integration_connection_engagements')
), rls_state as (
  select required.table_name, relation.relrowsecurity
  from required_tables required
  left join pg_class relation on relation.relname = required.table_name
  left join pg_namespace namespace
    on namespace.oid = relation.relnamespace and namespace.nspname = 'public'
), service_counts as (
  select organization_id, department_id, count(*) as service_count
  from public.service_catalog
  where is_active
  group by organization_id, department_id
)
select jsonb_build_object(
  'all_required_tables_exist', not exists (
    select 1 from rls_state where relrowsecurity is null
  ),
  'all_required_tables_use_rls', not exists (
    select 1 from rls_state where relrowsecurity is distinct from true
  ),
  'service_catalogue_counts_valid', not exists (
    select 1
    from service_counts
    where service_count <> case department_id
      when 'content' then 8
      when 'design' then 8
      when 'development' then 9
      when 'marketing' then 9
    end
  ),
  'every_service_has_primary_stage', not exists (
    select 1
    from public.service_catalog service
    where service.is_active
      and not exists (
        select 1 from public.service_stage_rules rule
        where rule.service_id = service.id and rule.rule_kind = 'primary'
      )
  ),
  'composer_is_security_invoker', (
    select not procedure.prosecdef
    from pg_proc procedure
    where procedure.oid = 'public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)'::regprocedure
  ),
  'composer_has_fixed_search_path', (
    select procedure.proconfig = array['search_path=""']
    from pg_proc procedure
    where procedure.oid = 'public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)'::regprocedure
  ),
  'ai_runs_engagement_fk_exists', exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.ai_runs'::regclass
      and constraint_record.contype = 'f'
      and pg_get_constraintdef(constraint_record.oid) like '%engagement_id%engagements%'
  ),
  'audit_event_types', (
    select array_agg(distinct event_type order by event_type)
    from public.engagement_events
  )
);
