-- P9-MODELS-1 executable verifier. This script always rolls back.
begin;

create temporary table p9_model_selection_checks (
  check_name text primary key,
  passed boolean not null,
  detail text not null
) on commit drop;
grant select, insert on p9_model_selection_checks to service_role, authenticated;

do $catalog$
declare
  v_function regprocedure;
  v_constraint text;
begin
  insert into p9_model_selection_checks values
  ('schema_columns_constraints',
    (select array_agg(attname::text order by attname) @> array[
      'connector_connection_id','created_by','department_id','display_name','id',
      'is_default','model_id','organization_id','revoked_at','revoked_by','verified_at'
    ] from pg_attribute
      where attrelid = 'public.department_chat_model_configurations'::regclass
        and attnum > 0 and not attisdropped)
    and exists (select 1 from pg_constraint
      where conrelid = 'public.department_chat_model_configurations'::regclass
        and conname = 'department_chat_model_configurations_connector_fkey')
    and exists (select 1 from pg_constraint
      where conrelid = 'public.department_chat_model_configurations'::regclass
        and conname = 'department_chat_model_configurations_revocation_check')
    and exists (select 1 from pg_constraint
      where conrelid = 'public.department_chat_model_configurations'::regclass
        and conname = 'department_chat_model_configurations_default_check')
    and exists (select 1 from pg_constraint
      where conrelid = 'public.ai_runs'::regclass
        and conname = 'ai_runs_department_chat_model_configuration_fkey')
    and exists (select 1 from pg_constraint
      where conrelid = 'public.department_chat_proposals'::regclass
        and conname = 'department_chat_proposals_model_configuration_fkey'),
    'Exact allowlist columns, checks, and organization-composite ledger foreign keys exist.'),
  ('schema_indexes_triggers',
    to_regclass('public.idx_department_chat_model_configurations_default') is not null
    and to_regclass('public.idx_department_chat_model_configurations_active_model') is not null
    and to_regclass('public.idx_department_chat_model_configurations_active') is not null
    and to_regclass('public.idx_ai_runs_department_chat_model_configuration') is not null
    and to_regclass('public.idx_department_chat_proposals_model_configuration') is not null
    and exists (select 1 from pg_trigger
      where tgrelid = 'public.department_chat_model_configurations'::regclass
        and tgname = 'trg_department_chat_model_configurations_protect' and not tgisinternal)
    and exists (select 1 from pg_trigger
      where tgrelid = 'public.department_chat_proposals'::regclass
        and tgname = 'trg_department_chat_proposals_model_binding' and not tgisinternal)
    and exists (select 1 from pg_trigger
      where tgrelid = 'public.ai_runs'::regclass
        and tgname = 'trg_ai_runs_model_binding' and not tgisinternal),
    'Partial indexes and all immutable-binding triggers exist.'),
  ('table_rls_acl',
    (select relrowsecurity from pg_class
      where oid = 'public.department_chat_model_configurations'::regclass)
    and not exists (
      select 1 from pg_class relation
      cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) privilege
      where relation.oid='public.department_chat_model_configurations'::regclass
        and privilege.grantee=0 and privilege.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
    )
    and not has_table_privilege('anon', 'public.department_chat_model_configurations', 'SELECT')
    and has_table_privilege('authenticated', 'public.department_chat_model_configurations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.department_chat_model_configurations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.department_chat_model_configurations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.department_chat_model_configurations', 'DELETE')
    and has_table_privilege('service_role', 'public.department_chat_model_configurations', 'SELECT')
    and has_table_privilege('service_role', 'public.department_chat_model_configurations', 'INSERT')
    and has_table_privilege('service_role', 'public.department_chat_model_configurations', 'UPDATE')
    and has_table_privilege('service_role', 'public.department_chat_model_configurations', 'DELETE')
    and exists (select 1 from pg_policies
      where schemaname = 'public' and tablename = 'department_chat_model_configurations'
        and roles @> array['authenticated']::name[]
        and qual like '%is_team_organization_member%'),
    'RLS and explicit PUBLIC/anon/authenticated/service-role table grants are least privilege.');

  foreach v_function in array array[
    'public.assert_department_chat_model_dispatch(uuid,uuid,uuid,text,uuid,text,uuid)'::regprocedure,
    'public.configure_department_chat_model_allowlist(uuid,uuid,uuid,jsonb)'::regprocedure,
    'public.save_department_chat_proposal_with_model(uuid,uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure,
    'public.save_department_chat_conversation_proposal_with_model(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure
  ] loop
    if exists (
         select 1 from pg_proc procedure
         cross join lateral aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) privilege
         where procedure.oid=v_function and privilege.grantee=0
           and privilege.privilege_type='EXECUTE'
       )
       or has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not has_function_privilege('service_role', v_function, 'EXECUTE')
       or (select prosecdef from pg_proc where oid = v_function)
    then
      raise exception 'service_rpc_acl_or_security_invalid: %', v_function;
    end if;
  end loop;
  insert into p9_model_selection_checks values
    ('service_rpc_acl', true, 'Every new public RPC is SECURITY INVOKER and executable only by service_role.');

  foreach v_function in array array[
    'private.department_chat_model_configuration_is_current(uuid,uuid,uuid,text,uuid,text)'::regprocedure,
    'private.bind_department_chat_model_configuration(jsonb,uuid,uuid,uuid,text,uuid,text)'::regprocedure,
    'private.protect_department_chat_model_configuration()'::regprocedure,
    'private.protect_department_chat_model_binding()'::regprocedure,
    'private.protect_ai_run_model_binding()'::regprocedure
  ] loop
    if exists (
      select 1 from pg_proc procedure
      cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
      where procedure.oid = v_function and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
    ) then
      raise exception 'private_helper_execute_not_revoked: %', v_function;
    end if;
  end loop;
  insert into p9_model_selection_checks values
    ('private_function_acl', true, 'Private model helpers are unavailable to PUBLIC, anon, and authenticated.');

  select pg_get_constraintdef(oid) into v_constraint
  from pg_constraint where conrelid = 'public.ai_runs'::regclass
    and conname = 'ai_runs_department_chat_model_configuration_fkey';
  if lower(v_constraint) not like '%(department_chat_model_configuration_id, organization_id)%'
     or lower(v_constraint) not like '%(id, organization_id)%' then
    raise exception 'ai_run_model_fk_not_tenant_composite';
  end if;
