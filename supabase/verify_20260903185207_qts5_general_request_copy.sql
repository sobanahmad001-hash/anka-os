-- Run only on an independently authorized disposable database with QTS1-QTS5 installed.
-- No permanent fixtures: all data, temporary helpers, and failure triggers roll back.
begin;
set local statement_timeout = '60s';
create temporary table qts5_checks(check_name text primary key, passed boolean not null) on commit drop;
create function pg_temp.check_qts5(p_name text, p_passed boolean) returns void language plpgsql as $$
begin insert into qts5_checks values (p_name, coalesce(p_passed, false)); end $$;
create function pg_temp.qts5_snapshot() returns jsonb language plpgsql as $$
declare result jsonb := '{}'::jsonb; rel text; rows jsonb;
begin
  foreach rel in array array['content_requests','content_request_assets','design_media_assets',
    'projects','engagements','tasks','work_items','artifacts','artifact_versions',
    'artifact_approvals','engagement_events','approvals','client_project_projections',
    'design_direction_selections','design_direction_releases','production_handoff_packages',
    'artifact_approval_requests','artifact_approval_signoffs','engagement_stage_instances',
    'project_workflow_templates'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t', rel) into rows;
    result := result || jsonb_build_object(rel, rows);
  end loop;
  return result;
end $$;
create function pg_temp.qts5_fail_write() returns trigger language plpgsql as $$
begin raise exception 'qts5 injected failure'; end $$;

do $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); peer uuid := gen_random_uuid();
  client_id uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  source_id uuid := gen_random_uuid(); other_source uuid := gen_random_uuid();
  long_source uuid := gen_random_uuid();
  key_id uuid := gen_random_uuid(); result jsonb; replay jsonb; other_copy jsonb;
  task_id uuid; cycle_id uuid;
  before_rows jsonb; after_rows jsonb; ledger_before jsonb; task_before jsonb;
  denied boolean; state_value text; rel text; before_count bigint; after_count bigint;
  connection_id uuid := gen_random_uuid(); revision_id uuid; chat jsonb;
  agency_id uuid := gen_random_uuid(); brand_id uuid := gen_random_uuid();
