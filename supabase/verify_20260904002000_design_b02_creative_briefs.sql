-- Fail-closed, rollback-only verification for Design B02.
begin;

do $$
declare
  v_table text;
  v_role text;
  v_privilege text;
  v_rpc regprocedure;
  v_trigger record;
begin
  if exists (
    with expected(parent_table, parent_columns) as (values
      ('tasks', array['id','organization_id']::text[]),
      ('work_items', array['id','organization_id']::text[]),
      ('engagements', array['id','organization_id']::text[]),
      ('brands', array['id','organization_id']::text[]),
      ('engagement_services', array['id','organization_id']::text[]),
      ('design_creative_briefs', array['id','organization_id']::text[]),
      ('design_creative_brief_versions', array['id','organization_id']::text[]),
      ('design_creative_brief_versions', array['creative_brief_id','id','organization_id']::text[]),
      ('artifact_versions', array['id','organization_id']::text[]),
      ('design_workshop_sessions', array['id','organization_id']::text[]),
      ('design_direction_versions', array['id','organization_id']::text[])
    )
    select 1 from expected e where not exists (
      select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
      where c.conrelid=to_regclass('public.'||e.parent_table)
        and c.contype in ('p','u') and c.convalidated and i.indisunique and i.indisvalid and i.indisready
        and i.indpred is null and i.indexprs is null and (
          select array_agg(a.attname order by key.ordinality)::text[]
          from unnest(c.conkey) with ordinality key(attnum, ordinality)
          join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum
        )=e.parent_columns
    )
  ) then raise exception 'B02 composite FK parent candidate-key set is incomplete'; end if;

  if exists (
    with expected(child_table, child_columns, parent_table, parent_columns, delete_action) as (values
      ('design_creative_briefs',array['engagement_id','organization_id']::text[],'engagements',array['id','organization_id']::text[],'c'),
      ('design_creative_briefs',array['brand_id','organization_id']::text[],'brands',array['id','organization_id']::text[],'r'),
      ('design_creative_briefs',array['engagement_service_id','organization_id']::text[],'engagement_services',array['id','organization_id']::text[],'r'),
      ('design_creative_briefs',array['project_task_id','organization_id']::text[],'tasks',array['id','organization_id']::text[],'r'),
      ('design_creative_briefs',array['engagement_work_item_id','organization_id']::text[],'work_items',array['id','organization_id']::text[],'r'),
      ('design_creative_brief_versions',array['creative_brief_id','organization_id']::text[],'design_creative_briefs',array['id','organization_id']::text[],'c'),
      ('design_creative_brief_versions',array['creative_brief_id','parent_version_id','organization_id']::text[],'design_creative_brief_versions',array['creative_brief_id','id','organization_id']::text[],'r'),
      ('design_creative_briefs',array['id','current_version_id','organization_id']::text[],'design_creative_brief_versions',array['creative_brief_id','id','organization_id']::text[],'r'),
      ('design_creative_briefs',array['id','frozen_version_id','organization_id']::text[],'design_creative_brief_versions',array['creative_brief_id','id','organization_id']::text[],'r'),
      ('design_creative_brief_version_sources',array['creative_brief_version_id','organization_id']::text[],'design_creative_brief_versions',array['id','organization_id']::text[],'c'),
      ('design_creative_brief_version_sources',array['artifact_version_id','organization_id']::text[],'artifact_versions',array['id','organization_id']::text[],'r'),
      ('design_working_direction_preferences',array['engagement_id','organization_id']::text[],'engagements',array['id','organization_id']::text[],'c'),
      ('design_working_direction_preferences',array['session_id','organization_id']::text[],'design_workshop_sessions',array['id','organization_id']::text[],'c'),
      ('design_working_direction_preferences',array['direction_version_id','organization_id']::text[],'design_direction_versions',array['id','organization_id']::text[],'r'),
      ('design_direction_versions',array['creative_brief_version_id','organization_id']::text[],'design_creative_brief_versions',array['id','organization_id']::text[],'r'),
      ('design_workshop_sessions',array['project_task_id','organization_id']::text[],'tasks',array['id','organization_id']::text[],'r'),
      ('design_workshop_sessions',array['engagement_work_item_id','organization_id']::text[],'work_items',array['id','organization_id']::text[],'r')
    )
    select 1 from expected e where not exists (
      select 1 from pg_constraint c where c.conrelid=to_regclass('public.'||e.child_table)
        and c.contype='f' and c.convalidated and c.confrelid=to_regclass('public.'||e.parent_table)
        and c.confdeltype=e.delete_action::"char" and c.confupdtype='a' and c.confmatchtype='s'
        and (select array_agg(a.attname order by key.ordinality)::text[] from unnest(c.conkey) with ordinality key(attnum,ordinality)
          join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=e.child_columns
        and (select array_agg(a.attname order by key.ordinality)::text[] from unnest(c.confkey) with ordinality key(attnum,ordinality)
          join pg_attribute a on a.attrelid=c.confrelid and a.attnum=key.attnum)=e.parent_columns
        and not exists (
          select 1 from unnest(c.conkey,c.confkey) with ordinality pair(child_attnum,parent_attnum,ordinality)
          join pg_attribute child_attribute on child_attribute.attrelid=c.conrelid and child_attribute.attnum=pair.child_attnum
          join pg_attribute parent_attribute on parent_attribute.attrelid=c.confrelid and parent_attribute.attnum=pair.parent_attnum
          where child_attribute.atttypid<>parent_attribute.atttypid
            or child_attribute.attcollation<>parent_attribute.attcollation
        )
    )
  ) then raise exception 'B02 tenant-safe composite FK set is incomplete'; end if;

  foreach v_table in array array[
    'design_creative_briefs', 'design_creative_brief_versions',
    'design_creative_brief_version_sources', 'design_working_direction_preferences'
  ] loop
    if to_regclass('public.' || v_table) is null then raise exception 'B02 missing table %', v_table; end if;
    if not coalesce((select relrowsecurity and not relforcerowsecurity from pg_class where oid = to_regclass('public.' || v_table)), false)
      then raise exception 'B02 RLS state invalid on %', v_table; end if;
    if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      where c.oid=to_regclass('public.'||v_table) and acl.grantee=0)
      then raise exception 'B02 PUBLIC unexpectedly has table privileges on %', v_table; end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      foreach v_privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(v_role, 'public.' || v_table, v_privilege)
          is distinct from (v_role = 'authenticated' and v_privilege = 'SELECT' or v_role = 'service_role')
        then raise exception 'B02 unexpected %.% privilege on %', v_role, v_privilege, v_table; end if;
      end loop;
    end loop;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename in (
      'design_creative_briefs','design_creative_brief_versions','design_creative_brief_version_sources','design_working_direction_preferences')) <> 4
  then raise exception 'B02 unexpected policy count'; end if;
  if exists (
    with expected(table_name, policy_name, required_qual) as (values
      ('design_creative_briefs','Team can read official or owned Design briefs','is_team_organization_member'),
      ('design_creative_brief_versions','Team can read permitted Design brief versions','design_creative_briefs'),
      ('design_creative_brief_version_sources','Team can read permitted Design brief sources','design_creative_brief_versions'),
      ('design_working_direction_preferences','Team can read working Design directions','is_team_organization_member')
    ) select 1 from expected e left join pg_policies p on p.schemaname='public' and p.tablename=e.table_name
      and p.policyname=e.policy_name and p.cmd='SELECT' and p.permissive='PERMISSIVE'
      and p.roles=array['authenticated']::name[] and p.with_check is null and p.qual like '%' || e.required_qual || '%'
      where p.policyname is null
  ) then raise exception 'B02 exact SELECT policy definition missing'; end if;

  foreach v_rpc in array array[
    'public.save_design_creative_brief_version(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,integer,uuid,jsonb,text,jsonb,uuid[])'::regprocedure,
    'public.freeze_design_creative_brief_version(uuid,uuid,uuid,uuid,integer,uuid)'::regprocedure,
    'public.set_design_working_direction_preference(uuid,uuid,uuid,uuid,uuid,integer,uuid)'::regprocedure
  ] loop
    if not coalesce((select not prosecdef and provolatile='v' and pg_get_userbyid(proowner)='postgres'
        and proconfig=array['search_path=""']::text[] from pg_proc where oid=v_rpc), false)
      then raise exception 'B02 RPC security metadata invalid for %', v_rpc; end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=v_rpc and acl.grantee=0)
      then raise exception 'B02 PUBLIC unexpectedly has RPC privileges on %', v_rpc; end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(v_role, v_rpc, 'EXECUTE') is distinct from (v_role='service_role')
        then raise exception 'B02 RPC privilege mismatch for % on %', v_role, v_rpc; end if;
    end loop;
  end loop;

  if not coalesce((select bool_and(checks.check_passed) from (values
    (exists(select 1 from pg_constraint where conrelid='public.design_creative_briefs'::regclass and conname='design_creative_briefs_current_version_fk'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (id, current_version_id, organization_id) REFERENCES %design_creative_brief_versions(creative_brief_id, id, organization_id)%')),
    (exists(select 1 from pg_constraint where conrelid='public.design_creative_briefs'::regclass and conname='design_creative_briefs_frozen_version_fk'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (id, frozen_version_id, organization_id) REFERENCES %design_creative_brief_versions(creative_brief_id, id, organization_id)%')),
    (exists(select 1 from pg_constraint where conrelid='public.design_creative_brief_versions'::regclass and conname='design_creative_brief_versions_parent_same_root_fk'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (creative_brief_id, parent_version_id, organization_id) REFERENCES %design_creative_brief_versions(creative_brief_id, id, organization_id)%')),
    (exists(select 1 from pg_constraint where conrelid='public.design_creative_briefs'::regclass and conname='design_creative_briefs_exact_scope_check' and contype='c')),
    (exists(select 1 from pg_constraint where conrelid='public.design_workshop_sessions'::regclass and conname='design_workshop_sessions_exact_scope_check' and contype='c')),
    (exists(select 1 from pg_constraint where conrelid='public.design_working_direction_preferences'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (session_id)')),
    (exists(select 1 from pg_constraint where conrelid='public.design_direction_versions'::regclass and conname='design_direction_versions_creative_brief_version_fk'))
  ) checks(check_passed)), false) then raise exception 'B02 composite/check constraint set is incomplete'; end if;

  if not coalesce((select bool_and(indexrelid is not null and indisunique and indisvalid and indisready)
    from (values
      ('uq_design_creative_briefs_official_engagement_scope'),
      ('uq_design_creative_briefs_official_task_scope'),
      ('uq_design_creative_briefs_official_work_item_scope')
    ) expected(name) left join pg_class index_class on index_class.relname=expected.name and index_class.relnamespace='public'::regnamespace
      left join pg_index on indexrelid=index_class.oid), false)
  then raise exception 'B02 exact-scope unique index missing or invalid'; end if;

  for v_trigger in select * from (values
    ('design_creative_briefs','trg_design_creative_briefs_context'),
    ('design_workshop_sessions','trg_design_workshop_sessions_context'),
    ('design_direction_versions','trg_design_direction_versions_brief_context'),
    ('design_working_direction_preferences','trg_design_working_preferences_chain'),
    ('design_creative_brief_versions','trg_design_creative_brief_versions_immutable'),
    ('design_creative_brief_version_sources','trg_design_creative_brief_sources_immutable'),
    ('artifact_versions','trg_artifact_versions_immutable'),
    ('artifact_approvals','trg_artifact_approvals_immutable'),
    ('design_workshop_context_versions','trg_design_context_immutable'),
    ('design_direction_versions','trg_design_direction_versions_immutable'),
    ('design_direction_selections','trg_design_selections_immutable'),
    ('design_direction_releases','trg_design_releases_immutable')
  ) x(table_name, trigger_name) loop
    if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||v_trigger.table_name)
      and tgname=v_trigger.trigger_name and not tgisinternal and tgenabled='O')
    then raise exception 'B02 missing or disabled trigger %.%', v_trigger.table_name, v_trigger.trigger_name; end if;
  end loop;
end;
$$;

create temporary table b02_runtime_checks(check_name text primary key, passed boolean not null) on commit drop;

do $$
declare
  o uuid; e uuid; e_other uuid; b uuid; p uuid; a uuid; s uuid; s_other uuid;
  task_id uuid:=gen_random_uuid(); task_id_other uuid:=gen_random_uuid(); item_id uuid:=gen_random_uuid();
  root_eng uuid:=gen_random_uuid(); root_task uuid:=gen_random_uuid(); root_item uuid:=gen_random_uuid();
  root_task_other uuid:=gen_random_uuid(); root_service uuid:=gen_random_uuid(); root_other_eng uuid:=gen_random_uuid();
  v_eng uuid:=gen_random_uuid(); v_task uuid:=gen_random_uuid(); v_item uuid:=gen_random_uuid();
  v_task_other uuid:=gen_random_uuid(); v_service uuid:=gen_random_uuid(); v_other_eng uuid:=gen_random_uuid();
  session_eng uuid:=gen_random_uuid(); session_task uuid:=gen_random_uuid(); session_item uuid:=gen_random_uuid();
  direction_eng uuid:=gen_random_uuid(); direction_task uuid:=gen_random_uuid(); direction_item uuid:=gen_random_uuid();
  dv_eng uuid:=gen_random_uuid(); dv_task uuid:=gen_random_uuid(); dv_item uuid:=gen_random_uuid();
  second_catalog uuid:=gen_random_uuid(); artifact_id uuid:=gen_random_uuid();
  artifact_version_id uuid:=gen_random_uuid(); approval_id uuid:=gen_random_uuid(); source_id uuid:=gen_random_uuid();
  wrong_org uuid:=gen_random_uuid();
  ok boolean;
begin
  select engagement.organization_id, engagement.id, other.id, engagement.brand_id, engagement.project_id,
         membership.user_id, service.id
  into o,e,e_other,b,p,a,s
  from public.engagements engagement
  join public.organization_memberships membership on membership.organization_id=engagement.organization_id
    and membership.member_kind='team' and membership.status='active'
  join public.engagement_services service on service.engagement_id=engagement.id and service.organization_id=engagement.organization_id and service.status='active'
  join public.service_catalog catalog on catalog.id=service.service_id and catalog.department_id='design' and catalog.is_active
  join public.engagements other on other.organization_id=engagement.organization_id and other.id<>engagement.id
  limit 1;
  if o is null then raise exception 'B02 runtime fixture requires two engagements and an active Design service'; end if;
  select service.id into s_other from public.engagement_services service join public.service_catalog catalog on catalog.id=service.service_id
    where service.organization_id=o and service.engagement_id=e_other and service.status='active' and catalog.department_id='design' and catalog.is_active limit 1;
  if s_other is null then
    insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by)
      select o,e_other,service_id,'active',a from public.engagement_services where id=s returning id into s_other;
  end if;
  insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active)
    values(second_catalog,o,'design','b02_verifier_'||replace(second_catalog::text,'-',''),'B02 verifier Design service',true);
  insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by)
    values(o,e,second_catalog,'active',a) returning id into second_catalog;
  insert into public.tasks(id,user_id,title,status,organization_id,project_id,created_by)
    values(task_id,a,'B02 verifier task A','backlog',o,p,a),
      (task_id_other,a,'B02 verifier task B','backlog',o,p,a);
  insert into public.work_items(id,organization_id,engagement_id,project_id,brand_id,title,created_by)
    values(item_id,o,e,p,b,'B02 verifier item',a);
  insert into public.artifacts(id,organization_id,brand_id,engagement_id,artifact_type,title,created_by)
    values(artifact_id,o,b,e,'discovery','B02 verifier artifact',a);
  insert into public.artifact_versions(id,organization_id,artifact_id,version_number,content,content_checksum,ai_use_allowed,created_by)
    values(artifact_version_id,o,artifact_id,1,'{}',repeat('c0',32),true,a);
  insert into public.artifact_approvals(id,organization_id,artifact_id,artifact_version_id,engagement_id,approved_by)
    values(approval_id,o,artifact_id,artifact_version_id,e,a);

  insert into public.design_creative_briefs(id,organization_id,engagement_id,brand_id,engagement_service_id,project_task_id,engagement_work_item_id,created_by,updated_by)
  values (root_eng,o,e,b,s,null,null,a,a),(root_task,o,e,b,s,task_id,null,a,a),
    (root_task_other,o,e,b,s,task_id_other,null,a,a),(root_item,o,e,b,s,null,item_id,a,a),
    (root_service,o,e,b,second_catalog,null,null,a,a),(root_other_eng,o,e_other,(select brand_id from public.engagements where id=e_other),s_other,null,null,a,a);
  insert into public.design_creative_brief_versions(id,organization_id,creative_brief_id,version_number,content,content_checksum,validation_snapshot,operation_key,created_by)
  values (v_eng,o,root_eng,1,'{}',repeat('a',64),'{"valid":true}',gen_random_uuid(),a),
    (v_task,o,root_task,1,'{}',repeat('b',64),'{"valid":true}',gen_random_uuid(),a),
    (v_task_other,o,root_task_other,1,'{}',repeat('a1',32),'{"valid":true}',gen_random_uuid(),a),
    (v_item,o,root_item,1,'{}',repeat('c',64),'{"valid":true}',gen_random_uuid(),a),
    (v_service,o,root_service,1,'{}',repeat('d',64),'{"valid":true}',gen_random_uuid(),a),
    (v_other_eng,o,root_other_eng,1,'{}',repeat('e',64),'{"valid":true}',gen_random_uuid(),a);

  begin update public.design_creative_briefs set current_version_id=v_task where id=root_eng; ok:=false;
    exception when foreign_key_violation then ok:=true; end;
  insert into b02_runtime_checks values('cross_root_current_rejected',ok);
  begin update public.design_creative_briefs set frozen_version_id=v_task where id=root_eng; ok:=false;
    exception when foreign_key_violation then ok:=true; end;
  insert into b02_runtime_checks values('cross_root_frozen_rejected',ok);
  begin insert into public.design_creative_brief_versions(organization_id,creative_brief_id,version_number,parent_version_id,content,content_checksum,validation_snapshot,operation_key,created_by)
    values(o,root_eng,2,v_task,'{}',repeat('f',64),'{}',gen_random_uuid(),a); ok:=false;
    exception when foreign_key_violation then ok:=true; end;
  insert into b02_runtime_checks values('cross_root_parent_rejected',ok);
  begin update public.design_creative_briefs set project_task_id=task_id where id=root_eng; ok:=false;
    exception when check_violation then ok:=true; end;
  insert into b02_runtime_checks values('root_context_mutation_rejected',ok);

  insert into public.design_workshop_sessions(id,organization_id,engagement_id,brand_id,engagement_service_id,project_task_id,engagement_work_item_id,output_family,output_brief,designer_instructions,context_manifest,context_checksum,created_by)
  values(session_eng,o,e,b,s,null,null,'marketing_asset','{}','B02 verifier','{}',repeat('1',64),a),
    (session_task,o,e,b,s,task_id,null,'marketing_asset','{}','B02 verifier','{}',repeat('2',64),a),
    (session_item,o,e,b,s,null,item_id,'marketing_asset','{}','B02 verifier','{}',repeat('3',64),a);
  insert into public.design_workshop_context_versions(organization_id,session_id,artifact_id,artifact_version_id,artifact_approval_id,artifact_type)
    values(o,session_task,artifact_id,artifact_version_id,approval_id,'discovery');
  insert into public.design_directions(id,organization_id,session_id,direction_slot)
  values(direction_eng,o,session_eng,1),(direction_task,o,session_task,1),(direction_item,o,session_item,1);
  insert into public.design_direction_versions(id,organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id)
  values(dv_eng,o,direction_eng,1,'{}',repeat('4',64),repeat('4',16),a,v_eng),
    (dv_task,o,direction_task,1,'{}',repeat('5',64),repeat('5',16),a,v_task),
    (dv_item,o,direction_item,1,'{}',repeat('6',64),repeat('6',16),a,v_item);

  begin insert into public.design_creative_briefs(organization_id,engagement_id,brand_id,engagement_service_id,created_by,updated_by)
    values(wrong_org,e,b,s,a,a); ok:=false; exception when foreign_key_violation or check_violation then ok:=true; end;
  insert into b02_runtime_checks values('creative_brief_cross_tenant_tuple_rejected',ok);
  begin insert into public.design_creative_brief_versions(organization_id,creative_brief_id,version_number,content,content_checksum,validation_snapshot,operation_key,created_by)
    values(wrong_org,root_task,99,'{}',repeat('11',32),'{}',gen_random_uuid(),a); ok:=false; exception when foreign_key_violation then ok:=true; end;
  insert into b02_runtime_checks values('brief_version_cross_tenant_tuple_rejected',ok);
  begin insert into public.design_creative_brief_version_sources(organization_id,creative_brief_version_id,artifact_version_id)
    values(wrong_org,v_task,artifact_version_id); ok:=false; exception when foreign_key_violation then ok:=true; end;
  insert into b02_runtime_checks values('brief_source_cross_tenant_tuple_rejected',ok);
  begin insert into public.design_workshop_sessions(organization_id,engagement_id,brand_id,engagement_service_id,project_task_id,output_family,output_brief,designer_instructions,context_manifest,context_checksum,created_by)
    values(wrong_org,e,b,s,task_id,'marketing_asset','{}','B02 cross tenant','{}',repeat('12',32),a); ok:=false;
    exception when foreign_key_violation or check_violation then ok:=true; end;
  insert into b02_runtime_checks values('design_session_cross_tenant_tuple_rejected',ok);
  begin insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id)
    values(wrong_org,direction_task,99,'{}',repeat('13',32),repeat('13',8),a,v_task); ok:=false;
    exception when foreign_key_violation or check_violation then ok:=true; end;
  insert into b02_runtime_checks values('direction_version_cross_tenant_tuple_rejected',ok);
  begin insert into public.design_working_direction_preferences(organization_id,engagement_id,session_id,direction_version_id,last_operation_key,created_by,updated_by)
    values(wrong_org,e,session_task,dv_task,gen_random_uuid(),a,a); ok:=false;
    exception when foreign_key_violation or check_violation then ok:=true; end;
  insert into b02_runtime_checks values('working_preference_cross_tenant_tuple_rejected',ok);

  begin insert into public.design_working_direction_preferences(organization_id,engagement_id,session_id,direction_version_id,last_operation_key,created_by,updated_by)
    values(o,e_other,session_task,dv_task,gen_random_uuid(),a,a); ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('preference_mismatched_engagement_rejected',ok);
  begin insert into public.design_working_direction_preferences(organization_id,engagement_id,session_id,direction_version_id,last_operation_key,created_by,updated_by)
    values(o,e,session_task,dv_item,gen_random_uuid(),a,a); ok:=false; exception when check_violation then ok:=true; end;
  insert into b02_runtime_checks values('preference_mismatched_session_direction_rejected',ok);

  begin insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id)
    values(o,direction_task,2,'{}',repeat('7',64),repeat('7',16),a,v_eng); ok:=false; exception when check_violation then ok:=true; end;
  insert into b02_runtime_checks values('direction_engagement_scope_brief_rejected',ok);
  begin insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id)
    values(o,direction_task,2,'{}',repeat('8',64),repeat('8',16),a,v_item); ok:=false; exception when check_violation then ok:=true; end;
  insert into b02_runtime_checks values('direction_work_item_scope_brief_rejected',ok);
  begin insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id)
    values(o,direction_task,2,'{}',repeat('ab',32),repeat('ab',8),a,v_task_other); ok:=false; exception when check_violation then ok:=true; end;
  insert into b02_runtime_checks values('direction_other_task_brief_rejected',ok);
  begin insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id)
    values(o,direction_task,2,'{}',repeat('9',64),repeat('9',16),a,v_service); ok:=false; exception when check_violation then ok:=true; end;
  insert into b02_runtime_checks values('direction_other_service_brief_rejected',ok);
  begin insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id)
    values(o,direction_task,2,'{}',repeat('0',64),repeat('0',16),a,v_other_eng); ok:=false; exception when check_violation then ok:=true; end;
  insert into b02_runtime_checks values('direction_other_engagement_brief_rejected',ok);

  begin update public.design_creative_brief_versions set content=content where id=v_task; ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('brief_version_update_rejected',ok);
  insert into public.design_creative_brief_version_sources(id,organization_id,creative_brief_version_id,artifact_version_id)
    values(source_id,o,v_task,artifact_version_id);
  begin delete from public.design_creative_brief_version_sources where id=source_id; ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('brief_source_delete_rejected',ok);
  begin update public.artifact_versions set content=content where id=artifact_version_id; ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('artifact_version_update_rejected',ok);
  begin update public.design_direction_versions set content=content where id=dv_task; ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('direction_version_update_rejected',ok);
  insert into public.design_direction_selections(organization_id,engagement_id,session_id,direction_version_id,selected_by)
    values(o,e,session_task,dv_task,a);
  begin update public.design_direction_selections set notes=notes where session_id=session_task; ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('final_selection_update_rejected',ok);
  insert into public.design_direction_releases(organization_id,engagement_id,session_id,direction_version_id,released_by)
    values(o,e,session_task,dv_task,a);
  begin delete from public.design_direction_releases where session_id=session_task; ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('final_release_delete_rejected',ok);

  begin update public.artifact_approvals set notes=notes where id=approval_id; ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('artifact_approval_update_rejected',ok);
  begin delete from public.design_workshop_context_versions where session_id=session_task and artifact_type='discovery'; ok:=false; exception when others then ok:=true; end;
  insert into b02_runtime_checks values('approved_context_delete_rejected',ok);
end;
$$;

do $$ begin
  if not coalesce((select bool_and(passed) from b02_runtime_checks), false) then
    raise exception 'B02 runtime verification failed: %', (select jsonb_object_agg(check_name,passed) from b02_runtime_checks);
  end if;
end $$;

select jsonb_build_object('design_b02','PASS','checks',(select jsonb_object_agg(check_name,passed) from b02_runtime_checks));
rollback;
