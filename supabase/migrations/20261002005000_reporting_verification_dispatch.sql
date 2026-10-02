-- B6 original-challenge dispatch. No provider, credential, registry or schedule activation.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('public.claim_project_reporting_refresh(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from 'f6dba26f88996c7ac88eac5b1c02838b'
 or md5(replace(pg_get_functiondef('public.record_project_reporting_verification(uuid,text,timestamptz,boolean,boolean,text)'::regprocedure),chr(13),'')) is distinct from '2bb8e59c8fe755b95f0dfeb8204b9db3'
 or md5(replace(pg_get_functiondef('private.reporting_refresh_binding(uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '6e5d889e84d3c58a577d225eb67bd143'
 or md5(replace(pg_get_functiondef('private.reporting_refresh_admin(uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '12e0a9786bb14fb87c44b3b0fc4bb323'
 then raise exception 'Exact verification dispatch prerequisites changed' using errcode='55000';end if;
end $$;
create table private.reporting_verification_attempts(
 challenge_id uuid primary key references private.reporting_verification_challenges(id) on delete restrict,
 claim_id uuid not null unique,
 binding_id uuid not null references public.project_reporting_bindings(id) on delete restrict,
 claimed_at timestamptz not null default clock_timestamp(),
 lease_expires_at timestamptz not null,check(lease_expires_at>claimed_at)
);
create index reporting_verification_attempt_quota_idx on private.reporting_verification_attempts(binding_id,claimed_at desc);
alter table private.reporting_verification_attempts enable row level security;
revoke all on private.reporting_verification_attempts from public,anon,authenticated,service_role;
create trigger reporting_verification_attempts_immutable before update or delete on private.reporting_verification_attempts for each row execute function private.reject_pipeline_template_mutation();
create function private.reporting_verification_receipt(p_challenge uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('challenge_id',q.id,'policy_id',q.policy_id,'binding_id',q.binding_id,'expires_at',q.expires_at,
 'state',case when v.challenge_id is not null then 'completed' when a.challenge_id is not null then case when clock_timestamp()>=a.lease_expires_at then 'uncertain' else 'claimed' end when clock_timestamp()>=q.expires_at then 'expired' else 'unclaimed' end,
 'original_result',case when v.challenge_id is null then null else jsonb_build_object('challenge_id',q.id,'resource_verified',v.resource_matches and v.observed_reporting_grant,'observed_at',v.observed_at,'recorded_at',v.recorded_at,'dispatch_authorized',false) end,
 'dispatch_authorized',false,'automatic_retry',false)
 from private.reporting_verification_challenges q left join private.reporting_verification_attempts a on a.challenge_id=q.id left join private.reporting_resource_verifications v on v.challenge_id=q.id where q.id=p_challenge;
$$;
create function public.claim_project_reporting_verification(p_challenge_id uuid,p_claim_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if (select count(*) from (select claimed_at from private.reporting_verification_attempts where binding_id=q.binding_id union all select claimed_at from private.reporting_refresh_attempts where binding_id=q.binding_id) attempts where claimed_at>clock_timestamp()-interval '24 hours') >= (p.limits->>'daily_request_limit')::numeric then
 return private.reporting_verification_receipt(q.id)||jsonb_build_object('blocked_reason','rolling_day_quota_exhausted');end if;
 -- A conflicting claim UUID rolls back; it can never produce a dispatch grant.
 insert into private.reporting_verification_attempts(challenge_id,claim_id,binding_id,lease_expires_at) values(q.id,p_claim_id,q.binding_id,q.expires_at) returning * into a;
 return jsonb_build_object('challenge_id',q.id,'claim_id',a.claim_id,'context',c,'source_contract',q.source_contract,'manifest_sha256',q.manifest_sha256,'claimed_at',a.claimed_at,'lease_expires_at',a.lease_expires_at,'limits',p.limits,'dispatch_authorized',true,'automatic_retry',false);
end $$;
-- The prior recorder retains its exact tested body but is no longer directly callable
-- by service_role. This wrapper requires proof of the one original dispatch first.
revoke all on function public.record_project_reporting_verification(uuid,text,timestamptz,boolean,boolean,text) from public,anon,authenticated,service_role;
create function public.complete_project_reporting_verification(p_challenge_id uuid,p_claim_id uuid,p_manifest_sha256 text,p_observed_at timestamptz,p_resource_matches boolean,p_observed_reporting_grant boolean,p_source_evidence_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.reporting_verification_attempts%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted verification worker only' using errcode='42501';end if;
 select * into a from private.reporting_verification_attempts where challenge_id=p_challenge_id and claim_id=p_claim_id;
 if not found then raise exception 'Original claimed verification required' using errcode='42501';end if;
 if p_observed_at is null or p_observed_at<a.claimed_at or p_observed_at>=a.lease_expires_at then raise exception 'Original dispatch observation window required' using errcode='22023';end if;
 return public.record_project_reporting_verification(p_challenge_id,p_manifest_sha256,p_observed_at,p_resource_matches,p_observed_reporting_grant,p_source_evidence_sha256);
end $$;
create function public.get_project_reporting_verification_claim(p_challenge_id uuid,p_claim_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted verification worker only' using errcode='42501';end if;
 if not exists(select 1 from private.reporting_verification_attempts where challenge_id=p_challenge_id and claim_id=p_claim_id) then return jsonb_build_object('challenge_id',p_challenge_id,'state','not_found','original_result',null,'dispatch_authorized',false,'automatic_retry',false);end if;
 return private.reporting_verification_receipt(p_challenge_id);
end $$;
create function public.get_project_reporting_verification_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.reporting_verification_challenges%rowtype;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 select * into q from private.reporting_verification_challenges where id=p_request_id and organization_id=p_organization_id and project_id=p_project_id;
 if not found then return jsonb_build_object('challenge_id',p_request_id,'state','not_found','original_result',null,'dispatch_authorized',false,'automatic_retry',false);end if;
 if q.actor_id is distinct from auth.uid() then raise exception 'Original verification actor required' using errcode='42501';end if;
 return private.reporting_verification_receipt(q.id);
end $$;
revoke all on function private.reporting_verification_receipt(uuid),public.claim_project_reporting_verification(uuid,uuid),public.complete_project_reporting_verification(uuid,uuid,text,timestamptz,boolean,boolean,text),public.get_project_reporting_verification_claim(uuid,uuid),public.get_project_reporting_verification_operation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_project_reporting_verification(uuid,uuid),public.complete_project_reporting_verification(uuid,uuid,text,timestamptz,boolean,boolean,text),public.get_project_reporting_verification_claim(uuid,uuid) to service_role;
grant execute on function public.get_project_reporting_verification_operation(uuid,uuid,uuid) to authenticated;
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
 stamp:=clock_timestamp();select count(*) into quota from (select claimed_at from private.reporting_refresh_attempts where binding_id=j.binding_id union all select claimed_at from private.reporting_verification_attempts where binding_id=j.binding_id) attempts where claimed_at>stamp-interval '24 hours';
 if quota>=(p.limits->>'daily_request_limit')::bigint then
 update private.reporting_refresh_jobs set next_attempt_at=(select min(claimed_at)+interval '24 hours' from (select claimed_at from private.reporting_refresh_attempts where binding_id=j.binding_id union all select claimed_at from private.reporting_verification_attempts where binding_id=j.binding_id) attempts where claimed_at>stamp-interval '24 hours'),updated_at=stamp where id=j.id;
 return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('reason','rolling_day_quota_exhausted');end if;
 if j.page_count>=1000 then update private.reporting_refresh_jobs set state='failed',updated_at=stamp where id=j.id;return private.reporting_refresh_job_receipt(j.id);end if;
 insert into private.reporting_refresh_attempts(claim_id,job_id,binding_id,attempt_number,cursor,claimed_at,lease_expires_at) values(p_claim_id,j.id,j.binding_id,j.attempt_number+1,j.cursor,stamp,stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer));
 update private.reporting_refresh_jobs set state='running',claim_id=p_claim_id,lease_expires_at=stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer),attempt_number=attempt_number+1,updated_at=stamp where id=j.id;
 -- Only the first committed claim response can authorize one dispatch. Replays cannot.
 return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('dispatch_authorized',true,'claim_id',p_claim_id,'cursor',j.cursor,'lease_expires_at',stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer),'context',ready->'context','source_contract',p.source_contract,'manifest_sha256',ready->>'manifest_sha256','limits',p.limits,'reporting_time_zone',p.reporting_time_zone);
end $$;
commit;
