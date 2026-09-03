-- WCH3/WCH4 rollback-only verification. Run after the WCH3 migration.

begin;

-- Fixtures are private to this transaction. No existing operating record is selected or changed.
create temp table wch3_fixture (
  department_id text primary key, organization_id uuid, engagement_id uuid, project_id uuid,
  actor_id uuid, client_actor_id uuid, revoked_actor_id uuid, connector_id uuid,
  brand_id uuid, service_id uuid, stage_id uuid
) on commit drop;
grant select on wch3_fixture to service_role, authenticated, anon;
do $$
declare
  d text; o uuid; a uuid; ca uuid; ra uuid; c uuid; ac uuid; b uuid; p uuid; e uuid; s uuid; con uuid;
begin
  foreach d in array array['content','design','marketing','development'] loop
    o := gen_random_uuid(); a := gen_random_uuid(); ca := gen_random_uuid(); ra := gen_random_uuid();
    insert into public.organizations(id,name,slug) values(o,'WCH rollback fixture','wch-' || o);
    insert into auth.users(id) values(a),(ca),(ra);
    insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status)
    values(o,a,'team','contributor',d,'active'),(o,ca,'client','contributor',d,'active'),(o,ra,'team','contributor',d,'revoked');
    insert into public.clients(name,company,owner_id,organization_id) values('WCH fixture','WCH',a,o) returning id into c;
    insert into public.agency_clients(organization_id,legacy_client_id,canonical_client_id,name,owner_id,created_by)
    values(o,c,c,'WCH fixture',a,a) returning id into ac;
    insert into public.brands(organization_id,client_id,name,is_default,created_by) values(o,ac,'WCH fixture',true,a) returning id into b;
    insert into public.projects(name,department_id,status,owner_id,organization_id,client_id,engagement_type)
    values('WCH fixture',d,'active',a,o,c,'project') returning id into p;
    insert into public.engagements(organization_id,client_id,brand_id,legacy_project_id,project_id,name,engagement_type,status,created_by)
    values(o,ac,b,p,p,'WCH fixture','project','active',a) returning id into e;
    insert into public.service_catalog(organization_id,department_id,slug,name) values(o,d,'wch_fixture_' || replace(o::text,'-',''),'WCH fixture') returning id into s;
    insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values(o,e,s,'active',a);
    insert into public.integration_connections(organization_id,provider,display_name,public_config,secret_name,status,created_by)
    values(o,'openai','WCH fixture',jsonb_build_object('model_id','wch-fixture-model'),'ANKA_OPENAI_WCH_FIXTURE','verified',a) returning id into con;
    insert into public.integration_connection_departments(connection_id,organization_id,department_id,created_by) values(con,o,d,a);
    insert into public.integration_connection_engagements(connection_id,organization_id,engagement_id,department_id,created_by) values(con,o,e,d,a);
    insert into wch3_fixture values(d,o,e,p,a,ca,ra,con,b,s,null);
  end loop;
end;
$$;

-- Full existing rows are compared, not counts, so updates/deletes cannot hide behind replacements.
do $$
declare f wch3_fixture; b uuid; a uuid; v uuid; catalog uuid;
begin
  for f in select * from wch3_fixture loop
    select brand_id into b from public.engagements where id=f.engagement_id;
    insert into public.tasks(user_id,title,organization_id,project_id,created_by,status) values(f.actor_id,'WCH sentinel task',f.organization_id,f.project_id,f.actor_id,'backlog');
    insert into public.artifacts(organization_id,project_id,engagement_id,brand_id,artifact_type,title,created_by)
    values(f.organization_id,f.project_id,f.engagement_id,b,'discovery','WCH sentinel',f.actor_id) returning id into a;
    insert into public.artifact_versions(organization_id,artifact_id,version_number,content,content_checksum,created_by)
    values(f.organization_id,a,1,'{"sentinel":true}',repeat('1',64),f.actor_id) returning id into v;
    insert into public.artifact_approvals(organization_id,artifact_id,artifact_version_id,engagement_id,approved_by)
    values(f.organization_id,a,v,f.engagement_id,f.actor_id);
    insert into public.work_items(organization_id,engagement_id,brand_id,department_id,title,created_by)
    values(f.organization_id,f.engagement_id,b,f.department_id,'WCH sentinel work',f.actor_id);
    insert into public.blueprint_stage_catalog(organization_id,slug,name,display_order)
    values(f.organization_id,'wch_sentinel','WCH sentinel',0) returning id into catalog;
    insert into public.engagement_stage_instances(organization_id,engagement_id,stage_catalog_id,name,accountable_department_id,stage_kind,position)
    values(f.organization_id,f.engagement_id,catalog,'WCH sentinel',f.department_id,'delivery',0) returning id into catalog;
    update wch3_fixture set stage_id=catalog where department_id=f.department_id;
  end loop;
