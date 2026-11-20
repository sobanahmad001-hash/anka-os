create or replace function private.valid_reporting_refresh_limits(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;n numeric;keys text[]:=array['cadence_seconds','history_days','stale_after_seconds','manual_min_interval_seconds','daily_request_limit','backoff_seconds','max_backoff_seconds','max_period_days','max_observations','lease_seconds'];begin
 if v is null or jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>10 or not(v ?& keys) then return false;end if;
 foreach k in array keys loop
 if jsonb_typeof(v->k)<>'number' or (v->>k)!~'^[0-9]+$' then return false;end if;
 n:=(v->>k)::numeric;if n<1 or n>9007199254740991 then return false;end if;
 if k like '%seconds' and n>31536000 then return false;end if;
 end loop;
 return (v->>'history_days')::numeric<=366 and (v->>'max_period_days')::numeric<=(v->>'history_days')::numeric and (v->>'max_observations')::numeric<=400000 and (v->>'max_backoff_seconds')::numeric>=(v->>'backoff_seconds')::numeric;
end $$;
create table private.website_tracking_links(
 project_id uuid primary key references public.projects(id),organization_id uuid not null,
 direct_binding uuid not null references private.gsc_property_bindings(id),direct_revision integer not null,
 reporting_binding uuid references public.project_reporting_bindings(id),policy_id uuid references private.reporting_refresh_policies(id),
 enabled boolean not null default false,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),last_dispatch timestamptz,
 foreign key(project_id,organization_id) references public.projects(id,organization_id)
);
alter table private.website_tracking_links enable row level security;
revoke all on private.website_tracking_links from public,anon,authenticated,service_role;

