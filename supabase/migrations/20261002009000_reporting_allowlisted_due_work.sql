-- Filter the exact activated policy allowlist before bounding due work.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
create function public.list_due_project_reporting_refreshes_for_policies(p_organization_id uuid,p_policy_ids uuid[],p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$declare items jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted reporting worker only' using errcode='42501';end if;
 if p_organization_id is null or p_policy_ids is null or cardinality(p_policy_ids) not between 1 and 25 or array_position(p_policy_ids,null) is not null or (select count(distinct id) from unnest(p_policy_ids) id)<>cardinality(p_policy_ids) or p_limit is null or p_limit not between 1 and 25 then raise exception 'Exact bounded configured policy allowlist required' using errcode='22023';end if;
 if (select count(*) from private.reporting_refresh_policies where organization_id=p_organization_id and id=any(p_policy_ids))<>cardinality(p_policy_ids) then raise exception 'Exact original organization policies required' using errcode='42501';end if;
 select coalesce(jsonb_agg(private.reporting_refresh_job_receipt(id) order by next_attempt_at,id),'[]') into items from(
 select id,next_attempt_at from private.reporting_refresh_jobs where organization_id=p_organization_id and policy_id=any(p_policy_ids) and ((state in ('queued','retry') and next_attempt_at<=clock_timestamp()) or (state='running' and lease_expires_at<=clock_timestamp())) order by next_attempt_at,id limit p_limit) jobs;
 return jsonb_build_object('organization_id',p_organization_id,'policy_ids',p_policy_ids,'items',items,'dispatch_authorized',false);
end $$;
revoke all on function public.list_due_project_reporting_refreshes_for_policies(uuid,uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.list_due_project_reporting_refreshes_for_policies(uuid,uuid[],integer) to service_role;
commit;
