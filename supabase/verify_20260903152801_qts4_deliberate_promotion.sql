begin;
create temporary table qts4_checks(check_name text primary key,passed boolean not null) on commit drop;

insert into qts4_checks values
('project_atomic_and_type_exact',position('case when v_client_id is null then ''internal'' else ''project'' end' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0),
('project_creates_no_engagement_or_projection',position('insert into public.engagements' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))=0 and position('insert into public.workstreams' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))=0),
('work_item_only_and_provenance',position('public.save_work_item' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0 and position('quick_task_promotion' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0 and position('insert into public.tasks' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))=0),
('artifact_is_internal_unapproved_unreleased',position('false, ''internal''' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0 and position('artifact_approvals' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))=0 and position('artifact_releases' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))=0),
('exact_revision_and_checksum_required',position('current_revision_id <> p_expected_revision_id' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0 and position('content_sha256 <> p_expected_content_sha256' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0),
('inactive_states_rejected',position('state not in (''active'', ''preserved'')' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0),
('retry_is_idempotent',position('idempotent_replay'', true' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0),
('conflicting_retry_rejected',position('different promotion request' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0),
('cross_tenant_and_foreign_mapping_rejected',position('organization_id = v_task.organization_id' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0),
('source_is_terminal_provenance',position('state = ''promoted''' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0),
('destination_and_promotion_rollback_together',position('for update' in pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure))>0),
('ledger_is_append_only',exists(select 1 from pg_trigger where tgrelid='public.quick_task_promotions'::regclass and tgname='trg_quick_task_promotions_append_only' and tgenabled<>'D')),
('leadership_metadata_only',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='quick_task_promotions' and column_name in('content','title','notes','prompt','output_text'))),
('promotion_table_rls_enabled',(select relrowsecurity from pg_class where oid='public.quick_task_promotions'::regclass)),
('promotion_policy_is_metadata_only',(select count(*)=1 and bool_and(polcmd='r') from pg_policy where polrelid='public.quick_task_promotions'::regclass)),
('table_acl_is_exact',not has_table_privilege('anon','public.quick_task_promotions','SELECT') and has_table_privilege('authenticated','public.quick_task_promotions','SELECT') and not has_table_privilege('authenticated','public.quick_task_promotions','INSERT,UPDATE,DELETE') and has_table_privilege('service_role','public.quick_task_promotions','SELECT,INSERT,UPDATE,DELETE,MAINTAIN')),
('promotion_rpc_acl_is_exact',not has_function_privilege('anon','public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)','EXECUTE') and has_function_privilege('service_role','public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)','EXECUTE')),
('typed_foreign_keys_are_exact',(
  with expected(constraint_name,parent_table,child_columns,parent_columns) as (
    values
      ('quick_task_promotions_owner_id_fkey','auth.users'::regclass,array['owner_id'],array['id']),
      ('quick_task_promotions_source_task_fkey','public.quick_tasks'::regclass,array['quick_task_id','organization_id','owner_id'],array['id','organization_id','owner_id']),
      ('quick_task_promotions_source_revision_fkey','public.quick_task_revisions'::regclass,array['source_revision_id','quick_task_id','organization_id','owner_id'],array['id','quick_task_id','organization_id','owner_id']),
      ('quick_task_promotions_project_fkey','public.projects'::regclass,array['destination_project_id','organization_id'],array['id','organization_id']),
      ('quick_task_promotions_work_item_fkey','public.work_items'::regclass,array['destination_work_item_id','organization_id'],array['id','organization_id']),
      ('quick_task_promotions_artifact_fkey','public.artifacts'::regclass,array['destination_artifact_id','organization_id'],array['id','organization_id']),
      ('quick_task_promotions_artifact_version_fkey','public.artifact_versions'::regclass,array['destination_artifact_version_id','organization_id'],array['id','organization_id']),
      ('quick_task_promotions_promoted_by_fkey','auth.users'::regclass,array['promoted_by'],array['id'])
  ), actual as (
    select relationship.conname,relationship.confrelid,relationship.confdeltype,relationship.confupdtype,
      relationship.confmatchtype,relationship.condeferrable,
      array(select attribute.attname::text from unnest(relationship.conkey) with ordinality key(attnum,position)
        join pg_attribute attribute on attribute.attrelid=relationship.conrelid and attribute.attnum=key.attnum order by key.position) child_columns,
      array(select attribute.attname::text from unnest(relationship.confkey) with ordinality key(attnum,position)
        join pg_attribute attribute on attribute.attrelid=relationship.confrelid and attribute.attnum=key.attnum order by key.position) parent_columns
    from pg_constraint relationship where relationship.conrelid='public.quick_task_promotions'::regclass and relationship.contype='f'
  )
  select (select count(*) from actual)=8 and count(actual.conname)=8 and bool_and(
    actual.confrelid=expected.parent_table and actual.child_columns=expected.child_columns
    and actual.parent_columns=expected.parent_columns and actual.confdeltype='r'
    and actual.confupdtype='a' and actual.confmatchtype='s' and not actual.condeferrable
  ) from expected left join actual using(constraint_name)
)),
('supporting_indexes_exist',(select count(*)=6 from pg_indexes where schemaname='public' and indexname like 'idx_quick_task_promotions_%')),
('exact_target_constraint_exists',exists(select 1 from pg_constraint where conrelid='public.quick_task_promotions'::regclass and conname='quick_task_promotions_exact_target_check')),
('created_via_constraint_is_exact',coalesce((select regexp_replace(btrim(pg_get_expr(rule.conbin,rule.conrelid,true)), '[[:space:]]+', ' ', 'g') = 'created_via = ANY (ARRAY[''manual''::text, ''ai_chat_proposal''::text, ''automation_rule''::text, ''recurring_plan''::text, ''quick_task_promotion''::text])' from pg_constraint rule where rule.conrelid='public.work_items'::regclass and rule.conname='work_items_created_via_check' and rule.contype='c'),false)),
('no_bypass_side_effects',position('security definer' in lower(pg_get_functiondef('public.promote_quick_task(uuid,uuid,text,text,jsonb,uuid,boolean,uuid)'::regprocedure)))=0);

select jsonb_object_agg(check_name,passed order by check_name) as qts4_verification from qts4_checks;
do $$ declare v_failed text; begin select string_agg(check_name,', ' order by check_name) into v_failed from qts4_checks where not passed; if v_failed is not null then raise exception 'QTS4 verification failed: %',v_failed; end if; end $$;
rollback;