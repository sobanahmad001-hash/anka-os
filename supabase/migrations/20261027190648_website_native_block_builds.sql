-- W3 internal review packages reuse canonical page designs and WordPress export jobs.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if md5(replace(pg_get_functiondef('private.website_native_actor(uuid,uuid,uuid,uuid,boolean)'::regprocedure),chr(13),''))<>'a44b39376c60b7f55de3d17e7885a63c' or md5(replace(pg_get_functiondef('private.website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'dde03f16e30bebfa602954f77e18d634' or md5(replace(pg_get_functiondef('private.website_native_immutable()'::regprocedure),chr(13),''))<>'8dc97efaf6d9ba89ac717afe11f836be' then raise exception 'Exact native build prerequisites differ' using errcode='55000';end if;
end;$$;
create table private.website_block_inputs(
 job_id uuid primary key,organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,design_id uuid not null,page_id uuid not null,
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),review_sha256 text not null check(review_sha256~'^[a-f0-9]{64}$'),
 source jsonb not null check(jsonb_typeof(source)='object' and octet_length(source::text)<=524288),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,created_by,request_id),
 foreign key(job_id,organization_id) references public.wordpress_export_jobs(id,organization_id),
 foreign key(design_id) references private.website_native_bindings(design_id),
 foreign key(page_id,organization_id) references public.project_website_pages(id,organization_id),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id)
);
create index website_block_scope on private.website_block_inputs(organization_id,project_id,engagement_id,created_at desc);
create index website_block_design on private.website_block_inputs(design_id);
create index website_block_page on private.website_block_inputs(page_id,organization_id);
create index website_block_actor on private.website_block_inputs(created_by);
alter table private.website_block_inputs enable row level security;
revoke all on private.website_block_inputs from public,anon,authenticated,service_role;
create trigger website_block_immutable before update or delete on private.website_block_inputs for each row execute function private.website_native_immutable();

