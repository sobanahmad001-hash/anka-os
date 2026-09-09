-- Run only after migration 20260904130000 in an authorized disposable database.
-- Every fixture and assertion is rolled back.
begin;
set local statement_timeout = '90s';

create temporary table p7_checks(
  check_name text primary key,
  passed boolean not null
) on commit drop;

create function pg_temp.check_p7(p_name text, p_passed boolean)
returns void language plpgsql as $$
begin
  insert into p7_checks values (p_name, coalesce(p_passed, false));
end $$;

select pg_temp.check_p7('new_tables_have_rls',
  (select bool_and(c.relrowsecurity)
   from pg_class c
   where c.oid in (
     'public.deliverable_review_assignments'::regclass,
     'public.deliverable_lifecycle_events'::regclass,
     'public.deliverable_action_requests'::regclass
   )));

select pg_temp.check_p7('browser_cannot_write_governed_tables',
  not has_table_privilege('authenticated','public.deliverable_review_assignments','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('authenticated','public.deliverable_lifecycle_events','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('authenticated','public.deliverable_action_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('authenticated','public.deliverable_versions','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.approvals','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.client_portal_items','INSERT,UPDATE,DELETE'));

select pg_temp.check_p7('public_and_anon_have_no_governed_table_acl',
  not has_table_privilege('anon','public.deliverable_review_assignments','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('anon','public.deliverable_lifecycle_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('anon','public.deliverable_action_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid in ('public.deliverable_review_assignments'::regclass,
      'public.deliverable_lifecycle_events'::regclass,
      'public.deliverable_action_requests'::regclass) and a.grantee=0
  ));

select pg_temp.check_p7('rpc_acl_is_authenticated_only',
  has_function_privilege('authenticated','public.create_governed_deliverable_version(uuid,uuid,text,text,uuid,jsonb,boolean,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.submit_governed_deliverable_version(uuid,uuid,bigint,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.assign_governed_deliverable_reviewer(uuid,uuid,bigint,uuid,text,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.review_governed_deliverable_version(uuid,uuid,bigint,text,text,jsonb,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.release_governed_deliverable_version(uuid,uuid,bigint,boolean,text,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.decide_governed_deliverable_version(uuid,uuid,bigint,text,text,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.mark_governed_deliverable_delivered(uuid,uuid,bigint,jsonb,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.mark_governed_deliverable_published(uuid,uuid,bigint,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.release_governed_deliverable_version(uuid,uuid,bigint,boolean,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.decide_governed_deliverable_version(uuid,uuid,bigint,text,text,uuid)','EXECUTE'));

select pg_temp.check_p7('security_definer_rpcs_have_fixed_search_path',
  (select count(*)=10 and bool_and(p.prosecdef and p.proconfig=array['search_path=""'])
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in (
     'get_deliverable_version_capabilities','list_deliverable_reviewer_candidates',
     'create_governed_deliverable_version','submit_governed_deliverable_version',
     'assign_governed_deliverable_reviewer','review_governed_deliverable_version',
     'release_governed_deliverable_version','decide_governed_deliverable_version',
     'mark_governed_deliverable_delivered','mark_governed_deliverable_published'
   )));

select pg_temp.check_p7('one_current_reviewer_and_terminal_facts_are_unique',
  to_regclass('public.deliverable_review_assignments_one_current_idx') is not null
  and to_regclass('public.deliverable_lifecycle_events_terminal_idx') is not null);

select pg_temp.check_p7('surrogate_keys_have_no_redundant_tenant_unique_constraints',
  not exists (
    select 1 from pg_constraint c
    where c.contype='u'
      and c.conrelid in (
        'public.deliverable_review_assignments'::regclass,
        'public.deliverable_lifecycle_events'::regclass
      )
      and (select array_agg(a.attname order by key.ordinality)
           from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)
          = array['id','organization_id']::name[]
  ));

select pg_temp.check_p7('new_foreign_keys_have_nonredundant_leading_indexes',
  (select count(*)=13 and bool_and(
     case i.relname
       when 'deliverable_review_assignments_project_fk_idx' then cols=array['project_id','organization_id']::name[] and predicate is null
       when 'deliverable_review_assignments_client_fk_idx' then cols=array['client_id','organization_id']::name[] and predicate='(client_id IS NOT NULL)'
       when 'deliverable_review_assignments_deliverable_fk_idx' then cols=array['deliverable_id','project_id','workstream_id','organization_id']::name[] and predicate is null
       when 'deliverable_review_assignments_version_fk_idx' then cols=array['deliverable_version_id','deliverable_id','project_id','organization_id']::name[] and predicate is null
       when 'deliverable_review_assignments_reviewer_fk_idx' then cols=array['reviewer_id']::name[] and predicate is null
       when 'deliverable_review_assignments_assigned_by_fk_idx' then cols=array['assigned_by']::name[] and predicate is null
       when 'deliverable_review_assignments_nominated_by_fk_idx' then cols=array['nominated_by']::name[] and predicate='(nominated_by IS NOT NULL)'
       when 'deliverable_lifecycle_events_project_fk_idx' then cols=array['project_id','organization_id']::name[] and predicate is null
       when 'deliverable_lifecycle_events_client_fk_idx' then cols=array['client_id','organization_id']::name[] and predicate='(client_id IS NOT NULL)'
       when 'deliverable_lifecycle_events_deliverable_fk_idx' then cols=array['deliverable_id','project_id','workstream_id','organization_id']::name[] and predicate is null
       when 'deliverable_lifecycle_events_version_fk_idx' then cols=array['deliverable_version_id','deliverable_id','project_id','organization_id']::name[] and predicate is null
       when 'deliverable_lifecycle_events_actor_fk_idx' then cols=array['actor_id']::name[] and predicate='(actor_id IS NOT NULL)'
       when 'deliverable_action_requests_actor_fk_idx' then cols=array['actor_id']::name[] and predicate is null
       else false end)
   from (
     select i.indexrelid, i.indrelid,
       array(select a.attname from unnest(i.indkey::smallint[]) with ordinality key(attnum,ordinality)
             join pg_attribute a on a.attrelid=i.indrelid and a.attnum=key.attnum order by key.ordinality) cols,
       pg_get_expr(i.indpred,i.indrelid) predicate
     from pg_index i
   ) x join pg_class i on i.oid=x.indexrelid
   where i.relname in (
     'deliverable_review_assignments_project_fk_idx','deliverable_review_assignments_client_fk_idx',
     'deliverable_review_assignments_deliverable_fk_idx','deliverable_review_assignments_version_fk_idx',
     'deliverable_review_assignments_reviewer_fk_idx','deliverable_review_assignments_assigned_by_fk_idx',
     'deliverable_review_assignments_nominated_by_fk_idx','deliverable_lifecycle_events_project_fk_idx',
     'deliverable_lifecycle_events_client_fk_idx','deliverable_lifecycle_events_deliverable_fk_idx',
     'deliverable_lifecycle_events_version_fk_idx','deliverable_lifecycle_events_actor_fk_idx',
     'deliverable_action_requests_actor_fk_idx'
   )));

select pg_temp.check_p7('tenant_safe_composite_foreign_keys_cover_new_relations',
  (select count(*)=8
   from pg_constraint c
   where c.contype='f' and c.conrelid in (
     'public.deliverable_review_assignments'::regclass,
     'public.deliverable_lifecycle_events'::regclass
   ) and array_length(c.conkey,1)>=2));

select pg_temp.check_p7('append_only_triggers_are_installed',
  (select count(*)=3 from pg_trigger
   where not tgisinternal and tgname in (
     'trg_deliverable_lifecycle_events_append_only','trg_deliverable_action_requests_append_only',
     'trg_approvals_append_only'
   )));

select pg_temp.check_p7('legacy_backfill_never_invents_publication',
  pg_get_functiondef('private.p7_terminal_event(uuid,uuid,bigint,text,jsonb,uuid)'::regprocedure) like '%p_event_type not in (%delivered%published%'
  and position('legacy_status_marker' in pg_get_functiondef('private.p7_terminal_event(uuid,uuid,bigint,text,jsonb,uuid)'::regprocedure))=0);

do $$
<<runtime>>
declare
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
  creator uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid();
  manager uuid:=gen_random_uuid(); other_manager uuid:=gen_random_uuid();
  client_user uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid(); project_id uuid:=gen_random_uuid();
  stream_id uuid:=gen_random_uuid(); deliverable_id uuid:=gen_random_uuid();
  contact_id uuid:=gen_random_uuid(); version_id uuid; version2_id uuid;
  create_key uuid:=gen_random_uuid(); submit_key uuid:=gen_random_uuid();
  review_key uuid:=gen_random_uuid(); release_key uuid:=gen_random_uuid();
  client_key uuid:=gen_random_uuid(); delivered_key uuid:=gen_random_uuid();
  published_key uuid:=gen_random_uuid(); result jsonb; replay jsonb;
  create2_key uuid:=gen_random_uuid(); submit2_key uuid:=gen_random_uuid();
  review2_key uuid:=gen_random_uuid(); release2_key uuid:=gen_random_uuid();
  published2_key uuid:=gen_random_uuid(); delivered2_key uuid:=gen_random_uuid();
  denied boolean; n bigint;
begin
  insert into auth.users(id) values(creator),(owner_id),(manager),(other_manager),(client_user),(outsider);
  insert into public.organizations(id,name,slug,settings) values
    (org,'P7 verifier','p7-'||org::text,'{"client_approvals_enabled":true}'::jsonb),
    (other_org,'P7 other','p7-'||other_org::text,'{}'::jsonb);
  insert into public.profiles(id,full_name) values
    (creator,'Creator'),(owner_id,'Project Owner'),(manager,'Design Manager'),
    (other_manager,'Other Manager'),(client_user,'Client Approver'),(outsider,'Outsider')
  on conflict(id) do update set full_name=excluded.full_name;
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (org,creator,'team','contributor','design','active'),
    (org,owner_id,'team','project_owner',null,'active'),
    (org,manager,'team','department_manager','design','active'),
    (org,other_manager,'team','department_manager','content','active'),
    (org,client_user,'client','client_approver',null,'active'),
    (other_org,outsider,'team','executive',null,'active');
  insert into public.clients(id,organization_id,name) values(client_id,org,'P7 client');
  insert into public.projects(id,organization_id,client_id,name,owner_id) values(project_id,org,client_id,'P7 project',owner_id);
  insert into public.workstreams(id,organization_id,project_id,department_id,name,owner_id)
    values(stream_id,org,project_id,'design','P7 design',creator);
  insert into public.deliverables(id,organization_id,project_id,workstream_id,title,owner_id,created_by)
    values(deliverable_id,org,project_id,stream_id,'P7 deliverable',owner_id,creator);
  insert into public.client_contacts(id,organization_id,client_id,auth_user_id,full_name,portal_role,status)
    values(contact_id,org,client_id,client_user,'P7 Client','approver','active');
  insert into public.project_client_access(organization_id,project_id,client_contact_id,access_role,status)
    values(org,project_id,contact_id,'approver','active');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',creator,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.create_governed_deliverable_version(org,deliverable_id,'Version one','Initial',null,'{}',true,create_key);
  reset role;
  version_id:=(result->>'deliverable_version_id')::uuid;
  perform pg_temp.check_p7('create_derives_exact_graph_and_initial_state',
    (select v.organization_id=org and v.project_id=runtime.project_id and v.deliverable_id=runtime.deliverable_id
      and v.state_version=1 and v.review_status='in_production' and v.client_approval_required
     from public.deliverable_versions v where v.id=version_id)
    and (select e.workstream_id=runtime.stream_id and e.client_id=runtime.client_id
      from public.deliverable_lifecycle_events e where e.deliverable_version_id=version_id and e.event_type='created'));

  set local role authenticated;
  replay:=public.create_governed_deliverable_version(org,deliverable_id,'Version one','Initial',null,'{}',true,create_key);
  reset role;
  perform pg_temp.check_p7('exact_create_replay_returns_same_result_without_duplicate',
    replay->>'deliverable_version_id'=result->>'deliverable_version_id'
    and (replay->>'idempotent_replay')::boolean
    and (select count(*)=1 from public.deliverable_versions where id=version_id));
  denied:=false;
  set local role authenticated;
  begin perform public.create_governed_deliverable_version(org,deliverable_id,'Changed payload','Initial',null,'{}',true,create_key);
  exception when unique_violation then denied:=true; end;
  reset role;
  perform pg_temp.check_p7('same_request_key_with_changed_payload_conflicts',denied);

  denied:=false;
  set local role authenticated;
  begin perform public.submit_governed_deliverable_version(org,version_id,1,creator,gen_random_uuid());
  exception when insufficient_privilege then denied:=true; end;
  reset role;
  perform pg_temp.check_p7('creator_cannot_self_review',denied);
  denied:=false;
  set local role authenticated;
  begin perform public.submit_governed_deliverable_version(org,version_id,1,other_manager,gen_random_uuid());
  exception when insufficient_privilege then denied:=true; end;
  reset role;
  perform pg_temp.check_p7('wrong_department_manager_is_ineligible',denied);

  set local role authenticated;
  result:=public.submit_governed_deliverable_version(org,version_id,1,manager,submit_key);
  reset role;
  perform pg_temp.check_p7('submitter_nominates_one_eligible_named_reviewer',
    result->>'assigned_reviewer_id'=manager::text
    and (select count(*)=1 from public.deliverable_review_assignments
      where deliverable_version_id=version_id and reviewer_id=manager and status='current'));

  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_manager,'role','authenticated')::text,true);
  denied:=false;
  set local role authenticated;
  begin perform public.review_governed_deliverable_version(org,version_id,2,'approved','No claim','{}',gen_random_uuid());
  exception when insufficient_privilege then denied:=true; end;
  reset role;
  perform pg_temp.check_p7('unassigned_reviewer_cannot_claim_or_decide',denied);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'role','authenticated')::text,true);
  update public.organization_memberships set status='suspended'
    where organization_id=org and user_id=manager;
  denied:=false;
  set local role authenticated;
  begin perform public.review_governed_deliverable_version(org,version_id,2,'approved','Inactive reviewer','{}',gen_random_uuid());
  exception when insufficient_privilege then denied:=true; end;
  reset role;
  perform pg_temp.check_p7('assigned_reviewer_is_revalidated_at_decision_time',denied);
  update public.organization_memberships set status='active'
    where organization_id=org and user_id=manager;
  set local role authenticated;
  result:=public.review_governed_deliverable_version(org,version_id,2,'approved','Ready','{"quality":true}',review_key);
  reset role;
  perform pg_temp.check_p7('assigned_department_manager_reviews_exact_version',
    result->>'review_status'='ready_for_client_review'
    and (select count(*)=1 from public.approvals where deliverable_version_id=version_id and approval_type='internal_quality' and decision='approved'));
  denied:=false;
  set local role authenticated;
  begin perform public.release_governed_deliverable_version(org,version_id,3,true,'Client review',gen_random_uuid());
  exception when insufficient_privilege then denied:=true; end;
  reset role;
  perform pg_temp.check_p7('department_manager_cannot_release',denied);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.release_governed_deliverable_version(org,version_id,3,true,'Client review',release_key);
  reset role;
  perform pg_temp.check_p7('project_owner_releases_without_premature_client_approval',
    result->>'review_status'='client_reviewing'
    and (select count(*)=0 from public.approvals where deliverable_version_id=version_id and approval_type='client_approval'));
  denied:=false;
  set local role authenticated;
  begin perform public.mark_governed_deliverable_delivered(org,version_id,4,'{}',gen_random_uuid());
  exception when check_violation then denied:=true; end;
  reset role;
  perform pg_temp.check_p7('closure_waits_for_required_exact_version_client_approval',denied);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',client_user,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.decide_governed_deliverable_version(org,version_id,4,'approved','Approved',client_key);
  reset role;
  perform pg_temp.check_p7('authorized_exact_project_client_approver_decides',
    result->>'review_status'='client_approved'
    and (select actor_kind='client' from public.deliverable_lifecycle_events
      where deliverable_version_id=version_id and event_type='client_approved'));

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.mark_governed_deliverable_delivered(org,version_id,5,'{"channel":"handoff"}',delivered_key);
  result:=public.mark_governed_deliverable_published(org,version_id,6,'{"channel":"web"}',published_key);
  reset role;
  perform pg_temp.check_p7('delivered_and_published_are_separate_append_only_facts',
    (select count(*)=2 from public.deliverable_lifecycle_events
      where deliverable_version_id=version_id and event_type in ('delivered','published'))
    and result->>'event_type'='published');
  set local role authenticated;
  replay:=public.mark_governed_deliverable_published(org,version_id,6,'{"channel":"web"}',published_key);
  reset role;
  perform pg_temp.check_p7('terminal_event_exact_replay_is_idempotent',
    replay->>'deliverable_version_id'=result->>'deliverable_version_id'
    and replay->>'event_type'=result->>'event_type'
    and (replay->>'idempotent_replay')::boolean);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',creator,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.create_governed_deliverable_version(org,deliverable_id,'Version two','Publish first',null,'{}',false,create2_key);
  reset role;
  version2_id:=(result->>'deliverable_version_id')::uuid;
  set local role authenticated;
  result:=public.submit_governed_deliverable_version(org,version2_id,1,manager,submit2_key);
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.review_governed_deliverable_version(org,version2_id,2,'approved','Ready','{}',review2_key);
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.release_governed_deliverable_version(org,version2_id,3,false,'Release',release2_key);
  result:=public.get_deliverable_version_capabilities(org,version2_id);
  reset role;
  perform pg_temp.check_p7('released_version_initially_permits_both_terminal_facts',
    (result->>'can_mark_delivered')::boolean and (result->>'can_mark_published')::boolean);

  set local role authenticated;
  result:=public.mark_governed_deliverable_published(org,version2_id,4,'{"channel":"web"}',published2_key);
  result:=public.get_deliverable_version_capabilities(org,version2_id);
  reset role;
  perform pg_temp.check_p7('publishing_first_still_permits_later_delivered_fact',
    (result->>'can_mark_delivered')::boolean and not (result->>'can_mark_published')::boolean);

  set local role authenticated;
  result:=public.mark_governed_deliverable_delivered(org,version2_id,5,'{"channel":"handoff"}',delivered2_key);
  result:=public.get_deliverable_version_capabilities(org,version2_id);
  reset role;
  perform pg_temp.check_p7('published_then_delivered_records_both_facts_once',
    not (result->>'can_mark_delivered')::boolean and not (result->>'can_mark_published')::boolean
    and (select count(*)=2 and count(distinct event_type)=2
      from public.deliverable_lifecycle_events
      where deliverable_version_id=version2_id and event_type in ('delivered','published')));

  denied:=false;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  set local role authenticated;
  begin perform public.get_deliverable_version_capabilities(org,version_id);
  exception when others then denied:=true; end;
  reset role;
  perform pg_temp.check_p7('cross_organization_actor_cannot_obtain_capabilities',denied);

  denied:=false;
  begin update public.deliverable_lifecycle_events set metadata='{}' where deliverable_version_id=version_id;
  exception when others then denied:=position('append-only' in sqlerrm)>0; end;
  perform pg_temp.check_p7('lifecycle_evidence_is_append_only',denied);
  select count(*) into n from public.deliverable_action_requests where organization_id=org;
  perform pg_temp.check_p7('one_content_free_replay_record_per_action',
    n=13 and not exists(select 1 from public.deliverable_action_requests request
      where request.result ?| array['title','rationale','change_summary','metadata']));
end $$;

select pg_temp.check_p7('all_checks_passed',coalesce(bool_and(passed),false)) from p7_checks;

do $$
declare failures text;
begin
  select string_agg(check_name,', ' order by check_name) into failures from p7_checks where not passed;
  if failures is not null then raise exception 'P7 verifier failed: %',failures; end if;
end $$;

table p7_checks;
rollback;
