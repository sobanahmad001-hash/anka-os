create table private.website_observation_schedules(project_id uuid primary key,organization_id uuid not null,created_by uuid not null references auth.users,enabled boolean not null default true,
 foreign key(project_id,organization_id) references public.projects(id,organization_id));
create table private.website_observation_queue(project_id uuid not null references private.website_observation_schedules, page_id uuid not null,url text not null,
 next_check timestamptz not null default now(),claim uuid,lease_until timestamptz,last_checked timestamptz,last_observed timestamptz,last_changed timestamptz,last_state text,
 failures integer not null default 0,latest_snapshot jsonb,latest_digest text,primary key(project_id,page_id));
create table private.website_observation_history(id uuid primary key default gen_random_uuid(),project_id uuid not null,page_id uuid not null,
 detected_at timestamptz not null default clock_timestamp(),snapshot jsonb not null,previous_snapshot jsonb,changed boolean not null,
 claim uuid not null unique,foreign key(project_id,page_id) references private.website_observation_queue);
create index website_observation_due on private.website_observation_queue(next_check,project_id,page_id);
create index website_observation_history_page on private.website_observation_history(project_id,page_id,detected_at desc);
alter table private.website_observation_schedules enable row level security;
alter table private.website_observation_queue enable row level security;
alter table private.website_observation_history enable row level security;
revoke all on private.website_observation_schedules,private.website_observation_queue,private.website_observation_history from public,anon,authenticated,service_role;
create function public.configure_website_observations(p_org uuid,p_project uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$begin
 perform private.reporting_refresh_admin(p_org,p_project,auth.uid());
 if p_enabled is null then raise invalid_parameter_value;end if;
 insert into private.website_observation_schedules values(p_project,p_org,auth.uid(),p_enabled)
 on conflict(project_id) do update set created_by=auth.uid(),enabled=p_enabled;
end;$$;
revoke all on function public.configure_website_observations(uuid,uuid,boolean) from public,anon;
grant execute on function public.configure_website_observations(uuid,uuid,boolean) to authenticated;
create function public.claim_website_observations(p_limit integer default 4) returns jsonb
language plpgsql security definer set search_path='' as $$
declare schedule private.website_observation_schedules;q private.website_observation_queue;items jsonb:='[]';
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_limit not between 1 and 4 then raise invalid_parameter_value;end if;
 for schedule in select * from private.website_observation_schedules where enabled order by project_id limit 100 loop
  begin
   perform private.reporting_refresh_admin(schedule.organization_id,schedule.project_id,schedule.created_by);
   insert into private.website_observation_queue(project_id,page_id,url)
   select schedule.project_id,(x->>'id')::uuid,x->>'url' from private.website_inventory_rows(schedule.organization_id,schedule.project_id)x
   where x->>'url' like 'https://%' on conflict(project_id,page_id) do update set url=excluded.url,next_check=now(),claim=null,lease_until=null,
    latest_snapshot=null,latest_digest=null,last_observed=null,last_checked=null,last_state=null,last_changed=null,failures=0
   where private.website_observation_queue.url<>excluded.url;
  exception when insufficient_privilege then continue;end;
 end loop;
 for q in select queue.* from private.website_observation_queue queue join private.website_observation_schedules s using(project_id)
  where s.enabled and queue.next_check<=now() and (lease_until is null or lease_until<now()) order by next_check,project_id,page_id limit p_limit for update of queue skip locked loop
  select * into schedule from private.website_observation_schedules where project_id=q.project_id;
  begin perform private.reporting_refresh_admin(schedule.organization_id,schedule.project_id,schedule.created_by);
  exception when insufficient_privilege then continue;end;
  if not exists(select from private.website_inventory_rows(schedule.organization_id,q.project_id)x where x->>'id'=q.page_id::text and x->>'url'=q.url) then continue;end if;
  update private.website_observation_queue set claim=gen_random_uuid(),lease_until=now()+interval '90 seconds' where project_id=q.project_id and page_id=q.page_id returning * into q;
  items:=items||jsonb_build_array(jsonb_build_object('project',q.project_id,'page',q.page_id,'url',q.url,'claim',q.claim));
 end loop;
 return items;
end;$$;
create function public.commit_website_observation(p_project uuid,p_page uuid,p_claim uuid,p_snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare q private.website_observation_queue;s private.website_observation_schedules;digest text;changed boolean;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into strict s from private.website_observation_schedules where project_id=p_project and enabled;
 perform private.reporting_refresh_admin(s.organization_id,p_project,s.created_by);
 if exists(select from private.website_observation_history where claim=p_claim and project_id=p_project and page_id=p_page) then return;end if;
 select * into strict q from private.website_observation_queue where project_id=p_project and page_id=p_page for update;
 if p_claim is null or q.claim is distinct from p_claim or q.lease_until is null or q.lease_until<now() then raise exception 'Observation lease changed';end if;
 if not exists(select from private.website_inventory_rows(s.organization_id,p_project)x where x->>'id'=p_page::text and x->>'url'=q.url) then raise exception 'Page URL changed';end if;
 if jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>160000 or p_snapshot->>'state' is null or p_snapshot->>'state' not in('observed','missing','http_error','read_failed','robots_excluded') then raise invalid_parameter_value;end if;
 if p_snapshot->>'url' is distinct from q.url then raise exception 'Observation URL changed';end if;
 digest:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
 changed:=q.latest_digest is not null and q.latest_digest<>digest;
 if q.latest_digest is distinct from digest then
  insert into private.website_observation_history(project_id,page_id,snapshot,previous_snapshot,changed,claim) values(p_project,p_page,p_snapshot,q.latest_snapshot,changed,p_claim);
 end if;
 update private.website_observation_queue set last_checked=now(),last_state=p_snapshot->>'state',claim=null,lease_until=null,
  next_check=now()+case when p_snapshot->>'state'='read_failed' then interval '1 hour' else interval '1 day' end,
  failures=case when p_snapshot->>'state'='read_failed' then failures+1 else 0 end,
  last_changed=case when changed then now() else last_changed end,
  last_observed=case when p_snapshot->>'state'='observed' then now() else last_observed end,
  latest_snapshot=case when p_snapshot->>'state'='observed' then p_snapshot else latest_snapshot end,
  latest_digest=digest
 where project_id=p_project and page_id=p_page;
end;$$;
revoke all on function public.claim_website_observations(integer),public.commit_website_observation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_website_observations(integer),public.commit_website_observation(uuid,uuid,uuid,jsonb) to service_role;
create function public.website_observation_history(p_org uuid,p_project uuid,p_page uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) or not exists(select from private.website_inventory_rows(p_org,p_project)x where x->>'id'=p_page::text) then raise insufficient_privilege;end if;
 return jsonb_build_object('schedule',(select jsonb_build_object('enabled',enabled) from private.website_observation_schedules where project_id=p_project),
 'current',(select to_jsonb(q)-'claim'-'lease_until' from private.website_observation_queue q where project_id=p_project and page_id=p_page),
 'history',coalesce((select jsonb_agg(to_jsonb(h)-'claim' order by detected_at desc) from(select * from private.website_observation_history where project_id=p_project and page_id=p_page order by detected_at desc limit 10)h),'[]'));
end;$$;
revoke all on function public.website_observation_history(uuid,uuid,uuid) from public,anon;
grant execute on function public.website_observation_history(uuid,uuid,uuid) to authenticated;
create function public.request_website_observation(p_org uuid,p_project uuid,p_page uuid) returns boolean
language plpgsql security definer set search_path='' as $$begin
 perform private.reporting_refresh_admin(p_org,p_project,auth.uid());
 if not exists(select from private.website_observation_schedules where organization_id=p_org and project_id=p_project and enabled) then raise exception 'Enable page checks first';end if;
 if not exists(select from private.website_inventory_rows(p_org,p_project)x where x->>'id'=p_page::text) then raise insufficient_privilege;end if;
 update private.website_observation_queue set next_check=now() where project_id=p_project and page_id=p_page
 and (last_checked is null or last_checked<now()-interval '5 minutes') and (lease_until is null or lease_until<now());
 return found;
end;$$;
revoke all on function public.request_website_observation(uuid,uuid,uuid) from public,anon;
grant execute on function public.request_website_observation(uuid,uuid,uuid) to authenticated;

alter function public.website_page_health(uuid,uuid,uuid[]) rename to website_page_health_before_tracking;
create function public.website_page_health(p_org uuid,p_project uuid,p_pages uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb:='[]';item jsonb;q private.website_observation_queue;
begin
 for item in select x from jsonb_array_elements(public.website_page_health_before_tracking(p_org,p_project,p_pages))x loop
  select * into q from private.website_observation_queue where project_id=p_project and page_id=(item->>'id')::uuid;
  if found then
   item:=item||jsonb_build_object('observation',jsonb_build_object('state',q.last_state,'checkedAt',q.last_checked,'changedAt',q.last_changed,'nextCheck',q.next_check));
   if q.latest_snapshot is not null and q.url=item->>'url' then
    item:=item||jsonb_build_object('source',jsonb_build_object('url',q.url,'meta',q.latest_snapshot,'serviceObserved',true,'observedAt',q.last_observed));
   end if;
  end if;
  result:=result||jsonb_build_array(item);
 end loop;
 return result;
end;$$;
revoke all on function public.website_page_health(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.website_page_health(uuid,uuid,uuid[]) to authenticated;
