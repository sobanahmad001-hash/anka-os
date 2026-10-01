-- B6: closed immutable stored reporting companion; no adapter, queue or provider calls.
-- Existing connector registry, credential storage and Legacy histories unchanged.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('private.website_read_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '339ae8372edf7afa3115655da7a2255f'
 or md5(replace(pg_get_functiondef('private.project_reporting_context(uuid,uuid,uuid,text,uuid,text,text)'::regprocedure),chr(13),'')) is distinct from '51a3895ccca2b26cee458e0a58890a55'
 or md5(replace(pg_get_functiondef('private.reject_pipeline_template_mutation()'::regprocedure),chr(13),'')) is distinct from '8c3f3ac7f15e91b22826b54ac3b3c2cc' then raise exception 'Exact stored-report scope/retention prerequisites changed' using errcode='55000';end if;
end $$;
create table public.project_reporting_observations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,binding_id uuid not null,binding_revision_number integer not null,
 context_checksum text not null check(context_checksum~'^[a-f0-9]{64}$'),source_contract text not null check(length(source_contract) between 1 and 240),
 source_observation_id text not null check(length(source_observation_id) between 1 and 240),source_record_sha256 text not null check(source_record_sha256~'^[a-f0-9]{64}$'),
 source_acceptance text not null check(source_acceptance in ('unverified','verified')),metric_key text not null check(length(metric_key) between 1 and 240),metric_label text not null check(length(metric_label) between 1 and 240),unit text not null check(length(unit) between 1 and 80),
 metric_value numeric check(metric_value::text not in ('NaN','Infinity','-Infinity')),value_state text not null check(value_state in ('available','unknown')),
 aggregation text not null check(aggregation in ('additive','non_additive','unknown')),dimensions jsonb not null check(jsonb_typeof(dimensions)='object' and octet_length(dimensions::text)<=4096),dimensions_sha256 text not null check(dimensions_sha256~'^[a-f0-9]{64}$'),
 period_start date not null,period_end date not null,reporting_time_zone text not null check(length(reporting_time_zone) between 1 and 120),
 data_through timestamptz,retrieved_at timestamptz not null,last_success_at timestamptz,fresh_until timestamptz,completeness text not null check(completeness in ('complete','partial','unknown')),
 page_revision_id uuid references public.project_website_page_revisions(id) on delete restrict,
 placement_revision_id uuid references public.project_campaign_placement_revisions(id) on delete restrict,
 foreign key(binding_id,project_id,organization_id) references public.project_reporting_bindings(id,project_id,organization_id) on delete restrict,
 foreign key(binding_id,binding_revision_number) references public.project_reporting_binding_revisions(binding_id,revision_number) on delete restrict,
 check(period_end>=period_start and period_end-period_start<=365),check((value_state='available')=(metric_value is not null)),
 check(data_through is null or data_through<=retrieved_at),check(last_success_at is null or last_success_at<=retrieved_at),check(fresh_until is null or fresh_until>=retrieved_at),
 check(page_revision_id is null or placement_revision_id is null),
 unique(binding_id,source_contract,source_observation_id,metric_key,dimensions_sha256,period_start,period_end,reporting_time_zone)
);
create table public.project_reporting_sync_events(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,binding_id uuid not null,binding_revision_number integer not null,
 context_checksum text not null check(context_checksum~'^[a-f0-9]{64}$'),state text not null check(state in ('pending','running','succeeded','permission_denied','disconnected','rate_limited','failed')),
 occurred_at timestamptz not null,next_retry_at timestamptz,source_contract text not null check(length(source_contract) between 1 and 240),
 foreign key(binding_id,project_id,organization_id) references public.project_reporting_bindings(id,project_id,organization_id) on delete restrict,
 foreign key(binding_id,binding_revision_number) references public.project_reporting_binding_revisions(binding_id,revision_number) on delete restrict,
 check(next_retry_at is null or (state='rate_limited' and next_retry_at>=occurred_at))
);
create index project_reporting_observations_scope_idx on public.project_reporting_observations(organization_id,project_id,binding_id,period_start,period_end,retrieved_at desc,id);
create index project_reporting_observations_page_idx on public.project_reporting_observations(page_revision_id) where page_revision_id is not null;
create index project_reporting_observations_placement_idx on public.project_reporting_observations(placement_revision_id) where placement_revision_id is not null;
create index project_reporting_sync_events_scope_idx on public.project_reporting_sync_events(organization_id,project_id,binding_id,occurred_at desc,id);
create function private.validate_stored_reporting_observation() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.project_reporting_bindings%rowtype;r public.project_reporting_binding_revisions%rowtype;
begin
 select * into b from public.project_reporting_bindings where id=new.binding_id and organization_id=new.organization_id and project_id=new.project_id;
 select * into r from public.project_reporting_binding_revisions where binding_id=b.id and revision_number=new.binding_revision_number;
 if b.id is null or r.id is null or new.context_checksum<>r.context_checksum then raise exception 'Exact original reporting binding revision required' using errcode='42501';end if;
 if tg_table_name='project_reporting_observations' then
 if new.dimensions_sha256<>encode(sha256(convert_to(new.dimensions::text,'UTF8')),'hex') or not exists(select 1 from pg_timezone_names where name=new.reporting_time_zone) then raise exception 'Exact dimensions checksum and recognized timezone required' using errcode='22023';end if;
 if new.page_revision_id is not null and not exists(select 1 from public.project_website_page_revisions pr join public.project_website_pages p on p.id=pr.page_id and p.organization_id=pr.organization_id where pr.id=new.page_revision_id and pr.organization_id=b.organization_id and pr.project_id=b.project_id and p.engagement_id=b.engagement_id and p.brand_id=b.brand_id) then raise exception 'Exact project/engagement page revision required' using errcode='42501';end if;
 if new.placement_revision_id is not null and not exists(select 1 from public.project_campaign_placement_revisions pr join public.project_campaign_placements p on p.id=pr.placement_id and p.organization_id=pr.organization_id join public.marketing_campaigns c on c.id=p.campaign_id and c.organization_id=p.organization_id where pr.id=new.placement_revision_id and pr.organization_id=b.organization_id and pr.project_id=b.project_id and pr.account_binding_id=b.id and c.engagement_id=b.engagement_id and c.brand_id=b.brand_id) then raise exception 'Exact original placement account/revision required' using errcode='42501';end if;
 end if;return new;
