-- Rollback-only synthetic local behavior. Never production data or signed-in acceptance.
begin;
set local statement_timeout = '120s';
do $$
declare
  org uuid := 'a4000000-0000-4000-8000-000000000001';
  owner_id uuid := 'a4000000-0000-4000-8000-000000000002';
  design_head uuid := 'a4000000-0000-4000-8000-000000000003';
  marketing_head uuid := 'a4000000-0000-4000-8000-000000000004';
  replacement_head uuid := 'a4000000-0000-4000-8000-000000000005';
  project_manager uuid := 'a4000000-0000-4000-8000-000000000006';
  design_service uuid := 'a4000000-0000-4000-8000-000000000011';
  marketing_service uuid := 'a4000000-0000-4000-8000-000000000012';
  created jsonb;
  result jsonb;
  version_one uuid;
  version_two uuid;
  single_version uuid;
  visible_approvals integer;
begin
  if not exists (select 1 from pg_class where oid='public.pipeline_template_department_approvals'::regclass and relrowsecurity) then
    raise exception 'Approval RLS disabled';
  end if;
  if has_table_privilege('authenticated','public.pipeline_template_department_approvals','INSERT')
    or has_table_privilege('authenticated','public.pipeline_template_department_approvals','UPDATE')
    or has_table_privilege('authenticated','public.pipeline_template_department_approvals','DELETE') then
    raise exception 'Browser mutation grant is open';
  end if;
  insert into public.organizations(id,name,slug,status) values(org,'N4 local org','n4_local_org','active');
  insert into public.departments(id,name,organization_id) values
    ('design','Design',org),('marketing','Marketing',org);
  insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values
    (design_service,org,'design','n4_design','N4 Design',true),
    (marketing_service,org,'marketing','n4_marketing','N4 Marketing',true);
  insert into auth.users(id) values(owner_id),(design_head),(marketing_head),(replacement_head),(project_manager);
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (org,owner_id,'team','operations_admin',null,'active'),
    (org,design_head,'team','department_manager','design','active'),
    (org,marketing_head,'team','department_manager','marketing','active'),
    (org,replacement_head,'team','department_manager','marketing','active'),
    (org,project_manager,'team','project_owner','design','active');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  select public.create_pipeline_template_version(org,null,'n4_cross','Cross', '',array[design_service,marketing_service],null,'') into created;
  version_one := (created->>'pipeline_template_version_id')::uuid;
  begin
    perform public.publish_pipeline_template_version(version_one);
    raise exception 'Cross-department publish without approvals succeeded';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',project_manager,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.approve_pipeline_template_version_department(version_one,'design');
    raise exception 'Project manager approved org preset';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.publish_pipeline_template_version(version_one);
    raise exception 'Project manager published org preset';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',design_head,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.approve_pipeline_template_version_department(version_one,'marketing');
    raise exception 'Head approved wrong department';
  exception when insufficient_privilege then null;
  end;
  select public.approve_pipeline_template_version_department(version_one,'design') into result;
  if (result->>'idempotent_replay')::boolean then raise exception 'First approval falsely replayed'; end if;
  select public.approve_pipeline_template_version_department(version_one,'design') into result;
  if not (result->>'idempotent_replay')::boolean then raise exception 'Approval replay created duplicate'; end if;
  select count(*) into visible_approvals from public.pipeline_template_department_approvals
    where pipeline_template_version_id=version_one;
  if visible_approvals <> 1 then raise exception 'Active head cannot read exact approval history'; end if;
  reset role;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',project_manager,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into visible_approvals from public.pipeline_template_department_approvals
    where pipeline_template_version_id=version_one;
  if visible_approvals <> 0 then raise exception 'Project manager read head-only approval history'; end if;
  reset role;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.publish_pipeline_template_version(version_one);
    raise exception 'One of two department approvals sufficed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',marketing_head,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.approve_pipeline_template_version_department(version_one,'marketing');
  reset role;
  update public.organization_memberships set status='revoked'
    where organization_id=org and user_id=marketing_head;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.publish_pipeline_template_version(version_one);
    raise exception 'Revoked head approval still counted';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',replacement_head,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.approve_pipeline_template_version_department(version_one,'marketing');
  reset role;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  select public.publish_pipeline_template_version(version_one) into result;
  if (result->>'idempotent_replay')::boolean then raise exception 'First publication falsely replayed'; end if;
  select public.publish_pipeline_template_version(version_one) into result;
  if not (result->>'idempotent_replay')::boolean then raise exception 'Publication replay failed'; end if;
  select public.create_pipeline_template_version(org,(created->>'pipeline_template_id')::uuid,'n4_cross','Second', '',array[design_service,marketing_service],version_one,'') into created;
  version_two := (created->>'pipeline_template_version_id')::uuid;
  begin
    perform public.publish_pipeline_template_version(version_two);
    raise exception 'Prior-version approvals authorized new version';
  exception when insufficient_privilege then null;
  end;
  select public.create_pipeline_template_version(org,null,'n4_single','Single', '',array[design_service],null,'') into created;
  single_version := (created->>'pipeline_template_version_id')::uuid;
  perform public.publish_pipeline_template_version(single_version);
  reset role;

  if (select count(*) from public.pipeline_template_department_approvals where pipeline_template_version_id=version_one) <> 3 then
    raise exception 'Approval history count mismatch';
  end if;
  begin
    update public.pipeline_template_department_approvals set approved_by=owner_id where pipeline_template_version_id=version_one;
    raise exception 'Approval history was mutable';
  exception when object_not_in_prerequisite_state then null;
  end;
  raise notice 'N4 approval behavior passed: exact version, each department, revoked head, PM denial, replay, single department, immutable history';
end;
$$;
rollback;
