set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
declare handoff public.requests%rowtype;
begin
  handoff:=public.create_project_handoff_request('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',
    'Implement approved design','Development output','Matches design version','medium',null);
  if handoff.request_type<>'internal_handoff' or handoff.request_origin<>'team'
    or handoff.visibility<>'internal_only' or handoff.source_project_comment_id is null
    or handoff.requested_by<>'10000000-0000-4000-8000-000000000002' then
    raise exception 'Canonical handoff provenance missing'; end if;
  if (public.create_project_handoff_request('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',
    'Implement approved design','Development output','Matches design version','medium',null)).id<>handoff.id then
    raise exception 'Exact handoff replay failed'; end if;
  begin
    perform public.create_project_handoff_request('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',
      'Changed handoff','Development output','Matches design version','medium',null);
    raise exception 'Changed handoff replay succeeded';
  exception when unique_violation then null; end;
  begin
    perform public.create_project_handoff_request('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000003',
      'Foreign receiving workstream','Output','Acceptance','medium',null);
    raise exception 'Foreign receiving workstream accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.requests set source_project_comment_id=null where id=handoff.id;
    raise exception 'Handoff source could be erased';
  exception when insufficient_privilege then null; end;
  update public.requests set status='triaged' where id=handoff.id;
  if (select status from public.requests where id=handoff.id)<>'triaged' then
    raise exception 'Canonical request lifecycle was blocked'; end if;
  begin
    update public.requests set requested_output='Rewritten after handoff' where id=handoff.id;
    raise exception 'Linked handoff contract was rewritten';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.requests(id,organization_id,project_id,receiving_workstream_id,request_type,request_origin,title,requested_output,
      visibility,requested_by,source_project_comment_id)
    values('e0000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',
      'internal_handoff','team','Forged actor','Output',
      'internal_only','10000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001');
    raise exception 'Direct actor forgery with source succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.requests(id,organization_id,project_id,receiving_workstream_id,request_type,request_origin,title,requested_output,
      visibility,requested_by,source_project_comment_id)
    values('e0000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000003',
      'internal_handoff','team','Foreign receiver','Output',
      'internal_only','10000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001');
    raise exception 'Direct foreign receiver with source succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',false);
do $$ begin
  begin
    perform public.create_project_handoff_request('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000004',
      'a0000000-0000-4000-8000-000000000001',
      null,'d0000000-0000-4000-8000-000000000002','Cross-org','Output','','medium',null);
    raise exception 'Other organization created handoff';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'N3 canonical handoff scope, replay, and source provenance checks passed' as result;
