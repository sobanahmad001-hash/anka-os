-- WCH3/WCH4 rollback-only verification. Run after the WCH3 migration.

begin;

create temporary table wch3_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

create function pg_temp.wch3_fail_version_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'WCH3 injected failure';
end;
$$;

insert into wch3_checks values
  ('proposal_table_rls_enabled', (
    select relrowsecurity from pg_class where oid = 'public.department_chat_proposals'::regclass
  )),
  ('browser_acl_is_read_only',
    has_table_privilege('authenticated', 'public.department_chat_proposals', 'SELECT')
    and not has_table_privilege('authenticated', 'public.department_chat_proposals', 'INSERT')
    and not has_table_privilege('authenticated', 'public.department_chat_proposals', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.department_chat_proposals', 'DELETE')
    and not has_table_privilege('anon', 'public.department_chat_proposals', 'SELECT')
  ),
  ('rpc_acl_is_service_role_only',
    has_function_privilege('service_role', 'public.save_department_chat_proposal(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.confirm_department_chat_proposal(uuid,uuid,text,uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.reject_department_chat_proposal(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.save_department_chat_proposal(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.confirm_department_chat_proposal(uuid,uuid,text,uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.reject_department_chat_proposal(uuid,uuid)', 'EXECUTE')
  ),
  ('preview_has_no_official_write',
    position('insert into public.ai_runs' in pg_get_functiondef('public.save_department_chat_proposal(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure)) > 0
    and position('insert into public.department_chat_proposals' in pg_get_functiondef('public.save_department_chat_proposal(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure)) > 0
    and position('insert into public.artifacts' in pg_get_functiondef('public.save_department_chat_proposal(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure)) = 0
    and position('save_work_item' in pg_get_functiondef('public.save_department_chat_proposal(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure)) = 0
  ),
  ('confirmation_is_proposer_only',
    position('Only the proposer can confirm' in pg_get_functiondef('public.confirm_department_chat_proposal(uuid,uuid,text,uuid,text)'::regprocedure)) > 0
  ),
  ('tasks_are_untouched',
    position('public.tasks' in pg_get_functiondef('public.save_department_chat_proposal(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure)) = 0
    and position('public.tasks' in pg_get_functiondef('public.confirm_department_chat_proposal(uuid,uuid,text,uuid,text)'::regprocedure)) = 0
    and position('public.tasks' in pg_get_functiondef('public.reject_department_chat_proposal(uuid,uuid)'::regprocedure)) = 0
  );

do $$
declare
  v_organization_id uuid;
  v_engagement_id uuid;
  v_project_id uuid;
  v_actor_id uuid;
  v_department_id text;
  v_connector_id uuid;
  v_model_id text;
  v_work_preview jsonb;
  v_work_confirm jsonb;
  v_replay jsonb;
  v_reject_preview jsonb;
  v_reject jsonb;
  v_stale_preview jsonb;
  v_stale jsonb;
  v_expired_preview jsonb;
  v_expired jsonb;
  v_artifact_preview jsonb;
  v_artifact_confirm jsonb;
  v_failure_preview jsonb;
  v_before_work_items bigint;
  v_before_tasks bigint;
  v_before_artifacts bigint;
  v_before_versions bigint;
  v_failed boolean := false;
  v_artifact_type text;
begin
  select
    engagement.organization_id,
    engagement.id,
    engagement.project_id,
    membership.user_id,
    mapping.department_id,
    connection.id,
    connection.public_config ->> 'model_id'
  into
    v_organization_id, v_engagement_id, v_project_id, v_actor_id,
    v_department_id, v_connector_id, v_model_id
  from public.integration_connection_engagements mapping
  join public.integration_connections connection
    on connection.id = mapping.connection_id
   and connection.organization_id = mapping.organization_id
  join public.engagements engagement
    on engagement.id = mapping.engagement_id
   and engagement.organization_id = mapping.organization_id
  join public.organization_memberships membership
    on membership.organization_id = mapping.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
   and (
     membership.department_id = mapping.department_id
     or membership.role in ('system_owner', 'operations_admin', 'executive')
   )
  where mapping.department_id in ('content', 'design', 'marketing', 'development')
    and connection.provider = 'openai'
    and connection.status = 'verified'
    and connection.archived_at is null
    and nullif(connection.public_config ->> 'model_id', '') is not null
    and exists (
      select 1 from public.engagement_services service
      join public.service_catalog catalog on catalog.id = service.service_id
      where service.organization_id = mapping.organization_id
        and service.engagement_id = mapping.engagement_id
        and service.status = 'active'
        and catalog.department_id = mapping.department_id
    )
    and (
      select count(*)
      from public.integration_connection_engagements other_mapping
      join public.integration_connections other_connection
        on other_connection.id = other_mapping.connection_id
       and other_connection.organization_id = other_mapping.organization_id
      join public.integration_connection_departments other_department
        on other_department.connection_id = other_connection.id
       and other_department.organization_id = other_connection.organization_id
       and other_department.department_id = other_mapping.department_id
      where other_mapping.organization_id = mapping.organization_id
        and other_mapping.engagement_id = mapping.engagement_id
        and other_mapping.department_id = mapping.department_id
        and other_connection.provider = 'openai'
        and other_connection.status = 'verified'
        and other_connection.archived_at is null
    ) = 1
  limit 1;

  if v_engagement_id is null then
    raise exception 'WCH3 verifier requires one engagement/department with exactly one verified OpenAI connector, explicit model, active service, and authorized team member.';
  end if;

  v_artifact_type := case v_department_id
    when 'content' then 'content'
    when 'design' then 'design_system'
    when 'marketing' then 'measurement_plan'
    else 'technical_brief'
  end;

  select count(*) into v_before_work_items from public.work_items;
  select count(*) into v_before_tasks from public.tasks;
  select count(*) into v_before_artifacts from public.artifacts;
  select count(*) into v_before_versions from public.artifact_versions;

  v_work_preview := public.save_department_chat_proposal(
    v_organization_id, v_engagement_id, v_project_id, v_department_id,
    v_actor_id, 'work_item', 'task', null, null,
    jsonb_build_object('title', 'WCH3 rollback work item', 'description', 'Verifier only.', 'priority', 'medium'),
    jsonb_build_object('title', 'WCH3 rollback work item', 'description', 'Verifier only.', 'work_item_type', 'task', 'priority', 'medium', 'status', 'not_started'),
    jsonb_build_object('prompt_length', 8, 'prompt_checksum', repeat('1', 64)),
    '{}'::uuid[], repeat('a', 64), v_connector_id, v_model_id,
    gen_random_uuid(), 'Verifier', 'Verifier output', 1, 1, 1, 0
  );
  insert into wch3_checks values (
    'preview_creates_no_official_record',
    (select count(*) from public.work_items) = v_before_work_items
    and (select count(*) from public.tasks) = v_before_tasks
    and (select count(*) from public.artifacts) = v_before_artifacts
    and (select count(*) from public.artifact_versions) = v_before_versions
  );

  v_work_confirm := public.confirm_department_chat_proposal(
    (v_work_preview ->> 'proposal_id')::uuid, v_actor_id, repeat('a', 64),
    v_connector_id, v_model_id
  );
  v_replay := public.confirm_department_chat_proposal(
    (v_work_preview ->> 'proposal_id')::uuid, v_actor_id, repeat('a', 64),
    v_connector_id, v_model_id
  );
  insert into wch3_checks values
    ('work_item_is_not_started', exists (
      select 1 from public.work_items item
      where item.id = (v_work_confirm ->> 'work_item_id')::uuid
        and item.status = 'not_started'
        and item.created_via = 'ai_chat_proposal'
        and item.department_id = v_department_id
    )),
    ('accepted_replay_is_idempotent',
      v_replay ->> 'outcome' = 'accepted'
      and (v_replay ->> 'replayed')::boolean
      and v_replay ->> 'work_item_id' = v_work_confirm ->> 'work_item_id'
      and (select count(*) from public.work_items) = v_before_work_items + 1
    );

  begin
    perform public.confirm_department_chat_proposal(
      (v_work_preview ->> 'proposal_id')::uuid, gen_random_uuid(),
      repeat('a', 64), v_connector_id, v_model_id
    );
  exception when insufficient_privilege then
    v_failed := true;
  end;
  insert into wch3_checks values ('cross_actor_confirmation_fails', v_failed);

  v_reject_preview := public.save_department_chat_proposal(
    v_organization_id, v_engagement_id, v_project_id, v_department_id,
    v_actor_id, 'work_item', 'bug', null, null,
    jsonb_build_object('title', 'Rejected verifier item', 'description', '', 'priority', 'low'),
    jsonb_build_object('title', 'Rejected verifier item', 'work_item_type', 'bug', 'priority', 'low', 'status', 'not_started'),
    '{}'::jsonb, '{}'::uuid[], repeat('b', 64), v_connector_id, v_model_id,
    gen_random_uuid(), 'Verifier', 'Verifier output', 1, 1, 1, 0
  );
  v_reject := public.reject_department_chat_proposal(
    (v_reject_preview ->> 'proposal_id')::uuid, v_actor_id
  );
  insert into wch3_checks values (
    'rejection_creates_no_record',
    v_reject ->> 'outcome' = 'rejected'
    and (select count(*) from public.work_items) = v_before_work_items + 1
  );

  v_stale_preview := public.save_department_chat_proposal(
    v_organization_id, v_engagement_id, v_project_id, v_department_id,
    v_actor_id, 'work_item', 'request', null, null,
    jsonb_build_object('title', 'Stale verifier item', 'description', '', 'priority', 'medium'),
    jsonb_build_object('title', 'Stale verifier item', 'work_item_type', 'request', 'priority', 'medium', 'status', 'not_started'),
    '{}'::jsonb, '{}'::uuid[], repeat('c', 64), v_connector_id, v_model_id,
    gen_random_uuid(), 'Verifier', 'Verifier output', 1, 1, 1, 0
  );
  v_stale := public.confirm_department_chat_proposal(
    (v_stale_preview ->> 'proposal_id')::uuid, v_actor_id, repeat('d', 64),
    v_connector_id, v_model_id
  );
  insert into wch3_checks values (
    'stale_confirmation_creates_no_record',
    v_stale ->> 'outcome' = 'stale'
    and (select count(*) from public.work_items) = v_before_work_items + 1
  );

  v_expired_preview := public.save_department_chat_proposal(
    v_organization_id, v_engagement_id, v_project_id, v_department_id,
    v_actor_id, 'work_item', 'task', null, null,
    jsonb_build_object('title', 'Expired verifier item', 'description', '', 'priority', 'medium'),
    jsonb_build_object('title', 'Expired verifier item', 'work_item_type', 'task', 'priority', 'medium', 'status', 'not_started'),
    '{}'::jsonb, '{}'::uuid[], repeat('e', 64), v_connector_id, v_model_id,
    gen_random_uuid(), 'Verifier', 'Verifier output', 1, 1, 1, 0
  );
  execute 'alter table public.department_chat_proposals disable trigger trg_department_chat_proposals_protect';
  update public.department_chat_proposals
  set created_at = now() - interval '25 hours',
      expires_at = now() - interval '1 hour',
      updated_at = now() - interval '1 hour'
  where id = (v_expired_preview ->> 'proposal_id')::uuid;
  execute 'alter table public.department_chat_proposals enable trigger trg_department_chat_proposals_protect';
  v_expired := public.confirm_department_chat_proposal(
    (v_expired_preview ->> 'proposal_id')::uuid, v_actor_id, repeat('e', 64),
    v_connector_id, v_model_id
  );
  insert into wch3_checks values (
    'expired_confirmation_creates_no_record',
    v_expired ->> 'outcome' = 'expired'
    and (select count(*) from public.work_items) = v_before_work_items + 1
  );

  v_artifact_preview := public.save_department_chat_proposal(
    v_organization_id, v_engagement_id, v_project_id, v_department_id,
    v_actor_id, 'artifact_version', v_artifact_type, null, null,
    jsonb_build_object('title', 'WCH3 rollback artifact', 'content', jsonb_build_object('summary', 'Verifier only'), 'change_summary', 'Verifier'),
    jsonb_build_object('title', 'WCH3 rollback artifact', 'artifact_type', v_artifact_type, 'content', jsonb_build_object('summary', 'Verifier only')),
    '{}'::jsonb, '{}'::uuid[], repeat('f', 64), v_connector_id, v_model_id,
    gen_random_uuid(), 'Verifier', 'Verifier output', 1, 1, 1, 0
  );
  v_artifact_confirm := public.confirm_department_chat_proposal(
    (v_artifact_preview ->> 'proposal_id')::uuid, v_actor_id, repeat('f', 64),
    v_connector_id, v_model_id
  );
  insert into wch3_checks values (
    'artifact_is_unapproved',
    exists (
      select 1 from public.artifact_versions version
      where version.id = (v_artifact_confirm ->> 'artifact_version_id')::uuid
        and version.ai_use_allowed = false
        and version.data_classification = 'internal'
    )
    and not exists (
      select 1 from public.artifact_approvals approval
      where approval.artifact_version_id = (v_artifact_confirm ->> 'artifact_version_id')::uuid
    )
  );

  v_failure_preview := public.save_department_chat_proposal(
    v_organization_id, v_engagement_id, v_project_id, v_department_id,
    v_actor_id, 'artifact_version', v_artifact_type, null, null,
    jsonb_build_object('title', 'WCH3 injected failure artifact', 'content', jsonb_build_object('summary', 'Must roll back'), 'change_summary', 'Verifier'),
    jsonb_build_object('title', 'WCH3 injected failure artifact', 'artifact_type', v_artifact_type, 'content', jsonb_build_object('summary', 'Must roll back')),
    '{}'::jsonb, '{}'::uuid[], repeat('9', 64), v_connector_id, v_model_id,
    gen_random_uuid(), 'Verifier', 'Verifier output', 1, 1, 1, 0
  );
  execute 'create trigger wch3_injected_failure
    before insert on public.artifact_versions
    for each row execute function pg_temp.wch3_fail_version_insert()';
  v_before_artifacts := (select count(*) from public.artifacts);
  v_before_versions := (select count(*) from public.artifact_versions);
  begin
    perform public.confirm_department_chat_proposal(
      (v_failure_preview ->> 'proposal_id')::uuid, v_actor_id, repeat('9', 64),
      v_connector_id, v_model_id
    );
  exception when others then
    null;
  end;
  execute 'drop trigger wch3_injected_failure on public.artifact_versions';
  insert into wch3_checks values (
    'transaction_failure_rolls_back',
    (select count(*) from public.artifacts) = v_before_artifacts
    and (select count(*) from public.artifact_versions) = v_before_versions
    and exists (
      select 1 from public.department_chat_proposals proposal
      where proposal.id = (v_failure_preview ->> 'proposal_id')::uuid
        and proposal.status = 'pending'
        and proposal.accepted_artifact_version_id is null
    )
  );

  insert into wch3_checks values (
    'tasks_remain_untouched_at_runtime',
    (select count(*) from public.tasks) = v_before_tasks
  );
end;
$$;

do $$
declare
  v_failed_checks text;
begin
  select string_agg(check_name, ', ' order by check_name)
  into v_failed_checks
  from wch3_checks
  where not passed;
  if v_failed_checks is not null then
    raise exception 'WCH3 verification failed: %', v_failed_checks;
  end if;
end;
$$;

select jsonb_object_agg(check_name, passed order by check_name)
  as wch3_department_chat_proposals_verification
from wch3_checks;

rollback;
