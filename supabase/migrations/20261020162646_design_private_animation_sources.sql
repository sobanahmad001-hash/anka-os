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
  if input->>'kind'='private_attachment' then
   if p_request->>'model_id' is distinct from 'bytedance/seedance-2.5/image-to-video' or p_request#>>'{context,kind}' is distinct from 'private' then raise exception 'Private upload animation scope required' using errcode='42501';end if;
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
commit;
