-- A request is not an official project; only the organization admin converts it.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
declare submitted jsonb; repeated jsonb;
begin
 submitted:=public.submit_project_request('00000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','Contributor request','Brief','internal',null,null,null,null);
 repeated:=public.submit_project_request('00000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','Contributor request','Brief','internal',null,null,null,null);
 if submitted->>'status'<>'pending' or repeated->>'replayed'<>'true' then
  raise exception 'Project request did not preserve exact replay';
 end if;
 if exists(select 1 from public.projects where name='Contributor request') then
  raise exception 'Contributor request created an official project';
 end if;
 begin
  perform public.submit_project_request('00000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001','Changed request','Brief','internal',null,null,null,null);
  raise exception 'Changed request replay unexpectedly succeeded';
 exception when unique_violation then null; end;
 begin
  perform public.convert_project_request('00000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002',null);
  raise exception 'Contributor converted a request';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$
begin
 if jsonb_array_length(public.get_project_requests('00000000-0000-4000-8000-000000000001')->'requests')<>0 then
  raise exception 'Another non-admin can see the contributor request';
 end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',false);
do $$
begin
 begin
  perform public.convert_project_request('00000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002',null);
  raise exception 'Other-organization admin converted the request';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$
declare converted jsonb; repeated jsonb; pid uuid;
begin
 if jsonb_array_length(public.get_project_requests('00000000-0000-4000-8000-000000000001')->'requests')<1 then
  raise exception 'Owner cannot see pending requests';
 end if;
 converted:=public.convert_project_request('00000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002',null);
 pid:=(converted->>'project_id')::uuid;
 repeated:=public.convert_project_request('00000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002',null);
 if converted->>'status'<>'converted' or repeated->>'replayed'<>'true'
  or (repeated->>'project_id')::uuid is distinct from pid
  or (select status from public.projects where id=pid)<>'planning'
  or (select count(*) from public.projects where name='Contributor request')<>1 then
  raise exception 'Admin conversion did not produce one planning project';
 end if;
 begin
  perform public.convert_project_request('00000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003',null);
  raise exception 'Changed conversion replay unexpectedly succeeded';
 exception when unique_violation then null; end;
 begin
  perform public.activate_draft_project('00000000-0000-4000-8000-000000000001',pid,
   '60000000-0000-4000-8000-000000000004');
  raise exception 'Converted project activated without assigned PM';
 exception when insufficient_privilege then null; end;
 if (public.get_draft_project_manager_state('00000000-0000-4000-8000-000000000001',pid)->>'manager_id') is not null then
  raise exception 'Converted project unexpectedly acquired a manager';
 end if;
 perform public.assign_draft_project_manager('00000000-0000-4000-8000-000000000001',pid,
  '10000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000006');
 if (public.get_draft_project_manager_state('00000000-0000-4000-8000-000000000001',pid)->>'manager_id')
   is distinct from '10000000-0000-4000-8000-000000000004' then
  raise exception 'Assigned manager not visible on exact planning draft';
 end if;
 begin
  update public.projects set status='active' where id=pid;
  raise exception 'Direct status update bypassed governed activation';
 exception when insufficient_privilege then null; end;
 perform public.activate_draft_project('00000000-0000-4000-8000-000000000001',pid,
  '60000000-0000-4000-8000-000000000007');
 if (select status from public.engagements where project_id=pid)<>'active' then
  raise exception 'Assigned PM did not unlock canonical activation';
 end if;
 begin
  perform public.submit_project_request('00000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000005','Retired client brand','Brief','project',
   '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',null,null);
  raise exception 'Retired brand project request unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'N2 project request authority tests passed' as result;
