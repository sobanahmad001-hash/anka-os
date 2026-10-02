-- B6 bounded cadence entrypoint; no scheduler enabled, no resources or defaults seeded.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
create function public.schedule_project_reporting_refresh(p_organization_id uuid,p_policy_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.reporting_refresh_policies%rowtype;day date;items jsonb:='[]';v jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted reporting scheduler only' using errcode='42501';end if;
 if p_organization_id is null or p_policy_ids is null or cardinality(p_policy_ids) not between 1 and 25 or array_position(p_policy_ids,null) is not null or (select count(distinct id) from unnest(p_policy_ids) id)<>cardinality(p_policy_ids) then raise exception 'One to25 exact configured policy identities required' using errcode='22023';end if;
 if (select count(*) from private.reporting_refresh_policies where organization_id=p_organization_id and id=any(p_policy_ids))<>cardinality(p_policy_ids) then raise exception 'Exact original organization policies required' using errcode='42501';end if;
 -- Consistent project/binding order keeps concurrent bounded scheduler batches ordered.
 for p in select * from private.reporting_refresh_policies where organization_id=p_organization_id and id=any(p_policy_ids) order by project_id,binding_id loop
 begin
 day:=timezone(p.reporting_time_zone,clock_timestamp())::date;
 v:=private.enqueue_reporting_refresh(p.organization_id,p.project_id,p.binding_id,p.id,day-(p.limits->>'max_period_days')::integer+1,day,gen_random_uuid(),p.created_by,'scheduled');
 items:=items||jsonb_build_array(jsonb_build_object('policy_id',p.id,'job',v));
 exception when sqlstate '42501' or sqlstate '22023' or sqlstate '40001' or sqlstate '55000' then
 items:=items||jsonb_build_array(jsonb_build_object('policy_id',p.id,'state','blocked','reason_code',sqlstate));
 end;end loop;
 return jsonb_build_object('items',items,'provider_request_made',false,'dispatch_authorized',false);
end $$;
create function public.list_due_project_reporting_refreshes(p_organization_id uuid,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$declare items jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted reporting worker only' using errcode='42501';end if;
 if p_organization_id is null or p_limit is null or p_limit not between 1 and 25 then raise exception 'Explicit organization and bounded worker page required' using errcode='22023';end if;
 select coalesce(jsonb_agg(private.reporting_refresh_job_receipt(id) order by next_attempt_at,id),'[]') into items from(
 select id,next_attempt_at from private.reporting_refresh_jobs where organization_id=p_organization_id and ((state in ('queued','retry') and next_attempt_at<=clock_timestamp()) or (state='running' and lease_expires_at<=clock_timestamp())) order by next_attempt_at,id limit p_limit) jobs;
 return jsonb_build_object('items',items,'dispatch_authorized',false);
end $$;
revoke all on function public.schedule_project_reporting_refresh(uuid,uuid[]),public.list_due_project_reporting_refreshes(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.schedule_project_reporting_refresh(uuid,uuid[]),public.list_due_project_reporting_refreshes(uuid,integer) to service_role;
commit;
