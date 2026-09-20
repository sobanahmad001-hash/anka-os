set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
declare org uuid:='00000000-0000-4000-8000-000000000001';
 project uuid:='90000000-0000-4000-8000-000000000001';
 request uuid:='a0000000-0000-4000-8000-000000000020';
 links jsonb:='[{"kind":"member","id":"10000000-0000-4000-8000-000000000003"},
 {"kind":"project_task","id":"b0000000-0000-4000-8000-000000000001"},
 {"kind":"deliverable_version","id":"c1000000-0000-4000-8000-000000000001"},
 {"kind":"file","id":"f0000000-0000-4000-8000-000000000001"}]'::jsonb;
 result jsonb; visible jsonb;
begin
 result:=public.get_project_discussion_reference_options(org,project);
 if jsonb_array_length(result->'options')<>7 then raise exception 'Scoped options missing'; end if;
 result:=public.post_project_discussion_message_with_links(org,project,request,'See references',null,links);
 if result->>'replayed'<>'false' then raise exception 'New linked message failed'; end if;
 result:=public.post_project_discussion_message_with_links(org,project,request,'See references',null,links);
 if result->>'replayed'<>'true' or (select count(*) from public.activity_events where comment_id=request)<>1 then
   raise exception 'Linked message replay duplicated activity'; end if;
 begin
   perform public.post_project_discussion_message_with_links(org,project,request,'See references',null,'[]');
   raise exception 'Changed link replay accepted';
 exception when unique_violation then null; end;
 visible:=public.get_project_discussion(org,project);
 if (select count(*) from jsonb_array_elements(visible->'messages') m
   cross join lateral jsonb_array_elements(m->'links') l
   where m->>'id'=request::text and l->>'available'='true')<>4 then
   raise exception 'Valid linked targets not resolved'; end if;
 begin
   perform public.post_project_discussion_message_with_links(org,project,
     'a0000000-0000-4000-8000-000000000021','Foreign file',null,
     '[{"kind":"file","id":"f0000000-0000-4000-8000-000000000002"}]');
   raise exception 'Foreign file accepted';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.post_project_discussion_message_with_links(org,project,
     'a0000000-0000-4000-8000-000000000022','Foreign member',null,
     '[{"kind":"member","id":"10000000-0000-4000-8000-000000000005"}]');
   raise exception 'Foreign member accepted';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
update public.files set archived_at=now() where id='f0000000-0000-4000-8000-000000000001';
update public.tasks set archived_at=now() where id='b0000000-0000-4000-8000-000000000001';
update public.deliverable_versions set withdrawn_at=now()
 where id='c1000000-0000-4000-8000-000000000001';
update public.organization_memberships set status='inactive'
 where organization_id='00000000-0000-4000-8000-000000000001'
 and user_id='10000000-0000-4000-8000-000000000003';
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
declare messages jsonb;
begin
 messages:=public.get_project_discussion('00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001')->'messages';
 if (select count(*) from jsonb_array_elements(messages) m cross join lateral jsonb_array_elements(m->'links') l
   where m->>'id'='a0000000-0000-4000-8000-000000000020'
    and l->>'available'='false' and l->>'label' is null)<>4 then
   raise exception 'Revoked or archived reference label exposed'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',false);
do $$ begin
 begin
  perform public.get_project_discussion_reference_options('00000000-0000-4000-8000-000000000001',
   '90000000-0000-4000-8000-000000000001');
  raise exception 'Foreign member enumerated project options';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.get_project_discussion_reference_options(uuid,uuid)','EXECUTE')
   or has_function_privilege('anon','public.post_project_discussion_message_with_links(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
   or has_function_privilege('authenticated','private.n3_discussion_link_label(uuid,uuid,text,uuid)','EXECUTE') then
   raise exception 'Discussion reference function grants are too broad'; end if;
end $$;
select 'N3 scoped references and revocation checks passed' as result;