end;
$$;
create temp table wch3_original_rows on commit drop as
select 'tasks'::text as table_name, to_jsonb(t) as row_data from public.tasks t
union all select 'artifact_approvals',to_jsonb(t) from public.artifact_approvals t
union all select 'engagement_stage_instances',to_jsonb(t) from public.engagement_stage_instances t
union all select 'artifacts',to_jsonb(t) from public.artifacts t
union all select 'artifact_versions',to_jsonb(t) from public.artifact_versions t
union all select 'work_items',to_jsonb(t) from public.work_items t;

create temp table wch3_source_snapshot(table_name text primary key, rows jsonb) on commit drop;
do $$
declare tab text; snapshot jsonb;
begin
  for tab in select tablename from pg_tables where schemaname='public' loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t',tab) into snapshot;
    insert into wch3_source_snapshot values(tab,snapshot);
  end loop;
end;
$$;

create temporary table wch3_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;
grant select, insert, update on wch3_checks to service_role, authenticated, anon;

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
  ('audit_scope_constraints_and_indexes',
    (select pg_get_constraintdef(oid) = 'FOREIGN KEY (proposal_id, organization_id) REFERENCES department_chat_proposals(id, organization_id) ON DELETE RESTRICT'
      from pg_constraint where conrelid = 'public.department_chat_audit_events'::regclass
        and conname = 'department_chat_audit_proposal_scope_fkey')
    and (select pg_get_constraintdef(oid) = 'FOREIGN KEY (ai_run_id, organization_id) REFERENCES ai_runs(id, organization_id) ON DELETE RESTRICT'
      from pg_constraint where conrelid = 'public.department_chat_audit_events'::regclass
        and conname = 'department_chat_audit_ai_run_scope_fkey')
    and to_regclass('public.idx_department_chat_proposals_ai_run_fk') is null
    and (select pg_get_indexdef(indexrelid) like '%(proposal_id, organization_id, created_at)%'
      from pg_index where indexrelid = 'public.department_chat_audit_proposal_idx'::regclass)
    and (select pg_get_indexdef(indexrelid) like '%(ai_run_id, organization_id)% WHERE (ai_run_id IS NOT NULL)'
      from pg_index where indexrelid = 'public.department_chat_audit_ai_run_idx'::regclass)
  ),
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
    and position('private.department_chat_current_context_checksum' in pg_get_functiondef('public.confirm_department_chat_proposal(uuid,uuid,text,uuid,text)'::regprocedure)) > 0
    and position('database_context_checksum' in pg_get_functiondef('public.confirm_department_chat_proposal(uuid,uuid,text,uuid,text)'::regprocedure)) > 0
    and position('for update' in lower(pg_get_functiondef('public.confirm_department_chat_proposal(uuid,uuid,text,uuid,text)'::regprocedure))) > 0
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
  select organization_id, engagement_id, project_id, actor_id, department_id, connector_id, 'wch-fixture-model'
  into v_organization_id, v_engagement_id, v_project_id, v_actor_id, v_department_id, v_connector_id, v_model_id
  from wch3_fixture where department_id = 'development';

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

create function pg_temp.wch_preview(f wch3_fixture, kind text, target text, actor uuid default null, stage uuid default null)
returns jsonb language sql security invoker as $$
  select public.save_department_chat_proposal(
    f.organization_id,f.engagement_id,f.project_id,f.department_id,coalesce(actor,f.actor_id),kind,target,null,stage,
    jsonb_build_object('title','WCH fixture','description','Fixture','priority','medium','content',jsonb_build_object('notes','Fixture','checklist',jsonb_build_array('Check'))),
    jsonb_build_object('title','WCH fixture'),'{}','{}',repeat('a',64),f.connector_id,'wch-fixture-model',gen_random_uuid(),'','',1,1,1,0
  );
