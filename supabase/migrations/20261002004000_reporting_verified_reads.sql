-- B6 stored-reader integration. Reading never dispatches, enqueues or changes policy.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('private.stored_reporting_context(uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '9854b04af8448e23e52747bff1371514'
 or md5(replace(pg_get_functiondef('public.list_project_stored_reporting_observations(uuid,uuid,uuid,date,date,text,integer,integer)'::regprocedure),chr(13),'')) is distinct from 'c6848545404074e2248057a1083ae516'
 or md5(replace(pg_get_functiondef('private.reporting_refresh_binding(uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '6e5d889e84d3c58a577d225eb67bd143'
 then raise exception 'Exact stored-reader and resource prerequisites changed' using errcode='55000';end if;
end $$;
create function private.stored_reporting_verified(p_org uuid,p_project uuid,p_binding uuid,p_revision integer,p_checksum text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.reporting_refresh_policies%rowtype;a private.reporting_refresh_adapters%rowtype;q private.reporting_verification_challenges%rowtype;v private.reporting_resource_verifications%rowtype;c jsonb;actor uuid;begin
 -- The enclosing read has already locked project and caller membership FOR SHARE.
 -- Do not upgrade that shared lock via the write-only administrator helper.
 c:=private.reporting_refresh_binding(p_org,p_project,p_binding);
 select * into p from private.reporting_refresh_policies where binding_id=p_binding order by revision_number desc limit 1;
 if p.id is null or p.binding_revision_number<>p_revision or p.context_checksum<>p_checksum then return jsonb_build_object('verified',false,'reason','configuration_and_resource_verification_required');end if;
 select * into a from private.reporting_refresh_adapters where source_contract=p.source_contract and provider=c->>'provider' and resource_kind=c->>'resource_kind' and enabled for share;
 if not found then return jsonb_build_object('verified',false,'reason','installed_adapter_unavailable');end if;
 select ch.* into q from private.reporting_verification_challenges ch join private.reporting_resource_verifications vr on vr.challenge_id=ch.id where ch.binding_id=p_binding and ch.binding_revision_number=p_revision and ch.context_checksum=p_checksum and ch.source_contract=a.source_contract and ch.manifest_sha256=a.manifest_sha256 order by vr.observed_at desc,vr.recorded_at desc,ch.id desc limit 1;
 select * into v from private.reporting_resource_verifications where challenge_id=q.id;
 if v.challenge_id is null or not v.resource_matches or not v.observed_reporting_grant or exists(select 1 from private.reporting_refresh_results rr join private.reporting_refresh_attempts ra on ra.claim_id=rr.claim_id where ra.binding_id=p_binding and rr.outcome in ('permission_denied','disconnected') and rr.created_at>=v.observed_at) then return jsonb_build_object('verified',false,'reason','resource_access_verification_pending');end if;
 for actor in select distinct unnest(array[p.created_by,q.actor_id]) loop
 perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id where o.id=p_org and o.status='active' and m.user_id=actor and m.status='active' and m.member_kind='team' and m.role in ('system_owner','operations_admin','executive') for share of o,m;
 if not found then return jsonb_build_object('verified',false,'reason','verification_authority_unavailable');end if;
 end loop;
 return jsonb_build_object('verified',true,'reason','verified_resource_access');
end $$;
create or replace function private.stored_reporting_context(p_org uuid,p_project uuid,p_binding uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.project_reporting_bindings%rowtype;r public.project_reporting_binding_revisions%rowtype;c jsonb;reason text;event public.project_reporting_sync_events%rowtype;last_success timestamptz;total bigint;proof jsonb;policy private.reporting_refresh_policies%rowtype;job private.reporting_refresh_jobs%rowtype;verified boolean:=false;eligible boolean:=false;
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
 elsif c->>'provider'<>'meta' and (c->>'grant_provenance'<>'observed' or c->>'reporting_scope_granted'<>'true') then reason:='observed_reporting_grant_missing';
 else
 proof:=private.stored_reporting_verified(p_org,p_project,p_binding,r.revision_number,r.context_checksum);
 verified:=coalesce((proof->>'verified')::boolean,false);reason:=case when verified then 'verified_resource_access' else proof->>'reason' end;
 end if;
 exception when sqlstate '42501' or sqlstate '22023' then reason:='binding_context_unavailable';end;
 select * into policy from private.reporting_refresh_policies where binding_id=b.id order by revision_number desc limit 1;
 select * into job from private.reporting_refresh_jobs where binding_id=b.id and state in ('queued','running','retry','uncertain') order by created_at desc,id desc limit 1;
 eligible:=verified and coalesce(policy.enabled,false) and private.n6_project_configuration_authorized(p_org,p_project,auth.uid());
 select * into event from public.project_reporting_sync_events where binding_id=b.id and organization_id=p_org and project_id=p_project order by occurred_at desc,id desc limit 1;
 select max(occurred_at) into last_success from public.project_reporting_sync_events where binding_id=b.id and organization_id=p_org and project_id=p_project and state='succeeded';
 select count(*) into total from public.project_reporting_observations where binding_id=b.id and organization_id=p_org and project_id=p_project;
 return jsonb_build_object('binding',to_jsonb(b)||jsonb_build_object('provider',private.reporting_resource_provider(b.resource_kind,b.resource_key)),'revision_number',r.revision_number,'binding_state',r.state,'current_context',c,'reason',reason,'current_authorized',verified,'provider_resource_verified',verified,'verified_source_contract',case when verified then policy.source_contract else null end,'external_write_authorized',false,
 'stored_observations',total,'latest_sync_event',case when event.id is null then null else jsonb_build_object('id',event.id,'state',event.state,'occurred_at',event.occurred_at,'next_retry_at',event.next_retry_at,'source_contract',event.source_contract,'binding_revision_number',event.binding_revision_number,'matches_current_context',event.context_checksum=r.context_checksum and event.binding_revision_number=r.revision_number) end,'historical_last_success_at',last_success,
 'refresh',jsonb_build_object('eligible',eligible,'reason',case when policy.id is null then 'configuration_and_resource_verification_required' when not verified then reason when not policy.enabled then 'policy_paused' when not eligible then 'refresh_permission_required' else 'ready_for_explicit_request' end,'policy_id',policy.id,'policy_revision',policy.revision_number,'source_contract',policy.source_contract,'reporting_time_zone',policy.reporting_time_zone,'enabled',policy.enabled,'limits',policy.limits,'cadence_seconds',policy.limits->'cadence_seconds','history_days',policy.limits->'history_days','stale_after_seconds',policy.limits->'stale_after_seconds','manual_min_interval_seconds',policy.limits->'manual_min_interval_seconds','daily_request_limit',policy.limits->'daily_request_limit','backoff_seconds',policy.limits->'backoff_seconds','queued',job.id is not null,'job',case when job.id is null then null else private.reporting_refresh_job_receipt(job.id) end),'provider_request_made',false);
end $$;
create or replace function public.list_project_stored_reporting_observations(p_organization_id uuid,p_project_id uuid,p_binding_id uuid,p_start_date date,p_end_date date,p_metric_key text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;b jsonb;total bigint;matching bigint;items jsonb;result jsonb;
begin
 c:=private.stored_reporting_context(p_organization_id,p_project_id,p_binding_id);b:=c->'binding';
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_end_date-p_start_date>365 or p_metric_key is null or length(p_metric_key)>240 or p_metric_key~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Explicit bounded reporting period and metric selection required' using errcode='22023';end if;
 select count(*) into total from public.project_reporting_observations where organization_id=p_organization_id and project_id=p_project_id and binding_id=p_binding_id;
 select count(*) into matching from public.project_reporting_observations where organization_id=p_organization_id and project_id=p_project_id and binding_id=p_binding_id and period_start>=p_start_date and period_end<=p_end_date and (p_metric_key='' or metric_key=p_metric_key);
 select coalesce(jsonb_agg(row order by row.retrieved_at desc,row.id),'[]'::jsonb) into items from(
 select o.id,o.organization_id,o.project_id,o.binding_id,o.binding_revision_number,o.source_contract,o.source_observation_id,o.source_record_sha256,o.source_acceptance,o.metric_key,o.metric_label,o.unit,o.aggregation,case when coalesce((c->>'current_authorized')::boolean,false) and o.source_acceptance='verified' and o.source_contract=c->>'verified_source_contract' and o.binding_revision_number=(c->>'revision_number')::integer and o.context_checksum=c->'current_context'->>'context_checksum' then o.dimensions else null end dimensions,o.dimensions_sha256,o.period_start,o.period_end,o.reporting_time_zone,o.data_through,o.retrieved_at,o.last_success_at,o.completeness,o.page_revision_id,o.placement_revision_id,
 b->>'provider' provider,b->>'resource_kind' resource_kind,b->>'resource_key' resource_key,case when coalesce((c->>'current_authorized')::boolean,false) and o.source_acceptance='verified' and o.source_contract=c->>'verified_source_contract' and o.binding_revision_number=(c->>'revision_number')::integer and o.context_checksum=c->'current_context'->>'context_checksum' then o.metric_value else null end metric_value,case when coalesce((c->>'current_authorized')::boolean,false) and o.source_acceptance='verified' and o.source_contract=c->>'verified_source_contract' and o.binding_revision_number=(c->>'revision_number')::integer and o.context_checksum=c->'current_context'->>'context_checksum' then o.metric_value::text else null end metric_value_text,case when coalesce((c->>'current_authorized')::boolean,false) and o.source_acceptance='verified' and o.source_contract=c->>'verified_source_contract' and o.binding_revision_number=(c->>'revision_number')::integer and o.context_checksum=c->'current_context'->>'context_checksum' then o.value_state else 'withheld' end value_state,case when coalesce((c->>'current_authorized')::boolean,false) and o.source_acceptance='verified' and o.source_contract=c->>'verified_source_contract' and o.binding_revision_number=(c->>'revision_number')::integer and o.context_checksum=c->'current_context'->>'context_checksum' then null when c->>'current_authorized'='true' then 'original_source_or_context_unverified' else c->>'reason' end metrics_withheld_reason,coalesce((coalesce((c->>'current_authorized')::boolean,false) and o.source_acceptance='verified' and o.source_contract=c->>'verified_source_contract' and o.binding_revision_number=(c->>'revision_number')::integer and o.context_checksum=c->'current_context'->>'context_checksum'),false) current_authorized,false fixture_only,
 case when o.fresh_until is null then 'unknown' when o.fresh_until<clock_timestamp() then 'stale' else 'fresh' end freshness,
 coalesce(o.binding_revision_number=(c->>'revision_number')::integer and o.context_checksum=c->'current_context'->>'context_checksum',false) original_context_matches_current
 from public.project_reporting_observations o where o.organization_id=p_organization_id and o.project_id=p_project_id and o.binding_id=p_binding_id and o.period_start>=p_start_date and o.period_end<=p_end_date and (p_metric_key='' or o.metric_key=p_metric_key) order by o.retrieved_at desc,o.id limit p_limit offset p_offset) row;
 result:=jsonb_build_object('context',c,'items',items,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching,'collection_start_date',p_start_date,'collection_end_date',p_end_date,'provider_request_made',false,'attribution_claim',false,'causal_claim',false);
 if octet_length(result::text)>131072 then raise exception 'Stored report exceeds whole bounded result' using errcode='22023';end if;return result;
end $$;

revoke all on function private.stored_reporting_verified(uuid,uuid,uuid,integer,text) from public,anon,authenticated,service_role;
-- Existing authenticated-only public reader grants remain unchanged.
comment on table public.project_reporting_observations is 'Closed immutable exact-resource stored observations. Trusted claimed ingestion only; native readers recheck current resource/grant, installed source and exact original binding revision before exposing values or dimensions.';
commit;
