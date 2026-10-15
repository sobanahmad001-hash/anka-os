begin;
set local lock_timeout='5s';
-- Unified media keeps the existing shared reservation ledger. Legacy jobs and
-- their spend/history identities are not rewritten or reparented.
create table private.design_media_generation_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references auth.users(id),operation_key uuid not null,
 quote_id uuid not null,request jsonb not null,prompt text not null check(length(prompt) between 1 and 12000),
 claim_id uuid not null unique default gen_random_uuid(),status text not null default 'claimed'
 check(status in ('claimed','provider_pending','provider_completed','ready','provider_failed','safety_refused','outcome_unknown')),
 provider_receipt jsonb,output_manifest jsonb,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,actor_id,operation_key),unique(id,organization_id),
 foreign key(quote_id,organization_id) references private.design_media_quotes(id,organization_id)
);
alter table private.design_media_generation_jobs enable row level security;
revoke all on private.design_media_generation_jobs from public,anon,authenticated,service_role;
create function private.guard_design_media_generation_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Media request history is retained';end if;
 if (new.id,new.organization_id,new.actor_id,new.operation_key,new.quote_id,new.request,new.prompt,new.claim_id,new.created_at)
 is distinct from (old.id,old.organization_id,old.actor_id,old.operation_key,old.quote_id,old.request,old.prompt,old.claim_id,old.created_at)
 or (old.output_manifest is not null and new.output_manifest is distinct from old.output_manifest)
 or (old.provider_receipt->>'requestId' is not null and new.provider_receipt->>'requestId' is distinct from old.provider_receipt->>'requestId')
 or (old.provider_receipt->>'statusUrl' is not null and new.provider_receipt->>'statusUrl' is distinct from old.provider_receipt->>'statusUrl')
 then raise exception 'Media identity and original receipts are immutable';end if;
 if not ((old.status='claimed' and new.status in ('provider_pending','provider_completed','provider_failed','safety_refused','outcome_unknown'))
 or (old.status='provider_pending' and new.status in ('provider_pending','provider_completed','provider_failed','safety_refused','outcome_unknown'))
 or (old.status='outcome_unknown' and old.provider_receipt->>'requestId' is not null and new.status in ('provider_pending','provider_completed','provider_failed','safety_refused'))
 or (old.status='provider_completed' and new.status='ready')) then raise exception 'Invalid media transition';end if;
 new.updated_at:=clock_timestamp();return new;
end;$$;
create trigger guard_design_media_generation_job before update or delete on private.design_media_generation_jobs for each row execute function private.guard_design_media_generation_job();
alter table private.ai_execution_budget_reservations add column design_media_job_id uuid unique references private.design_media_generation_jobs(id),
 drop constraint ai_execution_budget_reservations_one_source,
 add constraint ai_execution_budget_reservations_one_source check(num_nonnulls(run_plan_id,design_video_job_id,design_media_job_id)=1);