-- Opted-in Website tracking uses stable grant identity, retaining all original resource/tenant checks.
alter function private.project_reporting_context(uuid,uuid,uuid,text,uuid,text,text) rename to project_reporting_context_before_daily;
create function private.project_reporting_context(p_org uuid,p_project uuid,p_engagement uuid,p_department text,p_connection uuid,p_kind text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;grant_date timestamptz;refreshable boolean;
begin
 result:=private.project_reporting_context_before_daily(p_org,p_project,p_engagement,p_department,p_connection,p_kind,p_key);
 if p_kind='gsc_site' and exists(select from private.website_tracking_links l join private.gsc_property_bindings b on b.id=l.direct_binding
  where l.project_id=p_project and l.organization_id=p_org and b.revision=l.direct_revision and b.connection_id=p_connection and b.site=p_key) then
  select grant_updated_at,refresh_token_ciphertext is not null and refresh_token_iv is not null into grant_date,refreshable
  from public.integration_oauth_credentials where organization_id=p_org and connection_id=p_connection and provider='google_search_console';
  result:=(result-'context_checksum')||jsonb_build_object('credential_revision',grant_date,'credential_state',case when refreshable then 'available' else 'unavailable' end);
  result:=result||jsonb_build_object('context_checksum',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
 end if;
 return result;
end;$$;
revoke all on function private.project_reporting_context(uuid,uuid,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;

create function public.website_tracking_token_scope(p_org uuid,p_project uuid,p_binding uuid,p_checksum text)
returns boolean language plpgsql security definer set search_path='' as $$
declare ctx jsonb;l private.website_tracking_links;b private.gsc_property_bindings;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into strict l from private.website_tracking_links where organization_id=p_org and project_id=p_project and reporting_binding=p_binding and enabled;
 select * into strict b from private.gsc_property_bindings where id=l.direct_binding and project_id=p_project and organization_id=p_org and revision=l.direct_revision;
 perform private.reporting_refresh_admin(p_org,p_project,l.created_by);
 perform private.gsc_active_scope(p_org,p_project,b.id);
 ctx:=private.reporting_refresh_binding(p_org,p_project,p_binding);
 if ctx->>'context_checksum' is distinct from p_checksum then raise insufficient_privilege;end if;
 return true;
end;$$;
revoke all on function public.website_tracking_token_scope(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.website_tracking_token_scope(uuid,uuid,uuid,text) to service_role;

create function public.configure_website_tracking(p_org uuid,p_project uuid,p_engagement uuid,p_department text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();b private.gsc_property_bindings;l private.website_tracking_links;prior private.reporting_refresh_policies;input jsonb;review jsonb;saved jsonb;ctx jsonb;policy jsonb;revision integer;
begin
 perform private.reporting_refresh_admin(p_org,p_project,actor);
 if p_enabled is null then raise invalid_parameter_value;end if;
 if not p_enabled then update private.website_tracking_links set enabled=false where project_id=p_project;return jsonb_build_object('enabled',false);end if;
 select * into strict b from private.gsc_property_bindings where organization_id=p_org and project_id=p_project for share;
 perform private.gsc_active_scope(p_org,p_project,b.id);
 select * into l from private.website_tracking_links where project_id=p_project for update;
 if l.direct_binding=b.id and l.direct_revision=b.revision and l.policy_id is not null then
  begin
   ctx:=private.reporting_refresh_binding(p_org,p_project,l.reporting_binding);
   select * into prior from private.reporting_refresh_policies where binding_id=l.reporting_binding order by revision_number desc limit 1;
   perform private.reporting_refresh_admin(p_org,p_project,prior.created_by);
   if prior.id=l.policy_id and prior.enabled and prior.context_checksum=ctx->>'context_checksum' and prior.binding_revision_number=(ctx->>'binding_revision_number')::integer then
    update private.website_tracking_links set enabled=true,created_by=actor where project_id=p_project;
    return jsonb_build_object('binding',l.reporting_binding,'policy',l.policy_id,'enabled',true);
   end if;
  exception when insufficient_privilege or no_data_found then null;end;
 end if;
 -- The selected engagement must already map this connection; never invent a resource grant.
 if not exists(select from public.integration_connection_engagements m join public.engagements e on e.id=m.engagement_id
  where m.connection_id=b.connection_id and m.organization_id=p_org and m.engagement_id=p_engagement and m.department_id=p_department and e.project_id=p_project and e.organization_id=p_org)
 then raise exception 'Map the verified connection to this project engagement in Integrations first' using errcode='42501';end if;
 insert into private.website_tracking_links(project_id,organization_id,direct_binding,direct_revision,enabled,created_by)
 values(p_project,p_org,b.id,b.revision,true,actor) on conflict(project_id) do update set direct_binding=b.id,direct_revision=b.revision,enabled=true,created_by=actor;
 select id into l.reporting_binding from public.project_reporting_bindings where organization_id=p_org and project_id=p_project and engagement_id=p_engagement and department_id=p_department and connection_id=b.connection_id and resource_kind='gsc_site' and resource_key=b.site;
 select coalesce(max(revision_number),0) into revision from public.project_reporting_binding_revisions where binding_id=l.reporting_binding;
 input:=jsonb_build_object('binding_id',l.reporting_binding,'expected_revision',revision,'engagement_id',p_engagement,'department_id',p_department,'connection_id',b.connection_id,'resource_kind','gsc_site','resource_key',b.site,'permitted_operations',jsonb_build_array('reporting_read'),'state','enabled');
 review:=public.preview_project_reporting_binding(p_org,p_project,input);
 saved:=public.confirm_project_reporting_binding(p_org,p_project,input,review->>'review_sha256',gen_random_uuid());
 l.reporting_binding:=(saved->>'binding_id')::uuid;ctx:=private.reporting_refresh_binding(p_org,p_project,l.reporting_binding);
 select coalesce(max(revision_number),0) into revision from private.reporting_refresh_policies where binding_id=l.reporting_binding;
 policy:=public.configure_project_reporting_refresh(p_org,p_project,l.reporting_binding,revision,jsonb_build_object(
  'source_contract','anka.gsc.page-and-query.daily.final.v1','reporting_time_zone','America/Los_Angeles','enabled',true,
  'binding_revision_number',ctx->'binding_revision_number','context_checksum',ctx->'context_checksum',
  'limits',jsonb_build_object('cadence_seconds',60,'history_days',90,'stale_after_seconds',172800,'manual_min_interval_seconds',60,'daily_request_limit',2000,'backoff_seconds',60,'max_backoff_seconds',86400,'max_period_days',1,'max_observations',400000,'lease_seconds',60)),gen_random_uuid());
 update private.website_tracking_links set reporting_binding=l.reporting_binding,policy_id=(policy->>'policy_id')::uuid where project_id=p_project;
 -- A replaced authority snapshot cannot authorize an old in-flight result. Retain
 -- its immutable attempt/history while releasing the single unresolved-job slot.
 update private.reporting_refresh_jobs set state='failed',updated_at=now()
 where binding_id=l.reporting_binding and policy_id<>(policy->>'policy_id')::uuid and state in('queued','running','retry','uncertain');
 return jsonb_build_object('binding',l.reporting_binding,'policy',policy->'policy_id','enabled',true);
end;$$;
revoke all on function public.configure_website_tracking(uuid,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.configure_website_tracking(uuid,uuid,uuid,text,boolean) to authenticated;

create function public.website_tracking_due(p_limit integer default 4) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l private.website_tracking_links;job private.reporting_refresh_jobs;target date;today date;receipt jsonb;items jsonb:='[]';
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_limit not between 1 and 4 then raise invalid_parameter_value;end if;
 today:=(now() at time zone 'America/Los_Angeles')::date;
 for l in select * from private.website_tracking_links where enabled and policy_id is not null order by last_dispatch nulls first,project_id limit 100 loop
  begin
   perform public.website_tracking_token_scope(l.organization_id,l.project_id,l.reporting_binding,(select context_checksum from private.reporting_refresh_policies where id=l.policy_id));
   select * into job from private.reporting_refresh_jobs where binding_id=l.reporting_binding and state in('queued','running','retry','uncertain') order by created_at limit 1;
   if not found then
    select d::date into target from generate_series((today-58)::timestamp,(today-3)::timestamp,interval '1 day')d
    left join lateral(select max(updated_at) refreshed from private.reporting_refresh_jobs j where j.binding_id=l.reporting_binding and j.policy_id=l.policy_id and j.period_start=d::date and j.period_end=d::date and j.state='succeeded') s on true
    where s.refreshed is null or d::date>=today-9 and (s.refreshed at time zone 'America/Los_Angeles')::date<today
    order by (s.refreshed is not null) desc,d desc limit 1;
    if target is null then continue;end if;
    receipt:=private.enqueue_reporting_refresh(l.organization_id,l.project_id,l.reporting_binding,l.policy_id,target,target,gen_random_uuid(),l.created_by,'scheduled');
    select * into job from private.reporting_refresh_jobs where id=(receipt->>'job_id')::uuid;
   end if;
   if job.state in('queued','retry') and job.next_attempt_at<=now() or job.state='running' and job.lease_expires_at<=now() then
    items:=items||jsonb_build_array(jsonb_build_object('job_id',job.id));
    update private.website_tracking_links set last_dispatch=now() where project_id=l.project_id;
   end if;
  exception when insufficient_privilege or no_data_found or raise_exception or sqlstate '55000' or sqlstate '40001' then null;
  end;
  exit when jsonb_array_length(items)>=p_limit;
 end loop;
 return items;
end;$$;
revoke all on function public.website_tracking_due(integer) from public,anon,authenticated;
grant execute on function public.website_tracking_due(integer) to service_role;

create function public.website_tracking_status(p_org uuid,p_project uuid,p_page uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l private.website_tracking_links;ctx jsonb;address text;days jsonb;job jsonb;success timestamptz;through date;choices jsonb;
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise insufficient_privilege;end if;
 select * into l from private.website_tracking_links where project_id=p_project and organization_id=p_org;
 select coalesce(jsonb_agg(jsonb_build_object('engagement',e.id,'department',m.department_id)),'[]') into choices from private.gsc_property_bindings b
 join public.integration_connection_engagements m on m.connection_id=b.connection_id and m.organization_id=p_org
 join public.engagements e on e.id=m.engagement_id and e.project_id=p_project and e.organization_id=p_org
 where b.project_id=p_project and b.organization_id=p_org and e.status in('planning','active');
 if l.reporting_binding is null then return jsonb_build_object('enabled',false,'choices',choices);end if;
 begin ctx:=private.reporting_refresh_binding(p_org,p_project,l.reporting_binding);
 exception when insufficient_privilege or no_data_found or raise_exception then return jsonb_build_object('enabled',l.enabled,'state','reconnect_required','choices',choices);end;
 select max(updated_at),max(period_end) into success,through from private.reporting_refresh_jobs where binding_id=l.reporting_binding and policy_id=l.policy_id and state='succeeded';
 select private.reporting_refresh_job_receipt(id) into job from private.reporting_refresh_jobs where binding_id=l.reporting_binding order by created_at desc limit 1;
 if p_page is not null then
  select x->>'url' into strict address from private.website_inventory_rows(p_org,p_project)x where x->>'id'=p_page::text;
  with latest as(select distinct on(period_start) id,period_start,created_at,updated_at from private.reporting_refresh_jobs where binding_id=l.reporting_binding and policy_id=l.policy_id and state='succeeded' order by period_start,updated_at desc),
  metrics as(select j.period_start as date,max(o.metric_value) filter(where metric_key='clicks') clicks,max(o.metric_value) filter(where metric_key='impressions') impressions,max(o.metric_value) filter(where metric_key='position') position
   from latest j left join public.project_reporting_observations o on o.binding_id=l.reporting_binding and o.context_checksum=ctx->>'context_checksum'
    and o.period_start=j.period_start and o.period_end=j.period_start and o.retrieved_at between j.created_at and j.updated_at
    and o.dimensions->>'page'=address and o.dimensions->>'series'='pages' and o.source_contract='anka.gsc.page-and-query.daily.final.v1'
   where j.period_start>=through-55 group by j.period_start)
  select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('complete',clicks is not null and impressions is not null) order by date),'[]') into days from metrics m;
 end if;
 return jsonb_build_object('enabled',l.enabled,'binding',l.reporting_binding,'policy',l.policy_id,'choices',choices,'lastSuccess',success,'dataThrough',through,'job',job,'days',coalesce(days,'[]'));
end;$$;
revoke all on function public.website_tracking_status(uuid,uuid,uuid) from public,anon;
grant execute on function public.website_tracking_status(uuid,uuid,uuid) to authenticated;
