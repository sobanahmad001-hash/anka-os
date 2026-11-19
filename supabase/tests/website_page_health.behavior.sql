-- Execute after candidate migration inside BEGIN ... ROLLBACK.
-- Read-only assertions; JWT scope is transaction-local. No target or Work writes.
do $test$
declare org uuid;project uuid;actor uuid;other uuid;ids uuid[];result jsonb;
begin
 select p.organization_id,p.id,m.user_id into strict org,project,actor
 from public.projects p join public.organization_memberships m on m.organization_id=p.organization_id
 where p.id='02a91cea-2591-4b91-9666-3242bb7a6aac' and m.status='active' and m.role='system_owner' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select array_agg(id) into ids from (select (x->>'id')::uuid id from private.website_inventory_rows(org,project)x limit 25)s;
 if cardinality(ids)<>25 then raise exception 'Expected REL inventory fixture';end if;
 result:=public.website_page_health(org,project,ids);
 if jsonb_array_length(result)<>25 or exists(select from jsonb_array_elements(result)r where not((r->>'id')::uuid=any(ids))) then raise exception 'Page scope or bound failed';end if;
 if exists(select from jsonb_array_elements(result)r cross join lateral jsonb_array_elements(r->'work')w where w->>'kind' not in('engagement_work_item','project_task')) then raise exception 'Unknown Work kind';end if;
 select p.id into strict other from public.projects p where p.organization_id=org and p.id<>project and p.archived_at is null limit 1;
 if public.website_page_health(org,other,ids)<>'[]'::jsonb then raise exception 'Cross-project page leak';end if;
 begin
  perform public.website_page_health(org,project,array_fill(ids[1],array[26]));
  raise exception 'Unbounded request accepted';
 exception when invalid_parameter_value then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.website_page_health(org,project,ids);
  raise exception 'Unauthenticated request accepted';
 exception when insufficient_privilege then null;end;
end
$test$;