$$;

create temp table wch3_results(department_id text, target text, proposal_id uuid, official_id uuid) on commit drop;
grant all on wch3_results to service_role;
set local role service_role;
do $$
declare f wch3_fixture; target text; kind text; targets text[]; p jsonb; accepted jsonb; replay jsonb; rejected jsonb; before_count bigint; denied boolean; actor uuid;
begin
  for f in select * from wch3_fixture order by department_id loop
    targets := case f.department_id
      when 'content' then array['discovery','vision','audience','website_architecture','keyword_strategy','content','campaign_messaging','scripts']
      when 'design' then array['design_system']
      when 'marketing' then array['channel_strategy','campaign_brief','measurement_plan']
      else array['technical_brief','launch_checklist'] end || array['task','bug','request'];
    foreach target in array targets loop
      kind := case when target in ('task','bug','request') then 'work_item' else 'artifact_version' end;
      select (select count(*) from public.artifact_versions)+(select count(*) from public.work_items) into before_count;
      p := pg_temp.wch_preview(f,kind,target);
      if before_count <> (select (select count(*) from public.artifact_versions)+(select count(*) from public.work_items)) then raise exception 'Preview wrote official state'; end if;
      accepted := public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id,repeat('a',64),f.connector_id,'wch-fixture-model');
      replay := public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id,repeat('a',64),f.connector_id,'wch-fixture-model');
      if accepted->>'outcome' <> 'accepted' or replay->>'replayed' <> 'true'
         or (accepted - 'replayed') is distinct from (replay - 'replayed') then raise exception 'Acceptance/replay failed: % % %', f.department_id,target,accepted; end if;
      if before_count + 1 <> (select (select count(*) from public.artifact_versions)+(select count(*) from public.work_items)) then raise exception 'Official write count failed'; end if;
      if kind = 'artifact_version' and not exists (
        select 1 from public.artifact_versions v where v.id=(accepted->>'artifact_version_id')::uuid and not v.ai_use_allowed and v.data_classification='internal'
        and not exists(select 1 from public.artifact_approvals a where a.artifact_version_id=v.id)
      ) then raise exception 'Artifact boundary failed'; end if;
      if kind = 'work_item' and not exists (
        select 1 from public.work_items w where w.id=(accepted->>'work_item_id')::uuid and w.status='not_started' and w.work_item_type=target and w.assignee_id is null
      ) then raise exception 'Work item boundary failed'; end if;
      if not exists(select 1 from public.engagement_events event where event.payload->>'proposal_id'=p->>'proposal_id' and event.payload->>'ai_run_id'=p->>'ai_run_id') then raise exception 'Missing event provenance'; end if;
      insert into wch3_results values(f.department_id,target,(p->>'proposal_id')::uuid,coalesce((accepted->>'artifact_version_id')::uuid,(accepted->>'work_item_id')::uuid));
      p := pg_temp.wch_preview(f,kind,target);
      rejected := public.reject_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id);
      replay := public.reject_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id);
      if rejected->>'outcome'<>'rejected' or replay->>'replayed'<>'true' then raise exception 'Reject/replay failed'; end if;
      p := pg_temp.wch_preview(f,kind,target);
      rejected := public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id,repeat('b',64),f.connector_id,'wch-fixture-model');
      if rejected->>'outcome'<>'stale' then raise exception 'Stale accepted'; end if;
      foreach actor in array array[f.client_actor_id,f.revoked_actor_id,(select actor_id from wch3_fixture where department_id<>f.department_id limit 1)] loop
        denied:=false;
        begin perform pg_temp.wch_preview(f,kind,target,actor); exception when insufficient_privilege then denied:=true; end;
        if not denied then raise exception 'Unauthorized preview accepted'; end if;
        denied:=false;
        begin perform public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,actor,repeat('a',64),f.connector_id,'wch-fixture-model'); exception when insufficient_privilege then denied:=true; end;
        if not denied then raise exception 'Unauthorized confirm accepted'; end if;
        denied:=false;
        begin perform public.reject_department_chat_proposal((p->>'proposal_id')::uuid,actor); exception when insufficient_privilege then denied:=true; end;
        if not denied then raise exception 'Unauthorized reject accepted'; end if;
      end loop;
    end loop;
  end loop;
  insert into wch3_checks values('every_department_target_service_role_runtime',(select count(*)=26 from wch3_results));
