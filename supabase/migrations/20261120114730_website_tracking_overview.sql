create function public.website_tracking_overview(p_org uuid,p_project uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pages jsonb;search jsonb;enabled boolean;
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise insufficient_privilege;end if;
 search:=public.website_tracking_status(p_org,p_project,null);
 select s.enabled into enabled from private.website_observation_schedules s where s.project_id=p_project and s.organization_id=p_org;
 select jsonb_build_object('total',count(*),'fresh',count(*) filter(where q.last_state='observed' and q.last_observed>=now()-interval '2 days'),
  'failed',count(*) filter(where q.last_state in('missing','http_error','read_failed','robots_excluded')),
  'changedLast7Days',count(*) filter(where q.last_changed>=now()-interval '7 days'),
  'lastObserved',max(q.last_observed),'nextCheck',case when enabled then min(q.next_check) end)
 into pages from private.website_inventory_rows(p_org,p_project)x
 left join private.website_observation_queue q on q.project_id=p_project and q.page_id=(x->>'id')::uuid and q.url=x->>'url';
 return jsonb_build_object('search',search,'pages',pages,'pageChecksEnabled',coalesce(enabled,false),'observedAt',now());
end;$$;
revoke all on function public.website_tracking_overview(uuid,uuid) from public,anon;
grant execute on function public.website_tracking_overview(uuid,uuid) to authenticated;
