-- B6 atomic refresh queue. Provider dispatch and ingestion are separate trusted steps.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin if md5(replace(pg_get_functiondef('private.reporting_refresh_admin(uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '12e0a9786bb14fb87c44b3b0fc4bb323' or md5(replace(pg_get_functiondef('private.reporting_refresh_binding(uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '6e5d889e84d3c58a577d225eb67bd143' or md5(replace(pg_get_functiondef('private.n6_project_configuration_authorized(uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from 'b5005c1ed90d7fe6cf8acc091c1cfb81' then raise exception 'Exact reporting authority boundary changed' using errcode='55000';end if;end $$;
create table private.reporting_refresh_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,binding_id uuid not null,
 policy_id uuid not null references private.reporting_refresh_policies(id) on delete restrict,
 verification_id uuid not null references private.reporting_resource_verifications(challenge_id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 period_start date not null,period_end date not null,trigger text not null check(trigger in ('manual','scheduled')),
 state text not null check(state in ('queued','running','retry','uncertain','succeeded','denied','failed')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 next_attempt_at timestamptz not null default clock_timestamp(),cursor text check(length(cursor) between 1 and 4096 and cursor!~'[[:cntrl:]]'),
 claim_id uuid,lease_expires_at timestamptz,attempt_number integer not null default 0 check(attempt_number>=0),failure_count integer not null default 0 check(failure_count>=0),
 page_count integer not null default 0 check(page_count between 0 and 1000),observation_count integer not null default 0 check(observation_count>=0),
 foreign key(binding_id,project_id,organization_id) references public.project_reporting_bindings(id,project_id,organization_id) on delete restrict,
 check(period_end>=period_start and period_end-period_start<=365),check((claim_id is null)=(lease_expires_at is null)),check(state not in ('running','uncertain') or claim_id is not null)
);
create unique index reporting_refresh_one_active_binding on private.reporting_refresh_jobs(binding_id) where state in ('queued','running','retry','uncertain');
create index reporting_refresh_job_due_idx on private.reporting_refresh_jobs(organization_id,next_attempt_at,id) where state in ('queued','retry');
create index reporting_refresh_job_history_idx on private.reporting_refresh_jobs(binding_id,created_at desc,id);
create index reporting_refresh_job_actor_idx on private.reporting_refresh_jobs(actor_id);
create index reporting_refresh_job_policy_idx on private.reporting_refresh_jobs(policy_id);
create index reporting_refresh_job_verification_idx on private.reporting_refresh_jobs(verification_id);
create table private.reporting_refresh_requests(
 organization_id uuid not null,project_id uuid not null,request_id uuid not null,actor_id uuid not null references auth.users(id) on delete restrict,
 job_id uuid not null references private.reporting_refresh_jobs(id) on delete restrict,input_checksum text not null check(input_checksum~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),primary key(organization_id,request_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create index reporting_refresh_request_job_idx on private.reporting_refresh_requests(job_id);
create index reporting_refresh_request_actor_idx on private.reporting_refresh_requests(actor_id);
create table private.reporting_refresh_attempts(
 claim_id uuid primary key,job_id uuid not null references private.reporting_refresh_jobs(id) on delete restrict,binding_id uuid not null references public.project_reporting_bindings(id) on delete restrict,
 attempt_number integer not null check(attempt_number>0),cursor text,claimed_at timestamptz not null,lease_expires_at timestamptz not null,
 unique(job_id,attempt_number),check(lease_expires_at>claimed_at)
);
create index reporting_refresh_attempt_quota_idx on private.reporting_refresh_attempts(binding_id,claimed_at desc);
create table private.reporting_refresh_results(
 claim_id uuid primary key references private.reporting_refresh_attempts(claim_id) on delete restrict,
 outcome text not null check(outcome in ('page','rate_limited','temporary_failure','permission_denied','disconnected','uncertain')),
 input_checksum text not null check(input_checksum~'^[a-f0-9]{64}$'),result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin foreach t in array array['reporting_refresh_jobs','reporting_refresh_requests','reporting_refresh_attempts','reporting_refresh_results'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 if t<>'reporting_refresh_jobs' then execute format('create trigger %I before update or delete on private.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);end if;
end loop;end $$;
create function private.reporting_refresh_ready(p_org uuid,p_project uuid,p_binding uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;p private.reporting_refresh_policies%rowtype;a private.reporting_refresh_adapters%rowtype;q private.reporting_verification_challenges%rowtype;v private.reporting_resource_verifications%rowtype;begin
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found or not private.n6_project_configuration_authorized(p_org,p_project,p_actor) then raise exception 'Current exact project refresh authority required' using errcode='42501';end if;
 c:=private.reporting_refresh_binding(p_org,p_project,p_binding);
 select * into p from private.reporting_refresh_policies where binding_id=p_binding order by revision_number desc limit 1;
 if p.id is null or not p.enabled or p.context_checksum<>c->>'context_checksum' or p.binding_revision_number<>(c->>'binding_revision_number')::integer then raise exception 'Current enabled policy required' using errcode='42501';end if;
 perform private.reporting_refresh_admin(p_org,p_project,p.created_by);
 select * into a from private.reporting_refresh_adapters where source_contract=p.source_contract and provider=c->>'provider' and resource_kind=c->>'resource_kind' and enabled for share;
 if not found then raise exception 'Installed enabled reporting adapter required' using errcode='42501';end if;
 -- Latest completed exact-context receipt wins, including a negative receipt.
 select ch.* into q from private.reporting_verification_challenges ch join private.reporting_resource_verifications vr on vr.challenge_id=ch.id
 where ch.binding_id=p_binding and ch.binding_revision_number=p.binding_revision_number and ch.context_checksum=p.context_checksum and ch.source_contract=a.source_contract and ch.manifest_sha256=a.manifest_sha256 order by vr.observed_at desc,vr.recorded_at desc,ch.id desc limit 1;
 select * into v from private.reporting_resource_verifications where challenge_id=q.id;
 if v.challenge_id is null or not v.resource_matches or not v.observed_reporting_grant or exists(select 1 from private.reporting_refresh_results rr join private.reporting_refresh_attempts ra on ra.claim_id=rr.claim_id where ra.binding_id=p_binding and rr.outcome in ('permission_denied','disconnected') and rr.created_at>=v.observed_at) then raise exception 'Trusted current exact resource/grant verification required' using errcode='42501';end if;
 perform private.reporting_refresh_admin(p_org,p_project,q.actor_id);
 return jsonb_build_object('context',c,'policy',to_jsonb(p),'verification_id',q.id,'manifest_sha256',a.manifest_sha256);
end $$;
create function private.reporting_refresh_job_receipt(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('job_id',id,'binding_id',binding_id,'policy_id',policy_id,'period_start',period_start,'period_end',period_end,'state',state,'trigger',trigger,'created_at',created_at,'updated_at',updated_at,'next_attempt_at',next_attempt_at,'attempt_number',attempt_number,'page_count',page_count,'observation_count',observation_count,'dispatch_authorized',false) from private.reporting_refresh_jobs where id=p_id
$$;
create function private.enqueue_reporting_refresh(p_org uuid,p_project uuid,p_binding uuid,p_policy_id uuid,p_start date,p_end date,p_request uuid,p_actor uuid,p_trigger text) returns jsonb language plpgsql security definer set search_path='' as $$
declare ready jsonb;p private.reporting_refresh_policies%rowtype;prior private.reporting_refresh_requests%rowtype;j private.reporting_refresh_jobs%rowtype;checksum text;today date;last_manual timestamptz;last_success timestamptz;begin
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found or not private.n6_project_configuration_authorized(p_org,p_project,p_actor) then raise exception 'Current exact project refresh authority required' using errcode='42501';end if;
 if p_request is null or p_binding is null or p_policy_id is null or p_trigger is null or p_trigger not in ('manual','scheduled') or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start or p_end-p_start>365 then raise exception 'Exact bounded refresh request required' using errcode='22023';end if;
 checksum:=encode(sha256(convert_to(jsonb_build_array(p_project,p_binding,p_policy_id,p_start,p_end,p_trigger)::text,'UTF8')),'hex');
 select * into prior from private.reporting_refresh_requests where organization_id=p_org and request_id=p_request;
 if found then
 if prior.actor_id<>p_actor or prior.project_id<>p_project then raise exception 'Original refresh request actor required' using errcode='42501';end if;
 if prior.input_checksum<>checksum then raise exception 'Original refresh request changed' using errcode='23505';end if;
 return private.reporting_refresh_job_receipt(prior.job_id)||jsonb_build_object('replayed',true);end if;
 ready:=private.reporting_refresh_ready(p_org,p_project,p_binding,p_actor);
 select * into p from private.reporting_refresh_policies where id=(ready#>>'{policy,id}')::uuid;
 if p.id is distinct from p_policy_id then raise exception 'Refresh policy changed' using errcode='40001';end if;
 today:=timezone(p.reporting_time_zone,clock_timestamp())::date;
 if p_start<today-(p.limits->>'history_days')::integer+1 or p_end>today or p_end-p_start+1>(p.limits->>'max_period_days')::integer then raise exception 'Requested dates outside explicit resource policy' using errcode='22023';end if;
 select * into j from private.reporting_refresh_jobs where binding_id=p_binding and state in ('queued','running','retry','uncertain');
 if found then
 if j.policy_id<>p.id or j.period_start<>p_start or j.period_end<>p_end then raise exception 'Resource has an unresolved different refresh' using errcode='55000';end if;
 else
 if exists(select 1 from private.reporting_refresh_jobs where binding_id=p_binding and failure_count>0 and next_attempt_at>clock_timestamp()) then raise exception 'Resource refresh backoff remains active' using errcode='55000';end if;
 select max(created_at) into last_manual from private.reporting_refresh_jobs where binding_id=p_binding and trigger='manual';
 select max(updated_at) into last_success from private.reporting_refresh_jobs where binding_id=p_binding and state='succeeded';
 if p_trigger='manual' and last_manual+make_interval(secs=>(p.limits->>'manual_min_interval_seconds')::integer)>clock_timestamp() then raise exception 'Manual refresh cooldown' using errcode='55000';end if;
 if p_trigger='scheduled' and last_success+make_interval(secs=>(p.limits->>'cadence_seconds')::integer)>clock_timestamp() then raise exception 'Scheduled refresh not due' using errcode='55000';end if;
 insert into private.reporting_refresh_jobs(organization_id,project_id,binding_id,policy_id,verification_id,actor_id,period_start,period_end,trigger,state) values(p_org,p_project,p_binding,p.id,(ready->>'verification_id')::uuid,p_actor,p_start,p_end,p_trigger,'queued') returning * into j;
 end if;
 if p_trigger='scheduled' and exists(select 1 from private.reporting_refresh_requests where job_id=j.id) then return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('replayed',true);end if;
 insert into private.reporting_refresh_requests(organization_id,project_id,request_id,actor_id,job_id,input_checksum) values(p_org,p_project,p_request,p_actor,j.id,checksum);
 return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('replayed',false);
end $$;
create function public.request_project_reporting_refresh(p_organization_id uuid,p_project_id uuid,p_binding_id uuid,p_policy_id uuid,p_start_date date,p_end_date date,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 return private.enqueue_reporting_refresh(p_organization_id,p_project_id,p_binding_id,p_policy_id,p_start_date,p_end_date,p_request_id,auth.uid(),'manual');
end $$;
create function public.get_project_reporting_refresh_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare job uuid;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 select job_id into job from private.reporting_refresh_requests where organization_id=p_organization_id and project_id=p_project_id and request_id=p_request_id and actor_id=auth.uid();
 if job is null then return null;end if;
 return private.reporting_refresh_job_receipt(job);
end $$;
create function public.claim_project_reporting_refresh(p_job_id uuid,p_claim_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 stamp:=clock_timestamp();select count(*) into quota from private.reporting_refresh_attempts where binding_id=j.binding_id and claimed_at>stamp-interval '24 hours';
 if quota>=(p.limits->>'daily_request_limit')::bigint then
 update private.reporting_refresh_jobs set next_attempt_at=(select min(claimed_at)+interval '24 hours' from private.reporting_refresh_attempts where binding_id=j.binding_id and claimed_at>stamp-interval '24 hours'),updated_at=stamp where id=j.id;
 return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('reason','rolling_day_quota_exhausted');end if;
 if j.page_count>=1000 then update private.reporting_refresh_jobs set state='failed',updated_at=stamp where id=j.id;return private.reporting_refresh_job_receipt(j.id);end if;
 insert into private.reporting_refresh_attempts(claim_id,job_id,binding_id,attempt_number,cursor,claimed_at,lease_expires_at) values(p_claim_id,j.id,j.binding_id,j.attempt_number+1,j.cursor,stamp,stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer));
 update private.reporting_refresh_jobs set state='running',claim_id=p_claim_id,lease_expires_at=stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer),attempt_number=attempt_number+1,updated_at=stamp where id=j.id;
 -- Only the first committed claim response can authorize one dispatch. Replays cannot.
 return private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('dispatch_authorized',true,'claim_id',p_claim_id,'cursor',j.cursor,'lease_expires_at',stamp+make_interval(secs=>(p.limits->>'lease_seconds')::integer),'context',ready->'context','source_contract',p.source_contract,'manifest_sha256',ready->>'manifest_sha256','limits',p.limits,'reporting_time_zone',p.reporting_time_zone);
end $$;
create function public.fail_project_reporting_refresh(p_job_id uuid,p_claim_id uuid,p_reason text,p_retry_after timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.reporting_refresh_jobs%rowtype;p private.reporting_refresh_policies%rowtype;prior private.reporting_refresh_results%rowtype;checksum text;result jsonb;stamp timestamptz;delay_seconds numeric;next_stamp timestamptz;next_state text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted refresh worker only' using errcode='42501';end if;
 if p_reason is null or p_reason not in ('rate_limited','temporary_failure','permission_denied','disconnected','uncertain') or (p_retry_after is not null and (not isfinite(p_retry_after) or p_retry_after>clock_timestamp()+interval '366 days')) then raise exception 'Explicit bounded provider failure required' using errcode='22023';end if;
 select * into j from private.reporting_refresh_jobs where id=p_job_id;
 if not found then raise exception 'Original refresh job required' using errcode='42501';end if;
 perform 1 from public.projects where id=j.project_id and organization_id=j.organization_id for update;
 select * into j from private.reporting_refresh_jobs where id=p_job_id for update;
 checksum:=encode(sha256(convert_to(jsonb_build_array(p_job_id,p_claim_id,p_reason,p_retry_after)::text,'UTF8')),'hex');
 select * into prior from private.reporting_refresh_results where claim_id=p_claim_id;
 if found then if prior.input_checksum<>checksum then raise exception 'Original refresh result changed' using errcode='23505';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if j.claim_id is distinct from p_claim_id or j.state not in ('running','uncertain') then raise exception 'Original unsettled refresh claim required' using errcode='42501';end if;
 select * into p from private.reporting_refresh_policies where id=j.policy_id;
 stamp:=clock_timestamp();next_state:=case when p_reason='uncertain' then 'uncertain' when p_reason in ('permission_denied','disconnected') then 'denied' else 'retry' end;
 delay_seconds:=least((p.limits->>'max_backoff_seconds')::numeric,(p.limits->>'backoff_seconds')::numeric*power(2::numeric,least(j.failure_count,53)));
 next_stamp:=greatest(stamp+make_interval(secs=>delay_seconds::integer),coalesce(p_retry_after,stamp));
 update private.reporting_refresh_jobs set state=next_state,failure_count=failure_count+1,next_attempt_at=case when next_state='retry' then next_stamp else next_attempt_at end,updated_at=stamp where id=j.id;
 result:=private.reporting_refresh_job_receipt(j.id)||jsonb_build_object('automatic_retry',next_state='retry');
 insert into private.reporting_refresh_results(claim_id,outcome,input_checksum,result) values(p_claim_id,p_reason,checksum,result);
 return result||jsonb_build_object('replayed',false);
end $$;
revoke all on function private.reporting_refresh_ready(uuid,uuid,uuid,uuid),private.reporting_refresh_job_receipt(uuid),private.enqueue_reporting_refresh(uuid,uuid,uuid,uuid,date,date,uuid,uuid,text),public.request_project_reporting_refresh(uuid,uuid,uuid,uuid,date,date,uuid),public.get_project_reporting_refresh_operation(uuid,uuid,uuid),public.claim_project_reporting_refresh(uuid,uuid),public.fail_project_reporting_refresh(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.request_project_reporting_refresh(uuid,uuid,uuid,uuid,date,date,uuid),public.get_project_reporting_refresh_operation(uuid,uuid,uuid) to authenticated;
grant execute on function public.claim_project_reporting_refresh(uuid,uuid),public.fail_project_reporting_refresh(uuid,uuid,text,timestamptz) to service_role;
commit;
