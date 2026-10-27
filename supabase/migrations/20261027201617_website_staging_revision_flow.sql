-- W4 staging is a separate, explicitly bound environment; never a publication path.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if (select md5(prosrc) from pg_proc where oid='private.website_block_actor(uuid,uuid,uuid,uuid,boolean)'::regprocedure)<>'8f5dc822d22c66f39116226f85f935aa' then raise exception 'Reviewed W3 authority prerequisite required';end if;
end$$;

create table private.website_staging_targets(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,
 connection_id uuid not null references public.integration_connections(id),connection_revision timestamptz not null,
 site_id uuid not null,base_url text not null check(length(base_url)<=500 and base_url~'^https://'),version_number integer not null check(version_number>0),
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,created_by,request_id),unique(organization_id,project_id,connection_id,version_number),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id)
);
create table private.website_staging_runs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,
 target_id uuid not null references private.website_staging_targets(id),job_id uuid not null references private.website_block_inputs(job_id),page_id uuid not null,
 previous_run_id uuid references private.website_staging_runs(id),remote_head uuid,review_sha256 text not null check(review_sha256~'^[a-f0-9]{64}$'),
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(request_id),foreign key(page_id,organization_id) references public.project_website_pages(id,organization_id),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id)
);
create table private.website_staging_results(
 run_id uuid primary key references private.website_staging_runs(id),outcome text not null check(outcome in ('staged','failed')),
 evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=16000),
 recorded_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
create table private.website_staging_issues(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references private.website_staging_runs(id),issue_id uuid not null,
 previous_event_id uuid references private.website_staging_issues(id),kind text not null check(kind in ('opened','resolved')),
 note text not null check(length(btrim(note)) between 1 and 2000),request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(created_by,request_id)
);
create index website_staging_targets_scope on private.website_staging_targets(organization_id,project_id,engagement_id,created_at desc);
create index website_staging_targets_actor on private.website_staging_targets(created_by);
create index website_staging_runs_scope on private.website_staging_runs(organization_id,project_id,engagement_id,created_at desc);
create index website_staging_runs_target on private.website_staging_runs(target_id,page_id);
create index website_staging_runs_job on private.website_staging_runs(job_id);
create index website_staging_runs_actor on private.website_staging_runs(created_by);
create index website_staging_runs_previous on private.website_staging_runs(previous_run_id);
create index website_staging_issues_run on private.website_staging_issues(run_id,created_at desc);
create index website_staging_issues_chain on private.website_staging_issues(issue_id,created_at desc);
create index website_staging_issues_previous on private.website_staging_issues(previous_event_id);
create index website_staging_issues_actor on private.website_staging_issues(created_by);
create index website_staging_results_actor on private.website_staging_results(recorded_by);
alter table private.website_staging_targets enable row level security;
alter table private.website_staging_runs enable row level security;
alter table private.website_staging_results enable row level security;
alter table private.website_staging_issues enable row level security;
revoke all on private.website_staging_targets,private.website_staging_runs,private.website_staging_results,private.website_staging_issues from public,anon,authenticated,service_role;
create trigger website_staging_target_immutable before update or delete on private.website_staging_targets for each row execute function private.website_native_immutable();
create trigger website_staging_run_immutable before update or delete on private.website_staging_runs for each row execute function private.website_native_immutable();
create trigger website_staging_result_immutable before update or delete on private.website_staging_results for each row execute function private.website_native_immutable();
create trigger website_staging_issue_immutable before update or delete on private.website_staging_issues for each row execute function private.website_native_immutable();