-- Does not resolve a credential. Rechecks the established connector scopes.
create function private.require_design_media_connection(p_org uuid,p_actor uuid,p_request jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.integration_connections; model public.design_model_registry; input jsonb; matched boolean;
begin
 perform private.require_design_media_request_context(p_org,p_actor,p_request);
 select * into c from public.integration_connections where id=(p_request->>'connector_connection_id')::uuid and organization_id=p_org for share;
 if not found or c.provider is distinct from p_request->>'provider' or c.status<>'verified' or c.archived_at is not null or c.secret_name is null then raise exception 'Current verified media connection required' using errcode='42501';end if;
 if c.provider='higgsfield' then
  if c.secret_name !~ '^ANKA_HIGGSFIELD_[A-Z0-9_]+$' or exists(select 1 from public.integration_connection_departments where connection_id=c.id and organization_id=p_org) or exists(select 1 from public.integration_connection_engagements where connection_id=c.id and organization_id=p_org) then raise exception 'Separate organization media connection required' using errcode='42501';end if;
  if p_request->>'model_id' not in ('higgsfield-ai/soul/v2/standard','bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video') then raise exception 'Unsupported media adapter' using errcode='22023';end if;
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
revoke all on function private.require_design_media_connection(uuid,uuid,jsonb) from public,anon,authenticated,service_role;


create function private.require_design_media_capability(p_request jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare s jsonb:=p_request->'settings';model text:=p_request->>'model_id';provider text:=p_request->>'provider';n integer:=(p_request->>'output_count')::integer;keys text[];expected text[];inputs integer:=jsonb_array_length(p_request->'input_versions');
begin
 select array_agg(k order by k) into keys from jsonb_object_keys(s) k;
 if provider='higgsfield' and model='higgsfield-ai/soul/v2/standard' then
  expected:=array['aspect_ratio','enhance_prompt','resolution'];
  if n not in (1,4) or inputs<>0 or s->>'resolution' not in ('720p','1080p') or s->>'aspect_ratio' not in ('9:16','16:9','4:3','3:4','1:1','2:3','3:2') or jsonb_typeof(s->'enhance_prompt') is distinct from 'boolean' then raise exception 'Unsupported image settings' using errcode='22023';end if;
 elsif provider='higgsfield' and model in ('bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video') then
  expected:=case when model like '%/image-to-video' then array['duration_seconds','generate_audio','output_format','resolution'] else array['aspect_ratio','duration_seconds','generate_audio','output_format','resolution'] end;
  if n<>1 or inputs<>(case when model like '%/image-to-video' then 1 else 0 end) or jsonb_typeof(s->'duration_seconds') is distinct from 'number' or (s->>'duration_seconds')::numeric<>trunc((s->>'duration_seconds')::numeric) or (s->>'duration_seconds')::integer not between 4 and 30 or s->>'resolution' not in ('480p','720p','1080p') or (model like '%/text-to-video' and (s->>'resolution'='1080p' or s->>'aspect_ratio' not in ('16:9','4:3','1:1','3:4','9:16','21:9'))) or s->>'output_format' not in ('mp4','mov') or jsonb_typeof(s->'generate_audio') is distinct from 'boolean' then raise exception 'Unsupported video settings' using errcode='22023';end if;
 elsif provider='openai' and model in ('gpt-image-1','gpt-image-1-mini','gpt-image-1.5') then
  expected:=array['background','output_format','quality','size'];
  if n not between 1 and 10 or inputs<>0 or s->>'size' not in ('1024x1024','1024x1536','1536x1024') or s->>'quality' not in ('low','medium','high') or s->>'background' not in ('opaque','transparent') or s->>'output_format' is distinct from 'png' then raise exception 'Unsupported still settings' using errcode='22023';end if;
 else raise exception 'No verified adapter for selected model' using errcode='22023';end if;
 if keys is distinct from expected or exists(select 1 from jsonb_each(s) x where x.value='null'::jsonb) then raise exception 'Exact nonautomatic settings required' using errcode='22023';end if;
end;$$;
revoke all on function private.require_design_media_capability(jsonb) from public,anon,authenticated,service_role;
create function public.prepare_design_media_request(p_org uuid,p_actor uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.design_creative_brief_versions;prompt text;request jsonb;
begin
 if (select count(*) from jsonb_object_keys(p_request))<>10 or not p_request ?& array['organization_id','context','creative_brief_version_id','connector_connection_id','provider','model_id','settings','output_count','input_versions','prompt_checksum'] then raise exception 'Exact media selection required' using errcode='22023';end if;
 perform private.require_design_media_connection(p_org,p_actor,p_request);
 perform private.require_design_media_capability(p_request);
 select * into v from public.design_creative_brief_versions where id=(p_request->>'creative_brief_version_id')::uuid and organization_id=p_org;
 prompt:=concat_ws(E'\n\n','Purpose: '||(v.content->>'purpose'),'Audience: '||(v.content->>'audience'),'Instructions: '||(v.content->>'instructions'),'Constraints: '||(v.content->>'exclusions_constraints'),'Required text: '||(v.content->>'required_text'));
 if nullif(btrim(v.content->>'instructions'),'') is null or length(prompt) not between 1 and 12000 then raise exception 'Confirmed brief instructions are required' using errcode='22023';end if;
 request:=p_request||jsonb_build_object('prompt_checksum',encode(sha256(convert_to(prompt,'UTF8')),'hex'));
 return jsonb_build_object('request',request,'prompt',prompt,'creative_brief_id',v.creative_brief_id);
end;$$;
revoke all on function public.prepare_design_media_request(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_design_media_request(uuid,uuid,jsonb) to service_role;

create function public.claim_design_media_generation(p_org uuid,p_actor uuid,p_operation uuid,p_quote uuid,p_request jsonb,p_prompt text,p_acceptance jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.design_media_generation_jobs;q private.design_media_quotes;budget private.ai_execution_budget_limits;
 cycle date:=date_trunc('month',timezone('UTC',clock_timestamp()))::date;total numeric;unlinked numeric;unknown_count bigint;reservation uuid;
begin
 if p_operation is null or p_prompt is null or length(btrim(p_prompt)) not between 1 and 12000 or encode(sha256(convert_to(p_prompt,'UTF8')),'hex') is distinct from p_request->>'prompt_checksum' then raise exception 'Exact operation and confirmed prompt required' using errcode='22023';end if;
 perform private.require_design_media_connection(p_org,p_actor,p_request);
 perform private.require_design_media_capability(p_request);
 if public.prepare_design_media_request(p_org,p_actor,p_request)->>'prompt' is distinct from p_prompt then raise exception 'Prompt differs from the confirmed brief' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_actor::text||':'||p_operation::text,0));
 select * into job from private.design_media_generation_jobs where organization_id=p_org and actor_id=p_actor and operation_key=p_operation;
 if found then
  if job.request is distinct from p_request or job.prompt<>p_prompt or job.quote_id<>p_quote then raise exception 'Operation belongs to another media request' using errcode='23505';end if;
  return to_jsonb(job)||jsonb_build_object('must_not_submit',true);
 end if;
 select * into budget from private.ai_execution_budget_limits where organization_id=p_org for update;
 if not found then raise exception 'Organization spend tracking is not configured' using errcode='42501';end if;
 perform public.accept_design_media_quote(p_org,p_actor,p_quote,p_operation,p_request,p_acceptance);
 select * into q from private.design_media_quotes where id=p_quote and organization_id=p_org and actor_id=p_actor;
 if exists(select 1 from private.ai_execution_budget_reservations where organization_id=p_org and cycle_month<>cycle and status in ('reserved','uncertain')) or exists(select 1 from private.ai_execution_step_budget_reservations where organization_id=p_org and cycle_month<>cycle and status in ('reserved','uncertain')) then raise exception 'Prior-cycle unresolved costs require reconciliation' using errcode='55000';end if;
 select coalesce(sum(case when status='settled' then actual_cost_microusd else max_cost_microusd end),0) into total from private.ai_execution_budget_reservations where organization_id=p_org and cycle_month=cycle and status in ('reserved','uncertain','settled');
 select total+coalesce(sum(case when status='settled' then actual_cost_microusd else max_cost_microusd end),0) into total from private.ai_execution_step_budget_reservations where organization_id=p_org and cycle_month=cycle and status in ('reserved','uncertain','settled');
 select count(*) filter(where run.estimated_cost_microusd is null),coalesce(sum(run.estimated_cost_microusd),0) into unknown_count,unlinked from public.ai_runs run where run.organization_id=p_org and run.created_at>=timezone('UTC',cycle::timestamp) and run.created_at<timezone('UTC',cycle::timestamp+interval '1 month') and run.status='completed' and not exists(select 1 from private.ai_execution_budget_reservations r where r.ai_run_id=run.id) and not exists(select 1 from private.ai_execution_step_budget_reservations r where r.ai_run_id=run.id);
 if unknown_count>0 then raise exception 'Unmeasured AI cost requires reconciliation' using errcode='55000';end if;
 if budget.spend_guard_mode='local_monthly_cap' and total+unlinked+q.total_max_charge_microusd>budget.monthly_limit_microusd then raise exception 'Media would exceed organization monthly cap' using errcode='22003';end if;
 insert into private.design_media_generation_jobs(organization_id,actor_id,operation_key,quote_id,request,prompt) values(p_org,p_actor,p_operation,p_quote,p_request,p_prompt) returning * into job;
 insert into private.ai_execution_budget_reservations(organization_id,actor_id,cycle_month,design_media_job_id,max_cost_microusd,status) values(p_org,p_actor,cycle,job.id,q.total_max_charge_microusd,'reserved') returning id into reservation;
 insert into private.ai_execution_budget_events(reservation_id,organization_id,transition) values(reservation,p_org,'reserved');
 return to_jsonb(job)||jsonb_build_object('must_not_submit',false);
end;$$;
revoke all on function public.claim_design_media_generation(uuid,uuid,uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.claim_design_media_generation(uuid,uuid,uuid,uuid,jsonb,text,jsonb) to service_role;

create function private.require_design_media_history(p_org uuid,p_actor uuid,p_request jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare b public.design_creative_briefs;
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id where o.id=p_org and o.status='active' and m.user_id=p_actor and m.status='active' and m.member_kind='team' and (m.role in ('system_owner','operations_admin','executive') or m.department_id='design') for share of m,o;
 if not found then raise exception 'Current Design authority required' using errcode='42501';end if;
 select root.* into b from public.design_creative_briefs root join public.design_creative_brief_versions v on v.creative_brief_id=root.id and v.organization_id=root.organization_id where v.id=(p_request->>'creative_brief_version_id')::uuid and v.organization_id=p_org;
 if not found or (b.visibility='private' and (b.created_by<>p_actor or p_request#>>'{context,kind}' is distinct from 'private')) or (b.visibility='official' and (p_request#>>'{context,kind}' is distinct from 'engagement' or p_request#>>'{context,id}' is distinct from b.engagement_id::text)) then raise exception 'Original media history is outside this scope' using errcode='42501';end if;
 if b.visibility='private' then
  perform 1 from public.department_chat_conversations where id=(p_request#>>'{context,id}')::uuid and organization_id=p_org and owner_id=p_actor and department_id='design' and context_kind='department_private' for share;
  if not found then raise exception 'Original private context unavailable' using errcode='42501';end if;
 end if;
end;$$;
revoke all on function private.require_design_media_history(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.get_design_media_generation(p_org uuid,p_actor uuid,p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.design_media_generation_jobs;
begin
 select * into job from private.design_media_generation_jobs where organization_id=p_org and actor_id=p_actor and operation_key=p_operation;
 if not found then raise exception 'Original media request unavailable' using errcode='42501';end if;
 perform private.require_design_media_history(p_org,p_actor,job.request);
 return to_jsonb(job);
end;$$;
revoke all on function public.get_design_media_generation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_design_media_generation(uuid,uuid,uuid) to service_role;

-- New outputs remain owner-private originals. Existing bucket privacy and object
-- policies are retained; adding JPEG does not grant a reader or overwrite right.
update storage.buckets set allowed_mime_types=array(select distinct value from unnest(coalesce(allowed_mime_types,'{}'::text[])||array['image/jpeg']) value) where id='design-generated-media' and not public;
create function public.record_design_media_generation(p_org uuid,p_actor uuid,p_job uuid,p_claim uuid,p_state text,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.design_media_generation_jobs;reservation uuid;
begin
 select * into job from private.design_media_generation_jobs where id=p_job and organization_id=p_org and actor_id=p_actor for update;
 if not found or job.claim_id is distinct from p_claim then raise exception 'Original dispatch claim required' using errcode='42501';end if;
 if p_state not in ('provider_pending','provider_completed','provider_failed','safety_refused','outcome_unknown') or (p_receipt is not null and jsonb_typeof(p_receipt)<>'object') then raise exception 'Invalid provider receipt' using errcode='22023';end if;
 if job.request->>'provider'='higgsfield' and p_state<>'outcome_unknown' and (coalesce(p_receipt->>'requestId','') !~ '^[A-Za-z0-9_-]{1,128}$' or (p_receipt ? 'statusUrl' and p_receipt->>'statusUrl' is distinct from 'https://api.higgsfield.ai/requests/'||(p_receipt->>'requestId')||'/status')) then raise exception 'Original provider identity required' using errcode='22023';end if;
 if job.status=p_state and job.provider_receipt is not distinct from p_receipt then return to_jsonb(job);end if;
 update private.design_media_generation_jobs set status=p_state,provider_receipt=coalesce(p_receipt,provider_receipt) where id=p_job returning * into job;
 -- Provider success/failure alone is not a verified bill. Keep the complete bound
 -- held as uncertain until existing operator reconciliation has actual evidence.
 update private.ai_execution_budget_reservations set status='uncertain',reconciled_at=clock_timestamp(),outcome_evidence='Original media request recorded; actual provider billing awaits reconciliation'
 where design_media_job_id=p_job and organization_id=p_org and status='reserved' returning id into reservation;
 if reservation is not null then insert into private.ai_execution_budget_events(reservation_id,organization_id,transition,evidence) values(reservation,p_org,'uncertain','Original media provider receipt recorded');end if;
 return to_jsonb(job);
end;$$;
revoke all on function public.record_design_media_generation(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_design_media_generation(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
create function public.complete_design_media_storage(p_org uuid,p_actor uuid,p_job uuid,p_claim uuid,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.design_media_generation_jobs;item jsonb;i integer:=0;prefix text;expected_bucket text;
begin
 select * into job from private.design_media_generation_jobs where id=p_job and organization_id=p_org and actor_id=p_actor for update;
 if not found or job.claim_id is distinct from p_claim then raise exception 'Original dispatch required' using errcode='42501';end if;
 if job.status='ready' and job.output_manifest=p_manifest then return to_jsonb(job);end if;
 if job.status<>'provider_completed' or jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest)<>(job.request->>'output_count')::integer then raise exception 'Exact complete output set required' using errcode='22023';end if;
 prefix:=p_org::text||'/private/'||p_actor::text||'/media/'||p_job::text||'/';
 expected_bucket:=case when job.request->>'model_id' like 'bytedance/%' then 'design-generated-video' else 'design-generated-media' end;
 for item in select value from jsonb_array_elements(p_manifest) loop
  if (select count(*) from jsonb_object_keys(item))<>7 or not item ?& array['id','bucket','path','extension','mime_type','checksum','byte_length'] or item->>'id' is distinct from p_job::text||':'||i::text or item->>'bucket' is distinct from expected_bucket or item->>'path' is distinct from prefix||i::text||'.'||(item->>'extension') or coalesce(item->>'checksum','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(item->'byte_length') is distinct from 'number' or (item->>'byte_length')::bigint not between 12 and (case when expected_bucket='design-generated-video' then 52428800 else 10485760 end)
   or (expected_bucket='design-generated-video' and item->>'mime_type' not in ('video/mp4','video/quicktime')) or (expected_bucket='design-generated-media' and item->>'mime_type' not in ('image/png','image/jpeg')) or not ((item->>'extension'='png' and item->>'mime_type'='image/png') or (item->>'extension'='jpg' and item->>'mime_type'='image/jpeg') or (item->>'extension'='mp4' and item->>'mime_type'='video/mp4') or (item->>'extension'='mov' and item->>'mime_type'='video/quicktime')) then raise exception 'Invalid original output manifest' using errcode='22023';end if;
  perform 1 from storage.objects o where o.bucket_id=expected_bucket and o.name=item->>'path' and (o.metadata->>'size')::bigint=(item->>'byte_length')::bigint and o.metadata->>'mimetype'=item->>'mime_type';
  if not found then raise exception 'Verified private original object missing' using errcode='55000';end if;
  i:=i+1;
 end loop;
 update private.design_media_generation_jobs set status='ready',output_manifest=p_manifest where id=p_job returning * into job;return to_jsonb(job);
end;$$;
revoke all on function public.complete_design_media_storage(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.complete_design_media_storage(uuid,uuid,uuid,uuid,jsonb) to service_role;

create function public.list_design_media_generations(p_org uuid,p_actor uuid,p_context jsonb,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item private.design_media_generation_jobs;items jsonb:='[]'::jsonb;kind text:=p_context->>'kind';
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id where o.id=p_org and o.status='active' and m.user_id=p_actor and m.status='active' and m.member_kind='team' and (m.role in ('system_owner','operations_admin','executive') or m.department_id='design') for share of m,o;
 if not found then raise exception 'Current Design authority required' using errcode='42501';end if;
 if (p_before is null)<>(p_before_id is null) or jsonb_typeof(p_context) is distinct from 'object' or kind is null or kind not in ('private','engagement') or nullif(p_context->>'id','') is null then raise exception 'Exact history scope and cursor required' using errcode='22023';end if;
 if kind='private' then
  if (select count(*) from jsonb_object_keys(p_context))<>2 then raise exception 'Exact private history scope required' using errcode='22023';end if;
  perform 1 from public.department_chat_conversations where id=(p_context->>'id')::uuid and organization_id=p_org and owner_id=p_actor and department_id='design' and context_kind='department_private' for share;
 else
  if (select count(*) from jsonb_object_keys(p_context))<>3 or nullif(p_context->>'service_id','') is null then raise exception 'Exact service history scope required' using errcode='22023';end if;
  perform 1 from public.engagement_services es join public.engagements e on e.id=es.engagement_id and e.organization_id=es.organization_id join public.service_catalog sc on sc.id=es.service_id where es.id=(p_context->>'service_id')::uuid and es.organization_id=p_org and e.id=(p_context->>'id')::uuid and sc.department_id='design' for share of es,e,sc;
 end if;
 if not found then raise exception 'Original media context unavailable' using errcode='42501';end if;
 for item in select * from private.design_media_generation_jobs where organization_id=p_org and actor_id=p_actor and request->'context'=p_context and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 25 loop
  perform private.require_design_media_history(p_org,p_actor,item.request);
  items:=items||jsonb_build_array(jsonb_build_object('id',item.id,'operation_key',item.operation_key,'status',item.status,'request',item.request,'created_at',item.created_at,'outputs',(select coalesce(jsonb_agg(jsonb_build_object('id',o->>'id','checksum',o->>'checksum','mime_type',o->>'mime_type')),'[]'::jsonb) from jsonb_array_elements(coalesce(item.output_manifest,'[]'::jsonb)) o)));
 end loop;
 return items;
end;$$;
revoke all on function public.list_design_media_generations(uuid,uuid,jsonb,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_design_media_generations(uuid,uuid,jsonb,timestamptz,uuid) to service_role;

create function public.resolve_design_media_input(p_org uuid,p_actor uuid,p_context jsonb,p_source text,p_checksum text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.design_media_generation_jobs;original jsonb;
begin
 if p_source is null or p_source !~ '^[a-f0-9-]{36}:[0-9]{1,2}$' or p_checksum is null or p_checksum !~ '^[a-f0-9]{64}$' then raise exception 'Exact original image required' using errcode='22023';end if;
 select * into job from private.design_media_generation_jobs where id=split_part(p_source,':',1)::uuid and organization_id=p_org and actor_id=p_actor and status='ready' and request->'context'=p_context for share;
 if not found then raise exception 'Original image is outside current scope' using errcode='42501';end if;
 perform private.require_design_media_history(p_org,p_actor,job.request);
 select value into original from jsonb_array_elements(job.output_manifest) where value->>'id'=p_source and value->>'checksum'=p_checksum and value->>'bucket'='design-generated-media' and value->>'mime_type' in ('image/png','image/jpeg');
 if original is null or original->>'path' not like p_org::text||'/private/'||p_actor::text||'/media/'||job.id::text||'/%' then raise exception 'Exact original image unavailable' using errcode='42501';end if;
 return original;
end;$$;
revoke all on function public.resolve_design_media_input(uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_design_media_input(uuid,uuid,jsonb,text,text) to service_role;

-- Same verified-bill reconciliation contract as existing video reservations.
create function public.reconcile_design_media_budget(
  p_organization_id uuid, p_job_id uuid, p_actor_id uuid,
  p_claim_id uuid, p_actual_cost_microusd bigint, p_evidence text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  budget private.ai_execution_budget_limits;
  job private.design_media_generation_jobs;
  reservation private.ai_execution_budget_reservations;
  evidence text:=btrim(coalesce(p_evidence,''));
begin
  if p_organization_id is null or p_job_id is null or p_actor_id is null
    or p_claim_id is null or p_actual_cost_microusd is null
    or p_actual_cost_microusd<0 or length(evidence) not between 1 and 1000 then
    raise exception 'Verified media billing evidence is required' using errcode='22023';
  end if;
  select * into budget from private.ai_execution_budget_limits
    where organization_id=p_organization_id for update;
  if not found then raise exception 'Organization budget is unavailable' using errcode='42501'; end if;
  select * into job from private.design_media_generation_jobs
    where id=p_job_id and organization_id=p_organization_id for update;
  if not found or job.actor_id<>p_actor_id
    or job.claim_id<>p_claim_id
    or job.status not in ('provider_completed','ready','provider_failed',
      'safety_refused','outcome_unknown') then
    raise exception 'Terminal claimed media evidence is required' using errcode='42501';
  end if;
  select * into reservation from private.ai_execution_budget_reservations
    where design_media_job_id=p_job_id and organization_id=p_organization_id for update;
  if not found or reservation.actor_id<>p_actor_id
    or p_actual_cost_microusd>reservation.max_cost_microusd then
    raise exception 'Cost exceeds the exact media reservation' using errcode='22003';
  end if;
  if reservation.status='settled' then
    if reservation.actual_cost_microusd<>p_actual_cost_microusd
      or reservation.outcome_evidence<>evidence then
      raise exception 'Conflicting media cost reconciliation' using errcode='23505';
    end if;
    return jsonb_build_object('status','settled','idempotent_replay',true);
  end if;
  if reservation.status not in ('reserved','uncertain') then
    raise exception 'Media cost is not reconcilable' using errcode='55000';
  end if;
  update private.ai_execution_budget_reservations
    set status='settled',actual_cost_microusd=p_actual_cost_microusd,
      outcome_evidence=evidence,reconciled_at=clock_timestamp()
    where id=reservation.id;
  insert into private.ai_execution_budget_events(
    reservation_id,organization_id,transition,actual_cost_microusd,evidence)
    values(reservation.id,p_organization_id,'settled',p_actual_cost_microusd,evidence);
  return jsonb_build_object('status','settled',
    'actual_cost_microusd',p_actual_cost_microusd,'idempotent_replay',false);
end;
$$;
revoke all on function public.reconcile_design_media_budget(
  uuid,uuid,uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_design_media_budget(
  uuid,uuid,uuid,uuid,bigint,text)
  to service_role;

commit;
