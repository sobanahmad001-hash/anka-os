set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
declare root_id uuid:='a0000000-0000-4000-8000-000000000001'; reply_id uuid:='a0000000-0000-4000-8000-000000000002'; result jsonb;
begin
  result:=public.post_project_discussion_message('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',root_id,'  Project update  ');
  if result->>'replayed'<>'false' then raise exception 'Initial post was not new'; end if;
  result:=public.post_project_discussion_message('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',root_id,'Project update');
  if result->>'replayed'<>'true' or (select count(*) from public.activity_events where comment_id=root_id)<>1 then
    raise exception 'Replay duplicated project discussion or activity'; end if;
  begin
    perform public.post_project_discussion_message('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001',root_id,'Changed text');
    raise exception 'Changed replay succeeded';
  exception when unique_violation then null; end;
  perform public.post_project_discussion_message('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',reply_id,'Reply',root_id);
  if jsonb_array_length(public.get_project_discussion('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001')->'messages')<>2 then
    raise exception 'Project discussion did not include both thread messages'; end if;
  if jsonb_array_length(public.get_project_discussion('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    (select created_at from public.comments where id=reply_id),reply_id)->'messages')<>1 then
    raise exception 'Discussion cursor did not return earlier message'; end if;
  begin
    perform public.post_project_discussion_message('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000003',
      'Wrong tenant reply','a0000000-0000-4000-8000-000000000099');
    raise exception 'Wrong parent accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.comments(organization_id,project_id,user_id,entity_type,entity_id,content,visibility)
    values('00000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002','project','90000000-0000-4000-8000-000000000001',
      'Direct bypass','internal_only');
    raise exception 'Direct project discussion insert succeeded';
  exception when insufficient_privilege then null; end;
  update public.comments set content='Edited' where id=root_id;
  if (select content from public.comments where id=root_id)<>'Project update' then
    raise exception 'Existing project message was edited'; end if;
  delete from public.comments where id=root_id;
  if not exists(select 1 from public.comments where id=root_id) then raise exception 'Project message was deleted'; end if;
  insert into public.comments(organization_id,project_id,user_id,entity_type,entity_id,content,visibility)
    values('00000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002','task','90000000-0000-4000-8000-000000000001',
      'Task-specific legacy discussion','internal_only');
  insert into public.comments(organization_id,project_id,user_id,entity_type,entity_id,content,visibility)
    values('00000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002','project','90000000-0000-4000-8000-000000000001',
      'Existing client-shared path','client_shared');
  update public.comments set content='Client-shared path remains editable'
    where entity_type='project' and visibility='client_shared' and content='Existing client-shared path';
  if not exists(select 1 from public.comments where entity_type='project' and visibility='client_shared'
    and content='Client-shared path remains editable') then
    raise exception 'Existing client-shared comment path was blocked'; end if;
  if jsonb_array_length(public.get_project_discussion('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001')->'messages')<>2 then
    raise exception 'Task discussion leaked into project conversation'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',false);
do $$ begin
  begin
    perform public.get_project_discussion('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001');
    raise exception 'Other organization read project discussion';
  exception when insufficient_privilege then null; end;
  begin
    perform public.post_project_discussion_message('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000004','Cross-org');
    raise exception 'Other organization posted project discussion';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'N3 project discussion authority and history checks passed' as result;