create function private.website_block_actor(o uuid,p uuid,e uuid,a uuid,w boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.website_native_actor(o,p,e,a,false);
 if w then
  perform 1 from public.projects where id=p and organization_id=o and archived_at is null for share;
  if not found then raise exception 'Current unarchived build project required' using errcode='42501';end if;
  perform 1 from public.organization_memberships m where m.organization_id=o and m.user_id=a and m.status='active' and m.member_kind='team' and (m.role in ('system_owner','operations_admin','executive') or m.department_id='development') for share;
  if not found then raise exception 'Current Development build authority required' using errcode='42501';end if;
  perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id where es.organization_id=o and es.engagement_id=e and es.status='active' and sc.is_active and sc.department_id='development' and sc.slug in ('staging_production_builds','setup_development_website_page_build','setup_development_theme_setup') for share of es,sc;
  if not found then raise exception 'Selected active Website implementation service required' using errcode='42501';end if;
 end if;
end;$$;
create function private.website_block_stale(s jsonb) returns text[] language sql stable set search_path='' as $$
select array_remove(array[
 case when (s->'manifest'->'sources'->'architecture'->>'version_id')::uuid is distinct from (select v.id from public.artifact_versions v where v.organization_id=(s->>'organization_id')::uuid and v.artifact_id=(select artifact_id from public.artifact_versions where id=(s->'manifest'->'sources'->'architecture'->>'version_id')::uuid and organization_id=(s->>'organization_id')::uuid) order by v.version_number desc limit 1) then 'Architecture' end,
 case when (s->'manifest'->'sources'->'content'->>'version_id')::uuid is distinct from (select v.id from public.artifact_versions v where v.organization_id=(s->>'organization_id')::uuid and v.artifact_id=(select artifact_id from public.artifact_versions where id=(s->'manifest'->'sources'->'content'->>'version_id')::uuid and organization_id=(s->>'organization_id')::uuid) order by v.version_number desc limit 1) then 'Content' end,
 case when (s->'manifest'->'sources'->'site_system'->>'version_id')::uuid is distinct from (select id from private.website_site_versions where organization_id=(s->>'organization_id')::uuid and project_id=(s->>'project_id')::uuid order by version_number desc limit 1) then 'Site settings' end,
 case when (s->>'design_id')::uuid is distinct from (select design_id from private.website_native_bindings where organization_id=(s->>'organization_id')::uuid and page_id=(s->>'page_id')::uuid order by version_number desc limit 1) then 'Design' end,
 case when not exists(select 1 from public.design_creative_briefs b where b.organization_id=(s->>'organization_id')::uuid and b.engagement_id=(s->>'engagement_id')::uuid and b.current_version_id=(s->'manifest'->'sources'->'brief'->>'version_id')::uuid and b.frozen_version_id=b.current_version_id) then 'Brief' end
],null)
$$;

create function private.website_block_context(o uuid,p uuid,e uuid,a uuid,d uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.website_native_bindings;ctx jsonb;result jsonb;stale text[];
begin
 perform private.website_block_actor(o,p,e,a,false);
 select * into b from private.website_native_bindings where design_id=d and organization_id=o and project_id=p and engagement_id=e for share;
 if b.design_id is null then raise exception 'Exact saved native Website design required' using errcode='42501';end if;
 ctx:=private.website_native_source(o,p,e,a,b.page_id,b.architecture_version_id,b.content_version_id,b.brief_version_id,b.site_version_id);
 stale:=array_remove(array[case when b.architecture_version_id is distinct from (ctx->>'architecture_head')::uuid then 'Architecture' end,case when b.content_version_id is distinct from (ctx->>'content_head')::uuid then 'Content' end,case when b.site_version_id is distinct from (ctx->>'site_head')::uuid then 'Site settings' end,case when b.design_id is distinct from (ctx->>'design_head')::uuid then 'Design' end],null);
 result:=jsonb_build_object('organization_id',o,'project_id',p,'engagement_id',e,'design_id',d,'page_id',b.page_id,'design_version',b.version_number,'manifest',b.manifest,'context',ctx,'stale_sources',stale,'compiler','anka-native-block-v1','delivery_approved',false,'staging',false,'published',false);
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
create function public.get_website_block_review(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_design_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.website_block_context(p_organization_id,p_project_id,p_engagement_id,auth.uid(),p_design_id)$$;

create function public.get_website_block_workspace(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_design_id uuid default null,p_request_id uuid default null,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare designs jsonb;jobs jsonb;begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),false);
 if p_offset<0 or p_offset>10000 then raise exception 'Bounded history offset required' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into designs from (select b.design_id,b.page_id,b.version_number,b.created_at,b.manifest->'content'->>'title' as title,b.manifest->'scope'->>'page_key' as page_key from private.website_native_bindings b where b.organization_id=p_organization_id and b.project_id=p_project_id and b.engagement_id=p_engagement_id order by b.created_at desc,b.design_id limit 20 offset p_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]') into jobs from (select j.id,j.organization_id,j.website_page_design_id,j.status,j.artifact_sha256,j.seo_verification,j.failure_reason,j.requested_at,j.completed_at,private.website_block_stale(i.source) as stale_sources,i.project_id,i.engagement_id,i.page_id,i.request_id,i.created_by from private.website_block_inputs i join public.wordpress_export_jobs j on j.id=i.job_id and j.organization_id=i.organization_id where i.organization_id=p_organization_id and i.project_id=p_project_id and i.engagement_id=p_engagement_id and (p_design_id is null or i.design_id=p_design_id) and(p_request_id is null or i.request_id=p_request_id and i.created_by=auth.uid()) order by j.requested_at desc,j.id limit 20 offset p_offset)x;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'designs',designs,'jobs',jobs,'offset',p_offset,'limit',20,'job_total',(select count(*) from private.website_block_inputs where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id),'design_total',(select count(*) from private.website_native_bindings where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id));
end;$$;

create function public.start_website_block_build(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_design_id uuid,p_request_id uuid,p_review_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare old private.website_block_inputs;ctx jsonb;job public.wordpress_export_jobs;digest text;begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id,true);
 if p_request_id is null or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' then raise exception 'Exact reviewed build and request required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-block:'||p_organization_id::text||':'||p_actor_id::text||':'||p_request_id::text,0));
 digest:=encode(sha256(convert_to(jsonb_build_array(p_project_id,p_engagement_id,p_design_id,p_review_sha256,'anka-native-block-v1')::text,'UTF8')),'hex');
 select * into old from private.website_block_inputs where organization_id=p_organization_id and created_by=p_actor_id and request_id=p_request_id;
 if found then
  if old.request_sha256<>digest then raise exception 'Original request owns different build inputs' using errcode='23505';end if;
  select * into job from public.wordpress_export_jobs where id=old.job_id and organization_id=p_organization_id;
  return jsonb_build_object('created',false,'job',to_jsonb(job),'source',old.source);
 end if;
 ctx:=private.website_block_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id,p_design_id);
 if ctx->>'review_sha256' is distinct from p_review_sha256 or jsonb_array_length(ctx->'stale_sources')>0 then raise exception 'Website sources changed; review current exact versions' using errcode='40001';end if;
 insert into public.wordpress_export_jobs(organization_id,website_page_design_id,provider,provider_job_id,status,requested_by) values(p_organization_id,p_design_id,'native','anka-native-block-v1','processing',p_actor_id) returning * into job;
 insert into private.website_block_inputs(job_id,organization_id,project_id,engagement_id,design_id,page_id,request_id,request_sha256,review_sha256,source,created_by) values(job.id,p_organization_id,p_project_id,p_engagement_id,p_design_id,(ctx->>'page_id')::uuid,p_request_id,digest,p_review_sha256,ctx,p_actor_id);
 return jsonb_build_object('created',true,'job',to_jsonb(job),'source',ctx);
end;$$;

create function public.finish_website_block_build(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_job_id uuid,p_package_sha256 text,p_source_sha256 text,p_package_bytes integer,p_source_bytes integer,p_file_hashes jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.website_block_inputs;j public.wordpress_export_jobs;ctx jsonb;base text;begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id,true);
 select * into i from private.website_block_inputs where job_id=p_job_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and created_by=p_actor_id;
 select * into j from public.wordpress_export_jobs where id=i.job_id and organization_id=i.organization_id for update;
 if i.job_id is null or j.status<>'processing' or j.provider_job_id<>'anka-native-block-v1' then raise exception 'Original processing native package required' using errcode='42501';end if;
 ctx:=private.website_block_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id,i.design_id);
 if ctx->>'review_sha256' is distinct from i.review_sha256 or jsonb_array_length(ctx->'stale_sources')>0 then raise exception 'Build sources changed before completion' using errcode='40001';end if;
 if p_package_sha256 is null or p_source_sha256 is null or p_package_bytes is null or p_source_bytes is null or p_package_sha256!~'^[a-f0-9]{64}$' or p_source_sha256!~'^[a-f0-9]{64}$' or p_package_bytes not between 1 and 1048576 or p_source_bytes not between 1 and 524288 or jsonb_typeof(p_file_hashes) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_file_hashes))<>9 or not(p_file_hashes ?& array['anka-page.json','functions.php','parts/footer.html','parts/header.html','source-manifest.json','style.css','templates/index.html','theme.json']) or exists(select 1 from jsonb_each_text(p_file_hashes) h where h.value!~'^[a-f0-9]{64}$' or h.key not in ('anka-page.json','functions.php','parts/footer.html','parts/header.html','source-manifest.json','style.css','templates/index.html','theme.json','templates/anka-home.html','templates/anka-service.html','templates/anka-location.html','templates/anka-article.html','templates/anka-about.html','templates/anka-contact.html')) then raise exception 'Bounded checksummed package manifest required' using errcode='22023';end if;
 base:=p_organization_id::text||'/'||i.design_id::text||'/'||j.id::text||'/';
 update public.wordpress_export_jobs set status='complete',storage_path=base||'native-block.zip',artifact_sha256=p_package_sha256,completed_at=clock_timestamp(),seo_verification=jsonb_build_object('compiler','anka-native-block-v1','source_format','zip/source.json','source_sha256',p_source_sha256,'source_path',base||'source.zip','package_bytes',p_package_bytes,'source_bytes',p_source_bytes,'file_hashes',p_file_hashes,'static_checks_passed',true,'delivery_approved',false,'wordpress_installed',false,'staging',false,'published',false) where id=j.id and organization_id=p_organization_id returning * into j;
 return to_jsonb(j)||jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'request_id',i.request_id,'page_id',i.page_id);