end;
$catalog$;

create temporary table p9_model_fixture (
  organization_id uuid, foreign_organization_id uuid, leader_id uuid,
  contributor_id uuid, suspended_id uuid, foreign_leader_id uuid,
  project_id uuid, engagement_id uuid, connector_id uuid, configuration_id uuid
) on commit drop;
grant select on p9_model_fixture to service_role, authenticated;

do $fixture$
declare
  o uuid := '91000000-0000-4000-8000-000000000001';
  fo uuid := '91000000-0000-4000-8000-000000000002';
  leader uuid := '92000000-0000-4000-8000-000000000001';
  contributor uuid := '92000000-0000-4000-8000-000000000002';
  suspended uuid := '92000000-0000-4000-8000-000000000003';
  foreign_leader uuid := '92000000-0000-4000-8000-000000000004';
  client_id uuid; agency_client_id uuid; brand_id uuid; project_id uuid;
  engagement_id uuid; service_id uuid; connector_id uuid; foreign_connector_id uuid;
  configuration_id uuid;
begin
  insert into public.organizations(id,name,slug,status) values
    (o,'P9 model verifier','p9-model-verifier-a','active'),
    (fo,'P9 model verifier foreign','p9-model-verifier-b','active');
  insert into auth.users(id) values (leader),(contributor),(suspended),(foreign_leader);
  insert into public.organization_memberships(
    organization_id,user_id,member_kind,role,department_id,status
  ) values
    (o,leader,'team','operations_admin',null,'active'),
    (o,contributor,'team','contributor','content','active'),
    (o,suspended,'team','operations_admin',null,'suspended'),
    (fo,foreign_leader,'team','operations_admin',null,'active');

  insert into public.clients(name,company,owner_id,organization_id)
  values('P9 model verifier','P9',leader,o) returning id into client_id;
  insert into public.agency_clients(
    organization_id,legacy_client_id,canonical_client_id,name,owner_id,created_by
  ) values(o,client_id,client_id,'P9 model verifier',leader,leader)
  returning id into agency_client_id;
  insert into public.brands(organization_id,client_id,name,is_default,created_by)
  values(o,agency_client_id,'P9 model verifier',true,leader) returning id into brand_id;
  insert into public.projects(
    name,department_id,status,owner_id,organization_id,client_id,engagement_type
  ) values('P9 model verifier','content','active',leader,o,client_id,'project')
  returning id into project_id;
  insert into public.engagements(
    organization_id,client_id,brand_id,legacy_project_id,project_id,
    name,engagement_type,status,created_by
  ) values(o,agency_client_id,brand_id,project_id,project_id,
    'P9 model verifier','project','active',leader)
  returning id into engagement_id;
  insert into public.service_catalog(organization_id,department_id,slug,name)
  values(o,'content','p9_model_verifier','P9 model verifier') returning id into service_id;
  insert into public.engagement_services(
    organization_id,engagement_id,service_id,status,activated_by
  ) values(o,engagement_id,service_id,'active',leader);

  insert into public.integration_connections(
    organization_id,provider,display_name,public_config,secret_name,status,
    last_checked_at,last_check_status,created_by
  ) values(
    o,'openai','P9 model verifier',
    '{"model_id":"gpt-default","verified_model_ids":["gpt-default","gpt-other"]}',
    'ANKA_OPENAI_P9_MODEL_VERIFIER','verified',clock_timestamp(),'passed',leader
  ) returning id into connector_id;
  insert into public.integration_connection_departments(
    connection_id,organization_id,department_id,created_by
  ) values(connector_id,o,'content',leader);
  insert into public.integration_connection_engagements(
    connection_id,organization_id,engagement_id,department_id,created_by
  ) values(connector_id,o,engagement_id,'content',leader);

  insert into public.integration_connections(
    organization_id,provider,display_name,public_config,secret_name,status,
    last_checked_at,last_check_status,created_by
  ) values(
    fo,'openai','P9 model verifier foreign','{"model_id":"gpt-foreign"}',
    'ANKA_OPENAI_P9_MODEL_FOREIGN','verified',clock_timestamp(),'passed',foreign_leader
  ) returning id into foreign_connector_id;
  insert into public.integration_connection_departments(
    connection_id,organization_id,department_id,created_by
  ) values(foreign_connector_id,fo,'content',foreign_leader);

  -- Re-execute the migration's seed statement against a connector created after migration.
  insert into public.department_chat_model_configurations (
    organization_id,department_id,connector_connection_id,model_id,
    display_name,is_default,verified_at,created_by
  )
  select connection.organization_id,mapping.department_id,connection.id,
    btrim(connection.public_config ->> 'model_id'),
    btrim(connection.public_config ->> 'model_id'),true,
    coalesce(connection.last_checked_at,connection.updated_at),connection.created_by
  from public.integration_connections connection
  join public.integration_connection_departments mapping
    on mapping.connection_id = connection.id
   and mapping.organization_id = connection.organization_id
  where connection.id in (connector_id,foreign_connector_id)
    and connection.provider = 'openai' and connection.status = 'verified'
    and connection.archived_at is null
    and mapping.department_id in ('content','design','marketing')
    and char_length(btrim(coalesce(connection.public_config ->> 'model_id',''))) between 1 and 120
  on conflict do nothing;

  select id into strict configuration_id
  from public.department_chat_model_configurations
  where organization_id=o and connector_connection_id=connector_id
    and department_id='content' and model_id='gpt-default'
    and is_default and revoked_at is null;
  insert into p9_model_fixture values(
    o,fo,leader,contributor,suspended,foreign_leader,
    project_id,engagement_id,connector_id,configuration_id
  );
  insert into p9_model_selection_checks values(
    'seed_default_runtime',
    (select count(*)=1 from public.department_chat_model_configurations
      where organization_id=o and connector_connection_id=connector_id
        and department_id='content' and is_default and revoked_at is null),
    'The exact seed creates one active sole default for an eligible verified mapped connector.');