end $$;
do $$declare t text;begin foreach t in array array['project_reporting_observations','project_reporting_sync_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger %I before update or delete on public.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);
 execute format('create trigger %I before insert on public.%I for each row execute function private.validate_stored_reporting_observation()',t||'_scope',t);
 end loop;end $$;
create function private.stored_reporting_context(p_org uuid,p_project uuid,p_binding uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.project_reporting_bindings%rowtype;r public.project_reporting_binding_revisions%rowtype;c jsonb;reason text;event public.project_reporting_sync_events%rowtype;last_success timestamptz;total bigint;
begin
 perform private.website_read_authorized(p_org,p_project);
 if p_binding is null then raise exception 'Exact existing reporting binding required' using errcode='22023';end if;
 select * into b from public.project_reporting_bindings where id=p_binding and organization_id=p_org and project_id=p_project for share;
 if not found then raise exception 'Exact project reporting binding unavailable' using errcode='42501';end if;
 select * into r from public.project_reporting_binding_revisions where binding_id=b.id order by revision_number desc limit 1;
 begin
 c:=private.project_reporting_context(p_org,p_project,b.engagement_id,b.department_id,b.connection_id,b.resource_kind,b.resource_key);
 if c->>'client_id'<>b.client_id::text or c->>'agency_client_id'<>b.agency_client_id::text or c->>'brand_id'<>b.brand_id::text then reason:='owning_context_changed';
 elsif r.state is distinct from 'enabled' then reason:='binding_'||coalesce(r.state,'unavailable');
 elsif c->>'context_checksum' is distinct from r.context_checksum then reason:='binding_context_changed';
 elsif c->>'project_archived'='true' or c->>'engagement_active'<>'true' or c->>'connection_archived'='true' or c->>'connection_status'<>'verified' or c->>'selected_resource_matches' is distinct from 'true' then reason:='current_resource_unavailable';
 elsif c->>'credential_state'<>'available' then reason:='credential_'||(c->>'credential_state');
 elsif c->>'grant_provenance'<>'observed' or c->>'reporting_scope_granted'<>'true' then reason:='observed_reporting_grant_missing';
 else reason:='resource_access_verification_pending';end if;
 exception when sqlstate '42501' or sqlstate '22023' then reason:='binding_context_unavailable';end;
 select * into event from public.project_reporting_sync_events where binding_id=b.id and organization_id=p_org and project_id=p_project order by occurred_at desc,id desc limit 1;
 select max(occurred_at) into last_success from public.project_reporting_sync_events where binding_id=b.id and organization_id=p_org and project_id=p_project and state='succeeded';
 select count(*) into total from public.project_reporting_observations where binding_id=b.id and organization_id=p_org and project_id=p_project;
 return jsonb_build_object('binding',to_jsonb(b)||jsonb_build_object('provider',private.reporting_resource_provider(b.resource_kind,b.resource_key)),'revision_number',r.revision_number,'binding_state',r.state,'current_context',c,'reason',reason,'current_authorized',false,'provider_resource_verified',false,'external_write_authorized',false,
 'stored_observations',total,'latest_sync_event',case when event.id is null then null else jsonb_build_object('id',event.id,'state',event.state,'occurred_at',event.occurred_at,'next_retry_at',event.next_retry_at,'source_contract',event.source_contract,'binding_revision_number',event.binding_revision_number,'matches_current_context',event.context_checksum=r.context_checksum and event.binding_revision_number=r.revision_number) end,'historical_last_success_at',last_success,
 'refresh',jsonb_build_object('eligible',false,'reason','configuration_and_resource_verification_required','cadence_seconds',null,'history_days',null,'stale_after_seconds',null,'manual_min_interval_seconds',null,'daily_request_limit',null,'backoff_seconds',null,'queued',false),'provider_request_made',false);
end $$;
create function public.get_project_stored_reporting_status(p_organization_id uuid,p_project_id uuid,p_binding_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin return private.stored_reporting_context(p_organization_id,p_project_id,p_binding_id);end $$;
create function public.list_project_stored_reporting_observations(p_organization_id uuid,p_project_id uuid,p_binding_id uuid,p_start_date date,p_end_date date,p_metric_key text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;b jsonb;total bigint;matching bigint;items jsonb;result jsonb;
begin
 c:=private.stored_reporting_context(p_organization_id,p_project_id,p_binding_id);b:=c->'binding';
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_end_date-p_start_date>365 or p_metric_key is null or length(p_metric_key)>240 or p_metric_key~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Explicit bounded reporting period and metric selection required' using errcode='22023';end if;
 select count(*) into total from public.project_reporting_observations where organization_id=p_organization_id and project_id=p_project_id and binding_id=p_binding_id;
 select count(*) into matching from public.project_reporting_observations where organization_id=p_organization_id and project_id=p_project_id and binding_id=p_binding_id and period_start>=p_start_date and period_end<=p_end_date and (p_metric_key='' or metric_key=p_metric_key);
 select coalesce(jsonb_agg(row order by row.retrieved_at desc,row.id),'[]'::jsonb) into items from(
 select o.id,o.organization_id,o.project_id,o.binding_id,o.binding_revision_number,o.source_contract,o.source_observation_id,o.source_record_sha256,o.source_acceptance,o.metric_key,o.metric_label,o.unit,o.aggregation,null::jsonb dimensions,o.dimensions_sha256,o.period_start,o.period_end,o.reporting_time_zone,o.data_through,o.retrieved_at,o.last_success_at,o.completeness,o.page_revision_id,o.placement_revision_id,
 b->>'provider' provider,b->>'resource_kind' resource_kind,b->>'resource_key' resource_key,null::numeric metric_value,null::text metric_value_text,'withheld'::text value_state,c->>'reason' metrics_withheld_reason,false current_authorized,false fixture_only,
 case when o.fresh_until is null then 'unknown' when o.fresh_until<clock_timestamp() then 'stale' else 'fresh' end freshness,
 coalesce(o.binding_revision_number=(c->>'revision_number')::integer and o.context_checksum=c->'current_context'->>'context_checksum',false) original_context_matches_current
 from public.project_reporting_observations o where o.organization_id=p_organization_id and o.project_id=p_project_id and o.binding_id=p_binding_id and o.period_start>=p_start_date and o.period_end<=p_end_date and (p_metric_key='' or o.metric_key=p_metric_key) order by o.retrieved_at desc,o.id limit p_limit offset p_offset) row;
 result:=jsonb_build_object('context',c,'items',items,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching,'collection_start_date',p_start_date,'collection_end_date',p_end_date,'provider_request_made',false,'attribution_claim',false,'causal_claim',false);
 if octet_length(result::text)>131072 then raise exception 'Stored report exceeds whole bounded result' using errcode='22023';end if;return result;
end $$;
revoke all on function private.validate_stored_reporting_observation(),private.stored_reporting_context(uuid,uuid,uuid),public.get_project_stored_reporting_status(uuid,uuid,uuid),public.list_project_stored_reporting_observations(uuid,uuid,uuid,date,date,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_project_stored_reporting_status(uuid,uuid,uuid),public.list_project_stored_reporting_observations(uuid,uuid,uuid,date,date,text,integer,integer) to authenticated;
comment on table public.project_reporting_observations is 'Closed immutable exact-resource stored observation bridge. No ingestion grant or provider verification adapter exists in this prototype; metric values are withheld by every native read.';
commit;