end;$$;
create function public.fail_website_block_build(p_organization_id uuid,p_actor_id uuid,p_job_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 update public.wordpress_export_jobs j set status='failed',failure_reason='Native package could not complete. Original sources and request are retained; review before a separate new attempt.',completed_at=clock_timestamp() where j.id=p_job_id and j.organization_id=p_organization_id and j.status='processing' and j.provider_job_id='anka-native-block-v1' and exists(select 1 from private.website_block_inputs i where i.job_id=j.id and i.organization_id=j.organization_id and i.created_by=p_actor_id);
end;$$;
create function public.get_website_block_artifact(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_job_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.website_block_inputs;j public.wordpress_export_jobs;begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),false);
 select * into i from private.website_block_inputs where job_id=p_job_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;
 select * into j from public.wordpress_export_jobs where id=i.job_id and organization_id=i.organization_id and status='complete' and provider_job_id='anka-native-block-v1';
 if j.id is null then raise exception 'Exact completed native package unavailable' using errcode='42501';end if;
 return to_jsonb(j)||jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'page_id',i.page_id,'request_id',i.request_id,'source_versions',i.source->'manifest'->'sources','stale_sources',private.website_block_stale(i.source),'delivery_approved',false,'staging',false,'published',false);
end;$$;

revoke all on function private.website_block_stale(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.website_block_actor(uuid,uuid,uuid,uuid,boolean),private.website_block_context(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_website_block_review(uuid,uuid,uuid,uuid),public.get_website_block_workspace(uuid,uuid,uuid,uuid,uuid,integer),public.get_website_block_artifact(uuid,uuid,uuid,uuid),public.start_website_block_build(uuid,uuid,uuid,uuid,uuid,uuid,text),public.finish_website_block_build(uuid,uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb),public.fail_website_block_build(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_website_block_review(uuid,uuid,uuid,uuid),public.get_website_block_workspace(uuid,uuid,uuid,uuid,uuid,integer),public.get_website_block_artifact(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.start_website_block_build(uuid,uuid,uuid,uuid,uuid,uuid,text),public.finish_website_block_build(uuid,uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb),public.fail_website_block_build(uuid,uuid,uuid) to service_role;
commit;
