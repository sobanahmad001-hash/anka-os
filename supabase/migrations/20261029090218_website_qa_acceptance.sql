-- QA acceptance is a human technical review of one retained preview, not publication authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if (select md5(prosrc) from pg_proc where oid='private.website_block_actor(uuid,uuid,uuid,uuid,boolean)'::regprocedure)<>'8f5dc822d22c66f39116226f85f935aa'
 or (select md5(prosrc) from pg_proc where oid='public.save_development_artifact_version(uuid,uuid,uuid,text,text,jsonb,text,text,boolean,uuid)'::regprocedure)<>'b77ec9e7af6b60289d9e746c3d8c4c0e'
 or (select md5(prosrc) from pg_proc where oid='public.record_website_staging_issue(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure)<>'ada66fedfcf516507808030b8cdb7e89' then raise exception 'Reviewed Website QA prerequisites differ';end if;
end$$;

create table private.website_qa_acceptances(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,
 run_id uuid not null references private.website_staging_runs(id),
 artifact_version_id uuid not null,
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(created_by,request_id),
 foreign key(artifact_version_id,organization_id) references public.artifact_versions(id,organization_id),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id)
);
create index website_qa_acceptances_run on private.website_qa_acceptances(run_id,created_at desc);
create index website_qa_acceptances_version on private.website_qa_acceptances(artifact_version_id,organization_id);
alter table private.website_qa_acceptances enable row level security;
revoke all on private.website_qa_acceptances from public,anon,authenticated,service_role;
create trigger website_qa_acceptance_immutable before update or delete on private.website_qa_acceptances for each row execute function private.website_native_immutable();

create function private.website_qa_context(o uuid,p uuid,e uuid,a uuid,rid uuid,aid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.website_staging_runs;result private.website_staging_results;ctx jsonb;art public.artifacts;head public.artifact_versions;issues jsonb;choices jsonb;snapshot jsonb;
begin
 perform private.website_block_actor(o,p,e,a,true);
 select * into r from private.website_staging_runs where id=rid and organization_id=o and project_id=p and engagement_id=e;
 if r.id is null then raise exception 'Exact staged page required' using errcode='42501';end if;
 ctx:=public.get_website_staging_dispatch(o,p,e,a,null,r.target_id,r.job_id,null);
 -- Same serialization key as staging dispatch, then the row shared with revision notes.
 perform pg_advisory_xact_lock(hashtextextended('website-staging-run:'||r.target_id::text||':'||r.page_id::text,0));
 perform 1 from private.website_staging_runs where id=r.id for update;
 select * into result from private.website_staging_results where run_id=r.id;
 if result.outcome is distinct from 'staged' or result.evidence->>'preview_verified' is distinct from 'true' or result.evidence->>'published' is distinct from 'false'
 or result.evidence->>'environment' is distinct from 'staging' or result.evidence->>'package_sha256' is distinct from ctx->'job'->>'artifact_sha256'
 or result.evidence->>'site_id' is distinct from ctx->'target'->>'site_id' or result.evidence->>'base_url' is distinct from ctx->'target'->>'base_url'
 or result.evidence->>'preview_url' is distinct from (ctx->'target'->>'base_url')||'/?anka_staging_preview='||r.request_id::text then raise exception 'Exact verified private preview receipt required' using errcode='40001';end if;
 if jsonb_typeof(result.evidence->'unresolved_paths') is distinct from 'array' or result.evidence->'unresolved_paths'<>'[]'::jsonb then raise exception 'Resolve staging links before QA acceptance' using errcode='40001';end if;
 if exists(select 1 from private.website_staging_runs x where x.target_id=r.target_id and x.page_id=r.page_id and (x.created_at,x.id)>(r.created_at,r.id)) then raise exception 'A newer page attempt needs review' using errcode='40001';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.issue_id),'[]') into issues from(select distinct on(issue_id) issue_id,id,kind from private.website_staging_issues where run_id=r.id order by issue_id,created_at desc,id desc)x;
 if exists(select 1 from jsonb_array_elements(issues)x where x->>'kind'<>'resolved') then raise exception 'Resolve recorded page issues before QA acceptance' using errcode='40001';end if;
 if aid is not null then
  select * into art from public.artifacts where id=aid and organization_id=o and engagement_id=e and artifact_type='launch_checklist' and brand_id=(select brand_id from public.engagements where id=e and organization_id=o);
  if art.id is null then raise exception 'Exact Development launch checklist required' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(art.id::text,0));
  select * into head from public.artifact_versions where organization_id=o and artifact_id=art.id order by version_number desc limit 1;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into choices from(select id,title from public.artifacts where organization_id=o and engagement_id=e and artifact_type='launch_checklist' order by id limit 100)x;
 snapshot:=jsonb_build_object('organization_id',o,'project_id',p,'engagement_id',e,'run_id',r.id,'page_id',r.page_id,'job_id',r.job_id,'package_sha256',ctx->'job'->>'artifact_sha256','source_review_sha256',ctx->'source'->>'review_sha256','target_id',r.target_id,'site_id',ctx->'target'->>'site_id','base_url',ctx->'target'->>'base_url','preview_request_id',r.request_id,'preview_url',result.evidence->>'preview_url','issue_heads',issues,'artifact_id',art.id,'artifact_version_id',head.id,'remote_head_verified',false,'publication_authorized',false);
 return jsonb_build_object('snapshot',snapshot,'review_sha256',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),'artifacts',choices,'records',coalesce((select jsonb_agg(to_jsonb(x)) from(select q.id,q.run_id,q.artifact_version_id,q.created_at,q.created_by from private.website_qa_acceptances q where q.organization_id=o and q.project_id=p and q.engagement_id=e and q.run_id=r.id order by q.created_at desc,q.id limit 20)x),'[]'));
