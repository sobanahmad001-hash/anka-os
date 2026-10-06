begin;

create function pg_temp.ok(b boolean,label text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.reject(q text,code text,label text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then raise notice 'PASS %',label;return;end if;raise exception 'FAIL % expected % got % %',label,code,sqlstate,sqlerrm;end;raise exception 'FAIL % accepted',label;end $$;
create function pg_temp.snapshot() returns jsonb language sql as $$select public.get_workshop_execution_settings('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999902')$$;
create function pg_temp.save(q uuid,t text,s jsonb) returns jsonb language sql as $$select public.save_workshop_execution_settings('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999902',q,t,s)$$;
select pg_temp.ok((select bool_and(not (value->>'enabled')::boolean) from jsonb_array_elements(pg_temp.snapshot()->'workshops')),'all initially off');
select pg_temp.ok(not has_function_privilege('authenticated','public.save_workshop_execution_settings(uuid,uuid,uuid,uuid,uuid,text,jsonb)','execute'),'no actor spoof through authenticated RPC');
select pg_temp.ok(not has_table_privilege('authenticated','private.workshop_execution_settings','select,insert,update'),'authenticated table closed');
select pg_temp.ok(not has_table_privilege('service_role','private.workshop_execution_receipts','update,delete'),'audit immutable to service');
select pg_temp.ok((select count(*)=0 from pg_policies where schemaname='private' and tablename like 'workshop_execution_%'),'zero policies');
select pg_temp.reject($q$select pg_temp.save(gen_random_uuid(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','[]')$q$,'22023','empty selection rejected');
select pg_temp.reject($q$select pg_temp.save(gen_random_uuid(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','[{"department_id":"content","enabled":"true"}]')$q$,'22023','string boolean rejected');
select pg_temp.reject($q$select pg_temp.save(gen_random_uuid(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','[{"department_id":"content","enabled":true},{"department_id":"content","enabled":false}]')$q$,'22023','duplicate rejected');
savepoint leader;
update public.organization_memberships set role='contributor' where organization_id='99999999-9999-4999-8999-999999999901';
select pg_temp.reject('select pg_temp.snapshot()','42501','nonleader denied');
rollback to leader;
insert into public.integration_connection_engagements(connection_id,organization_id,engagement_id,department_id,created_by)
select '99999999-9999-4999-8999-999999996910','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999975',d,'99999999-9999-4999-8999-999999999902' from unnest(array['content','design','marketing']) d on conflict do nothing;
do $$declare t text; q uuid:=gen_random_uuid(); r jsonb; selection jsonb:='[{"department_id":"content","enabled":true}]';begin
 t:=pg_temp.snapshot()->>'token';r:=pg_temp.save(q,t,selection);
 perform pg_temp.ok(r->>'persisted'='true','save confirmed');
 perform pg_temp.ok(pg_temp.save(q,t,selection)=r,'exact replay');
 perform pg_temp.ok(public.recover_workshop_execution_settings('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999902',q)=r,'original read recovery');
 perform pg_temp.ok((select count(*)=1 from private.workshop_execution_receipts where request_id=q),'single audit receipt');
 perform pg_temp.ok((select count(*)=1 from private.workshop_execution_settings where enabled),'only reviewed department enabled');
 perform pg_temp.reject(format('select pg_temp.save(gen_random_uuid(),%L,%L)',t,selection),'40001','stale review rejected');
 perform pg_temp.reject(format('select pg_temp.save(%L,%L,%L)',q,t,'[{"department_id":"design","enabled":true}]'),'40001','UUID payload reuse rejected');
 perform pg_temp.save(gen_random_uuid(),pg_temp.snapshot()->>'token','[{"department_id":"content","enabled":false}]');
 perform pg_temp.ok((select count(*)=0 from private.workshop_execution_settings where enabled),'opt-out persisted');
end $$;
set local role service_role;
select pg_temp.ok(pg_temp.snapshot()->>'schema_version'='1','service read permitted');
reset role;

rollback;
