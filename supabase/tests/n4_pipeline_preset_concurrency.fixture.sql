-- Synthetic local two-session fixture. Use only in a disposable localhost database.
begin;
insert into public.organizations(id,name,slug,status) values
 ('b4000000-0000-4000-8000-000000000001','N4 concurrency local','n4_concurrency_local','active');
insert into public.departments(id,name,organization_id) values
 ('design','Design','b4000000-0000-4000-8000-000000000001'),
 ('marketing','Marketing','b4000000-0000-4000-8000-000000000001'),
 ('development','Development','b4000000-0000-4000-8000-000000000001');
insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values
 ('b4000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000001','design','n4_concurrency_design','N4 concurrency design',true),
 ('b4000000-0000-4000-8000-000000000012','b4000000-0000-4000-8000-000000000001','marketing','n4_concurrency_marketing','N4 concurrency marketing',true);
insert into auth.users(id) values
 ('b4000000-0000-4000-8000-000000000002'),
 ('b4000000-0000-4000-8000-000000000003'),
 ('b4000000-0000-4000-8000-000000000004');
insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
 ('b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002','team','operations_admin',null,'active'),
 ('b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000003','team','department_manager','design','active'),
 ('b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000004','team','department_manager','marketing','active');

do $$
declare first_version jsonb; second_version jsonb;
begin
 perform set_config('request.jwt.claims','{"sub":"b4000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 set local role authenticated;
 select public.create_pipeline_template_version(
  'b4000000-0000-4000-8000-000000000001',null,'n4_concurrency',
  'Concurrent version one','',array['b4000000-0000-4000-8000-000000000011'::uuid,'b4000000-0000-4000-8000-000000000012'::uuid],null,''
 ) into first_version;
 select public.create_pipeline_template_version(
  'b4000000-0000-4000-8000-000000000001',(first_version->>'pipeline_template_id')::uuid,'n4_concurrency',
  'Concurrent version two','',array['b4000000-0000-4000-8000-000000000011'::uuid,'b4000000-0000-4000-8000-000000000012'::uuid],(first_version->>'pipeline_template_version_id')::uuid,''
 ) into second_version;
 reset role;
 perform set_config('request.jwt.claims','{"sub":"b4000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 set local role authenticated;
 perform public.approve_pipeline_template_version_department((first_version->>'pipeline_template_version_id')::uuid,'design');
 perform public.approve_pipeline_template_version_department((second_version->>'pipeline_template_version_id')::uuid,'design');
 reset role;
 perform set_config('request.jwt.claims','{"sub":"b4000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 set local role authenticated;
 perform public.approve_pipeline_template_version_department((first_version->>'pipeline_template_version_id')::uuid,'marketing');
 perform public.approve_pipeline_template_version_department((second_version->>'pipeline_template_version_id')::uuid,'marketing');
 reset role;
end;
$$;
commit;
