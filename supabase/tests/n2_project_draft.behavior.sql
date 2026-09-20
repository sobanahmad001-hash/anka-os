set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
begin
  begin
    insert into public.projects(organization_id,name,engagement_type,status,owner_id)
      values('00000000-0000-4000-8000-000000000001','Forbidden direct','internal','planning','10000000-0000-4000-8000-000000000002');
    raise exception 'Contributor direct insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_draft_project('00000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001','Forbidden RPC','','internal',null,null,null,null,null,'','');
    raise exception 'Contributor create RPC unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.project_manager_bindings(organization_id,user_id,project_id,source,source_details)
      values('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
        '50000000-0000-4000-8000-000000000001','explicit','{}');
    raise exception 'Contributor PM self-enrollment unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$
begin
  begin
    insert into public.projects(organization_id,name,engagement_type,status,owner_id)
      values('00000000-0000-4000-8000-000000000001','Head direct','internal','planning','10000000-0000-4000-8000-000000000003');
    raise exception 'Department head direct insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_draft_project('00000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002','Head RPC','','internal',null,null,null,null,null,'','');
    raise exception 'Department head create RPC unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$
begin
  begin
    insert into public.projects(organization_id,name,engagement_type,status,owner_id)
      values('00000000-0000-4000-8000-000000000001','No draft','internal','active','10000000-0000-4000-8000-000000000001');
    raise exception 'Direct active creation unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select public.create_draft_project('00000000-0000-4000-8000-000000000001',
 '50000000-0000-4000-8000-000000000003','Unassigned internal','','internal',
 null,null,null,null,null,'','');
do $$
declare pid uuid;
begin
 select id into pid from public.projects where name='Unassigned internal';
 if pid is null then raise exception 'Unassigned draft missing'; end if;
 begin
  perform public.activate_draft_project('00000000-0000-4000-8000-000000000001',pid,
    '50000000-0000-4000-8000-000000000004');
  raise exception 'No-PM activation unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
end $$;
select public.create_draft_project('00000000-0000-4000-8000-000000000001',
 '50000000-0000-4000-8000-000000000005','Bound internal','','internal',
 null,null,'10000000-0000-4000-8000-000000000004',null,null,'','');
do $$
declare first_id uuid; replayed boolean;
begin
 select id into first_id from public.projects where name='Bound internal';
 select (public.create_draft_project('00000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000005','Bound internal','','internal',
  null,null,'10000000-0000-4000-8000-000000000004',null,null,'','')->>'replayed')::boolean into replayed;
 if not replayed or (select count(*) from public.projects where name='Bound internal') <> 1 then
  raise exception 'Exact replay created another project';
 end if;
 begin
  perform public.create_draft_project('00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000005','Changed payload','','internal',
   null,null,'10000000-0000-4000-8000-000000000004',null,null,'','');
  raise exception 'Changed-payload replay unexpectedly succeeded';
 exception when unique_violation then null; end;
end $$;
select public.create_draft_project('00000000-0000-4000-8000-000000000001',
 '50000000-0000-4000-8000-000000000006','Client draft','','project',
 '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
 null,null,null,'','');
do $$
declare pid uuid;
begin
 select id into pid from public.projects where name='Client draft';
 if (select count(*) from public.engagements where project_id=pid
  and client_id='30000000-0000-4000-8000-000000000001'
  and brand_id='40000000-0000-4000-8000-000000000001' and status='planning') <> 1 then
  raise exception 'Client draft identity was not preserved';
 end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare pid uuid;
begin
 select id into pid from public.projects where name='Bound internal';
 perform public.activate_draft_project('00000000-0000-4000-8000-000000000001',pid,
   '50000000-0000-4000-8000-000000000007');
 if (select status from public.projects where id=pid) <> 'active' then
  raise exception 'Bound PM activation did not persist';
 end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
declare pid uuid;
begin
 select id into pid from public.projects where name='Bound internal';
 begin
  update public.projects set name='Contributor changed' where id=pid;
  if found then raise exception 'Contributor project update unexpectedly succeeded'; end if;
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',false);
do $$
begin
 begin
  perform public.create_draft_project('00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000008','Cross org','','internal',
   null,null,null,null,null,'','');
  raise exception 'Other-org admin create unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'N2 minimal SQL role and draft tests passed' as result;
