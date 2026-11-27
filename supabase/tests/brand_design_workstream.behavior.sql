set role authenticated;
select set_config('test.actor',md5('other')::uuid::text,false),set_config('test.member','yes',false);
do $$ begin
  begin
    perform ensure_brand_design_workstream(md5('project')::uuid,md5('service')::uuid);
    raise exception 'non-owner accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('test.actor',md5('owner')::uuid::text,false);
  perform set_config('test.member','no',false);
  begin
    perform ensure_brand_design_workstream(md5('project')::uuid,md5('service')::uuid);
    raise exception 'inactive member accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('test.member','yes',false);
  begin
    perform ensure_brand_design_workstream(md5('project')::uuid,md5('other-service')::uuid);
    raise exception 'unbound service accepted';
  exception when insufficient_privilege then null; end;
  if exists(select from workstreams) then raise exception 'denied action wrote a row'; end if;
  perform ensure_brand_design_workstream(md5('project')::uuid,md5('service')::uuid);
  perform ensure_brand_design_workstream(md5('project')::uuid,md5('service')::uuid);
  if (select count(*) from workstreams) <> 1 then raise exception 'retry duplicated workstream'; end if;
  if not exists (select from workstreams where department_id='design' and status='active' and not client_visible
    and owner_id=auth.uid() and organization_id=md5('org')::uuid and project_id=md5('project')::uuid)
    then raise exception 'incorrect workstream'; end if;
end $$;
reset role;