create function private.website_staging_connection(o uuid,p uuid,e uuid,a uuid,cid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.integration_connections;
begin
 perform private.website_block_actor(o,p,e,a,true);
 select * into c from public.integration_connections where id=cid and organization_id=o and provider='wordpress' and status='verified' and last_check_status='passed' and archived_at is null for share;
 if c.id is null or coalesce(c.public_config->>'username','')='' or c.secret_name!~'^ANKA_WORDPRESS_[A-Z0-9_]+$' or c.secret_name is null then raise exception 'Verified WordPress connection with server-side credential reference required' using errcode='42501';end if;
 perform 1 from public.integration_connection_departments where organization_id=o and connection_id=cid and department_id='development' for share;
 if not found then raise exception 'Current Development connection access required' using errcode='42501';end if;
 perform 1 from public.integration_connection_engagements where organization_id=o and connection_id=cid and engagement_id=e and department_id='development' for share;
 if not found then raise exception 'Explicit selected-project WordPress connection required' using errcode='42501';end if;
 return jsonb_build_object('id',c.id,'display_name',c.display_name,'base_url',rtrim(c.base_url,'/'),'revision',c.updated_at,'username',c.public_config->>'username','secret_name',c.secret_name);
end$$;

create function public.bind_website_staging_target(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_connection_id uuid,p_site_id uuid,p_base_url text,p_connection_revision timestamptz,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;old private.website_staging_targets;row private.website_staging_targets;digest text;
begin
 c:=private.website_staging_connection(p_organization_id,p_project_id,p_engagement_id,p_actor_id,p_connection_id);
 perform 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_actor_id and member_kind='team' and status='active' and role in ('system_owner','operations_admin') for share;
 if not found then raise exception 'Current organization owner or operations admin must bind staging' using errcode='42501';end if;
 if p_site_id is null or p_request_id is null or p_base_url is distinct from c->>'base_url' or p_connection_revision is distinct from (c->>'revision')::timestamptz then raise exception 'Exact verified staging identity and connection revision required' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-staging-target:'||p_organization_id::text||':'||p_project_id::text||':'||p_connection_id::text,0));
 digest:=encode(sha256(convert_to(jsonb_build_array(p_project_id,p_engagement_id,p_connection_id,p_site_id,p_base_url,p_connection_revision)::text,'UTF8')),'hex');
 select * into old from private.website_staging_targets where organization_id=p_organization_id and created_by=p_actor_id and request_id=p_request_id;
 if found then if old.request_sha256<>digest then raise exception 'Original target request has different inputs' using errcode='23505';end if;return to_jsonb(old);end if;
 insert into private.website_staging_targets(organization_id,project_id,engagement_id,connection_id,connection_revision,site_id,base_url,version_number,request_id,request_sha256,created_by)
 values(p_organization_id,p_project_id,p_engagement_id,p_connection_id,p_connection_revision,p_site_id,p_base_url,1+(select coalesce(max(version_number),0) from private.website_staging_targets where organization_id=p_organization_id and project_id=p_project_id and connection_id=p_connection_id),p_request_id,digest,p_actor_id) returning * into row;
 return to_jsonb(row);
end$$;

create function public.get_website_staging_dispatch(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_connection_id uuid default null,p_target_id uuid default null,p_job_id uuid default null,p_remote_head uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.website_staging_targets;i private.website_block_inputs;j public.wordpress_export_jobs;c jsonb;ctx jsonb;digest text;
begin
 if p_target_id is null then
  c:=private.website_staging_connection(p_organization_id,p_project_id,p_engagement_id,p_actor_id,p_connection_id);
  return jsonb_build_object('connection',c);
 end if;
 select * into t from private.website_staging_targets where id=p_target_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id for share;
 if t.id is null then raise exception 'Exact staging target required' using errcode='42501';end if;
 c:=private.website_staging_connection(p_organization_id,p_project_id,p_engagement_id,p_actor_id,t.connection_id);
 if t.connection_revision is distinct from (c->>'revision')::timestamptz or t.base_url is distinct from c->>'base_url' or t.version_number<>(select max(version_number) from private.website_staging_targets where organization_id=p_organization_id and project_id=p_project_id and connection_id=t.connection_id) then raise exception 'Staging connection changed; review a current binding' using errcode='40001';end if;
 if p_job_id is null then return jsonb_build_object('target',to_jsonb(t),'connection',c);end if;
 select * into i from private.website_block_inputs where job_id=p_job_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id for share;
 select * into j from public.wordpress_export_jobs where id=i.job_id and organization_id=i.organization_id and status='complete' and provider_job_id='anka-native-block-v1' for share;
 if j.id is null then raise exception 'Exact completed native package required' using errcode='42501';end if;
 ctx:=private.website_block_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id,i.design_id);
 if ctx->>'review_sha256' is distinct from i.review_sha256 or jsonb_array_length(ctx->'stale_sources')>0 then raise exception 'Native package sources changed; review a new build' using errcode='40001';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(t.id,t.connection_revision,j.id,j.artifact_sha256,i.review_sha256,p_remote_head,'anka-stage-v1')::text,'UTF8')),'hex');
 return jsonb_build_object('target',to_jsonb(t),'connection',c,'job',to_jsonb(j),'source',i.source,'page_id',i.page_id,'review_sha256',digest,'remote_head',p_remote_head);