begin
  insert into auth.users(id) values(owner_id),(peer),(client_id),(outsider);
  insert into public.organizations(id,name,slug) values
    (org,'QTS5 rollback tenant','qts5-' || org::text),
    (other_org,'QTS5 rollback other tenant','qts5-' || other_org::text);
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (org,owner_id,'team','contributor','content','active'),
    (org,peer,'team','system_owner',null,'active'),
    (org,client_id,'client','system_owner',null,'active'),
    (other_org,outsider,'team','contributor','content','active');
  insert into public.agency_clients(id,organization_id,name,created_by) values(agency_id,org,'QTS5 fixture client',owner_id);
  insert into public.brands(id,organization_id,client_id,name,created_by) values(brand_id,org,agency_id,'QTS5 fixture brand',owner_id);
  insert into public.content_requests(id,organization_id,mode,output_path,format,brief,created_by,brand_id) values
    (source_id,org,'general','figma_handoff','reel',E'  Exact brief\nUnicode: café 🙂  ',owner_id,brand_id),
    (other_source,other_org,'general','internal_engine','stories','Other tenant secret',outsider,null),
    (long_source,org,'general','internal_engine','reel',repeat('x',12000),owner_id,null);
  insert into public.content_request_assets(organization_id,content_request_id,figma_handoff_url)
    values(org,source_id,'https://example.invalid/private-handoff');
  before_rows := pg_temp.qts5_snapshot();
  set local role service_role;
  result := public.copy_general_request_to_quick_task(org,source_id,key_id,owner_id);
  reset role;
  task_id := (result->>'quick_task_id')::uuid;
  perform pg_temp.check_qts5('service_role_executes_real_copy',task_id is not null);
  perform pg_temp.check_qts5('server_mapping_preserves_exact_brief_and_inert_fields',
    (select r.source_kind='copied_general_request'
      and r.content = jsonb_build_object('notes',s.brief || E'\n\nFormat: ' || s.format
        || E'\nOutput path (reference only): ' || s.output_path
        || E'\nBrand reference: ' || s.brand_id::text,'checklist','[]'::jsonb)
      and r.content_sha256=encode(extensions.digest(convert_to(r.content::text,'UTF8'),'sha256'),'hex')
      and r.ai_run_id is null
     from public.quick_task_revisions r cross join public.content_requests s
     where r.quick_task_id=task_id and s.id=source_id));
  select to_jsonb(t) into task_before from public.quick_tasks t where t.id=task_id;
  replay := public.copy_general_request_to_quick_task(org,source_id,key_id,owner_id);
  perform pg_temp.check_qts5('same_key_returns_existing_without_clock_change',
    replay->>'quick_task_id'=result->>'quick_task_id' and (replay->>'replayed')::boolean
    and task_before=(select to_jsonb(t) from public.quick_tasks t where t.id=task_id)
    and (select count(*)=1 from public.quick_task_revisions r where r.quick_task_id=task_id));
  other_copy := public.copy_general_request_to_quick_task(org,source_id,gen_random_uuid(),owner_id);
  perform pg_temp.check_qts5('fresh_key_creates_distinct_copy',other_copy->>'quick_task_id'<>result->>'quick_task_id');
  cycle_id := (other_copy->>'quick_task_id')::uuid;
  other_copy := public.copy_general_request_to_quick_task(org,long_source,gen_random_uuid(),owner_id);
  perform pg_temp.check_qts5('maximum_brief_unbranded_copy_has_no_truncation',
    (select r.content->>'notes'=repeat('x',12000) || E'\n\nFormat: reel\nOutput path (reference only): internal_engine'
     from public.quick_task_revisions r where r.quick_task_id=(other_copy->>'quick_task_id')::uuid));

  foreach state_value in array array['suspended','archived'] loop
    update public.organizations set status=state_value where id=org;
    denied := false;
    begin perform public.copy_general_request_to_quick_task(org,source_id,key_id,owner_id);
    exception when insufficient_privilege then denied := true; end;
    perform pg_temp.check_qts5('organization_' || state_value || '_replay_denied',denied);
  end loop;
  update public.organizations set status='active' where id=org;
  foreach state_value in array array['revoked','suspended'] loop
    update public.organization_memberships set status=state_value where organization_id=org and user_id=owner_id;
    denied := false;
    begin perform public.copy_general_request_to_quick_task(org,source_id,key_id,owner_id);
    exception when insufficient_privilege then denied := true; end;
    perform pg_temp.check_qts5('membership_' || state_value || '_replay_denied',denied);
  end loop;
  update public.organization_memberships set status='active' where organization_id=org and user_id=owner_id;
  denied := false;
  begin perform public.copy_general_request_to_quick_task(org,source_id,gen_random_uuid(),client_id);
  exception when insufficient_privilege then denied:=true; end;
  perform pg_temp.check_qts5('privileged_role_client_kind_denied',denied);
  denied := false;
  begin perform public.copy_general_request_to_quick_task(org,source_id,key_id,outsider);
  exception when insufficient_privilege then denied:=true; end;
  perform pg_temp.check_qts5('nonmember_cannot_replay_another_owner_key',denied);
  denied := false;
  begin perform public.copy_general_request_to_quick_task(org,other_source,key_id,owner_id);
  exception when insufficient_privilege then denied:=true; end;
  perform pg_temp.check_qts5('cross_organization_source_denied',denied);
  denied := false;
  begin
    insert into public.content_requests(organization_id,mode,output_path,format,brief,created_by,brand_id)
      values(other_org,'general','internal_engine','reel','Foreign brand',outsider,brand_id);
  exception when others then denied:=true; end;
  perform pg_temp.check_qts5('foreign_brand_source_rejected_by_existing_boundary',denied);
  -- Peer may copy the shared source, but an owner-bound key never yields owner content.
  other_copy := public.copy_general_request_to_quick_task(org,source_id,key_id,peer);
  perform pg_temp.check_qts5('same_key_different_actor_is_isolated',other_copy->>'quick_task_id'<>result->>'quick_task_id');
  denied:=false;
  begin
    select id into revision_id from public.create_quick_task(org,owner_id,'FK probe','{"notes":"probe","checklist":[]}');
    insert into public.quick_task_request_copies values(org,owner_id,gen_random_uuid(),other_source,revision_id,now());
  exception when foreign_key_violation then denied:=true; end;
  perform pg_temp.check_qts5('cross_tenant_ledger_source_rejected',denied);
  denied := false;
  begin perform public.copy_general_request_to_quick_task(org,long_source,key_id,owner_id);
  exception when unique_violation then denied:=true; end;
  perform pg_temp.check_qts5('same_key_different_source_conflicts',denied);

  -- Inject a failure at every insert boundary and prove all earlier writes roll back.
  foreach rel in array array['quick_tasks','quick_task_revisions','quick_task_lifecycle_events','quick_task_request_copies'] loop
    select (select count(*) from public.quick_tasks)+(select count(*) from public.quick_task_revisions)
      +(select count(*) from public.quick_task_lifecycle_events)+(select count(*) from public.quick_task_request_copies) into before_count;
    execute format('create trigger qts5_failure before insert on public.%I for each row execute function pg_temp.qts5_fail_write()', rel);
    denied := false;
    begin perform public.copy_general_request_to_quick_task(org,source_id,gen_random_uuid(),owner_id);
    exception when others then denied:=sqlerrm='qts5 injected failure'; end;
    execute format('drop trigger qts5_failure on public.%I',rel);
    select (select count(*) from public.quick_tasks)+(select count(*) from public.quick_task_revisions)
      +(select count(*) from public.quick_task_lifecycle_events)+(select count(*) from public.quick_task_request_copies) into after_count;
    perform pg_temp.check_qts5('rollback_on_' || rel || '_failure',denied and before_count=after_count);
  end loop;

  -- Real authenticated RLS, separately from service RPC authorization.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into before_count from public.quick_task_request_copies c where c.quick_task_id=task_id;
  reset role;
  perform pg_temp.check_qts5('owner_reads_reference_via_rls',before_count=1);
  denied:=false;
  set local role authenticated;
  begin perform public.copy_general_request_to_quick_task(org,source_id,key_id,owner_id);
  exception when insufficient_privilege then denied:=true; end;
  reset role;
  perform pg_temp.check_qts5('authenticated_direct_rpc_denied',denied);
  denied:=false;
  set local role anon;
  begin perform public.copy_general_request_to_quick_task(org,source_id,key_id,owner_id);
  exception when insufficient_privilege then denied:=true; end;
  reset role;
  perform pg_temp.check_qts5('anonymous_direct_rpc_denied',denied);
  update public.organizations set status='suspended' where id=org;
  set local role authenticated;
  select count(*) into before_count from public.quick_task_request_copies c where c.quick_task_id=task_id;
  reset role;
  perform pg_temp.check_qts5('inactive_org_hides_reference_via_rls',before_count=0);
  update public.organizations set status='active' where id=org;
  update public.organization_memberships set status='revoked' where organization_id=org and user_id=owner_id;
  set local role authenticated;
  select count(*) into before_count from public.quick_task_request_copies c where c.quick_task_id=task_id;
  reset role;
  perform pg_temp.check_qts5('revoked_owner_hides_reference_via_rls',before_count=0);
  update public.organization_memberships set status='active' where organization_id=org and user_id=owner_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',peer,'role','authenticated')::text,true);
  set local role authenticated;
  select (select count(*) from public.quick_task_request_copies c where c.quick_task_id=task_id)
    +(select count(*) from public.quick_tasks t where t.id=task_id)
    +(select count(*) from public.quick_task_revisions r where r.quick_task_id=task_id) into before_count;
  reset role;
  perform pg_temp.check_qts5('peer_leader_cannot_read_owner_content_or_reference',before_count=0);

  perform public.preserve_quick_task(cycle_id,owner_id);
  replay:=public.copy_general_request_to_quick_task(org,source_id,
    (select c.idempotency_key from public.quick_task_request_copies c where c.quick_task_id=cycle_id),owner_id);
  perform pg_temp.check_qts5('preserved_replay_keeps_state',replay->>'state'='preserved');
  perform public.unpreserve_quick_task(cycle_id,owner_id);
  perform public.discard_quick_task(cycle_id,owner_id);
  perform public.restore_quick_task(cycle_id,owner_id);
  update public.quick_tasks set last_activity_at=now()-interval '31 days',
    expires_at=now()-interval '1 day' where id=cycle_id;
  perform public.expire_quick_task(cycle_id,owner_id);
  perform public.restore_quick_task(cycle_id,owner_id);
  perform pg_temp.check_qts5('copied_task_preserve_discard_expire_restore_cycle',
    (select state='active' from public.quick_tasks where id=cycle_id));

  insert into public.integration_connections(id,organization_id,provider,display_name,public_config,secret_name,status,last_check_status,created_by)
    values(connection_id,org,'openai','QTS5 rollback model','{"model_id":"qts5-test"}','ANKA_OPENAI_QTS5_TEST_ONLY','verified','passed',owner_id);
  insert into public.integration_connection_departments(connection_id,organization_id,department_id,created_by)
    values(connection_id,org,'content',owner_id);
  select current_revision_id into revision_id from public.quick_tasks where id=task_id;
  chat:=public.record_quick_task_chat_success(task_id,revision_id,owner_id,'content',connection_id,
    'qts5-test','private prompt','private output','{"notes":"private generated content","checklist":[]}',2,3,5,10);
  select to_jsonb(c) into ledger_before from public.quick_task_request_copies c where c.quick_task_id=task_id;
  perform public.discard_quick_task(task_id,owner_id);
  denied:=false;
  begin perform public.purge_quick_task(task_id,owner_id); exception when others then denied:=true; end;
  perform pg_temp.check_qts5('early_purge_rejected',denied);
  update public.quick_tasks set discarded_at=now()-interval '31 days',recoverable_until=now()-interval '1 day' where id=task_id;
  denied:=false;
  begin perform public.restore_quick_task(task_id,owner_id); exception when others then denied:=true; end;
  perform pg_temp.check_qts5('closed_recovery_rejected',denied);
  perform public.purge_quick_task(task_id,owner_id);
  replay:=public.copy_general_request_to_quick_task(org,source_id,key_id,owner_id);
  perform pg_temp.check_qts5('purged_retry_never_resurrects',
    (replay->>'purged')::boolean and replay->>'quick_task_id'=task_id::text
    and (select title='[purged]' and current_revision_id is null from public.quick_tasks where id=task_id));
  perform pg_temp.check_qts5('purge_removes_all_copied_and_ai_payload',
    not exists(select 1 from public.quick_task_revisions r where r.quick_task_id=task_id)
    and not exists(select 1 from public.quick_task_messages m where m.quick_task_id=task_id)
    and (select bool_and(input_text='' and output_text='' and redacted_at is not null
      and quick_task_revision_id is null and context_manifest->>'redacted'='true') from public.ai_runs a where a.quick_task_id=task_id));
  perform pg_temp.check_qts5('purge_retains_exact_content_free_reference',
    ledger_before=(select to_jsonb(c) from public.quick_task_request_copies c where c.quick_task_id=task_id));
  after_rows:=pg_temp.qts5_snapshot();
  perform pg_temp.check_qts5('complete_source_assets_and_canonical_rows_unchanged',before_rows=after_rows);
  -- QTS4 terminal shape: verifier simulates the state, no canonical output needed.
  update public.quick_tasks set state='promoted',promoted_at=now(),expires_at=null where id=cycle_id;
  denied:=false;
  begin perform public.purge_quick_task(cycle_id,owner_id); exception when others then denied:=true; end;
  perform pg_temp.check_qts5('promoted_copy_never_purges',denied and
    (select purged_at is null and current_revision_id is not null from public.quick_tasks where id=cycle_id));
  denied:=false;
  begin update public.quick_task_request_copies set source_request_id=source_id where quick_task_id=task_id;
  exception when others then denied:=sqlerrm like '%append-only%'; end;
  perform pg_temp.check_qts5('reference_is_append_only',denied);