end;
$fixture$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select leader_id from p9_model_fixture),'role','authenticated')::text,true);
set local role authenticated;
insert into p9_model_selection_checks
select 'rls_own_foreign_runtime',
  count(*)=1 and bool_and(organization_id=(select organization_id from p9_model_fixture)),
  'Active team members read only configurations in their organization.'
from public.department_chat_model_configurations
where organization_id in (
  (select organization_id from p9_model_fixture),
  (select foreign_organization_id from p9_model_fixture)
);
reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select suspended_id from p9_model_fixture),'role','authenticated')::text,true);
set local role authenticated;
insert into p9_model_selection_checks
select 'rls_suspended_runtime',count(*)=0,
  'Suspended memberships cannot read model configurations.'
from public.department_chat_model_configurations
where organization_id=(select organization_id from p9_model_fixture);
do $denied$
declare blocked boolean := false;
begin
  begin
    update public.department_chat_model_configurations set display_name='blocked';
  exception when insufficient_privilege then blocked := true;
  end;
  insert into p9_model_selection_checks values(
    'browser_direct_mutation_denied',blocked,
    'Authenticated direct mutation is rejected by table ACL.');
end;
$denied$;
reset role;

set local role service_role;
do $runtime$
declare
  f p9_model_fixture%rowtype;
  active_configuration uuid;
  saved jsonb; replayed jsonb; stale_confirmation jsonb; operation_key uuid := gen_random_uuid();
  denied boolean;
  before_work_items bigint; before_proposals bigint; before_runs bigint; before_audit bigint;