end;
$$;
reset role;

do $$
declare f wch3_fixture; p jsonb; denied boolean; op text; actor uuid;
begin
  for f in select * from wch3_fixture loop
    p:=pg_temp.wch_preview(f,'work_item','task');
    update public.organizations set status='suspended' where id=f.organization_id;
    execute 'set local role service_role';
    foreach op in array array['save','confirm','reject'] loop
      denied:=false;
      begin
        if op='save' then perform pg_temp.wch_preview(f,'work_item','task');
        elsif op='confirm' then perform public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id,repeat('a',64),f.connector_id,'wch-fixture-model');
        else perform public.reject_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id); end if;
      exception when insufficient_privilege then denied:=true; end;
      if not denied then raise exception 'Inactive organization permitted %',op; end if;
    end loop;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',f.actor_id::text,true);
    execute 'set local role authenticated';
    if exists(select 1 from public.department_chat_proposals where organization_id=f.organization_id) then raise exception 'Inactive organization readable'; end if;
    execute 'reset role';
    update public.organizations set status='active' where id=f.organization_id;
    foreach actor in array array[f.actor_id,f.client_actor_id,f.revoked_actor_id,(select actor_id from wch3_fixture where department_id<>f.department_id limit 1)] loop
      perform set_config('request.jwt.claim.sub',actor::text,true);
      execute 'set local role authenticated';
      if (exists(select 1 from public.department_chat_proposals where id=(p->>'proposal_id')::uuid)) <> (actor=f.actor_id) then raise exception 'Proposal RLS actor boundary failed'; end if;
      foreach op in array array['save','confirm','reject'] loop
        denied:=false;
        begin
          if op='save' then perform pg_temp.wch_preview(f,'work_item','task');
          elsif op='confirm' then perform public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,actor,repeat('a',64),f.connector_id,'wch-fixture-model');
          else perform public.reject_department_chat_proposal((p->>'proposal_id')::uuid,actor); end if;
        exception when insufficient_privilege then denied:=true; end;
        if not denied then raise exception 'Authenticated RPC permitted %',op; end if;
      end loop;
      execute 'reset role';
    end loop;
    execute 'set local role anon';
    denied:=false;
    begin perform 1 from public.department_chat_proposals; exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Anon proposal read permitted'; end if;
    execute 'reset role';
  end loop;
  insert into wch3_checks values('inactive_org_and_actor_runtime_boundaries',true);
end;
$$;

do $$
declare f wch3_fixture; p jsonb; variant text; operation text; denied boolean;
begin
  for f in select * from wch3_fixture loop
    p:=pg_temp.wch_preview(f,'work_item','task');
    foreach variant in array array['revoked','client'] loop
      update public.organization_memberships set status=case when variant='revoked' then 'revoked' else 'active' end,
        member_kind=case when variant='client' then 'client' else 'team' end
      where organization_id=f.organization_id and user_id=f.actor_id;
      execute 'set local role service_role';
      foreach operation in array array['save','confirm','reject','audit'] loop
        denied:=false;
        begin
          if operation='save' then perform pg_temp.wch_preview(f,'work_item','task');
          elsif operation='confirm' then perform public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id,repeat('a',64),f.connector_id,'wch-fixture-model');
          elsif operation='reject' then perform public.reject_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id);
          else perform public.record_department_chat_attempt(f.organization_id,f.actor_id,'preview_requested',''); end if;
        exception when insufficient_privilege then denied:=true; end;
        if not denied then raise exception 'Changed proposer authorization accepted: % %',variant,operation; end if;
      end loop;
      execute 'reset role';
      perform set_config('request.jwt.claim.sub',f.actor_id::text,true);
      execute 'set local role authenticated';
      if exists(select 1 from public.department_chat_proposals where id=(p->>'proposal_id')::uuid) then raise exception 'Changed proposer still reads proposal'; end if;
      execute 'reset role';
      update public.organization_memberships set status='active',member_kind='team' where organization_id=f.organization_id and user_id=f.actor_id;
    end loop;
  end loop;
  insert into wch3_checks values('revoked_and_client_proposer_denied',true);