end$$;

create function public.start_website_staging_run(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_target_id uuid,p_job_id uuid,p_remote_head uuid,p_review_sha256 text,p_previous_run_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;old private.website_staging_runs;row private.website_staging_runs;prior private.website_staging_runs;digest text;
begin
 ctx:=public.get_website_staging_dispatch(p_organization_id,p_project_id,p_engagement_id,p_actor_id,null,p_target_id,p_job_id,p_remote_head);
 if p_request_id is null or p_review_sha256 is null or ctx->>'review_sha256' is distinct from p_review_sha256 then raise exception 'Exact dry-run review required' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-staging-run:'||p_target_id::text||':'||(ctx->>'page_id'),0));
 digest:=encode(sha256(convert_to(jsonb_build_array(p_project_id,p_engagement_id,p_target_id,p_job_id,p_remote_head,p_review_sha256,p_previous_run_id)::text,'UTF8')),'hex');
 select * into old from private.website_staging_runs where organization_id=p_organization_id and created_by=p_actor_id and request_id=p_request_id;
 if found then if old.request_sha256<>digest then raise exception 'Original staging request has different inputs' using errcode='23505';end if;return jsonb_build_object('created',false,'run',to_jsonb(old));end if;
 if exists(select 1 from private.website_staging_runs r where r.target_id=p_target_id and r.page_id=(ctx->>'page_id')::uuid and not exists(select 1 from private.website_staging_results x where x.run_id=r.id)) then raise exception 'Recover original uncertain staging request before another attempt' using errcode='55000';end if;
 if p_previous_run_id is not null then
  select * into prior from private.website_staging_runs where id=p_previous_run_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and page_id=(ctx->>'page_id')::uuid;
  if prior.id is null or prior.request_id is distinct from p_remote_head or not exists(select 1 from private.website_staging_targets t where t.id=prior.target_id and t.connection_id=(ctx->'target'->>'connection_id')::uuid and t.site_id=(ctx->'target'->>'site_id')::uuid) or not exists(select 1 from private.website_staging_results where run_id=prior.id and outcome='staged') then raise exception 'Revision must reference a retained staged version of this exact page' using errcode='42501';end if;
 end if;
 insert into private.website_staging_runs(organization_id,project_id,engagement_id,target_id,job_id,page_id,previous_run_id,remote_head,review_sha256,request_id,request_sha256,created_by)
 values(p_organization_id,p_project_id,p_engagement_id,p_target_id,p_job_id,(ctx->>'page_id')::uuid,p_previous_run_id,p_remote_head,p_review_sha256,p_request_id,digest,p_actor_id) returning * into row;
 return jsonb_build_object('created',true,'run',to_jsonb(row));
end$$;

create function public.get_website_staging_recovery(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.website_staging_runs;ctx jsonb;
begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id,true);
 select * into r from private.website_staging_runs where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and request_id=p_request_id;
 if r.id is null then return null;end if;
 -- Recovery never requires sources to remain current and never redispatches the package.
 ctx:=public.get_website_staging_dispatch(p_organization_id,p_project_id,p_engagement_id,p_actor_id,null,r.target_id,null,null);
 return ctx||jsonb_build_object('run',to_jsonb(r),'result',(select to_jsonb(x) from private.website_staging_results x where run_id=r.id),'source',(select source from private.website_block_inputs where job_id=r.job_id),'job',(select to_jsonb(j) from public.wordpress_export_jobs j where j.id=r.job_id));
end$$;

create function public.record_website_staging_result(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_run_id uuid,p_outcome text,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.website_staging_runs;t private.website_staging_targets;old private.website_staging_results;row private.website_staging_results;
begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id,true);
 select * into r from private.website_staging_runs where id=p_run_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id for share;
 select * into t from private.website_staging_targets where id=r.target_id;
 if r.id is null or p_outcome not in ('staged','failed') or p_outcome is null or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>16000 then raise exception 'Bounded original staging result required' using errcode='22023';end if;
 if (p_evidence->>'request_id')::uuid is distinct from r.request_id or (p_evidence->>'site_id')::uuid is distinct from t.site_id or p_evidence->>'base_url' is distinct from t.base_url or p_evidence->>'published' is distinct from 'false' or p_evidence->>'environment' is distinct from 'staging' then raise exception 'Staging result identity differs' using errcode='40001';end if;
 if p_outcome='staged' and (p_evidence->>'package_sha256' is distinct from (select artifact_sha256 from public.wordpress_export_jobs where id=r.job_id) or p_evidence->>'preview_verified' is distinct from 'true' or p_evidence->>'preview_url' is distinct from t.base_url||'/?anka_staging_preview='||r.request_id::text) then raise exception 'Exact verified staging preview required' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-staging-result:'||r.id::text,0));
 select * into old from private.website_staging_results where run_id=r.id;
 if found then if old.outcome is distinct from p_outcome or old.evidence is distinct from p_evidence then raise exception 'Original staging result is immutable' using errcode='23505';end if;return to_jsonb(old);end if;
 insert into private.website_staging_results(run_id,outcome,evidence,recorded_by) values(r.id,p_outcome,p_evidence,p_actor_id) returning * into row;
 return to_jsonb(row);
end$$;

create function public.get_website_staging_workspace(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare targets jsonb;jobs jsonb;runs jsonb;issues jsonb;connections jsonb;
begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),false);
 if p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'Bounded staging history offset required' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into targets from(select t.*,c.display_name,(c.updated_at=t.connection_revision and c.status='verified' and c.last_check_status='passed' and c.archived_at is null and exists(select 1 from public.integration_connection_departments d where d.organization_id=c.organization_id and d.connection_id=c.id and d.department_id='development') and exists(select 1 from public.integration_connection_engagements e where e.organization_id=c.organization_id and e.connection_id=c.id and e.engagement_id=p_engagement_id and e.department_id='development') and t.version_number=(select max(x.version_number) from private.website_staging_targets x where x.organization_id=t.organization_id and x.project_id=t.project_id and x.connection_id=t.connection_id)) as current from private.website_staging_targets t join public.integration_connections c on c.id=t.connection_id and c.organization_id=t.organization_id where t.organization_id=p_organization_id and t.project_id=p_project_id and t.engagement_id=p_engagement_id order by t.created_at desc,t.id limit 20 offset p_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into jobs from(select j.id,i.page_id,i.source->'manifest'->'scope'->>'page_key' as page_key,i.source->'manifest'->'content'->>'title' as title,j.artifact_sha256,j.requested_at,private.website_block_stale(i.source) as stale_sources from private.website_block_inputs i join public.wordpress_export_jobs j on j.id=i.job_id and j.organization_id=i.organization_id where i.organization_id=p_organization_id and i.project_id=p_project_id and i.engagement_id=p_engagement_id and j.status='complete' and j.provider_job_id='anka-native-block-v1' order by j.requested_at desc,j.id limit 20 offset p_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into runs from(select r.*,i.source->'manifest'->'scope'->>'page_key' as page_key,i.source->'manifest'->'content'->>'title' as title,coalesce(z.outcome,case when r.created_at+interval '10 minutes'<=clock_timestamp() then 'uncertain' else 'processing' end) as status,z.evidence,private.website_block_stale(i.source) as stale_sources from private.website_staging_runs r join private.website_block_inputs i on i.job_id=r.job_id left join private.website_staging_results z on z.run_id=r.id where r.organization_id=p_organization_id and r.project_id=p_project_id and r.engagement_id=p_engagement_id order by r.created_at desc,r.id limit 20 offset p_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into issues from(select v.*,r.page_id from private.website_staging_issues v join private.website_staging_runs r on r.id=v.run_id where r.organization_id=p_organization_id and r.project_id=p_project_id and r.engagement_id=p_engagement_id order by v.created_at desc,v.id limit 20 offset p_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into connections from(select c.id,c.display_name,c.base_url,c.status from public.integration_connections c where exists(select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.member_kind='team' and m.status='active' and m.role in ('system_owner','operations_admin')) and c.organization_id=p_organization_id and c.provider='wordpress' and c.status='verified' and c.archived_at is null and exists(select 1 from public.integration_connection_departments d where d.organization_id=c.organization_id and d.connection_id=c.id and d.department_id='development') and exists(select 1 from public.integration_connection_engagements e where e.organization_id=c.organization_id and e.connection_id=c.id and e.engagement_id=p_engagement_id and e.department_id='development'))x;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'targets',targets,'jobs',jobs,'runs',runs,'issues',issues,'connections',connections,'offset',p_offset,'has_more',greatest((select count(*) from private.website_staging_issues v join private.website_staging_runs r on r.id=v.run_id where r.organization_id=p_organization_id and r.project_id=p_project_id and r.engagement_id=p_engagement_id),(select count(*) from private.website_staging_targets where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id),(select count(*) from private.website_staging_runs where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id),(select count(*) from private.website_block_inputs i join public.wordpress_export_jobs j on j.id=i.job_id where i.organization_id=p_organization_id and i.project_id=p_project_id and i.engagement_id=p_engagement_id and j.status='complete'))>p_offset+20);
end$$;

create function public.record_website_staging_issue(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_run_id uuid,p_issue_id uuid,p_expected_event_id uuid,p_kind text,p_note text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.website_staging_runs;old private.website_staging_issues;head private.website_staging_issues;row private.website_staging_issues;digest text;event_id uuid:=gen_random_uuid();
begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),true);
 select * into r from private.website_staging_runs where id=p_run_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;
 if r.id is null or not exists(select 1 from private.website_staging_results where run_id=r.id and outcome='staged') then raise exception 'Exact retained staged page required' using errcode='42501';end if;
 if p_request_id is null or p_kind not in ('opened','resolved') or p_kind is null or p_note is null or length(btrim(p_note)) not between 1 and 2000 then raise exception 'Bounded explicit issue or revision note required' using errcode='22023';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(p_run_id,p_issue_id,p_expected_event_id,p_kind,p_note)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('website-staging-issue-request:'||auth.uid()::text||':'||p_request_id::text,0));
 select * into old from private.website_staging_issues where created_by=auth.uid() and request_id=p_request_id;
 if found then if old.request_sha256<>digest then raise exception 'Original issue request has different inputs' using errcode='23505';end if;return to_jsonb(old);end if;
 if p_kind='opened' then
  if p_issue_id is not null or p_expected_event_id is not null then raise exception 'New issue cannot replace an existing event' using errcode='22023';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended('website-staging-issue:'||p_issue_id::text,0));
  select * into head from private.website_staging_issues where issue_id=p_issue_id and run_id=r.id order by created_at desc,id desc limit 1;
  if head.id is null or head.kind<>'opened' or head.id is distinct from p_expected_event_id then raise exception 'Issue changed; review the current event before resolving' using errcode='40001';end if;
 end if;
 insert into private.website_staging_issues(id,run_id,issue_id,previous_event_id,kind,note,request_id,request_sha256,created_by) values(event_id,r.id,coalesce(p_issue_id,event_id),p_expected_event_id,p_kind,p_note,p_request_id,digest,auth.uid()) returning * into row;
 return to_jsonb(row);
end$$;

revoke all on function private.website_staging_connection(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.bind_website_staging_target(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid),public.get_website_staging_dispatch(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.start_website_staging_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid),public.get_website_staging_recovery(uuid,uuid,uuid,uuid,uuid),public.record_website_staging_result(uuid,uuid,uuid,uuid,uuid,text,jsonb),public.get_website_staging_workspace(uuid,uuid,uuid,integer),public.record_website_staging_issue(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bind_website_staging_target(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid),public.get_website_staging_dispatch(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.start_website_staging_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid),public.get_website_staging_recovery(uuid,uuid,uuid,uuid,uuid),public.record_website_staging_result(uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.get_website_staging_workspace(uuid,uuid,uuid,integer),public.record_website_staging_issue(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid) to authenticated;
commit;
