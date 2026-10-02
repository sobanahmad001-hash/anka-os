-- Additive per-HTTP reservation/ordinal audit. No adapter registration or activation.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
create table private.reporting_http_costs(
 source_contract text not null,manifest_sha256 text not null,request_budget integer not null check(request_budget=2),
 primary key(source_contract,manifest_sha256),foreign key(source_contract,manifest_sha256) references private.reporting_refresh_adapters(source_contract,manifest_sha256) on delete restrict
);
create table private.reporting_http_reservations(
 claim_kind text not null check(claim_kind in ('refresh','verification')),claim_id uuid not null,
 refresh_claim_id uuid references private.reporting_refresh_attempts(claim_id) on delete restrict,
 verification_claim_id uuid references private.reporting_verification_attempts(claim_id) on delete restrict,
 organization_id uuid not null,project_id uuid not null,actor_id uuid not null references auth.users(id) on delete restrict,
 binding_id uuid not null references public.project_reporting_bindings(id) on delete restrict,policy_id uuid not null references private.reporting_refresh_policies(id) on delete restrict,context_checksum text not null,
 source_contract text not null,manifest_sha256 text not null,request_budget integer not null check(request_budget=2),
 claimed_at timestamptz not null,lease_expires_at timestamptz not null check(lease_expires_at>claimed_at),
 primary key(claim_kind,claim_id),foreign key(source_contract,manifest_sha256) references private.reporting_http_costs(source_contract,manifest_sha256) on delete restrict,
 check((claim_kind='refresh' and refresh_claim_id=claim_id and refresh_claim_id is not null and verification_claim_id is null) or (claim_kind='verification' and verification_claim_id=claim_id and verification_claim_id is not null and refresh_claim_id is null))
);
create table private.reporting_http_permits(
 claim_kind text not null,claim_id uuid not null,ordinal integer not null check(ordinal between 1 and 2),permit_id uuid not null unique,
 permitted_at timestamptz not null default clock_timestamp(),primary key(claim_kind,claim_id,ordinal),
 foreign key(claim_kind,claim_id) references private.reporting_http_reservations(claim_kind,claim_id) on delete restrict
);
create table private.reporting_http_outcomes(
 permit_id uuid primary key references private.reporting_http_permits(permit_id) on delete restrict,
 outcome text not null check(outcome in ('validated','denied','failed','uncertain')),
 evidence_sha256 text not null check(evidence_sha256~'^[a-f0-9]{64}$'),valid_until timestamptz,
 recorded_at timestamptz not null default clock_timestamp(),check(valid_until is null or isfinite(valid_until))
);
do $$declare t text;begin foreach t in array array['reporting_http_costs','reporting_http_reservations','reporting_http_permits','reporting_http_outcomes'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger %I before update or delete on private.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);
end loop;end $$;
create function private.reporting_http_cost(p_source text,p_manifest text) returns integer language sql stable security definer set search_path='' as $$
 select coalesce((select request_budget from private.reporting_http_costs where source_contract=p_source and manifest_sha256=p_manifest),1)
$$;
create function private.reporting_http_usage(p_binding uuid,p_at timestamptz) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(coalesce(r.request_budget,1)),0)::bigint from (
 select 'refresh'::text kind,claim_id,claimed_at from private.reporting_refresh_attempts where binding_id=p_binding
 union all select 'verification',claim_id,claimed_at from private.reporting_verification_attempts where binding_id=p_binding
 ) a left join private.reporting_http_reservations r on r.claim_kind=a.kind and r.claim_id=a.claim_id where a.claimed_at>p_at-interval '24 hours'
