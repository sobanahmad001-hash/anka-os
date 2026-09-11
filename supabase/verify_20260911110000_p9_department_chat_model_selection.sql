-- P9-MODELS-1 verifier. This script always rolls back.
begin;

create temporary table p9_model_selection_checks (
  check_name text primary key,
  passed boolean not null,
  detail text not null
) on commit drop;

insert into p9_model_selection_checks values
('schema_rls_acl',
  (select relrowsecurity from pg_class where oid = 'public.department_chat_model_configurations'::regclass)
  and has_table_privilege('authenticated', 'public.department_chat_model_configurations', 'select')
  and not has_table_privilege('authenticated', 'public.department_chat_model_configurations', 'insert')
  and not has_table_privilege('authenticated', 'public.department_chat_model_configurations', 'update')
  and not has_table_privilege('authenticated', 'public.department_chat_model_configurations', 'delete'),
  'RLS is enabled; authenticated users can read but cannot mutate the allowlist.'),
('seeded_default',
  not exists (
    select 1
    from public.integration_connections connection
    join public.integration_connection_departments department
      on department.connection_id = connection.id
     and department.organization_id = connection.organization_id
    where connection.provider = 'openai' and connection.status = 'verified'
      and connection.archived_at is null
      and department.department_id in ('content', 'design', 'marketing')
      and char_length(btrim(coalesce(connection.public_config ->> 'model_id', ''))) > 0
      and not exists (
        select 1 from public.department_chat_model_configurations configuration
        where configuration.organization_id = connection.organization_id
          and configuration.connector_connection_id = connection.id
          and configuration.department_id = department.department_id
          and configuration.model_id = connection.public_config ->> 'model_id'
          and configuration.revoked_at is null and configuration.is_default
      )
  ),
  'Every eligible pre-existing connector mapping has its sole initial default.'),
('dispatch_stale',
  to_regprocedure('public.assert_department_chat_model_dispatch(uuid,uuid,uuid,text,uuid,text,uuid)') is not null
  and not has_function_privilege('authenticated',
    'public.assert_department_chat_model_dispatch(uuid,uuid,uuid,text,uuid,text,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.assert_department_chat_model_dispatch(uuid,uuid,uuid,text,uuid,text,uuid)', 'execute'),
  'Dispatch revalidation exists and remains service-role only.'),
('tenant_role',
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'department_chat_model_configurations'
      and roles @> array['authenticated']::name[]
      and qual like '%is_team_organization_member%'
  )
  and position('operations_admin' in pg_get_functiondef(
    'public.assert_department_chat_model_dispatch(uuid,uuid,uuid,text,uuid,text,uuid)'::regprocedure
  )) > 0,
  'Tenant read policy and existing organization leadership vocabulary are preserved.'),
('immutable_history',
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.department_chat_model_configurations'::regclass
      and tgname = 'trg_department_chat_model_configurations_protect' and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgrelid = 'public.ai_runs'::regclass
      and tgname = 'trg_ai_runs_model_binding' and not tgisinternal
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_runs'::regclass
      and conname = 'ai_runs_department_chat_model_configuration_fkey'
  ),
  'Configuration facts and persisted run identities are immutable and retained by FK.'),
('confirmation_stale',
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.department_chat_proposals'::regclass
      and tgname = 'trg_department_chat_proposals_model_binding' and not tgisinternal
  )
  and position('department_chat_model_configuration_is_current' in pg_get_functiondef(
    'private.protect_department_chat_model_binding()'::regprocedure
  )) > 0,
  'Proposal acceptance independently rejects revoked, mismatched, or stale model identities.');

do $$
declare failures text;
begin
  select string_agg(check_name || ': ' || detail, E'\n' order by check_name)
    into failures
  from p9_model_selection_checks where not passed;
  if failures is not null then
    raise exception 'P9-MODELS-1 verification failed:%', E'\n' || failures;
  end if;
end;
$$;

select check_name, passed, detail
from p9_model_selection_checks
order by check_name;

-- Verification never leaves schema or data changes behind.
rollback;
