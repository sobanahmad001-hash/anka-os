-- The owned native clone and existing synthetic actor only; all fixture writes roll back.
\set ON_ERROR_STOP on
begin;
insert into public.departments(id,name,organization_id) values('content','Local Content fixture','99999999-9999-4999-8999-999999999901') on conflict(id) do nothing;
insert into public.service_catalog(id,organization_id,department_id,slug,name) values('99999999-9999-4999-8999-999999999941','99999999-9999-4999-8999-999999999901','content','b2_details','Local service details');
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
do $$
declare details jsonb:='{"unit":"article","recurrence":"4 per month","quantity":4,"scope_statement":"Editorial plan"}'; result jsonb; again jsonb; snap jsonb;
begin
 begin
  perform public.propose_workspace_service_scope('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999942','99999999-9999-4999-8999-999999999941',details-'unit');
  raise exception 'Missing unit accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.propose_workspace_service_scope('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999942','99999999-9999-4999-8999-999999999941',details||'{"actor_id":"forged"}');
  raise exception 'Unexpected authority input accepted';
 exception when invalid_parameter_value then null; end;
 result:=public.propose_workspace_service_scope('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999942','99999999-9999-4999-8999-999999999941',details);
 if result->>'status'<>'proposed' or result->>'unit'<>'article' or result->>'recurrence'<>'4 per month' then raise exception 'Explicit proposal details not retained'; end if;
 again:=public.propose_workspace_service_scope('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999942','99999999-9999-4999-8999-999999999941',details);
 if again->>'replayed'<>'true' or again->>'scope_id' is distinct from result->>'scope_id' then raise exception 'Details replay duplicated proposal'; end if;
 begin
  perform public.propose_workspace_service_scope('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999942','99999999-9999-4999-8999-999999999941',details||'{"unit":"page"}');
  raise exception 'Changed unit replay accepted';
 exception when unique_violation then null; end;
 snap:=public.get_project_service_scope('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911');
 if not exists(select 1 from jsonb_array_elements(snap->'scopes') s where s->>'id'=result->>'scope_id' and s->>'unit'='article' and s->>'recurrence'='4 per month') then raise exception 'Scoped snapshot omits details'; end if;
 begin
  perform public.propose_workspace_service_scope('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999943','99999999-9999-4999-8999-999999999941',details||'{"owner_id":"99999999-9999-4999-8999-999999999999"}');
  raise exception 'Foreign owner accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.project_service_scopes where service_id='99999999-9999-4999-8999-999999999941')<>1 then raise exception 'Duplicate or orphan proposal'; end if;
 if (select count(*) from private.workspace_service_proposal_details where request_id='99999999-9999-4999-8999-999999999942')<>1 then raise exception 'Details receipt missing'; end if;
 if exists(select 1 from private.n2_service_scope_commands where request_id='99999999-9999-4999-8999-999999999943') then raise exception 'Rejected owner left a receipt'; end if;
 if has_table_privilege('authenticated','private.workspace_service_proposal_details','select') or has_function_privilege('anon','public.propose_workspace_service_scope(uuid,uuid,uuid,uuid,jsonb)','execute') then raise exception 'Proposal details permission leak'; end if;
 begin
  update private.workspace_service_proposal_details set result='{}' where request_id='99999999-9999-4999-8999-999999999942';
  raise exception 'Receipt mutable';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'B2 unit/recurrence, scope snapshot, replay, rejected input rollback and ACL passed' as result;