$$;
create function private.reporting_http_reserve(p_kind text,p_claim uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare x record;budget integer;begin
 if p_kind='verification' then
 select a.claim_id,a.binding_id,a.claimed_at,a.lease_expires_at,q.organization_id,q.project_id,q.actor_id,q.policy_id,q.context_checksum,q.source_contract,q.manifest_sha256 into x from private.reporting_verification_attempts a join private.reporting_verification_challenges q on q.id=a.challenge_id where a.claim_id=p_claim;
 elsif p_kind='refresh' then
 select a.claim_id,a.binding_id,a.claimed_at,a.lease_expires_at,j.organization_id,j.project_id,j.actor_id,j.policy_id,p.context_checksum,p.source_contract,v.manifest_sha256 into x from private.reporting_refresh_attempts a join private.reporting_refresh_jobs j on j.id=a.job_id join private.reporting_refresh_policies p on p.id=j.policy_id join private.reporting_verification_challenges v on v.id=j.verification_id where a.claim_id=p_claim;
 else raise exception 'Original HTTP claim kind required' using errcode='22023';end if;
 if x.claim_id is null then raise exception 'Original immutable attempt required' using errcode='42501';end if;
 budget:=private.reporting_http_cost(x.source_contract,x.manifest_sha256);if budget=1 then return '{}'::jsonb;end if;
 insert into private.reporting_http_reservations(claim_kind,claim_id,refresh_claim_id,verification_claim_id,organization_id,project_id,actor_id,binding_id,policy_id,context_checksum,source_contract,manifest_sha256,request_budget,claimed_at,lease_expires_at)
 values(p_kind,p_claim,case when p_kind='refresh' then p_claim end,case when p_kind='verification' then p_claim end,x.organization_id,x.project_id,x.actor_id,x.binding_id,x.policy_id,x.context_checksum,x.source_contract,x.manifest_sha256,budget,x.claimed_at,x.lease_expires_at);
 return jsonb_build_object('provider_http_claim',jsonb_build_object('kind',p_kind,'claim_id',p_claim,'request_budget',budget));
end $$;
create function public.get_project_reporting_http_claim(p_kind text,p_claim uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.reporting_http_reservations%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted reporting worker only' using errcode='42501';end if;
 select * into r from private.reporting_http_reservations where claim_kind=p_kind and claim_id=p_claim;
 if not found then return jsonb_build_object('claim_id',p_claim,'claim_kind',p_kind,'state','not_found','dispatch_authorized',false);end if;
 return jsonb_build_object('claim_id',p_claim,'claim_kind',p_kind,'reserved_requests',r.request_budget,'lease_expires_at',r.lease_expires_at,'dispatch_authorized',false,'requests',coalesce((select jsonb_agg(jsonb_build_object('ordinal',p.ordinal,'permit_id',p.permit_id,'permitted_at',p.permitted_at,'outcome',o.outcome,'evidence_sha256',o.evidence_sha256,'valid_until',o.valid_until,'recorded_at',o.recorded_at) order by p.ordinal) from private.reporting_http_permits p left join private.reporting_http_outcomes o using(permit_id) where p.claim_kind=p_kind and p.claim_id=p_claim),'[]'::jsonb));
end $$;
create function public.claim_project_reporting_http_request(p_kind text,p_claim uuid,p_ordinal integer,p_permit uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.reporting_http_reservations%rowtype;c jsonb;policy private.reporting_refresh_policies%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted reporting worker only' using errcode='42501';end if;
 if p_permit is null or p_ordinal is null or p_ordinal not between 1 and 2 then raise exception 'Original bounded request required' using errcode='22023';end if;
 select * into r from private.reporting_http_reservations where claim_kind=p_kind and claim_id=p_claim;
 if not found then raise exception 'Original reserved HTTP claim required' using errcode='42501';end if;
 perform private.reporting_refresh_admin(r.organization_id,r.project_id,r.actor_id);
 perform 1 from private.reporting_http_reservations where claim_kind=p_kind and claim_id=p_claim for update;
 if exists(select 1 from private.reporting_http_permits where permit_id=p_permit and (claim_kind<>p_kind or claim_id<>p_claim or ordinal<>p_ordinal)) then raise exception 'Permit belongs to another request' using errcode='42501';end if;
 if exists(select 1 from private.reporting_http_permits where claim_kind=p_kind and claim_id=p_claim and ordinal=p_ordinal) or clock_timestamp()>=r.lease_expires_at then return public.get_project_reporting_http_claim(p_kind,p_claim);end if;
 if p_kind='verification' and exists(select 1 from private.reporting_verification_attempts a join private.reporting_resource_verifications v using(challenge_id) where a.claim_id=p_claim) then return public.get_project_reporting_http_claim(p_kind,p_claim);end if;
 if p_kind='refresh' and not exists(select 1 from private.reporting_refresh_jobs where claim_id=p_claim and state='running') then return public.get_project_reporting_http_claim(p_kind,p_claim);end if;
 select * into policy from private.reporting_refresh_policies where binding_id=r.binding_id order by revision_number desc limit 1;
 if policy.id is distinct from r.policy_id or not policy.enabled then raise exception 'Original HTTP policy changed' using errcode='40001';end if;
 perform private.reporting_refresh_admin(r.organization_id,r.project_id,policy.created_by);
 c:=private.reporting_refresh_binding(r.organization_id,r.project_id,r.binding_id);
 if c->>'context_checksum' is distinct from r.context_checksum then raise exception 'Original HTTP context changed' using errcode='40001';end if;
 perform 1 from private.reporting_refresh_adapters where source_contract=r.source_contract and manifest_sha256=r.manifest_sha256 and enabled for share;
 if not found then raise exception 'Original adapter disabled' using errcode='42501';end if;
 if p_ordinal=2 and not exists(select 1 from private.reporting_http_permits p join private.reporting_http_outcomes o using(permit_id) where p.claim_kind=p_kind and p.claim_id=p_claim and p.ordinal=1 and o.outcome='validated' and o.valid_until>clock_timestamp()) then return public.get_project_reporting_http_claim(p_kind,p_claim);end if;
 insert into private.reporting_http_permits(claim_kind,claim_id,ordinal,permit_id) values(p_kind,p_claim,p_ordinal,p_permit);
 return jsonb_build_object('claim_kind',p_kind,'claim_id',p_claim,'ordinal',p_ordinal,'permit_id',p_permit,'dispatch_authorized',true);
end $$;
create function public.record_project_reporting_http_outcome(p_permit uuid,p_outcome text,p_evidence_sha256 text,p_valid_until timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.reporting_http_permits%rowtype;r private.reporting_http_reservations%rowtype;o private.reporting_http_outcomes%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted reporting worker only' using errcode='42501';end if;
 if p_outcome is null or p_outcome not in ('validated','denied','failed','uncertain') or p_evidence_sha256 is null or p_evidence_sha256!~'^[a-f0-9]{64}$' or (p_valid_until is not null and not isfinite(p_valid_until)) then raise exception 'Exact bounded outcome required' using errcode='22023';end if;
 select * into p from private.reporting_http_permits where permit_id=p_permit;if not found then raise exception 'Original request permit required' using errcode='42501';end if;
 select * into r from private.reporting_http_reservations where claim_kind=p.claim_kind and claim_id=p.claim_id;
 -- Audit of an already permitted original request remains recoverable after revocation/timeout; it grants no new dispatch.
 perform 1 from public.projects where id=r.project_id and organization_id=r.organization_id for update;
 select * into o from private.reporting_http_outcomes where permit_id=p_permit;
 if found then if o.outcome<>p_outcome or o.evidence_sha256<>p_evidence_sha256 or o.valid_until is distinct from p_valid_until then raise exception 'Original request outcome changed' using errcode='23505';end if;return public.get_project_reporting_http_claim(p.claim_kind,p.claim_id);end if;
 if p_outcome='validated' and (clock_timestamp()>=r.lease_expires_at or (p.ordinal=1 and p_valid_until<=clock_timestamp()) or (p.ordinal=2 and not exists(select 1 from private.reporting_http_permits f join private.reporting_http_outcomes first_result using(permit_id) where f.claim_kind=p.claim_kind and f.claim_id=p.claim_id and f.ordinal=1 and first_result.outcome='validated' and first_result.valid_until>clock_timestamp()))) then raise exception 'Current original HTTP evidence validity required' using errcode='22023';end if;
 if (p.ordinal=1 and p_outcome='validated' and (p_valid_until is null or p_valid_until<=p.permitted_at)) or ((p.ordinal<>1 or p_outcome<>'validated') and p_valid_until is not null) then raise exception 'Exact first-request validity required' using errcode='22023';end if;
 insert into private.reporting_http_outcomes(permit_id,outcome,evidence_sha256,valid_until) values(p_permit,p_outcome,p_evidence_sha256,p_valid_until);
 return public.get_project_reporting_http_claim(p.claim_kind,p.claim_id);
end $$;
create function private.reporting_http_completion(p_kind text,p_claim uuid,p_positive boolean,p_evidence text default null) returns void language plpgsql security definer set search_path='' as $$
declare r private.reporting_http_reservations%rowtype;last_outcome text;last_hash text;begin
 select * into r from private.reporting_http_reservations where claim_kind=p_kind and claim_id=p_claim;if not found then return;end if;
 select o.outcome,o.evidence_sha256 into last_outcome,last_hash from private.reporting_http_permits p join private.reporting_http_outcomes o using(permit_id) where p.claim_kind=p_kind and p.claim_id=p_claim order by p.ordinal desc limit 1;
 if p_positive then
 if (select count(*) from private.reporting_http_permits p join private.reporting_http_outcomes o using(permit_id) where p.claim_kind=p_kind and p.claim_id=p_claim and o.outcome='validated')<>2 then raise exception 'Both original HTTP proofs required' using errcode='42501';end if;
 elsif last_outcome is distinct from 'denied' then raise exception 'Observed original HTTP denial required' using errcode='42501';end if;
 if p_evidence is not null and last_hash is distinct from p_evidence then raise exception 'Original HTTP evidence changed' using errcode='22023';end if;
end $$;
create or replace function public.claim_project_reporting_verification(p_challenge_id uuid,p_claim_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.reporting_verification_challenges%rowtype;p private.reporting_refresh_policies%rowtype;c jsonb;a private.reporting_verification_attempts%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted verification worker only' using errcode='42501';end if;
 if p_claim_id is null then raise exception 'Original verification claim required' using errcode='22023';end if;
 select * into q from private.reporting_verification_challenges where id=p_challenge_id;
 if not found then raise exception 'Original verification challenge required' using errcode='42501';end if;
 -- All resource dispatches serialize project before authority, binding and quota.
 perform private.reporting_refresh_admin(q.organization_id,q.project_id,q.actor_id);
 select * into a from private.reporting_verification_attempts where challenge_id=q.id;
 if found or exists(select 1 from private.reporting_resource_verifications where challenge_id=q.id) or clock_timestamp()>=q.expires_at then
 return private.reporting_verification_receipt(q.id);end if;
 c:=private.reporting_refresh_binding(q.organization_id,q.project_id,q.binding_id);
 select * into p from private.reporting_refresh_policies where binding_id=q.binding_id order by revision_number desc limit 1;
 if p.id is distinct from q.policy_id or c->>'context_checksum' is distinct from q.context_checksum or (c->>'binding_revision_number')::integer is distinct from q.binding_revision_number then raise exception 'Verification context changed' using errcode='40001';end if;
 perform private.reporting_refresh_admin(q.organization_id,q.project_id,p.created_by);
 perform 1 from private.reporting_refresh_adapters where source_contract=q.source_contract and manifest_sha256=q.manifest_sha256 and provider=c->>'provider' and resource_kind=c->>'resource_kind' and enabled for share;
 if not found then raise exception 'Original reviewed adapter no longer enabled' using errcode='42501';end if;
 if private.reporting_http_usage(q.binding_id,clock_timestamp())+private.reporting_http_cost(q.source_contract,q.manifest_sha256) > (p.limits->>'daily_request_limit')::numeric then
 return private.reporting_verification_receipt(q.id)||jsonb_build_object('blocked_reason','rolling_day_quota_exhausted');end if;
 -- A conflicting claim UUID rolls back; it can never produce a dispatch grant.
 insert into private.reporting_verification_attempts(challenge_id,claim_id,binding_id,lease_expires_at) values(q.id,p_claim_id,q.binding_id,q.expires_at) returning * into a;
 return jsonb_build_object('challenge_id',q.id,'claim_id',a.claim_id,'context',c||private.reporting_http_reserve('verification',a.claim_id),'source_contract',q.source_contract,'manifest_sha256',q.manifest_sha256,'claimed_at',a.claimed_at,'lease_expires_at',a.lease_expires_at,'limits',p.limits,'dispatch_authorized',true,'automatic_retry',false);
end $$;
create or replace function public.claim_project_reporting_refresh(p_job_id uuid,p_claim_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.reporting_refresh_jobs%rowtype;p private.reporting_refresh_policies%rowtype;ready jsonb;stamp timestamptz;quota bigint;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted refresh worker only' using errcode='42501';end if;
 if p_claim_id is null then raise exception 'Original worker claim required' using errcode='22023';end if;
 select * into j from private.reporting_refresh_jobs where id=p_job_id;
 if not found then raise exception 'Original refresh job required' using errcode='42501';end if;
 perform 1 from public.projects where id=j.project_id and organization_id=j.organization_id for update;
 select * into j from private.reporting_refresh_jobs where id=p_job_id for update;
 if exists(select 1 from private.reporting_refresh_attempts where claim_id=p_claim_id) then
 if not exists(select 1 from private.reporting_refresh_attempts where claim_id=p_claim_id and job_id=j.id) then raise exception 'Original claim belongs to another job' using errcode='42501';end if;
 return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('replayed',true);end if;
 if j.state='running' and j.lease_expires_at<=clock_timestamp() then
 update private.reporting_refresh_jobs set state='uncertain',updated_at=clock_timestamp() where id=j.id;
 return private.reporting_refresh_job_receipt(j.id);end if;
 if j.state not in ('queued','retry') or j.next_attempt_at>clock_timestamp() then return private.reporting_refresh_job_receipt(j.id);end if;
 begin
 ready:=private.reporting_refresh_ready(j.organization_id,j.project_id,j.binding_id,j.actor_id);
 if (ready#>>'{policy,id}')::uuid<>j.policy_id or (ready->>'verification_id')::uuid<>j.verification_id then raise exception 'Original refresh policy/verification changed' using errcode='42501';end if;
 exception when sqlstate '42501' or sqlstate '22023' then
 update private.reporting_refresh_jobs set state='denied',updated_at=clock_timestamp() where id=j.id;
 return private.reporting_refresh_job_receipt(j.id);end;
 select * into p from private.reporting_refresh_policies where id=j.policy_id;
 stamp:=clock_timestamp();quota:=private.reporting_http_usage(j.binding_id,stamp);
 if quota+private.reporting_http_cost(p.source_contract,ready->>'manifest_sha256')>(p.limits->>'daily_request_limit')::bigint then
 update private.reporting_refresh_jobs set next_attempt_at=(select min(claimed_at)+interval '24 hours' from (select claimed_at from private.reporting_refresh_attempts where binding_id=j.binding_id union all select claimed_at from private.reporting_verification_attempts where binding_id=j.binding_id) attempts where claimed_at>stamp-interval '24 hours'),updated_at=stamp where id=j.id;
 return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('reason','rolling_day_quota_exhausted');end if;
 if j.page_count>=1000 then update private.reporting_refresh_jobs set state='failed',updated_at=stamp where id=j.id;return private.reporting_refresh_job_receipt(j.id);end if;
 insert into private.reporting_refresh_attempts(claim_id,job_id,binding_id,attempt_number,cursor,claimed_at,lease_expires_at) values(p_claim_id,j.id,j.binding_id,j.attempt_number+1,j.cursor,stamp,stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer));
 update private.reporting_refresh_jobs set state='running',claim_id=p_claim_id,lease_expires_at=stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer),attempt_number=attempt_number+1,updated_at=stamp where id=j.id;
 -- Only the first committed claim response can authorize one dispatch. Replays cannot.
 return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('dispatch_authorized',true,'claim_id',p_claim_id,'cursor',j.cursor,'lease_expires_at',stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer),'context',(ready->'context')||private.reporting_http_reserve('refresh',p_claim_id),'source_contract',p.source_contract,'manifest_sha256',ready->>'manifest_sha256','limits',p.limits,'reporting_time_zone',p.reporting_time_zone);
end $$;
create or replace function public.complete_project_reporting_verification(p_challenge_id uuid,p_claim_id uuid,p_manifest_sha256 text,p_observed_at timestamptz,p_resource_matches boolean,p_observed_reporting_grant boolean,p_source_evidence_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.reporting_verification_attempts%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted verification worker only' using errcode='42501';end if;
 select * into a from private.reporting_verification_attempts where challenge_id=p_challenge_id and claim_id=p_claim_id;
 if not found then raise exception 'Original claimed verification required' using errcode='42501';end if;
 if p_observed_at is null or p_observed_at<a.claimed_at or p_observed_at>=a.lease_expires_at then raise exception 'Original dispatch observation window required' using errcode='22023';end if;
 perform private.reporting_http_completion('verification',p_claim_id,p_resource_matches and p_observed_reporting_grant,p_source_evidence_sha256);
 return public.record_project_reporting_verification(p_challenge_id,p_manifest_sha256,p_observed_at,p_resource_matches,p_observed_reporting_grant,p_source_evidence_sha256);
end $$;
create or replace function public.commit_project_reporting_refresh_page(p_job_id uuid,p_claim_id uuid,p_page jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 perform private.reporting_http_completion('refresh',p_claim_id,true);
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

revoke all on function private.reporting_http_cost(text,text),private.reporting_http_usage(uuid,timestamptz),private.reporting_http_reserve(text,uuid),private.reporting_http_completion(text,uuid,boolean,text) from public,anon,authenticated,service_role;
revoke all on function public.get_project_reporting_http_claim(text,uuid),public.claim_project_reporting_http_request(text,uuid,integer,uuid),public.record_project_reporting_http_outcome(uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.get_project_reporting_http_claim(text,uuid),public.claim_project_reporting_http_request(text,uuid,integer,uuid),public.record_project_reporting_http_outcome(uuid,text,text,timestamptz) to service_role;
commit;
