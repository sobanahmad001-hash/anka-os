begin;
set local lock_timeout='5s';
-- Existing authority, prices, histories and grants remain unchanged. No rates seeded.
create or replace function private.require_design_media_connection(p_org uuid,p_actor uuid,p_request jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; model public.design_model_registry; input jsonb; matched boolean;
begin
 perform private.require_design_media_request_context(p_org,p_actor,p_request);
 select * into c from public.integration_connections where id=(p_request->>'connector_connection_id')::uuid and organization_id=p_org for share;
 if not found or c.provider is distinct from p_request->>'provider' or c.status<>'verified' or c.archived_at is not null or c.secret_name is null then raise exception 'Current verified media connection required' using errcode='42501';end if;
 if c.provider='higgsfield' then
  if c.secret_name !~ '^ANKA_HIGGSFIELD_[A-Z0-9_]+$' or exists(select 1 from public.integration_connection_departments where connection_id=c.id and organization_id=p_org) or exists(select 1 from public.integration_connection_engagements where connection_id=c.id and organization_id=p_org) then raise exception 'Separate organization media connection required' using errcode='42501';end if;
  if p_request->>'model_id' not in ('higgsfield-ai/soul/v2/standard','higgsfield-ai/soul/v2/image-to-image','bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video') then raise exception 'Unsupported media adapter' using errcode='22023';end if;
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
 for input in select value from jsonb_array_elements(p_request->'input_versions') loop
  if input#>>'{provider_consent,provider}' is distinct from c.provider or input#>>'{provider_consent,source_id}' is distinct from input->>'id' or input#>>'{provider_consent,checksum}' is distinct from input->>'checksum' or input#>>'{provider_consent,allow_transfer}' is distinct from 'true' then raise exception 'Exact selected input/provider consent required' using errcode='42501';end if;
  if input->>'kind'='media_output' then
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
 elsif provider='openai' and model in ('gpt-image-1','gpt-image-1-mini','gpt-image-1.5') then
  expected:=array['background','output_format','quality','size'];
  if n not between 1 and 10 or inputs<>0 or s->>'size' not in ('1024x1024','1024x1536','1536x1024') or s->>'quality' not in ('low','medium','high') or s->>'background' not in ('opaque','transparent') or s->>'output_format' is distinct from 'png' then raise exception 'Unsupported still settings' using errcode='22023';end if;
 else raise exception 'No verified adapter for selected model' using errcode='22023';end if;
 if keys is distinct from expected or exists(select 1 from jsonb_each(s) x where x.value='null'::jsonb) then raise exception 'Exact nonautomatic settings required' using errcode='22023';end if;
end;$$;
commit;