begin
  select * into strict f from p9_model_fixture;

  denied := false;
  begin
    perform public.configure_department_chat_model_allowlist(
      f.organization_id,f.connector_id,f.contributor_id,'{"content":["gpt-default"]}'::jsonb);
  exception when insufficient_privilege then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'configure_leadership_runtime',denied,
    'An active department contributor cannot configure the allowlist.');

  denied := false;
  begin
    perform public.configure_department_chat_model_allowlist(
      f.organization_id,f.connector_id,f.leader_id,'{"content":["browser-invented"]}'::jsonb);
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'configure_unverified_runtime',denied,
    'A fabricated/unverified model ID is rejected.');

  denied := false;
  begin
    perform public.configure_department_chat_model_allowlist(
      f.organization_id,f.connector_id,f.leader_id,'{"design":["gpt-default"]}'::jsonb);
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'configure_unmapped_runtime',denied,
    'A model cannot be configured for an unmapped department.');

  perform public.configure_department_chat_model_allowlist(
    f.organization_id,f.connector_id,f.leader_id,'{"content":["gpt-other"]}'::jsonb);
  select id into strict active_configuration
  from public.department_chat_model_configurations
  where organization_id=f.organization_id and connector_connection_id=f.connector_id
    and department_id='content' and model_id='gpt-other'
    and is_default and revoked_at is null;
  insert into p9_model_selection_checks values(
    'configure_leader_runtime',true,
    'An active organization leader can replace the mapped allowlist with a verified model.');

  perform public.assert_department_chat_model_dispatch(
    active_configuration,f.organization_id,f.engagement_id,'content',
    f.connector_id,'gpt-other',f.contributor_id);
  insert into p9_model_selection_checks values(
    'dispatch_current_runtime',true,
    'Current mapped configuration, service, connector, and contributor pass dispatch validation.');

  denied := false;
  begin
    perform public.assert_department_chat_model_dispatch(
      active_configuration,f.organization_id,f.engagement_id,'content',
      f.connector_id,'gpt-other',f.suspended_id);
  exception when insufficient_privilege then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'dispatch_suspended_actor_runtime',denied,
    'A suspended team actor is rejected at the service dispatch RPC boundary.');

  update public.organization_memberships set status='revoked'
  where organization_id=f.organization_id and user_id=f.contributor_id;
  denied := false;
  begin
    perform public.assert_department_chat_model_dispatch(
      active_configuration,f.organization_id,f.engagement_id,'content',
      f.connector_id,'gpt-other',f.contributor_id);
  exception when insufficient_privilege then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'dispatch_revoked_actor_runtime',denied,
    'A revoked team actor is rejected at the service dispatch RPC boundary.');
  update public.organization_memberships set status='active'
  where organization_id=f.organization_id and user_id=f.contributor_id;

  denied := false;
  begin
    perform public.assert_department_chat_model_dispatch(
      gen_random_uuid(),f.organization_id,f.engagement_id,'content',
      f.connector_id,'gpt-other',f.contributor_id);
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'dispatch_fabricated_runtime',denied,
    'A fabricated opaque configuration identity is rejected.');

  saved := public.save_department_chat_proposal_with_model(
    active_configuration,
    f.organization_id,f.engagement_id,f.project_id,'content',f.contributor_id,
    'work_item','task',null,null,
    '{"title":"Verifier item","description":"Verifier only","priority":"medium"}',
    '{"title":"Verifier item","work_item_type":"task","priority":"medium","status":"not_started"}',
    '{}'::jsonb,'{}'::uuid[],repeat('a',64),f.connector_id,'gpt-other',
    operation_key,'Verifier','Verifier output',1,1,1,0
  );
  replayed := public.save_department_chat_proposal_with_model(
    active_configuration,
    f.organization_id,f.engagement_id,f.project_id,'content',f.contributor_id,
    'work_item','task',null,null,
    '{"title":"Verifier item","description":"Verifier only","priority":"medium"}',
    '{"title":"Verifier item","work_item_type":"task","priority":"medium","status":"not_started"}',
    '{}'::jsonb,'{}'::uuid[],repeat('a',64),f.connector_id,'gpt-other',
    operation_key,'Verifier','Verifier output',1,1,1,0
  );
  insert into p9_model_selection_checks values(
    'proposal_run_binding_replay_runtime',
    saved->>'proposal_id'=replayed->>'proposal_id'
    and saved->>'ai_run_id'=replayed->>'ai_run_id'
    and (select model_configuration_id=active_configuration
      from public.department_chat_proposals where id=(saved->>'proposal_id')::uuid)
    and (select department_chat_model_configuration_id=active_configuration
      from public.ai_runs where id=(saved->>'ai_run_id')::uuid),
    'Exact proposal/run identity is atomically bound and exact replay is idempotent.');

  denied := false;
  begin
    update public.department_chat_proposals
    set model_configuration_id=f.configuration_id
    where id=(saved->>'proposal_id')::uuid;
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'proposal_binding_immutable_runtime',
    denied and (select model_configuration_id=active_configuration
      from public.department_chat_proposals where id=(saved->>'proposal_id')::uuid),
    'A bound proposal model configuration cannot be replaced.');

  denied := false;
  begin
    update public.ai_runs
    set department_chat_model_configuration_id=f.configuration_id
    where id=(saved->>'ai_run_id')::uuid;
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'ai_run_binding_immutable_runtime',
    denied and (select department_chat_model_configuration_id=active_configuration
      from public.ai_runs where id=(saved->>'ai_run_id')::uuid),
    'A bound AI-run model configuration cannot be replaced.');

  denied := false;
  begin
    update public.department_chat_model_configurations
    set model_id='mutated'
    where id=active_configuration;
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'configuration_immutable_runtime',denied,
    'Configuration identity fields cannot be mutated.');

  select count(*) into before_work_items from public.work_items;
  select count(*) into before_proposals from public.department_chat_proposals;
  select count(*) into before_runs from public.ai_runs;
  select count(*) into before_audit from public.department_chat_audit_events;
  update public.integration_connections set status='error' where id=f.connector_id;
  denied := false;
  begin
    perform public.assert_department_chat_model_dispatch(
      active_configuration,f.organization_id,f.engagement_id,'content',
      f.connector_id,'gpt-other',f.contributor_id);
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'dispatch_stale_connector_runtime',
    denied
      and (select revoked_at is null from public.department_chat_model_configurations where id=active_configuration)
      and (select count(*) from public.work_items)=before_work_items
      and (select count(*) from public.department_chat_proposals)=before_proposals
      and (select count(*) from public.ai_runs)=before_runs
      and (select count(*) from public.department_chat_audit_events)=before_audit,
    'A still-unrevoked configuration made stale by connector status is rejected before every side effect.');

  stale_confirmation := public.confirm_department_chat_proposal(
    (saved->>'proposal_id')::uuid,f.contributor_id,repeat('a',64),
    f.connector_id,'gpt-other');
  insert into p9_model_selection_checks values(
    'confirmation_stale_no_side_effect_runtime',
    stale_confirmation->>'outcome'='stale'
      and (select count(*) from public.work_items)=before_work_items
      and exists(select 1 from public.department_chat_proposals
        where id=(saved->>'proposal_id')::uuid and status='stale'
          and model_configuration_id=active_configuration)
      and exists(select 1 from public.ai_runs
        where id=(saved->>'ai_run_id')::uuid
          and human_decision='rejected'
          and decision_outcome='context_changed_regenerate'
          and department_chat_model_configuration_id=active_configuration),
    'Confirmation rejects stale connector facts with no official write and preserves bound history.');

  update public.integration_connections set status='verified' where id=f.connector_id;
  operation_key := gen_random_uuid();
  saved := public.save_department_chat_proposal_with_model(
    active_configuration,
    f.organization_id,f.engagement_id,f.project_id,'content',f.contributor_id,
    'work_item','task',null,null,
    '{"title":"Verifier revoked item","description":"Verifier only","priority":"medium"}',
    '{"title":"Verifier revoked item","work_item_type":"task","priority":"medium","status":"not_started"}',
    '{}'::jsonb,'{}'::uuid[],repeat('a',64),f.connector_id,'gpt-other',
    operation_key,'Verifier','Verifier revoked output',1,1,1,0
  );

  update public.department_chat_model_configurations
  set revoked_at=clock_timestamp(),revoked_by=f.leader_id
  where id=active_configuration;
  denied := false;
  begin
    perform public.assert_department_chat_model_dispatch(
      active_configuration,f.organization_id,f.engagement_id,'content',
      f.connector_id,'gpt-other',f.contributor_id);
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'dispatch_revoked_runtime',denied,
    'Revocation blocks a new dispatch.');

  select count(*) into before_work_items from public.work_items;
  denied := false;
  begin
    perform public.confirm_department_chat_proposal(
      (saved->>'proposal_id')::uuid,f.contributor_id,repeat('a',64),
      f.connector_id,'gpt-other');
  exception when check_violation then denied := true;
  end;
  insert into p9_model_selection_checks values(
    'confirmation_revoked_no_side_effect_runtime',
    denied and (select count(*) from public.work_items)=before_work_items
      and exists(select 1 from public.department_chat_proposals
        where id=(saved->>'proposal_id')::uuid and status='pending'
          and model_configuration_id=active_configuration)
      and exists(select 1 from public.ai_runs
        where id=(saved->>'ai_run_id')::uuid
          and department_chat_model_configuration_id=active_configuration),
    'Confirmation revalidation rejects revocation, creates no official record, and preserves history.');

  perform public.configure_department_chat_model_allowlist(
    f.organization_id,f.connector_id,f.leader_id,'{"content":[]}'::jsonb);
  insert into p9_model_selection_checks values(
    'explicit_empty_revocation_runtime',
    not exists(select 1 from public.department_chat_model_configurations
      where organization_id=f.organization_id and connector_connection_id=f.connector_id
        and department_id='content' and revoked_at is null),
    'An explicit empty mapped allowlist revokes active access without deleting history.');
end;
$runtime$;
reset role;

do $final$
declare failures text;
begin
  select string_agg(check_name || ': ' || detail,E'\n' order by check_name)
  into failures from p9_model_selection_checks where not passed;
  if failures is not null then
    raise exception 'P9-MODELS-1 verification failed:%',E'\n' || failures;
  end if;
end;
$final$;

select check_name,passed,detail
from p9_model_selection_checks
order by check_name;

-- Every fixture, proposal, run, and attempted official write is discarded.
rollback;
