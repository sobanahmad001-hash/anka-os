-- B6 durable refresh policy and trusted resource-verification boundary.
-- No adapter is registered or activated by this migration; no provider calls.
begin;
set local lock_timeout='5s'; set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('private.project_reporting_context(uuid,uuid,uuid,text,uuid,text,text)'::regprocedure),chr(13),'')) is distinct from '51a3895ccca2b26cee458e0a58890a55'
 or md5(replace(pg_get_functiondef('private.website_read_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '339ae8372edf7afa3115655da7a2255f'
 or md5(replace(pg_get_functiondef('private.reject_pipeline_template_mutation()'::regprocedure),chr(13),'')) is distinct from '8c3f3ac7f15e91b22826b54ac3b3c2cc'
 then raise exception 'Exact reporting authority prerequisites changed' using errcode='55000';end if;
end $$;
create function private.valid_reporting_refresh_limits(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;n numeric;keys text[]:=array['cadence_seconds','history_days','stale_after_seconds','manual_min_interval_seconds','daily_request_limit','backoff_seconds','max_backoff_seconds','max_period_days','max_observations','lease_seconds'];begin
 if v is null or jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>10 or not(v ?& keys) then return false;end if;
 foreach k in array keys loop
 if jsonb_typeof(v->k)<>'number' or (v->>k)!~'^[0-9]+$' then return false;end if;
 n:=(v->>k)::numeric;if n<1 or n>9007199254740991 then return false;end if;
 if k like '%seconds' and n>31536000 then return false;end if;
 end loop;
 return (v->>'history_days')::numeric<=366 and (v->>'max_period_days')::numeric<=(v->>'history_days')::numeric and (v->>'max_observations')::numeric<=1000 and (v->>'max_backoff_seconds')::numeric>=(v->>'backoff_seconds')::numeric;
end $$;
-- Deployment-owned registry. A reviewed adapter release must add its exact manifest;
-- neither authenticated users nor service_role can invent or enable capabilities.
create table private.reporting_refresh_adapters(
 source_contract text primary key check(length(source_contract) between 1 and 240 and source_contract!~'[[:cntrl:]]'),
 provider text not null,resource_kind text not null,
 manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'),
 metric_definitions jsonb not null check(jsonb_typeof(metric_definitions)='array' and jsonb_array_length(metric_definitions) between 1 and 100),
 enabled boolean not null,unique(source_contract,manifest_sha256)
);
create table private.reporting_refresh_policies(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,binding_id uuid not null,
 revision_number integer not null check(revision_number>0),source_contract text not null check(length(source_contract) between 1 and 240 and source_contract!~'[[:cntrl:]]'),
 reporting_time_zone text not null check(length(reporting_time_zone) between 1 and 120),limits jsonb not null check(private.valid_reporting_refresh_limits(limits)),enabled boolean not null,
 binding_revision_number integer not null,context_checksum text not null check(context_checksum~'^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),
 request_id uuid not null,input_checksum text not null check(input_checksum~'^[a-f0-9]{64}$'),
 foreign key(binding_id,project_id,organization_id) references public.project_reporting_bindings(id,project_id,organization_id) on delete restrict,
 foreign key(binding_id,binding_revision_number) references public.project_reporting_binding_revisions(binding_id,revision_number) on delete restrict,
 unique(binding_id,revision_number),unique(organization_id,request_id)
);
create table private.reporting_verification_challenges(
 id uuid primary key,organization_id uuid not null,project_id uuid not null,binding_id uuid not null,policy_id uuid not null references private.reporting_refresh_policies(id) on delete restrict,
 binding_revision_number integer not null,context_checksum text not null check(context_checksum~'^[a-f0-9]{64}$'),
 source_contract text not null,manifest_sha256 text not null,
 actor_id uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 foreign key(source_contract,manifest_sha256) references private.reporting_refresh_adapters(source_contract,manifest_sha256) on delete restrict,
 foreign key(binding_id,project_id,organization_id) references public.project_reporting_bindings(id,project_id,organization_id) on delete restrict,
 foreign key(binding_id,binding_revision_number) references public.project_reporting_binding_revisions(binding_id,revision_number) on delete restrict,
 check(expires_at>created_at)
);
create table private.reporting_resource_verifications(
 challenge_id uuid primary key references private.reporting_verification_challenges(id) on delete restrict,
 observed_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 resource_matches boolean not null,observed_reporting_grant boolean not null,
 source_evidence_sha256 text not null check(source_evidence_sha256~'^[a-f0-9]{64}$'),
 input_checksum text not null check(input_checksum~'^[a-f0-9]{64}$'),check(observed_at<=recorded_at)
);
create index reporting_refresh_policies_actor_idx on private.reporting_refresh_policies(created_by);
create index reporting_verification_scope_idx on private.reporting_verification_challenges(binding_id,created_at desc,id);
create index reporting_verification_policy_idx on private.reporting_verification_challenges(policy_id);
create index reporting_verification_actor_idx on private.reporting_verification_challenges(actor_id);
create index reporting_verification_adapter_idx on private.reporting_verification_challenges(source_contract,manifest_sha256);
do $$declare t text;begin foreach t in array array['reporting_refresh_adapters','reporting_refresh_policies','reporting_verification_challenges','reporting_resource_verifications'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 if t<>'reporting_refresh_adapters' then execute format('create trigger %I before update or delete on private.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);end if;
end loop;end $$;
create function private.reporting_refresh_admin(p_org uuid,p_project uuid,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$begin
 -- Same leadership roles as the existing integration gateway; serialize project first.
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found then raise exception 'Active exact project required' using errcode='42501';end if;
 perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id where o.id=p_org and o.status='active' and m.user_id=p_actor and m.status='active' and m.member_kind='team' and m.role in ('system_owner','operations_admin','executive') for share of o,m;
 if not found then raise exception 'Current integration administrator required' using errcode='42501';end if;
end $$;
create function private.reporting_refresh_binding(p_org uuid,p_project uuid,p_binding uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.project_reporting_bindings%rowtype;r public.project_reporting_binding_revisions%rowtype;c jsonb;begin
 select * into b from public.project_reporting_bindings where id=p_binding and organization_id=p_org and project_id=p_project for share;
 if not found then raise exception 'Exact original reporting binding required' using errcode='42501';end if;
 select * into r from public.project_reporting_binding_revisions where binding_id=b.id order by revision_number desc limit 1;
 c:=private.project_reporting_context(p_org,p_project,b.engagement_id,b.department_id,b.connection_id,b.resource_kind,b.resource_key);
 if r.state is distinct from 'enabled' or c->>'context_checksum' is distinct from r.context_checksum or c->>'client_id' is distinct from b.client_id::text or c->>'agency_client_id' is distinct from b.agency_client_id::text or c->>'brand_id' is distinct from b.brand_id::text
 or c->>'project_archived' is distinct from 'false' or c->>'engagement_active' is distinct from 'true' or c->>'connection_archived' is distinct from 'false' or c->>'connection_status' is distinct from 'verified' or c->>'selected_resource_matches' is distinct from 'true' or c->>'credential_state' is distinct from 'available'
 then raise exception 'Current exact reporting binding and credentials required' using errcode='42501';end if;
 -- Existing Google granted scopes are observed. Meta resource/grant acceptance must
 -- come from the trusted adapter receipt, never its requested-scope constant.
 if c->>'provider'<>'meta' and (c->>'grant_provenance' is distinct from 'observed' or c->>'reporting_scope_granted' is distinct from 'true') then raise exception 'Observed reporting grant required' using errcode='42501';end if;
 return c||jsonb_build_object('binding_id',b.id,'binding_revision_number',r.revision_number);
end $$;
create function public.configure_project_reporting_refresh(p_organization_id uuid,p_project_id uuid,p_binding_id uuid,p_expected_revision integer,p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();prior private.reporting_refresh_policies%rowtype;current_revision integer;c jsonb;checksum text;v private.reporting_refresh_policies%rowtype;r public.project_reporting_binding_revisions%rowtype;begin
 perform private.reporting_refresh_admin(p_organization_id,p_project_id,actor);
 if p_request_id is null or p_expected_revision is null or p_expected_revision not between 0 and 2147483646 or p_input is null or jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>6 or not(p_input ?& array['source_contract','reporting_time_zone','limits','enabled','binding_revision_number','context_checksum'])
 or jsonb_typeof(p_input->'source_contract') is distinct from 'string' or length(p_input->>'source_contract') not between 1 and 240 or (p_input->>'source_contract')~'[[:cntrl:]]'
 or jsonb_typeof(p_input->'reporting_time_zone') is distinct from 'string' or not exists(select 1 from pg_timezone_names where name=p_input->>'reporting_time_zone')
 or jsonb_typeof(p_input->'enabled') is distinct from 'boolean' or not private.valid_reporting_refresh_limits(p_input->'limits')
 or jsonb_typeof(p_input->'binding_revision_number') is distinct from 'number' or (p_input->>'binding_revision_number')!~'^[0-9]{1,10}$' or (p_input->>'binding_revision_number')::numeric not between 1 and 2147483647
 or jsonb_typeof(p_input->'context_checksum') is distinct from 'string' or (p_input->>'context_checksum')!~'^[a-f0-9]{64}$'
 then raise exception 'Complete explicit bounded refresh configuration required' using errcode='22023';end if;
 checksum:=encode(sha256(convert_to(jsonb_build_array(p_project_id,p_binding_id,p_expected_revision,p_input)::text,'UTF8')),'hex');
 select * into prior from private.reporting_refresh_policies where organization_id=p_organization_id and request_id=p_request_id;
 if found then
 if prior.created_by<>actor or prior.project_id<>p_project_id or prior.binding_id<>p_binding_id then raise exception 'Original policy actor/scope required' using errcode='42501';end if;
 if prior.input_checksum<>checksum then raise exception 'Original policy request changed' using errcode='23505';end if;
 return jsonb_build_object('policy_id',prior.id,'revision_number',prior.revision_number,'enabled',prior.enabled,'replayed',true,'dispatch_authorized',false);end if;
 perform 1 from public.project_reporting_bindings where id=p_binding_id and organization_id=p_organization_id and project_id=p_project_id for share;
 if not found then raise exception 'Exact original reporting binding required' using errcode='42501';end if;
 select * into r from public.project_reporting_binding_revisions where binding_id=p_binding_id order by revision_number desc limit 1;
 if r.revision_number is distinct from (p_input->>'binding_revision_number')::integer or r.context_checksum is distinct from p_input->>'context_checksum' then raise exception 'Original binding changed' using errcode='40001';end if;
 if (p_input->>'enabled')::boolean then c:=private.reporting_refresh_binding(p_organization_id,p_project_id,p_binding_id);end if;
 select coalesce(max(revision_number),0) into current_revision from private.reporting_refresh_policies where binding_id=p_binding_id;
 if current_revision<>p_expected_revision then raise exception 'Refresh policy changed' using errcode='40001';end if;
 insert into private.reporting_refresh_policies(organization_id,project_id,binding_id,revision_number,source_contract,reporting_time_zone,limits,enabled,binding_revision_number,context_checksum,created_by,request_id,input_checksum)
 values(p_organization_id,p_project_id,p_binding_id,current_revision+1,p_input->>'source_contract',p_input->>'reporting_time_zone',p_input->'limits',(p_input->>'enabled')::boolean,r.revision_number,r.context_checksum,actor,p_request_id,checksum) returning * into v;
 return jsonb_build_object('policy_id',v.id,'revision_number',v.revision_number,'enabled',v.enabled,'replayed',false,'dispatch_authorized',false);
end $$;
create function public.begin_project_reporting_verification(p_organization_id uuid,p_project_id uuid,p_binding_id uuid,p_policy_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c jsonb;p private.reporting_refresh_policies%rowtype;a private.reporting_refresh_adapters%rowtype;q private.reporting_verification_challenges%rowtype;begin
 perform private.reporting_refresh_admin(p_organization_id,p_project_id,actor);
 if p_request_id is null then raise exception 'Original verification request required' using errcode='22023';end if;
 select * into q from private.reporting_verification_challenges where id=p_request_id;
 if found then
 if q.actor_id<>actor or q.organization_id<>p_organization_id or q.project_id<>p_project_id or q.binding_id<>p_binding_id or q.policy_id is distinct from p_policy_id then raise exception 'Original verification request scope required' using errcode='42501';end if;
 return jsonb_build_object('challenge_id',q.id,'expires_at',q.expires_at,'replayed',true,'dispatch_authorized',false);end if;
 c:=private.reporting_refresh_binding(p_organization_id,p_project_id,p_binding_id);
 select * into p from private.reporting_refresh_policies where binding_id=p_binding_id order by revision_number desc limit 1;
 if p.id is null or p.id is distinct from p_policy_id or p.context_checksum is distinct from c->>'context_checksum' or p.binding_revision_number is distinct from (c->>'binding_revision_number')::integer then raise exception 'Exact current refresh policy required' using errcode='40001';end if;
 perform private.reporting_refresh_admin(p_organization_id,p_project_id,p.created_by);
 select * into a from private.reporting_refresh_adapters where source_contract=p.source_contract and provider=c->>'provider' and resource_kind=c->>'resource_kind' and enabled for share;
 if not found then raise exception 'Reviewed installed reporting adapter required' using errcode='55000';end if;
 insert into private.reporting_verification_challenges(id,organization_id,project_id,binding_id,policy_id,binding_revision_number,context_checksum,source_contract,manifest_sha256,actor_id,expires_at)
 values(p_request_id,p_organization_id,p_project_id,p_binding_id,p.id,p.binding_revision_number,p.context_checksum,a.source_contract,a.manifest_sha256,actor,clock_timestamp()+make_interval(secs=>(p.limits->>'lease_seconds')::integer)) returning * into q;
 return jsonb_build_object('challenge_id',q.id,'expires_at',q.expires_at,'replayed',false,'dispatch_authorized',false);
end $$;
-- Called only by a trusted adapter after its exact read-only verification. It accepts
-- fingerprints and booleans, never tokens, raw provider payloads or arbitrary metrics.
create function public.record_project_reporting_verification(p_challenge_id uuid,p_manifest_sha256 text,p_observed_at timestamptz,p_resource_matches boolean,p_observed_reporting_grant boolean,p_source_evidence_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.reporting_verification_challenges%rowtype;p private.reporting_refresh_policies%rowtype;c jsonb;prior private.reporting_resource_verifications%rowtype;checksum text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted reporting adapter only' using errcode='42501';end if;
 select * into q from private.reporting_verification_challenges where id=p_challenge_id;
 if not found then raise exception 'Original verification challenge required' using errcode='42501';end if;
 perform private.reporting_refresh_admin(q.organization_id,q.project_id,q.actor_id);
 if p_observed_at is null or not isfinite(p_observed_at) or p_observed_at<q.created_at or p_observed_at>clock_timestamp() or p_resource_matches is null or p_observed_reporting_grant is null or p_source_evidence_sha256 is null or p_source_evidence_sha256!~'^[a-f0-9]{64}$' or p_manifest_sha256 is distinct from q.manifest_sha256 then raise exception 'Exact bounded observed resource evidence required' using errcode='22023';end if;
 checksum:=encode(sha256(convert_to(jsonb_build_array(p_challenge_id,p_manifest_sha256,p_observed_at,p_resource_matches,p_observed_reporting_grant,p_source_evidence_sha256)::text,'UTF8')),'hex');
 select * into prior from private.reporting_resource_verifications where challenge_id=q.id;
 if found then
 if prior.input_checksum<>checksum then raise exception 'Original verification result changed' using errcode='23505';end if;
 return jsonb_build_object('challenge_id',q.id,'resource_verified',prior.resource_matches and prior.observed_reporting_grant,'replayed',true,'dispatch_authorized',false);end if;
 if clock_timestamp()>=q.expires_at then raise exception 'Verification lease expired; explicit new review required' using errcode='40001';end if;
 c:=private.reporting_refresh_binding(q.organization_id,q.project_id,q.binding_id);
 select * into p from private.reporting_refresh_policies where binding_id=q.binding_id order by revision_number desc limit 1;
 if p.id is distinct from q.policy_id or c->>'context_checksum' is distinct from q.context_checksum or (c->>'binding_revision_number')::integer is distinct from q.binding_revision_number then raise exception 'Verification context changed' using errcode='40001';end if;
 perform private.reporting_refresh_admin(q.organization_id,q.project_id,p.created_by);
 perform 1 from private.reporting_refresh_adapters where source_contract=q.source_contract and manifest_sha256=q.manifest_sha256 and enabled for share;
 if not found then raise exception 'Original reviewed adapter no longer enabled' using errcode='42501';end if;
 insert into private.reporting_resource_verifications(challenge_id,observed_at,resource_matches,observed_reporting_grant,source_evidence_sha256,input_checksum) values(q.id,p_observed_at,p_resource_matches,p_observed_reporting_grant,p_source_evidence_sha256,checksum);
 return jsonb_build_object('challenge_id',q.id,'resource_verified',p_resource_matches and p_observed_reporting_grant,'replayed',false,'dispatch_authorized',false);
end $$;
create function public.get_project_reporting_refresh_configuration(p_organization_id uuid,p_project_id uuid,p_binding_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.reporting_refresh_policies%rowtype;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 perform 1 from public.project_reporting_bindings where id=p_binding_id and organization_id=p_organization_id and project_id=p_project_id;
 if not found then raise exception 'Exact original reporting binding required' using errcode='42501';end if;
 select * into p from private.reporting_refresh_policies where binding_id=p_binding_id order by revision_number desc limit 1;
 return jsonb_build_object('policy',case when p.id is null then null else jsonb_build_object('id',p.id,'revision_number',p.revision_number,'source_contract',p.source_contract,'reporting_time_zone',p.reporting_time_zone,'limits',p.limits,'enabled',p.enabled,'binding_revision_number',p.binding_revision_number,'context_checksum',p.context_checksum) end,'dispatch_authorized',false,'provider_request_made',false);
end $$;
revoke all on function private.valid_reporting_refresh_limits(jsonb),private.reporting_refresh_admin(uuid,uuid,uuid),private.reporting_refresh_binding(uuid,uuid,uuid),public.configure_project_reporting_refresh(uuid,uuid,uuid,integer,jsonb,uuid),public.begin_project_reporting_verification(uuid,uuid,uuid,uuid,uuid),public.record_project_reporting_verification(uuid,text,timestamptz,boolean,boolean,text),public.get_project_reporting_refresh_configuration(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.configure_project_reporting_refresh(uuid,uuid,uuid,integer,jsonb,uuid),public.begin_project_reporting_verification(uuid,uuid,uuid,uuid,uuid),public.get_project_reporting_refresh_configuration(uuid,uuid,uuid) to authenticated;
grant execute on function public.record_project_reporting_verification(uuid,text,timestamptz,boolean,boolean,text) to service_role;
commit;