end;
$$;

do $$
declare f wch3_fixture; result record; kind text; p jsonb; outcome jsonb; before_count bigint;
begin
  for result in select * from wch3_results loop
    select * into f from wch3_fixture where department_id=result.department_id;
    kind:=case when result.target in ('task','bug','request') then 'work_item' else 'artifact_version' end;
    p:=pg_temp.wch_preview(f,kind,result.target);
    execute 'alter table public.department_chat_proposals disable trigger trg_department_chat_proposals_protect';
    update public.department_chat_proposals set created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where id=(p->>'proposal_id')::uuid;
    execute 'alter table public.department_chat_proposals enable trigger trg_department_chat_proposals_protect';
    select (select count(*) from public.artifact_versions)+(select count(*) from public.work_items) into before_count;
    execute 'set local role service_role';
    outcome:=public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id,repeat('a',64),f.connector_id,'wch-fixture-model');
    if outcome->>'outcome'<>'expired' then raise exception 'Expiry accepted for %',result.target; end if;
    execute 'reset role';
    if before_count<>(select (select count(*) from public.artifact_versions)+(select count(*) from public.work_items)) then raise exception 'Expiry wrote official record'; end if;
  end loop;
  execute 'create trigger wch3_fail_all_versions before insert on public.artifact_versions for each row execute function pg_temp.wch3_fail_version_insert()';
  execute 'create trigger wch3_fail_all_items before insert on public.work_items for each row execute function pg_temp.wch3_fail_version_insert()';
  for result in select * from wch3_results loop
    select * into f from wch3_fixture where department_id=result.department_id;
    kind:=case when result.target in ('task','bug','request') then 'work_item' else 'artifact_version' end;
    p:=pg_temp.wch_preview(f,kind,result.target);
    select (select count(*) from public.artifacts)+(select count(*) from public.artifact_versions)+(select count(*) from public.work_items) into before_count;
    execute 'set local role service_role';
    outcome:=public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id,repeat('a',64),f.connector_id,'wch-fixture-model');
    if outcome->>'outcome'<>'atomic_failure' then raise exception 'Injection did not fail %',result.target; end if;
    if not exists(select 1 from public.department_chat_audit_events where proposal_id=(p->>'proposal_id')::uuid and event_kind='atomic_failure' and reason_code='atomic_write_failed') then raise exception 'Missing atomic failure audit'; end if;
    if not exists(select 1 from public.department_chat_proposals where id=(p->>'proposal_id')::uuid and status='pending') then raise exception 'Partial proposal transition'; end if;
    if not exists(select 1 from public.ai_runs where id=(p->>'ai_run_id')::uuid and human_decision='pending') then raise exception 'Partial AI decision'; end if;
    execute 'reset role';
    if before_count<>(select (select count(*) from public.artifacts)+(select count(*) from public.artifact_versions)+(select count(*) from public.work_items)) then raise exception 'Partial canonical state after failure'; end if;
  end loop;
  execute 'drop trigger wch3_fail_all_versions on public.artifact_versions';
  execute 'drop trigger wch3_fail_all_items on public.work_items';
  insert into wch3_checks values('all_targets_expiry_and_atomic_failure',true);
end;
$$;

