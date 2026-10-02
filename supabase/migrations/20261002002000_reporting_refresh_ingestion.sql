-- B6 trusted atomic ingestion. Only a claimed, currently authorized original attempt
-- can append immutable observations and advance its cursor in the same transaction.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin if md5(replace(pg_get_functiondef('private.validate_stored_reporting_observation()'::regprocedure),chr(13),'')) is distinct from '76362bf8ed44a19b6057f8e1590f00ac' then raise exception 'Exact immutable stored observation boundary changed' using errcode='55000';end if;end $$;
create table private.reporting_refresh_pages(
 claim_id uuid primary key references private.reporting_refresh_attempts(claim_id) on delete restrict,
 input_checksum text not null check(input_checksum~'^[a-f0-9]{64}$'),result jsonb not null,
 retrieved_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 check(retrieved_at<=recorded_at)
);
alter table private.reporting_refresh_pages enable row level security;
revoke all on private.reporting_refresh_pages from public,anon,authenticated,service_role;
create trigger reporting_refresh_pages_immutable before update or delete on private.reporting_refresh_pages for each row execute function private.reject_pipeline_template_mutation();
create function public.commit_project_reporting_refresh_page(p_job_id uuid,p_claim_id uuid,p_page jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.reporting_refresh_jobs%rowtype;p private.reporting_refresh_policies%rowtype;a private.reporting_refresh_attempts%rowtype;
 ready jsonb;prior private.reporting_refresh_pages%rowtype;checksum text;definition jsonb;definitions jsonb;row jsonb;old public.project_reporting_observations%rowtype;
 stamp timestamptz;retrieved timestamptz;data_through timestamptz;next_cursor text;is_complete boolean;dim_sha text;metric numeric;inserted integer:=0;deduped integer:=0;result jsonb;n integer;row_keys text[]:=array['source_observation_id','source_record_sha256','metric_key','metric_value','value_state','dimensions','data_through','completeness'];
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted refresh ingestion only' using errcode='42501';end if;
 select * into j from private.reporting_refresh_jobs where id=p_job_id;
 if not found then raise exception 'Original refresh job required' using errcode='42501';end if;
 perform 1 from public.projects where id=j.project_id and organization_id=j.organization_id for update;
 select * into j from private.reporting_refresh_jobs where id=p_job_id for update;
 if p_page is null or jsonb_typeof(p_page)<>'object' or octet_length(p_page::text)>262144 or (select count(*) from jsonb_object_keys(p_page))<>10 or not(p_page ?& array['source_contract','resource_key','period_start','period_end','reporting_time_zone','cursor','next_cursor','complete','retrieved_at','observations']) then raise exception 'Closed bounded original adapter page required' using errcode='22023';end if;
 checksum:=encode(sha256(convert_to(jsonb_build_array(p_job_id,p_claim_id,p_page)::text,'UTF8')),'hex');
 select * into prior from private.reporting_refresh_pages where claim_id=p_claim_id;
 if found then
 if prior.input_checksum<>checksum then raise exception 'Original ingestion response changed' using errcode='23505';end if;
 return prior.result||jsonb_build_object('replayed',true);end if;
 if j.claim_id is distinct from p_claim_id or j.state not in ('running','uncertain') then raise exception 'Original unsettled ingestion claim required' using errcode='42501';end if;
 select * into a from private.reporting_refresh_attempts where claim_id=p_claim_id and job_id=j.id;
 if not found then raise exception 'Original attempt required' using errcode='42501';end if;
 if exists(select 1 from private.reporting_refresh_results where claim_id=p_claim_id and outcome<>'uncertain') then raise exception 'Original attempt already has a known result' using errcode='40001';end if;
 ready:=private.reporting_refresh_ready(j.organization_id,j.project_id,j.binding_id,j.actor_id);
 if (ready#>>'{policy,id}')::uuid<>j.policy_id or (ready->>'verification_id')::uuid<>j.verification_id then raise exception 'Original ingestion policy/verification changed' using errcode='42501';end if;
 select * into p from private.reporting_refresh_policies where id=j.policy_id;
 if exists(select 1 from unnest(array['source_contract','resource_key','period_start','period_end','reporting_time_zone']) k where jsonb_typeof(p_page->k) is distinct from 'string') or p_page->>'source_contract' is distinct from p.source_contract or p_page->>'resource_key' is distinct from ready#>>'{context,resource_key}' or p_page->>'period_start' is distinct from j.period_start::text or p_page->>'period_end' is distinct from j.period_end::text or p_page->>'reporting_time_zone' is distinct from p.reporting_time_zone
 or p_page->'cursor' is distinct from coalesce(to_jsonb(a.cursor),'null'::jsonb) or jsonb_typeof(p_page->'complete') is distinct from 'boolean' or jsonb_typeof(p_page->'observations') is distinct from 'array'
 or (p_page->'next_cursor'<>'null'::jsonb and (jsonb_typeof(p_page->'next_cursor')<>'string' or length(p_page->>'next_cursor') not between 1 and 4096 or (p_page->>'next_cursor')~'[[:cntrl:]]'))
 or jsonb_typeof(p_page->'retrieved_at') is distinct from 'string' or (p_page->>'retrieved_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$'
 then raise exception 'Adapter page must match exact original resource, cursor, period and timezone' using errcode='22023';end if;
 next_cursor:=p_page->>'next_cursor';is_complete:=(p_page->>'complete')::boolean;retrieved:=(p_page->>'retrieved_at')::timestamptz;stamp:=clock_timestamp();
 if not isfinite(retrieved) or retrieved<a.claimed_at-interval '1 millisecond' or retrieved>stamp or is_complete<>(next_cursor is null) or (next_cursor is not null and exists(select 1 from private.reporting_refresh_attempts where job_id=j.id and cursor=next_cursor)) then raise exception 'Exact retrieval time and advancing finite cursor required' using errcode='22023';end if;
 if jsonb_array_length(p_page->'observations')>(p.limits->>'max_observations')::integer or j.page_count>=1000 then raise exception 'Bounded ingestion page required' using errcode='22023';end if;
 select metric_definitions into definitions from private.reporting_refresh_adapters where source_contract=p.source_contract and manifest_sha256=ready->>'manifest_sha256' and enabled;
 for row in select value from jsonb_array_elements(p_page->'observations') loop
 if jsonb_typeof(row)<>'object' or (select count(*) from jsonb_object_keys(row))<>8 or not(row ?& row_keys)
 or jsonb_typeof(row->'source_observation_id') is distinct from 'string' or length(row->>'source_observation_id') not between 1 and 240 or (row->>'source_observation_id')~'[[:cntrl:]]'
 or jsonb_typeof(row->'source_record_sha256') is distinct from 'string' or (row->>'source_record_sha256')!~'^[a-f0-9]{64}$'
 or jsonb_typeof(row->'metric_key') is distinct from 'string' or coalesce(row->>'value_state','') not in ('available','unknown') or coalesce(row->>'completeness','') not in ('complete','partial','unknown')
 or jsonb_typeof(row->'dimensions') is distinct from 'object' or octet_length((row->'dimensions')::text)>4096 then raise exception 'Exact bounded original observation required' using errcode='22023';end if;
 if exists(select 1 from jsonb_each(row->'dimensions') d where length(d.key) not between 1 and 240 or d.key~'[[:cntrl:]]' or jsonb_typeof(d.value) not in ('string','number','boolean','null') or (jsonb_typeof(d.value)='number' and abs((d.value#>>'{}')::numeric)>9007199254740991) or (jsonb_typeof(d.value)='string' and (length(d.value#>>'{}')>2048 or (d.value#>>'{}')~'[[:cntrl:]]'))) then raise exception 'Only bounded scalar dimensions accepted' using errcode='22023';end if;
 select count(*),jsonb_agg(value)->0 into n,definition from jsonb_array_elements(definitions) where value->>'metric_key'=row->>'metric_key';
 if n<>1 or jsonb_typeof(definition)<>'object' or (select count(*) from jsonb_object_keys(definition))<>4 or not(definition ?& array['metric_key','metric_label','unit','aggregation']) or jsonb_typeof(definition->'metric_label') is distinct from 'string' or length(definition->>'metric_label') not between 1 and 240 or jsonb_typeof(definition->'unit') is distinct from 'string' or length(definition->>'unit') not between 1 and 80 or coalesce(definition->>'aggregation','') not in ('additive','non_additive','unknown') then raise exception 'Exact installed metric semantics required' using errcode='55000';end if;
 if row->>'value_state'='unknown' then
 if row->'metric_value'<>'null'::jsonb then raise exception 'Unknown metrics cannot become zero' using errcode='22023';end if;metric:=null;
 else
 if jsonb_typeof(row->'metric_value')<>'number' then raise exception 'Explicit numeric provider metric required' using errcode='22023';end if;
 metric:=(row->>'metric_value')::numeric;if abs(metric)>9007199254740991 then raise exception 'Metric exceeds exact client numeric range' using errcode='22023';end if;
 end if;
 data_through:=null;
 if row->'data_through'<>'null'::jsonb then
 if jsonb_typeof(row->'data_through')<>'string' or (row->>'data_through')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$' then raise exception 'Explicit original data-through required' using errcode='22023';end if;
 data_through:=(row->>'data_through')::timestamptz;if not isfinite(data_through) or data_through>retrieved then raise exception 'Data-through cannot exceed retrieval time' using errcode='22023';end if;end if;
 dim_sha:=encode(sha256(convert_to((row->'dimensions')::text,'UTF8')),'hex');
 select * into old from public.project_reporting_observations where binding_id=j.binding_id and source_contract=p.source_contract and source_observation_id=row->>'source_observation_id' and metric_key=row->>'metric_key' and dimensions_sha256=dim_sha and period_start=j.period_start and period_end=j.period_end and reporting_time_zone=p.reporting_time_zone;
 if found then
 if old.binding_revision_number<>p.binding_revision_number or old.context_checksum<>p.context_checksum or old.source_record_sha256<>row->>'source_record_sha256' or old.source_acceptance<>'verified' or old.metric_value is distinct from metric or old.value_state<>row->>'value_state' or old.dimensions<>row->'dimensions' or old.completeness<>row->>'completeness' or old.data_through is distinct from data_through or old.metric_label<>definition->>'metric_label' or old.unit<>definition->>'unit' or old.aggregation<>definition->>'aggregation' then raise exception 'Conflicting original observation is never overwritten' using errcode='23505';end if;
 deduped:=deduped+1;
 else
 insert into public.project_reporting_observations(organization_id,project_id,binding_id,binding_revision_number,context_checksum,source_contract,source_observation_id,source_record_sha256,source_acceptance,metric_key,metric_label,unit,metric_value,value_state,aggregation,dimensions,dimensions_sha256,period_start,period_end,reporting_time_zone,data_through,retrieved_at,last_success_at,fresh_until,completeness)
 values(j.organization_id,j.project_id,j.binding_id,p.binding_revision_number,p.context_checksum,p.source_contract,row->>'source_observation_id',row->>'source_record_sha256','verified',row->>'metric_key',definition->>'metric_label',definition->>'unit',metric,row->>'value_state',definition->>'aggregation',row->'dimensions',dim_sha,j.period_start,j.period_end,p.reporting_time_zone,data_through,retrieved,case when is_complete then retrieved else null end,retrieved+make_interval(secs=>(p.limits->>'stale_after_seconds')::integer),row->>'completeness');
 inserted:=inserted+1;
 end if;
 end loop;
 if j.observation_count+inserted>(p.limits->>'max_observations')::integer or (not is_complete and (j.observation_count+inserted>=(p.limits->>'max_observations')::integer or j.page_count+1>=1000)) then raise exception 'Whole refresh exceeds configured row/page bound' using errcode='22023';end if;
 update private.reporting_refresh_jobs set state=case when is_complete then 'succeeded' else 'queued' end,cursor=next_cursor,page_count=page_count+1,observation_count=observation_count+inserted,failure_count=0,next_attempt_at=stamp,updated_at=stamp where id=j.id;
 if is_complete then insert into public.project_reporting_sync_events(organization_id,project_id,binding_id,binding_revision_number,context_checksum,state,occurred_at,source_contract) values(j.organization_id,j.project_id,j.binding_id,p.binding_revision_number,p.context_checksum,'succeeded',stamp,p.source_contract);end if;
 result:=private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('inserted',inserted,'deduplicated',deduped,'complete',is_complete,'result_state',case when is_complete and j.observation_count+inserted=0 then 'successful_empty' when is_complete then 'complete' else 'partial' end);
 insert into private.reporting_refresh_pages(claim_id,input_checksum,result,retrieved_at) values(p_claim_id,checksum,result,retrieved);
 -- Preserve an earlier unknown-outcome audit record when original evidence arrives late.
 insert into private.reporting_refresh_results(claim_id,outcome,input_checksum,result) values(p_claim_id,'page',checksum,result) on conflict(claim_id) do nothing;
 return result||jsonb_build_object('replayed',false);
end $$;
create function public.get_project_reporting_refresh_claim(p_job_id uuid,p_claim_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted original refresh recovery only' using errcode='42501';end if;
 if not exists(select 1 from private.reporting_refresh_attempts where job_id=p_job_id and claim_id=p_claim_id) then return null;end if;
 select result into r from private.reporting_refresh_pages where claim_id=p_claim_id;
 if r is null then select result into r from private.reporting_refresh_results where claim_id=p_claim_id;end if;
 return jsonb_build_object('job',private.reporting_refresh_job_receipt(p_job_id),'original_result',r,'dispatch_authorized',false);
end $$;
revoke all on function public.commit_project_reporting_refresh_page(uuid,uuid,jsonb),public.get_project_reporting_refresh_claim(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.commit_project_reporting_refresh_page(uuid,uuid,jsonb),public.get_project_reporting_refresh_claim(uuid,uuid) to service_role;
commit;
