-- Scope proposals do not start journeys; only exact PM/admin authority activates them.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
begin
 begin
  insert into public.engagement_services(organization_id,engagement_id,service_id,activated_by)
   values('00000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
  raise exception 'Contributor directly selected a service';
 exception when insufficient_privilege then null; end;
 begin
  perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>'90000000-0000-4000-8000-000000000001',
   p_request_id=>'a0000000-0000-4000-8000-000000000001',p_action=>'add',
   p_service_id=>'80000000-0000-4000-8000-000000000002');
  raise exception 'Contributor proposed official scope';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$
declare pid uuid; scope_id uuid; replayed jsonb;
begin
 if (select count(*) from public.project_service_scopes where project_id='90000000-0000-4000-8000-000000000001'
   and engagement_service_id='90000000-0000-4000-8000-000000000003' and status='active')<>1 then
  raise exception 'Installed legacy service was not preserved in project scope';
 end if;
 select (public.create_draft_project('00000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002','Service-only internal','','internal',null,null,
   '10000000-0000-4000-8000-000000000004',null,null,'','')->>'project_id')::uuid into pid;
 select (public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000003',p_action=>'add',
   p_service_id=>'80000000-0000-4000-8000-000000000001',p_scope_statement=>'Identity design',
   p_quantity=>2)->>'scope_id')::uuid into scope_id;
 if (select status from public.project_service_scopes where id=scope_id)<>'proposed'
   or exists(select 1 from public.engagement_services s join public.engagements e on e.id=s.engagement_id
     where e.project_id=pid) then
  raise exception 'Service proposal unexpectedly activated an engagement';
 end if;
 replayed:=public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000003',p_action=>'add',
   p_service_id=>'80000000-0000-4000-8000-000000000001',p_scope_statement=>'Identity design',
   p_quantity=>2);
 if replayed->>'replayed'<>'true' or (replayed->>'scope_id')::uuid is distinct from scope_id then
  raise exception 'Service proposal replay created another scope';
 end if;
 begin
  perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000004',p_action=>'activate',
   p_scope_id=>scope_id,p_expected_revision=>1);
  raise exception 'Service activated before its project';
 exception when serialization_failure then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare pid uuid; sid uuid;
begin
 select id into pid from public.projects where name='Service-only internal';
 select id into sid from public.project_service_scopes where project_id=pid;
 perform public.activate_draft_project('00000000-0000-4000-8000-000000000001',pid,
   'a0000000-0000-4000-8000-000000000005');
 perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000006',p_action=>'activate',
   p_scope_id=>sid,p_expected_revision=>1);
 if (select status from public.project_service_scopes where id=sid)<>'active' then
  raise exception 'Exact bound PM could not activate internal scope';
 end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$
declare pid uuid;
begin
 select (public.create_draft_project('00000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000007','Scoped client','','project',
   '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000004',null,null,'','')->>'project_id')::uuid into pid;
 perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000008',p_action=>'add',
   p_service_id=>'80000000-0000-4000-8000-000000000001',p_scope_statement=>'Only design');
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare pid uuid; sid uuid; token text; new_token text;
begin
 select id into pid from public.projects where name='Scoped client';
 select id into sid from public.project_service_scopes where project_id=pid;
 perform public.activate_draft_project('00000000-0000-4000-8000-000000000001',pid,
   'a0000000-0000-4000-8000-000000000009');
 perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000010',p_action=>'activate',
   p_scope_id=>sid,p_expected_revision=>1);
 if (select count(*) from public.engagement_services s join public.engagements e on e.id=s.engagement_id
   where e.project_id=pid and s.status='active' and s.service_id='80000000-0000-4000-8000-000000000001')<>1
   or exists(select 1 from public.engagement_services s join public.engagements e on e.id=s.engagement_id
     where e.project_id=pid and s.service_id='80000000-0000-4000-8000-000000000002') then
  raise exception 'Exact service activation selected wrong or extra services';
 end if;
 select item->>'impact_token' into token from jsonb_array_elements(
   public.get_project_service_scope('00000000-0000-4000-8000-000000000001',pid)->'scopes') item
   where item->>'id'=sid::text;
 begin
  perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000011',p_action=>'pause',
   p_scope_id=>sid,p_expected_revision=>2,p_impact_token=>token);
  raise exception 'Pause without impact acknowledgement succeeded';
 exception when serialization_failure then null; end;
end $$;
reset role;
insert into public.tasks(organization_id,project_id) values
 ('00000000-0000-4000-8000-000000000001',(select id from public.projects where name='Scoped client'));
insert into public.work_items(organization_id,project_id) values
 ('00000000-0000-4000-8000-000000000001',(select id from public.projects where name='Scoped client'));
insert into public.deliverables(organization_id,project_id) values
 ('00000000-0000-4000-8000-000000000001',(select id from public.projects where name='Scoped client'));
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare pid uuid; sid uuid; token text; stale_token text;
begin
 select id into pid from public.projects where name='Scoped client';
 select id into sid from public.project_service_scopes where project_id=pid;
 stale_token:=md5(sid::text||':2:0:0:0');
 select item->>'impact_token' into token from jsonb_array_elements(
   public.get_project_service_scope('00000000-0000-4000-8000-000000000001',pid)->'scopes') item
   where item->>'id'=sid::text;
 begin
  perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000014',p_action=>'pause',
   p_scope_id=>sid,p_expected_revision=>2,p_impact_token=>stale_token,p_impact_acknowledged=>true);
  raise exception 'Stale impact review was accepted after project work changed';
 exception when serialization_failure then null; end;
 perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000012',p_action=>'pause',
   p_scope_id=>sid,p_expected_revision=>2,p_impact_token=>token,p_impact_acknowledged=>true);
 if (select status from public.project_service_scopes where id=sid)<>'on_hold'
   or (select status from public.engagement_services where id=(select engagement_service_id from public.project_service_scopes where id=sid))<>'on_hold'
   or (select count(*) from public.tasks where project_id=pid)<>1
   or (select count(*) from public.work_items where project_id=pid)<>1
   or (select count(*) from public.deliverables where project_id=pid)<>1 then
  raise exception 'Pause did not preserve linked project work and output records';
 end if;
 perform public.change_project_service_scope(p_organization_id=>'00000000-0000-4000-8000-000000000001',
   p_project_id=>pid,p_request_id=>'a0000000-0000-4000-8000-000000000013',p_action=>'resume',
   p_scope_id=>sid,p_expected_revision=>3);
 if (select status from public.engagement_services where id=(select engagement_service_id from public.project_service_scopes where id=sid))<>'active' then
  raise exception 'Resume did not restore exact existing service row';
 end if;
end $$;
reset role;
select 'N2 service scope authority and impact checks passed' as result;