do $$
declare f wch3_fixture; op text; denied boolean; fn record;
begin
  select * into f from wch3_fixture where department_id='content';
  execute 'set local role service_role';
  perform public.record_department_chat_attempt(f.organization_id,f.actor_id,'preview_requested','');
  perform public.record_department_chat_attempt(f.organization_id,f.actor_id,'preview_blocked','connector_unavailable');
  perform public.record_department_chat_attempt(f.organization_id,f.actor_id,'preview_failed','invalid_output');
  execute 'reset role';
  for fn in select p.oid,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('save_department_chat_proposal','confirm_department_chat_proposal','reject_department_chat_proposal','record_department_chat_attempt') loop
    if fn.prosecdef or not has_function_privilege('service_role',fn.oid,'execute')
      or has_function_privilege('anon',fn.oid,'execute') or has_function_privilege('authenticated',fn.oid,'execute')
      or exists(select 1 from aclexplode(fn.proacl) where grantee=0 and privilege_type='EXECUTE') then raise exception 'Unexpected RPC catalog privilege'; end if;
  end loop;
  foreach op in array array['preview_requested','preview_generated','preview_blocked','preview_failed','confirmed','rejected','expired','stale','replay','official_record_created','atomic_failure'] loop
    if not exists(select 1 from public.department_chat_audit_events where event_kind=op) then raise exception 'Missing audit event %',op; end if;
  end loop;
  execute 'set local role anon';
  foreach op in array array['save','confirm','reject','audit'] loop
    denied:=false;
    begin
      if op='save' then perform pg_temp.wch_preview(f,'work_item','task');
      elsif op='confirm' then perform public.confirm_department_chat_proposal(gen_random_uuid(),f.actor_id,repeat('a',64),f.connector_id,'wch-fixture-model');
      elsif op='reject' then perform public.reject_department_chat_proposal(gen_random_uuid(),f.actor_id);
      else perform public.record_department_chat_attempt(f.organization_id,f.actor_id,'preview_requested',''); end if;
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Anonymous mutation permitted %',op; end if;
  end loop;
  execute 'reset role';
  insert into wch3_checks values('full_audit_vocabulary_and_rpc_acl',true);
end;
$$;

do $$
declare
  f wch3_fixture;
  p jsonb;
  decision jsonb;
  context_artifact_id uuid;
  context_version_id uuid;
  brand_id uuid;
  before_work_items bigint;
  passed boolean := false;
begin
  select * into f from wch3_fixture where department_id = 'development';
  begin
    p := pg_temp.wch_preview(f, 'work_item', 'task');

    -- Represents authoritative context changing after the Edge process resolved its
    -- checksum/version set but before the confirmation RPC begins.
    select engagement.brand_id into brand_id from public.engagements engagement where engagement.id = f.engagement_id;
    insert into public.artifacts(organization_id, project_id, engagement_id, brand_id, artifact_type, title, created_by)
    values(f.organization_id, f.project_id, f.engagement_id, brand_id, 'brand_statement', 'TOCTOU context', f.actor_id)
    returning id into context_artifact_id;
    insert into public.artifact_versions(
      organization_id, artifact_id, version_number, content, content_checksum,
      ai_use_allowed, data_classification, created_by
    ) values (
      f.organization_id, context_artifact_id, 1, '{"changed":true}', repeat('7',64),
      true, 'internal', f.actor_id
    ) returning id into context_version_id;
    insert into public.artifact_approvals(organization_id, artifact_id, artifact_version_id, engagement_id, approved_by)
    values(f.organization_id, context_artifact_id, context_version_id, f.engagement_id, f.actor_id);

    select count(*) into before_work_items from public.work_items;
    decision := public.confirm_department_chat_proposal(
      (p->>'proposal_id')::uuid, f.actor_id, repeat('a',64),
      f.connector_id, 'wch-fixture-model'
    );
    if decision->>'outcome' <> 'stale'
      or (select count(*) from public.work_items) <> before_work_items
      or exists (
        select 1 from public.department_chat_proposals proposal
        where proposal.id = (p->>'proposal_id')::uuid
          and proposal.accepted_work_item_id is not null
      ) then
      raise exception 'Authoritative context TOCTOU created an official record';
    end if;
    raise exception using errcode = 'Z0001', message = 'rollback successful TOCTOU fixture';
  exception when sqlstate 'Z0001' then
    passed := true;
  end;
  insert into wch3_checks values('approved_context_toctou_creates_no_record', passed);
end;
$$;

do $$
declare
  source_proposal public.department_chat_proposals%rowtype;
  other wch3_fixture;
  proposal_mismatch_denied boolean := false;
  ai_run_mismatch_denied boolean := false;
