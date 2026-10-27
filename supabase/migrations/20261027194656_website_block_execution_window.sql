begin;
-- Fixed execution window exceeds the hosted worker wall limit. Recovery remains read-only.
do $$begin
 if (select md5(prosrc) from pg_proc where oid='public.get_website_block_workspace(uuid,uuid,uuid,uuid,uuid,integer)'::regprocedure)<>'02e9e5c6fab4f206f846fd9a61481beb'
 or (select md5(prosrc) from pg_proc where oid='public.finish_website_block_build(uuid,uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb)'::regprocedure)<>'24c9860d1e8added2159bf29b1739ec6'
 then raise exception 'Exact reviewed W3 prerequisites required';end if;
end$$;
create or replace function public.get_website_block_workspace(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_design_id uuid default null,p_request_id uuid default null,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare designs jsonb;jobs jsonb;observed_at timestamptz;begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),false);
 if p_offset<0 or p_offset>10000 then raise exception 'Bounded history offset required' using errcode='22023';end if;
   -- Serialize recovery against a completion already holding the original job lock.
   if p_request_id is not null then
    perform 1 from private.website_block_inputs i join public.wordpress_export_jobs j on j.id=i.job_id and j.organization_id=i.organization_id
    where i.organization_id=p_organization_id and i.project_id=p_project_id and i.engagement_id=p_engagement_id
     and i.created_by=auth.uid() and i.request_id=p_request_id for share of j;
   end if;
   observed_at:=clock_timestamp();
   select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into designs from (select b.design_id,b.page_id,b.version_number,b.created_at,b.manifest->'content'->>'title' as title,b.manifest->'scope'->>'page_key' as page_key from private.website_native_bindings b where b.organization_id=p_organization_id and b.project_id=p_project_id and b.engagement_id=p_engagement_id order by b.created_at desc,b.design_id limit 20 offset p_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]') into jobs from (select j.id,j.organization_id,j.website_page_design_id,case when (j.status='processing' and i.created_at+interval '10 minutes'<=observed_at) then 'failed' else j.status end as status,j.status as original_status,(j.status='processing' and i.created_at+interval '10 minutes'<=observed_at) as execution_window_expired,j.artifact_sha256,j.seo_verification,case when (j.status='processing' and i.created_at+interval '10 minutes'<=observed_at) then 'Native package execution window expired. Original sources and request are retained; review before a separate new attempt.' else j.failure_reason end as failure_reason,j.requested_at,j.completed_at,private.website_block_stale(i.source) as stale_sources,i.project_id,i.engagement_id,i.page_id,i.request_id,i.created_by from private.website_block_inputs i join public.wordpress_export_jobs j on j.id=i.job_id and j.organization_id=i.organization_id where i.organization_id=p_organization_id and i.project_id=p_project_id and i.engagement_id=p_engagement_id and (p_design_id is null or i.design_id=p_design_id) and(p_request_id is null or i.request_id=p_request_id and i.created_by=auth.uid()) order by j.requested_at desc,j.id limit 20 offset p_offset)x;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'designs',designs,'jobs',jobs,'offset',p_offset,'limit',20,'job_total',(select count(*) from private.website_block_inputs where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id),'design_total',(select count(*) from private.website_native_bindings where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id));
end;$$;
create or replace function public.finish_website_block_build(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_job_id uuid,p_package_sha256 text,p_source_sha256 text,p_package_bytes integer,p_source_bytes integer,p_file_hashes jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.website_block_inputs;j public.wordpress_export_jobs;ctx jsonb;base text;begin
 perform private.website_block_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id,true);
 select * into i from private.website_block_inputs where job_id=p_job_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and created_by=p_actor_id;
 select * into j from public.wordpress_export_jobs where id=i.job_id and organization_id=i.organization_id for update;
 if i.job_id is null or j.status<>'processing' or j.provider_job_id<>'anka-native-block-v1' then raise exception 'Original processing native package required' using errcode='42501';end if;
 ctx:=private.website_block_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id,i.design_id);
 if ctx->>'review_sha256' is distinct from i.review_sha256 or jsonb_array_length(ctx->'stale_sources')>0 then raise exception 'Build sources changed before completion' using errcode='40001';end if;
 if p_package_sha256 is null or p_source_sha256 is null or p_package_bytes is null or p_source_bytes is null or p_package_sha256!~'^[a-f0-9]{64}$' or p_source_sha256!~'^[a-f0-9]{64}$' or p_package_bytes not between 1 and 1048576 or p_source_bytes not between 1 and 524288 or jsonb_typeof(p_file_hashes) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_file_hashes))<>9 or not(p_file_hashes ?& array['anka-page.json','functions.php','parts/footer.html','parts/header.html','source-manifest.json','style.css','templates/index.html','theme.json']) or exists(select 1 from jsonb_each_text(p_file_hashes) h where h.value!~'^[a-f0-9]{64}$' or h.key not in ('anka-page.json','functions.php','parts/footer.html','parts/header.html','source-manifest.json','style.css','templates/index.html','theme.json','templates/anka-home.html','templates/anka-service.html','templates/anka-location.html','templates/anka-article.html','templates/anka-about.html','templates/anka-contact.html')) then raise exception 'Bounded checksummed package manifest required' using errcode='22023';end if;
   if i.created_at+interval '10 minutes'<=clock_timestamp() then raise exception 'Original native build execution window expired' using errcode='55000';end if;
 base:=p_organization_id::text||'/'||i.design_id::text||'/'||j.id::text||'/';
 update public.wordpress_export_jobs set status='complete',storage_path=base||'native-block.zip',artifact_sha256=p_package_sha256,completed_at=clock_timestamp(),seo_verification=jsonb_build_object('compiler','anka-native-block-v1','source_format','zip/source.json','source_sha256',p_source_sha256,'source_path',base||'source.zip','package_bytes',p_package_bytes,'source_bytes',p_source_bytes,'file_hashes',p_file_hashes,'static_checks_passed',true,'delivery_approved',false,'wordpress_installed',false,'staging',false,'published',false) where id=j.id and organization_id=p_organization_id returning * into j;
 return to_jsonb(j)||jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'request_id',i.request_id,'page_id',i.page_id);
end;$$;
revoke all on function public.get_website_block_workspace(uuid,uuid,uuid,uuid,uuid,integer),public.finish_website_block_build(uuid,uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_website_block_workspace(uuid,uuid,uuid,uuid,uuid,integer) to authenticated;
grant execute on function public.finish_website_block_build(uuid,uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb) to service_role;
commit;
