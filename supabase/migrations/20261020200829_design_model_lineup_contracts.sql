begin;
set local lock_timeout='5s';
-- Reuse closed owner-private records; no history, permission or rate changes.
create or replace function private.require_design_media_connection(p_org uuid,p_actor uuid,p_request jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; model public.design_model_registry; input jsonb; matched boolean;
begin
 perform private.require_design_media_request_context(p_org,p_actor,p_request);
 select * into c from public.integration_connections where id=(p_request->>'connector_connection_id')::uuid and organization_id=p_org for share;
 if not found or c.provider is distinct from p_request->>'provider' or c.status<>'verified' or c.archived_at is not null or c.secret_name is null then raise exception 'Current verified media connection required' using errcode='42501';end if;
 if c.provider='higgsfield' then
  if c.secret_name !~ '^ANKA_HIGGSFIELD_[A-Z0-9_]+$' or exists(select 1 from public.integration_connection_departments where connection_id=c.id and organization_id=p_org) or exists(select 1 from public.integration_connection_engagements where connection_id=c.id and organization_id=p_org) then raise exception 'Separate organization media connection required' using errcode='42501';end if;
  if p_request->>'model_id' not in ('higgsfield-ai/soul/v2/standard','higgsfield-ai/soul/v2/image-to-image','bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video','ideogram/v4.0','recraft/v4.1/text-to-image','xai/grok-imagine-image-2.0','minimax/h3/text-to-video','lightricks/ltx-2.5/image-to-video/fast','kling-video/v3.0/std/text-to-video','alibaba/wan-3.0/text-to-video','kling-video/v3.0/std/image-to-video','alibaba/wan-3.0/image-to-video') then raise exception 'Unsupported media adapter' using errcode='22023';end if;
 elsif c.provider='openai' then
  select * into model from public.design_model_registry where organization_id=p_org and provider='openai' and model_id=p_request->>'model_id' and is_active and 'image'=any(supported_output_types) for share;
  if not found or c.secret_name !~ '^ANKA_OPENAI_[A-Z0-9_]+$' then raise exception 'Active approved still model required' using errcode='42501';end if;
  perform 1 from public.integration_connection_departments where connection_id=c.id and organization_id=p_org and department_id='design' for share;
  if not found then raise exception 'Existing Design connection scope required' using errcode='42501';end if;
  if p_request#>>'{context,kind}'='private' then
   if exists(select 1 from public.integration_connection_engagements where connection_id=c.id and organization_id=p_org) then raise exception 'Private source cannot use engagement connection' using errcode='42501';end if;
  else
   perform 1 from public.integration_connection_engagements where connection_id=c.id and organization_id=p_org and engagement_id=(p_request#>>'{context,id}')::uuid for share;
   if not found then raise exception 'Exact engagement connection required' using errcode='42501';end if;
  end if;
 else raise exception 'Unsupported media provider' using errcode='22023';end if;
 if jsonb_array_length(p_request->'input_versions')>1 then raise exception 'One exact input image is supported' using errcode='22023';end if;
 if p_request->>'model_id'='higgsfield-ai/soul/v2/image-to-image' and exists(select 1 from jsonb_array_elements(p_request->'input_versions') x where x->>'kind' not in ('design_asset_version','media_output')) then raise exception 'Immutable original image checksum required' using errcode='42501';end if;
 if p_request->>'model_id' in ('ideogram/v4.0','recraft/v4.1/text-to-image','xai/grok-imagine-image-2.0','minimax/h3/text-to-video','lightricks/ltx-2.5/image-to-video/fast','kling-video/v3.0/std/text-to-video','alibaba/wan-3.0/text-to-video','kling-video/v3.0/std/image-to-video','alibaba/wan-3.0/image-to-video') and exists(select 1 from jsonb_array_elements(p_request->'input_versions') x where x->>'kind' not in ('design_asset_version','media_output','private_attachment')) then raise exception 'Exact original checksum required' using errcode='42501';end if;
 for input in select value from jsonb_array_elements(p_request->'input_versions') loop
  if input#>>'{provider_consent,provider}' is distinct from c.provider or input#>>'{provider_consent,source_id}' is distinct from input->>'id' or input#>>'{provider_consent,checksum}' is distinct from input->>'checksum' or input#>>'{provider_consent,allow_transfer}' is distinct from 'true' then raise exception 'Exact selected input/provider consent required' using errcode='42501';end if;
  if input->>'kind'='private_attachment' then
   if p_request->>'model_id' not in ('bytedance/seedance-2.5/image-to-video','lightricks/ltx-2.5/image-to-video/fast','kling-video/v3.0/std/image-to-video','alibaba/wan-3.0/image-to-video') or p_request#>>'{context,kind}' is distinct from 'private' then raise exception 'Private upload animation scope required' using errcode='42501';end if;
   perform private.require_design_private_attachment_owner(p_org,(p_request#>>'{context,id}')::uuid,p_actor);
   perform 1 from public.design_private_attachments a where a.id=(input->>'id')::uuid and a.organization_id=p_org and a.conversation_id=(p_request#>>'{context,id}')::uuid and a.owner_id=p_actor and a.status='ready' and a.extraction_kind='reference_only' and a.verified_mime in ('image/png','image/jpeg') and a.expected_sha256=input->>'checksum' and a.declared_bytes between 1 and 5242880 for share;
  elsif input->>'kind'='media_output' then
   perform public.resolve_design_media_input(p_org,p_actor,p_request->'context',input->>'id',input->>'checksum');
  elsif input->>'kind'='private_image_job' and p_request#>>'{context,kind}'='private' then
   perform 1 from public.design_private_experiment_jobs j where j.id=(input->>'id')::uuid and j.organization_id=p_org and j.owner_id=p_actor and j.status='succeeded' and j.storage_path like p_org::text||'/private/'||p_actor::text||'/%' and j.request_checksum=input->>'checksum' for share;
  elsif input->>'kind'='design_asset_version' and p_request#>>'{context,kind}'='engagement' then
   perform 1 from public.design_asset_versions v join public.design_assets a on a.id=v.asset_id and a.organization_id=v.organization_id where v.id=(input->>'id')::uuid and v.organization_id=p_org and a.engagement_id=(p_request#>>'{context,id}')::uuid and a.archived_at is null and v.content_checksum=input->>'checksum' and v.mime_type='image/png' for share of v,a;
  else raise exception 'Input source scope is not transferable' using errcode='42501';end if;
  if not found then raise exception 'Exact original input is unavailable' using errcode='42501';end if;
 end loop;
end;$$;
create or replace function private.require_design_media_capability(p_request jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare s jsonb:=p_request->'settings';model text:=p_request->>'model_id';provider text:=p_request->>'provider';n integer:=(p_request->>'output_count')::integer;keys text[];expected text[];inputs integer:=jsonb_array_length(p_request->'input_versions');
begin
 select array_agg(k order by k) into keys from jsonb_object_keys(s) k;
 if provider='higgsfield' and model in ('higgsfield-ai/soul/v2/standard','higgsfield-ai/soul/v2/image-to-image') then
  expected:=array['aspect_ratio','enhance_prompt','resolution'];
  if n not in (1,4) or inputs<>(case when model='higgsfield-ai/soul/v2/image-to-image' then 1 else 0 end) or (model='higgsfield-ai/soul/v2/image-to-image' and s->>'enhance_prompt' is distinct from 'true') or s->>'resolution' not in ('720p','1080p') or s->>'aspect_ratio' not in ('9:16','16:9','4:3','3:4','1:1','2:3','3:2') or jsonb_typeof(s->'enhance_prompt') is distinct from 'boolean' then raise exception 'Unsupported image settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model in ('bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video') then
  expected:=case when model like '%/image-to-video' then array['duration_seconds','generate_audio','output_format','resolution'] else array['aspect_ratio','duration_seconds','generate_audio','output_format','resolution'] end;
  if n<>1 or inputs<>(case when model like '%/image-to-video' then 1 else 0 end) or jsonb_typeof(s->'duration_seconds') is distinct from 'number' or (s->>'duration_seconds')::numeric<>trunc((s->>'duration_seconds')::numeric) or (s->>'duration_seconds')::integer not between 4 and 30 or s->>'resolution' not in ('480p','720p','1080p') or (model like '%/text-to-video' and (s->>'resolution'='1080p' or s->>'aspect_ratio' not in ('16:9','4:3','1:1','3:4','9:16','21:9'))) or s->>'output_format' not in ('mp4','mov') or jsonb_typeof(s->'generate_audio') is distinct from 'boolean' then raise exception 'Unsupported video settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='ideogram/v4.0' then
  expected:=array['aspect_ratio','rendering_speed'];
  if n<>1 or inputs<>0 or s->'aspect_ratio' not in ('"1:1"'::jsonb,'"1:2"'::jsonb,'"2:1"'::jsonb,'"2:3"'::jsonb,'"3:2"'::jsonb,'"4:5"'::jsonb,'"5:4"'::jsonb,'"9:16"'::jsonb,'"16:9"'::jsonb,'"5:8"'::jsonb,'"8:5"'::jsonb,'"3:4"'::jsonb,'"4:3"'::jsonb,'"9:22"'::jsonb,'"22:9"'::jsonb,'"9:23"'::jsonb,'"23:9"'::jsonb,'"3:8"'::jsonb,'"8:3"'::jsonb,'"5:12"'::jsonb,'"12:5"'::jsonb,'"1:3"'::jsonb,'"3:1"'::jsonb) or s->'rendering_speed' not in ('"TURBO"'::jsonb,'"DEFAULT"'::jsonb,'"QUALITY"'::jsonb) then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='recraft/v4.1/text-to-image' then
  expected:=array['aspect_ratio','output_format','resolution'];
  if n<>1 or inputs<>0 or s->'resolution' not in ('"1k"'::jsonb) or s->'aspect_ratio' not in ('"1:1"'::jsonb,'"2:1"'::jsonb,'"1:2"'::jsonb,'"3:2"'::jsonb,'"2:3"'::jsonb,'"4:3"'::jsonb,'"3:4"'::jsonb,'"5:4"'::jsonb,'"4:5"'::jsonb,'"6:10"'::jsonb,'"14:10"'::jsonb,'"10:14"'::jsonb,'"16:9"'::jsonb,'"9:16"'::jsonb) or s->'output_format' not in ('"png"'::jsonb) then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='xai/grok-imagine-image-2.0' then
  expected:=array['aspect_ratio','quality','resolution'];
  if n<>1 or inputs<>0 or s->'quality' not in ('"low"'::jsonb,'"medium"'::jsonb) or s->'resolution' not in ('"1k"'::jsonb,'"2k"'::jsonb) or s->'aspect_ratio' not in ('"auto"'::jsonb,'"1:1"'::jsonb,'"1:2"'::jsonb,'"2:1"'::jsonb,'"3:2"'::jsonb,'"2:3"'::jsonb,'"4:3"'::jsonb,'"3:4"'::jsonb,'"16:9"'::jsonb,'"9:16"'::jsonb) then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='minimax/h3/text-to-video' then
  expected:=array['aigc_watermark','aspect_ratio','duration','resolution'];
  if n<>1 or inputs<>0 or (case when jsonb_typeof(s->'duration')='number' then (s->>'duration')::numeric not between 5 and 15 or (s->>'duration')::numeric<>trunc((s->>'duration')::numeric) else true end) or s->'resolution' not in ('"2K"'::jsonb) or s->'aspect_ratio' not in ('"auto"'::jsonb,'"adaptive"'::jsonb,'"21:9"'::jsonb,'"16:9"'::jsonb,'"4:3"'::jsonb,'"1:1"'::jsonb,'"3:4"'::jsonb,'"9:16"'::jsonb) or jsonb_typeof(s->'aigc_watermark') is distinct from 'boolean' then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='lightricks/ltx-2.5/image-to-video/fast' then
  expected:=array['aspect_ratio','duration','fps','generate_audio','resolution'];
  if n<>1 or inputs<>1 or s->'fps' not in ('24'::jsonb,'25'::jsonb,'48'::jsonb,'50'::jsonb) or s->'duration' not in ('6'::jsonb,'8'::jsonb,'10'::jsonb) or s->'resolution' not in ('"720p"'::jsonb,'"1080p"'::jsonb,'"2k"'::jsonb,'"4k"'::jsonb) or s->'aspect_ratio' not in ('"16:9"'::jsonb,'"9:16"'::jsonb) or jsonb_typeof(s->'generate_audio') is distinct from 'boolean' then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='kling-video/v3.0/std/text-to-video' then
  expected:=array['aspect_ratio','cfg_scale','duration','multi_shots','sound'];
  if n<>1 or inputs<>0 or s->'sound' not in ('"on"'::jsonb,'"off"'::jsonb) or (case when jsonb_typeof(s->'duration')='number' then (s->>'duration')::numeric not between 3 and 15 or (s->>'duration')::numeric<>trunc((s->>'duration')::numeric) else true end) or (case when jsonb_typeof(s->'cfg_scale')='number' then (s->>'cfg_scale')::numeric not between 0 and 1 else true end) or s->'multi_shots' not in ('false'::jsonb) or s->'aspect_ratio' not in ('"16:9"'::jsonb,'"9:16"'::jsonb,'"1:1"'::jsonb) then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='alibaba/wan-3.0/text-to-video' then
  expected:=array['aspect_ratio','duration','enable_thinking','generate_audio','resolution'];
  if n<>1 or inputs<>0 or (case when jsonb_typeof(s->'duration')='number' then (s->>'duration')::numeric not between 2 and 30 or (s->>'duration')::numeric<>trunc((s->>'duration')::numeric) else true end) or s->'resolution' not in ('"480p"'::jsonb,'"720p"'::jsonb,'"1080p"'::jsonb) or s->'aspect_ratio' not in ('"16:9"'::jsonb,'"4:3"'::jsonb,'"1:1"'::jsonb,'"3:4"'::jsonb,'"9:16"'::jsonb,'"adaptive"'::jsonb) or jsonb_typeof(s->'generate_audio') is distinct from 'boolean' or s->'enable_thinking' not in ('false'::jsonb) then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='kling-video/v3.0/std/image-to-video' then
  expected:=array['cfg_scale','duration','multi_shots','sound'];
  if n<>1 or inputs<>1 or s->'sound' not in ('"on"'::jsonb,'"off"'::jsonb) or (case when jsonb_typeof(s->'duration')='number' then (s->>'duration')::numeric not between 3 and 15 or (s->>'duration')::numeric<>trunc((s->>'duration')::numeric) else true end) or (case when jsonb_typeof(s->'cfg_scale')='number' then (s->>'cfg_scale')::numeric not between 0 and 1 else true end) or s->'multi_shots' not in ('false'::jsonb) then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model='alibaba/wan-3.0/image-to-video' then
  expected:=array['aspect_ratio','duration','enable_thinking','generate_audio','resolution'];
  if n<>1 or inputs<>1 or (case when jsonb_typeof(s->'duration')='number' then (s->>'duration')::numeric not between 2 and 30 or (s->>'duration')::numeric<>trunc((s->>'duration')::numeric) else true end) or s->'resolution' not in ('"480p"'::jsonb,'"720p"'::jsonb,'"1080p"'::jsonb) or s->'aspect_ratio' not in ('"16:9"'::jsonb,'"4:3"'::jsonb,'"1:1"'::jsonb,'"3:4"'::jsonb,'"9:16"'::jsonb,'"adaptive"'::jsonb) or jsonb_typeof(s->'generate_audio') is distinct from 'boolean' or s->'enable_thinking' not in ('false'::jsonb) then raise exception 'Unsupported exact model settings' using errcode='22023';end if;
 elsif provider='openai' and model in ('gpt-image-1','gpt-image-1-mini','gpt-image-1.5') then
  expected:=array['background','output_format','quality','size'];
  if n not between 1 and 10 or inputs<>0 or s->>'size' not in ('1024x1024','1024x1536','1536x1024') or s->>'quality' not in ('low','medium','high') or s->>'background' not in ('opaque','transparent') or s->>'output_format' is distinct from 'png' then raise exception 'Unsupported still settings' using errcode='22023';end if;
 else raise exception 'No verified adapter for selected model' using errcode='22023';end if;
 if keys is distinct from expected or exists(select 1 from jsonb_each(s) x where x.value='null'::jsonb) then raise exception 'Exact nonautomatic settings required' using errcode='22023';end if;
end;$$;

create or replace function public.complete_design_media_storage(p_org uuid,p_actor uuid,p_job uuid,p_claim uuid,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.design_media_generation_jobs;item jsonb;i integer:=0;prefix text;expected_bucket text;
begin
 select * into job from private.design_media_generation_jobs where id=p_job and organization_id=p_org and actor_id=p_actor for update;
 if not found or job.claim_id is distinct from p_claim then raise exception 'Original dispatch required' using errcode='42501';end if;
 if job.status='ready' and job.output_manifest=p_manifest then return to_jsonb(job);end if;
 if job.status<>'provider_completed' or jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest)<>(job.request->>'output_count')::integer then raise exception 'Exact complete output set required' using errcode='22023';end if;
 prefix:=p_org::text||'/private/'||p_actor::text||'/media/'||p_job::text||'/';
 expected_bucket:=case when job.request->>'model_id' in ('bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video','kling-video/v3.0/std/text-to-video','kling-video/v3.0/std/image-to-video','alibaba/wan-3.0/text-to-video','alibaba/wan-3.0/image-to-video','lightricks/ltx-2.5/image-to-video/fast','minimax/h3/text-to-video') then 'design-generated-video' else 'design-generated-media' end;
 for item in select value from jsonb_array_elements(p_manifest) loop
  if (select count(*) from jsonb_object_keys(item))<>7 or not item ?& array['id','bucket','path','extension','mime_type','checksum','byte_length'] or item->>'id' is distinct from p_job::text||':'||i::text or item->>'bucket' is distinct from expected_bucket or item->>'path' is distinct from prefix||i::text||'.'||(item->>'extension') or coalesce(item->>'checksum','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(item->'byte_length') is distinct from 'number' or (item->>'byte_length')::bigint not between 12 and (case when expected_bucket='design-generated-video' then 52428800 else 10485760 end)
   or (expected_bucket='design-generated-video' and item->>'mime_type' not in ('video/mp4','video/quicktime')) or (expected_bucket='design-generated-media' and item->>'mime_type' not in ('image/png','image/jpeg')) or not ((item->>'extension'='png' and item->>'mime_type'='image/png') or (item->>'extension'='jpg' and item->>'mime_type'='image/jpeg') or (item->>'extension'='mp4' and item->>'mime_type'='video/mp4') or (item->>'extension'='mov' and item->>'mime_type'='video/quicktime')) then raise exception 'Invalid original output manifest' using errcode='22023';end if;
  perform 1 from storage.objects o where o.bucket_id=expected_bucket and o.name=item->>'path' and (o.metadata->>'size')::bigint=(item->>'byte_length')::bigint and o.metadata->>'mimetype'=item->>'mime_type';
  if not found then raise exception 'Verified private original object missing' using errcode='55000';end if;
  i:=i+1;
 end loop;
 update private.design_media_generation_jobs set status='ready',output_manifest=p_manifest where id=p_job returning * into job;return to_jsonb(job);
end;$$;

commit;
