-- P9 canonical proposal execution metadata behavior verifier. This script always rolls back.
begin;
create temporary table p9_proposal_execution_metadata_behavior_checks(check_name text,passed boolean,detail text);
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
  insert into p9_proposal_execution_metadata_behavior_checks values(
    'seed_default_runtime',
    (select count(*)=1 from public.department_chat_model_configurations
      where organization_id=o and connector_connection_id=connector_id
        and department_id='content' and is_default and revoked_at is null),
    'The exact seed creates one active sole default for an eligible verified mapped connector.');
end;
$fixture$;
create function pg_temp.review_save(op uuid, requested text[]) returns jsonb language plpgsql as $fn$
declare f p9_model_fixture%rowtype; begin select * into f from p9_model_fixture;
return public.save_department_chat_proposal_with_execution_metadata(
p_organization_id=>f.organization_id,p_engagement_id=>f.engagement_id,p_project_id=>f.project_id,p_department_id=>'content',p_actor_id=>f.contributor_id,p_proposal_kind=>'work_item',p_target_key=>'task',p_artifact_id=>null,p_engagement_stage_instance_id=>null,p_validated_payload=>'{"title":"Review task","description":"Local only","priority":"medium"}',p_preview_payload=>'{"title":"Review task","work_item_type":"task","priority":"medium","status":"not_started"}',p_safe_prompt_metadata=>'{}',p_context_artifact_version_ids=>'{}',p_context_checksum=>repeat('a',64),p_connector_connection_id=>f.connector_id,p_model_id=>'gpt-default',p_idempotency_key=>op,p_input_text=>'Review',p_output_text=>'Review output',p_latency_ms=>1,p_input_tokens=>1,p_output_tokens=>1,p_estimated_cost_microusd=>0,p_model_configuration_id=>f.configuration_id,p_actual_model_id=>'provider-actual',p_requested_tools=>requested,p_executed_tools=>'{}');end;$fn$;
do $tests$ declare op uuid:=gen_random_uuid(); saved jsonb; replayed jsonb; n bigint; denied boolean; begin
saved:=pg_temp.review_save(op,array['tool-a','tool-b']);
insert into p9_proposal_execution_metadata_behavior_checks values('canonical_wrapper_stores_telemetry',(select context_manifest->>'actual_model_id'='provider-actual' and context_manifest->'requested_tools'='["tool-a","tool-b"]'::jsonb from public.ai_runs where id=(saved->>'ai_run_id')::uuid),'Actual canonical wrapper and exact persisted run');
replayed:=pg_temp.review_save(op,array['tool-a','tool-b']);
insert into p9_proposal_execution_metadata_behavior_checks values('identical_replay_same_run',saved->>'ai_run_id'=replayed->>'ai_run_id','Same operation retains exact run');
select count(*) into n from public.ai_runs; denied:=false;
begin perform pg_temp.review_save(gen_random_uuid(),null); exception when check_violation then denied:=true; end;
insert into p9_proposal_execution_metadata_behavior_checks values('invalid_telemetry_atomic_rollback',denied and (select count(*) from public.ai_runs)=n,'Invalid metadata rolls back canonical creation');
denied:=false;
begin perform pg_temp.review_save(op,array['tool-a']); exception when check_violation then denied:=true; end;
insert into p9_proposal_execution_metadata_behavior_checks values('removed_tool_replay_rejected',denied and (select context_manifest->'requested_tools'='["tool-a","tool-b"]'::jsonb from public.ai_runs where id=(saved->>'ai_run_id')::uuid),'Replay must not remove a stored requested tool');

denied:=false;
begin perform pg_temp.review_save(op,array['tool-a','tool-c']); exception when check_violation then denied:=true; end;
insert into p9_proposal_execution_metadata_behavior_checks values('changed_tool_replay_rejected',denied and (select context_manifest->'requested_tools'='["tool-a","tool-b"]'::jsonb from public.ai_runs where id=(saved->>'ai_run_id')::uuid),'Replay must not change a stored requested tool');

denied:=false;
begin perform pg_temp.review_save(op,array[]::text[]); exception when check_violation then denied:=true; end;
insert into p9_proposal_execution_metadata_behavior_checks values('empty_tool_replay_rejected',denied and (select context_manifest->'requested_tools'='["tool-a","tool-b"]'::jsonb from public.ai_runs where id=(saved->>'ai_run_id')::uuid),'Replay must not replace stored requested tools with an empty array');
end;$tests$;

do $assert$
begin
  if exists (select 1 from p9_proposal_execution_metadata_behavior_checks where not passed)
     or (select count(*) from p9_proposal_execution_metadata_behavior_checks) <> 7 then
    raise exception 'P9 proposal execution metadata behavior verification failed';
  end if;
end;
$assert$;

table p9_proposal_execution_metadata_behavior_checks;
rollback;
