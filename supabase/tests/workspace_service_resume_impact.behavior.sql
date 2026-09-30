-- Rollback-only fixture in the owned B1 native clone; reuse its existing synthetic member.
\set ON_ERROR_STOP on
begin;
insert into public.departments(id,name,organization_id) values('content','Local Content fixture','99999999-9999-4999-8999-999999999901') on conflict(id) do nothing;
update public.projects set status='active', engagement_type='internal'
 where id='99999999-9999-4999-8999-999999999911' and organization_id='99999999-9999-4999-8999-999999999901';
insert into public.service_catalog(id,organization_id,department_id,slug,name)
 values('99999999-9999-4999-8999-999999999931','99999999-9999-4999-8999-999999999901','content','b2_local_resume','Local resume fixture');
insert into public.project_service_scopes(id,organization_id,project_id,service_id,status,source,created_by)
 values('99999999-9999-4999-8999-999999999932','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999931','on_hold','project_setup','99999999-9999-4999-8999-999999999902');
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
do $$
declare token text; result jsonb; replay jsonb;
begin
 select item->>'impact_token' into token from jsonb_array_elements(public.get_project_service_scope('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911')->'scopes') item where item->>'id'='99999999-9999-4999-8999-999999999932';
 begin
  perform public.change_project_service_scope(p_organization_id=>'99999999-9999-4999-8999-999999999901',p_project_id=>'99999999-9999-4999-8999-999999999911',p_request_id=>'99999999-9999-4999-8999-999999999933',p_action=>'resume',p_scope_id=>'99999999-9999-4999-8999-999999999932',p_expected_revision=>1,p_impact_token=>token);
  raise exception 'Missing resume acknowledgement accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.change_project_service_scope(p_organization_id=>'99999999-9999-4999-8999-999999999901',p_project_id=>'99999999-9999-4999-8999-999999999911',p_request_id=>'99999999-9999-4999-8999-999999999933',p_action=>'resume',p_scope_id=>'99999999-9999-4999-8999-999999999932',p_expected_revision=>1,p_impact_token=>'stale',p_impact_acknowledged=>true);
  raise exception 'Stale resume impact accepted';
 exception when serialization_failure then null; end;
 result:=public.change_project_service_scope(p_organization_id=>'99999999-9999-4999-8999-999999999901',p_project_id=>'99999999-9999-4999-8999-999999999911',p_request_id=>'99999999-9999-4999-8999-999999999933',p_action=>'resume',p_scope_id=>'99999999-9999-4999-8999-999999999932',p_expected_revision=>1,p_impact_token=>token,p_impact_acknowledged=>true);
 if result->>'status'<>'active' or (result->>'revision')::int<>2 then raise exception 'Reviewed resume did not activate exact scope'; end if;
 replay:=public.change_project_service_scope(p_organization_id=>'99999999-9999-4999-8999-999999999901',p_project_id=>'99999999-9999-4999-8999-999999999911',p_request_id=>'99999999-9999-4999-8999-999999999933',p_action=>'resume',p_scope_id=>'99999999-9999-4999-8999-999999999932',p_expected_revision=>1,p_impact_token=>token,p_impact_acknowledged=>true);
 if replay->>'replayed'<>'true' or replay->>'scope_id' is distinct from result->>'scope_id' then raise exception 'Resume replay changed scope'; end if;
 begin
  perform public.change_project_service_scope(p_organization_id=>'99999999-9999-4999-8999-999999999901',p_project_id=>'99999999-9999-4999-8999-999999999911',p_request_id=>'99999999-9999-4999-8999-999999999933',p_action=>'resume',p_scope_id=>'99999999-9999-4999-8999-999999999932',p_expected_revision=>1,p_impact_token=>'changed',p_impact_acknowledged=>true);
  raise exception 'Changed replay payload accepted';
 exception when unique_violation then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from private.n2_service_scope_events where scope_id='99999999-9999-4999-8999-999999999932' and action='resume' and impact->>'exact_service_linkage_known'='false')<>1 then raise exception 'Resume impact/history not retained exactly once'; end if;
 if has_function_privilege('anon','public.change_project_service_scope(uuid,uuid,uuid,text,uuid,uuid,text,text,integer,uuid,date,date,bigint,text,boolean)','execute') then raise exception 'Anonymous service command access'; end if;
end $$;
rollback;
select 'B2 resume acknowledgement, stale impact, replay, history and ACL passed' as result;
