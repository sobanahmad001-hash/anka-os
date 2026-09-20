-- Run after n2_project_draft.behavior.sql in the same disposable database.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
set role authenticated;
do $$
begin
 if has_function_privilege('authenticated',
   'public.create_internal_project_setup(uuid,uuid,text,text,uuid,date,date,text,text,jsonb)','EXECUTE') then
  raise exception 'Legacy internal project setup remains executable';
 end if;
 if has_function_privilege('authenticated','public.get_internal_project_setup_options(uuid)','EXECUTE') then
  raise exception 'Legacy internal setup options remain executable';
 end if;
 if has_function_privilege('authenticated',
   'public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)','EXECUTE')
   or has_function_privilege('authenticated',
   'public.compose_engagement_from_pipeline_template(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)','EXECUTE') then
  raise exception 'Legacy engagement composition remains executable';
 end if;
end $$;
do $$
declare pid uuid;
begin
 insert into public.projects(organization_id,name,engagement_type,status,owner_id)
  values('00000000-0000-4000-8000-000000000001','Direct admin draft','internal','planning',
    '10000000-0000-4000-8000-000000000001') returning id into pid;
 begin
  update public.projects set status='active' where id=pid;
  raise exception 'Direct no-PM activation unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
end $$;
do $$
begin
 begin
  perform public.create_draft_project('00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000009','Wrong brand','','project',
   '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',
   null,null,null,'','');
  raise exception 'Wrong client brand unexpectedly accepted';
 exception when insufficient_privilege then null; end;
end $$;
select public.create_draft_project('00000000-0000-4000-8000-000000000001',
 '50000000-0000-4000-8000-000000000010','Bound client','','project',
 '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000004',null,null,'','');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare pid uuid;
begin
 select id into pid from public.projects where name='Bound client';
 perform public.activate_draft_project('00000000-0000-4000-8000-000000000001',pid,
   '50000000-0000-4000-8000-000000000011');
 if (select status from public.projects where id=pid) <> 'active'
  or (select status from public.engagements where project_id=pid) <> 'active' then
  raise exception 'Bound client activation did not atomically update project and engagement';
 end if;
 update public.projects set description='PM manages exact project' where id=pid;
 if not found then raise exception 'Bound PM could not update exact project'; end if;
 begin
  update public.projects set owner_id='10000000-0000-4000-8000-000000000001' where id=pid;
  raise exception 'PM changed project owner without admin';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.project_manager_bindings set status='revoked'
 where user_id='10000000-0000-4000-8000-000000000004' and project_id=(select id from public.projects where name='Bound client');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare pid uuid;
begin
 select id into pid from public.projects where name='Bound client';
 begin
  perform public.activate_draft_project('00000000-0000-4000-8000-000000000001',pid,
   '50000000-0000-4000-8000-000000000011');
  raise exception 'Revoked PM activation replay unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'N2 extended SQL authority tests passed' as result;