begin
  select proposal.* into source_proposal
  from public.department_chat_proposals proposal
  order by proposal.created_at
  limit 1;
  select * into other from wch3_fixture where organization_id <> source_proposal.organization_id limit 1;

  begin
    insert into public.department_chat_audit_events(organization_id, actor_id, proposal_id, event_kind)
    values(other.organization_id, other.actor_id, source_proposal.id, 'replay');
  exception when foreign_key_violation then proposal_mismatch_denied := true;
  end;
  begin
    insert into public.department_chat_audit_events(organization_id, actor_id, ai_run_id, event_kind)
    values(other.organization_id, other.actor_id, source_proposal.ai_run_id, 'preview_generated');
  exception when foreign_key_violation then ai_run_mismatch_denied := true;
  end;
  if not proposal_mismatch_denied or not ai_run_mismatch_denied then
    raise exception 'Cross-organization audit reference was accepted';
  end if;
  update wch3_checks set passed = passed and proposal_mismatch_denied and ai_run_mismatch_denied
  where check_name = 'audit_scope_constraints_and_indexes';
end;
$$;

do $$
declare
  f wch3_fixture;
  scenario text;
  p jsonb;
  decision jsonb;
  before_work_items bigint;
  passed_count integer := 0;
begin
  select * into f from wch3_fixture where department_id='development';
  foreach scenario in array array['project','brand','service','catalog','connector','stage'] loop
    begin
      p := pg_temp.wch_preview(f,'work_item','task',null,
        case when scenario='stage' then f.stage_id else null end);
      if scenario='project' then
        update public.projects set name=name || ' changed' where id=f.project_id;
      elsif scenario='brand' then
        update public.brands set description=description || ' changed' where id=f.brand_id;
      elsif scenario='service' then
        update public.engagement_services set target_date=current_date + 1 where service_id=f.service_id and engagement_id=f.engagement_id;
      elsif scenario='catalog' then
        update public.service_catalog set name=name || ' changed' where id=f.service_id;
      elsif scenario='connector' then
        update public.integration_connections set public_config=jsonb_set(public_config,'{model_id}','"changed-model"') where id=f.connector_id;
      else
        update public.engagement_stage_instances set name=name || ' changed' where id=f.stage_id;
      end if;
      select count(*) into before_work_items from public.work_items;
      decision := public.confirm_department_chat_proposal((p->>'proposal_id')::uuid,f.actor_id,repeat('a',64),f.connector_id,'wch-fixture-model');
      if decision->>'outcome'<>'stale' or (select count(*) from public.work_items)<>before_work_items
        or exists(select 1 from public.department_chat_proposals where id=(p->>'proposal_id')::uuid and accepted_work_item_id is not null) then
        raise exception 'Context mutation created an official record: %',scenario;
      end if;
      raise exception using errcode='Z0001',message='rollback context mutation';
    exception when sqlstate 'Z0001' then
      passed_count := passed_count + 1;
    end;
  end loop;
  insert into wch3_checks values('complete_database_context_toctou_zero_writes',passed_count=6);
end;
$$;

do $$
declare original record; current_row jsonb; source record; current_rows jsonb;
begin
  if (select count(*) from wch3_original_rows) < 24 then raise exception 'Protected sentinels are missing'; end if;
  for original in select * from wch3_original_rows loop
    execute format('select to_jsonb(t) from public.%I t where id::text=$1',original.table_name) into current_row using original.row_data->>'id';
    if current_row is distinct from original.row_data then raise exception 'Existing canonical row changed: %',original.table_name; end if;
  end loop;
  if (select count(*) from public.tasks) <> (select count(*) from wch3_original_rows where table_name='tasks')
    or (select count(*) from public.artifact_approvals) <> (select count(*) from wch3_original_rows where table_name='artifact_approvals')
    or (select count(*) from public.engagement_stage_instances) <> (select count(*) from wch3_original_rows where table_name='engagement_stage_instances') then raise exception 'Forbidden canonical insertion'; end if;
  insert into wch3_checks values('complete_canonical_rows_preserved',true);
  for source in select * from wch3_source_snapshot loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t',source.table_name) into current_rows;
    if source.table_name in ('artifacts','artifact_versions','work_items','ai_runs','engagement_events','department_chat_proposals','department_chat_audit_events') then
      if not source.rows <@ current_rows then raise exception 'Existing source row changed: %',source.table_name; end if;
    elsif source.rows is distinct from current_rows then raise exception 'Excluded source table changed: %',source.table_name; end if;
  end loop;
  insert into wch3_checks values('complete_source_snapshot_preserved',true);
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