end $$;

select pg_temp.check_qts5('table_acl_is_select_only_for_browser',
  has_table_privilege('authenticated','public.quick_task_request_copies','SELECT')
  and not has_table_privilege('authenticated','public.quick_task_request_copies','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('anon','public.quick_task_request_copies','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not exists(select 1 from pg_class c, lateral aclexplode(c.relacl) a
    where c.oid='public.quick_task_request_copies'::regclass and a.grantee=0));
select pg_temp.check_qts5('rpc_acl_and_invoker_search_path',
  not has_function_privilege('anon','public.copy_general_request_to_quick_task(uuid,uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.copy_general_request_to_quick_task(uuid,uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.copy_general_request_to_quick_task(uuid,uuid,uuid,uuid)','EXECUTE')
  and exists(select 1 from pg_proc p where p.oid='public.copy_general_request_to_quick_task(uuid,uuid,uuid,uuid)'::regprocedure
    and not p.prosecdef and p.proconfig=array['search_path=""']
    and not exists(select 1 from aclexplode(p.proacl) a where a.grantee=0)));
select pg_temp.check_qts5('rls_owner_active_team_active_organization_definition',
  (select relrowsecurity from pg_class where oid='public.quick_task_request_copies'::regclass)
  and (select count(*)=1 and bool_and(polcmd='r' and polroles=array['authenticated'::regrole::oid]
    and pg_get_expr(polqual,polrelid) like '%owner_id = ( SELECT auth.uid()%'
    and pg_get_expr(polqual,polrelid) like '%member_kind = ''team''%'
    and pg_get_expr(polqual,polrelid) like '%m.status = ''active''%'
    and pg_get_expr(polqual,polrelid) like '%o.status = ''active''%')
    from pg_policy where polrelid='public.quick_task_request_copies'::regclass));
select pg_temp.check_qts5('no_revision_fk_can_block_purge',
  (select count(*)=2 and bool_and(confdeltype='r' and convalidated and confrelid in
    ('public.quick_tasks'::regclass,'public.content_requests'::regclass))
   from pg_constraint where conrelid='public.quick_task_request_copies'::regclass and contype='f'));
select pg_temp.check_qts5('ledger_contains_only_six_content_free_columns',
  (select array_agg(attname::text order by attnum)=array[
    'organization_id','owner_id','idempotency_key','source_request_id','quick_task_id','created_at']
   from pg_attribute where attrelid='public.quick_task_request_copies'::regclass and attnum>0 and not attisdropped));
select pg_temp.check_qts5('service_ledger_grants_are_select_insert_only',
  has_table_privilege('service_role','public.quick_task_request_copies','SELECT')
  and has_table_privilege('service_role','public.quick_task_request_copies','INSERT')
  and not has_table_privilege('service_role','public.quick_task_request_copies','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
with expected(target,local_cols,remote_cols) as (values
  ('public.content_requests'::regclass,array['source_request_id','organization_id'],array['id','organization_id']),
  ('public.quick_tasks'::regclass,array['quick_task_id','organization_id','owner_id'],array['id','organization_id','owner_id'])
)
select pg_temp.check_qts5('exact_composite_foreign_keys_and_supporting_indexes',bool_and(exists(
  select 1 from pg_constraint c
  where c.conrelid='public.quick_task_request_copies'::regclass and c.contype='f'
    and c.confrelid=e.target and c.confdeltype='r' and c.convalidated
    and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(num,ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num)=e.local_cols
    and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(num,ord)
      join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num)=e.remote_cols
    and exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indisready
      and i.indpred is null and (select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality k(num,ord)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
        where k.ord<=cardinality(e.local_cols))=e.local_cols)
))) from expected e;
select pg_temp.check_qts5('exact_idempotency_primary_key',
  exists(select 1 from pg_constraint c where c.conrelid='public.quick_task_request_copies'::regclass and c.contype='p'
    and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(num,ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num)=array['organization_id','owner_id','idempotency_key']));
select check_name,passed from qts5_checks order by check_name;
do $$ begin
  if exists(select 1 from qts5_checks where not passed) then
    raise exception 'QTS5 verifier failed; transaction must be rolled back.';
  end if;
end $$;
rollback;