end$$;

create function public.get_website_qa_review(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_run_id uuid,p_artifact_id uuid default null) returns jsonb language sql security definer set search_path='' as $$
 select private.website_qa_context(p_organization_id,p_project_id,p_engagement_id,auth.uid(),p_run_id,p_artifact_id)
$$;

create function public.get_website_qa_record(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare row private.website_qa_acceptances;
begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),false);
 perform pg_advisory_xact_lock(hashtextextended('website-qa-request:'||auth.uid()::text||':'||p_request_id::text,0));
 select * into row from private.website_qa_acceptances where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and created_by=auth.uid() and request_id=p_request_id;
 return case when row.id is null then null else to_jsonb(row) end;
end$$;

create function public.save_website_qa_acceptance(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_run_id uuid,p_artifact_id uuid,p_expected_version_id uuid,p_review_sha256 text,p_evidence jsonb,p_confirmed boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid();digest text;prior private.website_qa_acceptances;row private.website_qa_acceptances;ctx jsonb;snapshot jsonb;latest public.artifact_versions;content jsonb;saved jsonb;k text;
begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,a,false);
 if p_request_id is null or p_confirmed is distinct from true or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' then raise exception 'Explicit exact QA review and original request required' using errcode='22023';end if;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then raise exception 'Manual QA evidence object required' using errcode='22023';end if;
 if octet_length(p_evidence::text)>12000 or (select count(*) from jsonb_object_keys(p_evidence))<>7 then raise exception 'Seven bounded manual QA evidence notes required' using errcode='22023';end if;
 foreach k in array array['responsive','keyboard','structure','motion','links_metadata','security','performance'] loop
  if jsonb_typeof(p_evidence->k) is distinct from 'string' or length(btrim(p_evidence->>k)) not between 10 and 1000 then raise exception 'Complete each manual QA evidence note' using errcode='22023';end if;
 end loop;
 digest:=encode(sha256(convert_to(jsonb_build_array(p_organization_id,p_project_id,p_engagement_id,p_run_id,p_artifact_id,p_expected_version_id,p_review_sha256,p_evidence,p_confirmed)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('website-qa-request:'||a::text||':'||p_request_id::text,0));
 select * into prior from private.website_qa_acceptances where created_by=a and request_id=p_request_id;
 if found then
  if prior.organization_id<>p_organization_id or prior.project_id<>p_project_id or prior.engagement_id<>p_engagement_id or prior.request_sha256<>digest then raise exception 'Original QA request owns different inputs' using errcode='23505';end if;
  return to_jsonb(prior);
 end if;
 -- Serialize first QA checklist creation; existing checklist saves use their original lock.
 perform pg_advisory_xact_lock(hashtextextended('website-qa-artifact:'||p_engagement_id::text,0));
 ctx:=private.website_qa_context(p_organization_id,p_project_id,p_engagement_id,a,p_run_id,p_artifact_id);snapshot:=ctx->'snapshot';
 if ctx->>'review_sha256' is distinct from p_review_sha256 or (snapshot->>'artifact_version_id')::uuid is distinct from p_expected_version_id then raise exception 'QA source, issue history or checklist changed; review again' using errcode='40001';end if;
 if p_artifact_id is null and exists(select 1 from public.artifacts where organization_id=p_organization_id and engagement_id=p_engagement_id and artifact_type='launch_checklist') then raise exception 'Select the existing launch checklist and review it' using errcode='40001';end if;
 select * into latest from public.artifact_versions where id=p_expected_version_id and organization_id=p_organization_id and artifact_id=p_artifact_id;
 content:=coalesce(latest.content,'{}')||jsonb_build_object('website_qa',jsonb_build_object('schema','anka-website-qa-v1','snapshot',snapshot,'review_sha256',p_review_sha256,'manual_evidence',p_evidence,'accepted_by',a,'accepted_at',clock_timestamp(),'assessment','human_reported_pass','delivery_approved',false,'publication_authorized',false));
 saved:=public.save_development_artifact_version(p_engagement_id,null,p_artifact_id,'launch_checklist','Website QA launch checklist',content,'Record human QA acceptance for exact retained page preview',coalesce(latest.data_classification,'internal'),false,a);
 insert into private.website_qa_acceptances(organization_id,project_id,engagement_id,run_id,artifact_version_id,request_id,request_sha256,created_by) values(p_organization_id,p_project_id,p_engagement_id,p_run_id,(saved->'version'->>'id')::uuid,p_request_id,digest,a) returning * into row;
 return to_jsonb(row);
end$$;

revoke all on function private.website_qa_context(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_website_qa_review(uuid,uuid,uuid,uuid,uuid),public.get_website_qa_record(uuid,uuid,uuid,uuid),public.save_website_qa_acceptance(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_website_qa_review(uuid,uuid,uuid,uuid,uuid),public.get_website_qa_record(uuid,uuid,uuid,uuid),public.save_website_qa_acceptance(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean,uuid) to authenticated;

-- Revision-note writes share the selected run lock with QA acceptance.
do $patch$
declare definition text;
begin
 select pg_get_functiondef('public.record_website_staging_issue(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'and engagement_id=p_engagement_id;','and engagement_id=p_engagement_id for update;');
 if definition not like '%and engagement_id=p_engagement_id for update;%' then raise exception 'Reviewed issue serialization patch did not match';end if;
 execute definition;
end$patch$;
commit;
