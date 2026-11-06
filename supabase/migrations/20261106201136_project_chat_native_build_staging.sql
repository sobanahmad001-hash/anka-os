begin;set local lock_timeout='500ms';set local statement_timeout='120s';
-- Read-only production preimages captured for unchanged canonical prerequisites.
do $guard$
declare expected jsonb; actual jsonb;
begin
 for expected in select value from jsonb_array_elements($preimages$[{"name":"private.content_n3_source_ids","signature":"private.content_n3_source_ids(jsonb,boolean)","body_md5":"965ebee5bf841ff89ace0ca02527b073","owner":"postgres","prosecdef":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"private.project_chat_design_brand_sources_actor","signature":"private.project_chat_design_brand_sources_actor(uuid,uuid,uuid,uuid[])","body_md5":"0f3add75765ca0e11c89fe041136572b","owner":"postgres","prosecdef":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"private.project_chat_design_metadata_actor","signature":"private.project_chat_design_metadata_actor(uuid,uuid,uuid,jsonb,uuid[])","body_md5":"31b7bb686537d8244e95f6f2ec701541","owner":"postgres","prosecdef":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"private.project_chat_design_owner_actor","signature":"private.project_chat_design_owner_actor(uuid,uuid,uuid,uuid,uuid,boolean)","body_md5":"51811024d55e81ff83b6cabcb5e2a6f3","owner":"postgres","prosecdef":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"private.project_chat_design_sources_actor","signature":"private.project_chat_design_sources_actor(uuid,uuid,uuid,uuid[])","body_md5":"d6fe4fffe4783fef4665c02d7809335a","owner":"postgres","prosecdef":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"private.require_pipeline_approved_artifact","signature":"private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)","body_md5":"3c25851a2b7019b656d2f5c876a20377","owner":"postgres","prosecdef":true,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"private.website_block_actor","signature":"private.website_block_actor(uuid,uuid,uuid,uuid,boolean)","body_md5":"8f5dc822d22c66f39116226f85f935aa","owner":"postgres","prosecdef":true,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"private.website_block_context","signature":"private.website_block_context(uuid,uuid,uuid,uuid,uuid)","body_md5":"2accfddfc974df270948c4c7a514ee48","owner":"postgres","prosecdef":true,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"private.website_block_stale","signature":"private.website_block_stale(jsonb)","body_md5":"e335eaf6c8667651420b0e5a5a263e22","owner":"postgres","prosecdef":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}"},{"name":"public.finish_website_block_build","signature":"public.finish_website_block_build(uuid,uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb)","body_md5":"798133b89dc83b01416c3e69c6e55f20","owner":"postgres","prosecdef":true,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,service_role=X/postgres}"},{"name":"public.get_website_staging_dispatch","signature":"public.get_website_staging_dispatch(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)","body_md5":"fd7d758d3eaa57d7560d640845ecf9d4","owner":"postgres","prosecdef":true,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,service_role=X/postgres}"},{"name":"public.record_website_staging_result","signature":"public.record_website_staging_result(uuid,uuid,uuid,uuid,uuid,text,jsonb)","body_md5":"6b058bfeb7ece08d6de9bcb91eda51a5","owner":"postgres","prosecdef":true,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,service_role=X/postgres}"},{"name":"public.start_website_block_build","signature":"public.start_website_block_build(uuid,uuid,uuid,uuid,uuid,uuid,text)","body_md5":"90817defb2f18534ef6623a73f8114b1","owner":"postgres","prosecdef":true,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,service_role=X/postgres}"},{"name":"public.start_website_staging_run","signature":"public.start_website_staging_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)","body_md5":"f193ace42f8aac7c83a3953274c7e272","owner":"postgres","prosecdef":true,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,service_role=X/postgres}"}]$preimages$::jsonb) loop
  select jsonb_build_object('body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'prosecdef',p.prosecdef,'proconfig',to_jsonb(p.proconfig),'acl',p.proacl::text) into actual from pg_proc p where p.oid=to_regprocedure(expected->>'signature');
  if actual is distinct from expected-'name'-'signature' then raise exception 'Reviewed native prerequisite differs: %',expected->>'signature' using errcode='55000';end if;
 end loop;
end;$guard$;

-- LOCAL UNTESTED FRAGMENT. Assemble into CLI-created migration after preimage capture.
-- Call only after current Chat ownership and exact immutable association validation.
create function private.project_chat_native_build_state_actor(
 p_actor uuid,p_org uuid,p_project uuid,p_engagement uuid,p_job uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='500ms' as $$
declare i private.website_block_inputs;j public.wordpress_export_jobs;
 observed timestamptz;expired boolean;meta jsonb;
begin
 if p_actor is null or p_org is null or p_project is null or p_engagement is null or p_job is null then
  raise exception 'Exact original package identity required' using errcode='22023';
 end if;
 perform private.website_block_actor(p_org,p_project,p_engagement,p_actor,false);
 select * into i from private.website_block_inputs
 where job_id=p_job and organization_id=p_org and project_id=p_project
 and engagement_id=p_engagement and created_by=p_actor;
 if i.job_id is null then raise exception 'Original owned package unavailable' using errcode='42501';end if;
 -- Serialize observation with canonical finish without changing its processing state.
 select * into j from public.wordpress_export_jobs
 where id=i.job_id and organization_id=p_org and requested_by=p_actor
 and provider_job_id='anka-native-block-v1' for share nowait;
 if j.id is null or j.website_page_design_id is distinct from i.design_id or j.status not in ('processing','complete','failed') then
  raise exception 'Original native package state unavailable' using errcode='42501';
 end if;
 observed:=clock_timestamp();
 expired:=j.status='processing' and i.created_at+interval '10 minutes'<=observed;
 meta:=j.seo_verification;
 if j.status='complete' and (
  (j.artifact_sha256~'^[a-f0-9]{64}$') is distinct from true
  or (meta->>'source_sha256'~'^[a-f0-9]{64}$') is distinct from true
  or jsonb_typeof(meta->'package_bytes') is distinct from 'number'
  or jsonb_typeof(meta->'source_bytes') is distinct from 'number'
  or (meta->>'package_bytes'~'^[1-9][0-9]*$') is distinct from true
  or (meta->>'source_bytes'~'^[1-9][0-9]*$') is distinct from true
 ) then raise exception 'Original completed package metadata is incomplete' using errcode='55000';end if;
 if j.status='complete' and ((meta->>'package_bytes')::numeric>1048576 or (meta->>'source_bytes')::numeric>524288)
 then raise exception 'Original completed package exceeds canonical bounds' using errcode='55000';end if;
 return jsonb_build_object(
  'kind','website_native_package','status',case when expired then 'failed' else j.status end,
  'original_status',j.status,'execution_window_expired',expired,
  'artifact_sha256',case when j.status='complete' then j.artifact_sha256 else null end,
  'source_sha256',case when j.status='complete' then meta->>'source_sha256' else null end,
  'package_bytes',case when j.status='complete' then meta->'package_bytes' else null end,
  'source_bytes',case when j.status='complete' then meta->'source_bytes' else null end,
  'stale_sources',to_jsonb(private.website_block_stale(i.source)),
  'failure_reason',case when expired then 'Original build execution window expired; the retained processing state is unchanged.' else j.failure_reason end);
end;$$;
revoke all on function private.project_chat_native_build_state_actor(uuid,uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;

-- LOCAL WIP, NOT NATIVE-VERIFIED. Assemble with guarded preimages into CLI migration.
create function private.project_chat_build_source_actor(a uuid,o uuid,p uuid,c uuid,m uuid,x jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='500ms' as $$
declare e uuid;origin private.project_work_commands;b private.website_native_bindings;
 selection jsonb;ids uuid[];roots uuid[];v public.artifact_versions;artifact public.artifacts;
 site private.website_site_versions;identity_root uuid;native jsonb;chat jsonb;
begin
 if x is null or jsonb_typeof(x)<>'object' or octet_length(x::text)>8192
 or (select count(*) from jsonb_object_keys(x))<>5
 or not x?&array['engagement_id','selection','design_request_id','design_id','page_id']
 then raise exception 'Exact bounded Chat package context required' using errcode='22023';end if;
 e:=(x->>'engagement_id')::uuid;selection:=nullif(x->'selection','null'::jsonb);
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||o::text||':'||p::text,0));
 perform 1 from public.projects where id=p and organization_id=o and archived_at is null for update;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(a,o,p,c,m,true);
 perform private.website_block_actor(o,p,e,a,true);
 perform 1 from public.engagements where id=e and organization_id=o and project_id=p for share;
 if not found then raise exception 'Exact project engagement required' using errcode='42501';end if;
 select * into origin from private.project_work_commands where organization_id=o and project_id=p and actor_id=a and request_id=(x->>'design_request_id')::uuid;
 if origin.request_id is null or origin.payload->>'action' is distinct from 'project_chat_native_design_v1'
 or origin.payload->>'conversation_id' is distinct from c::text
 or origin.result->>'engagement_id' is distinct from e::text
 or origin.result->'output'->>'design_id' is distinct from x->>'design_id'
 or origin.result->'output'->>'page_id' is distinct from x->>'page_id'
 or origin.result->>'status' is distinct from 'design_draft_saved'
 then raise exception 'Exact original owned Chat Design receipt required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(a,o,p,c,(origin.payload->>'source_message_id')::uuid,false);
 if (case when selection is null then 'null'::jsonb else selection-'context_sha256' end)
 is distinct from (case when nullif(origin.result->'selection','null'::jsonb) is null then 'null'::jsonb else (origin.result->'selection')-'context_sha256' end)
 then raise exception 'Retain original Design selection; refresh only its context checksum' using errcode='40001';end if;
 select * into b from private.website_native_bindings where design_id=(x->>'design_id')::uuid and organization_id=o and project_id=p and engagement_id=e and created_by=a and request_id=origin.request_id;
 if b.design_id is null or b.page_id::text is distinct from x->>'page_id' then raise exception 'Original Design binding unavailable' using errcode='42501';end if;
 ids:=array[b.architecture_version_id,b.content_version_id];
 if selection is not null then
  select ids||coalesce(array_agg((ref->'reference'->>'artifact_version_id')::uuid) filter(where ref->'reference'->>'artifact_version_id' is not null),'{}'::uuid[]) into ids
  from public.project_pipeline_configurations cfg join public.project_pipeline_stage_reviews sr on sr.configuration_id=cfg.id and sr.organization_id=cfg.organization_id
  cross join lateral jsonb_array_elements(sr.resolved_artifacts)ref
  where cfg.organization_id=o and cfg.project_id=p and cfg.engagement_id=e and cfg.pipeline_group_id=(selection->>'group_id')::uuid
  and cfg.revision=(select max(q.revision) from public.project_pipeline_configurations q where q.organization_id=o and q.project_id=p and q.engagement_id=e and q.pipeline_group_id=cfg.pipeline_group_id);
 end if;
 with recursive pinned(id) as (select unnest(ids) union select child::uuid from pinned z join public.artifact_versions av on av.id=z.id and av.organization_id=o cross join lateral unnest(private.content_n3_source_ids(av.content))child)
 select array_agg(id) into ids from (select id from pinned limit 21)bounded;
 if cardinality(ids)>20 or array_position(ids,null) is not null then raise exception 'Bounded pinned sources required' using errcode='54000';end if;
 if (select count(*) from public.artifact_versions av join public.artifacts ar on ar.id=av.artifact_id and ar.organization_id=av.organization_id where av.organization_id=o and ar.project_id=p and av.id=any(ids))<>cardinality(ids)
 then raise exception 'Exact project sources required' using errcode='42501';end if;
 select array_agg(distinct artifact_id) into roots from public.artifact_versions where organization_id=o and id=any(ids);
 perform private.project_chat_design_sources_actor(a,o,p,roots);
 select * into site from private.website_site_versions where id=b.site_version_id and organization_id=o and project_id=p and engagement_id=e;
 if site.id is null then raise exception 'Original site settings unavailable' using errcode='42501';end if;
 if site.identity_version_id is not null then
  select av.artifact_id into identity_root from public.artifact_versions av join public.artifacts ar on ar.id=av.artifact_id and ar.organization_id=av.organization_id join public.engagements eng on eng.id=e and eng.organization_id=o
  where av.id=site.identity_version_id and av.organization_id=o and ar.artifact_type='design_system' and ar.brand_id=eng.brand_id;
  if identity_root is null then raise exception 'Exact same-brand identity required' using errcode='42501';end if;
  perform private.project_chat_design_brand_sources_actor(a,o,p,array[identity_root]);
 end if;
 for v in select * from public.artifact_versions where organization_id=o and id=any(ids) loop
  select * into artifact from public.artifacts where organization_id=o and id=v.artifact_id;
  perform private.require_pipeline_approved_artifact(o,p,v.id,artifact.artifact_type,v.content->>'output_type');
  if exists(select 1 from public.artifact_versions nv join public.artifact_approvals ap on ap.artifact_version_id=nv.id and ap.organization_id=nv.organization_id where nv.organization_id=o and nv.artifact_id=v.artifact_id and nv.version_number>v.version_number and ap.decision='approved') then raise exception 'Pinned source has newer approval' using errcode='40001';end if;
 end loop;
 if selection is not null then
  if selection->>'engagement_id' is distinct from e::text or selection->'partition'->>'kind' is distinct from 'website_page' or selection->'partition'->>'id' is distinct from b.page_id::text then raise exception 'Original selected page required' using errcode='42501';end if;
  perform private.project_chat_design_metadata_actor(a,o,p,selection,'{}');
 end if;
 perform brief.id from public.design_creative_briefs brief join public.design_creative_brief_versions bv on bv.creative_brief_id=brief.id and bv.organization_id=brief.organization_id where bv.id=b.brief_version_id and bv.organization_id=o for share of brief,bv nowait;
 native:=private.website_block_context(o,p,e,a,b.design_id);
 if jsonb_array_length(native->'stale_sources')<>0 then raise exception 'Package sources changed; review current exact versions' using errcode='40001';end if;
 chat:=jsonb_build_object('version',1,'organization_id',o,'project_id',p,'engagement_id',e,'conversation_id',c,'source_message_id',m,'actor_id',a,'context',x,'origin_receipt',origin.result);
 return native||jsonb_build_object('chat_context',chat,'chat_review_sha256',encode(sha256(convert_to(jsonb_build_array(chat,native->>'review_sha256')::text,'UTF8')),'hex'));
end;$$;
revoke all on function private.project_chat_build_source_actor(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.start_project_chat_native_build(p_actor_id uuid,p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid,p_context jsonb,p_review_sha256 text,p_chat_review_sha256 text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare old private.project_work_commands;payload jsonb;review jsonb;saved jsonb;receipt jsonb;recorded jsonb;e uuid;old_timeout text:=current_setting('lock_timeout');
begin
 if p_actor_id is null or p_request_id is null or p_source_message_id is null or p_context is null or octet_length(p_context::text)>8192
 or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' or p_chat_review_sha256 is null or p_chat_review_sha256!~'^[a-f0-9]{64}$'
 then raise exception 'Exact reviewed Chat package request required' using errcode='22023';end if;
 e:=(p_context->>'engagement_id')::uuid;
 perform set_config('lock_timeout','500ms',true);
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id and archived_at is null for update;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,false);
 perform private.website_block_actor(p_organization_id,p_project_id,e,p_actor_id,false);
 payload:=jsonb_build_object('action','project_chat_native_build_v1','conversation_id',p_conversation_id,'source_message_id',p_source_message_id,'context',p_context,'review_sha256',p_review_sha256,'chat_review_sha256',p_chat_review_sha256);
 perform pg_advisory_xact_lock(hashtextextended('project-work:'||p_organization_id::text||':'||p_actor_id::text||':'||p_request_id::text,0));
 select * into old from private.project_work_commands where organization_id=p_organization_id and actor_id=p_actor_id and request_id=p_request_id;
 if found then
  if old.project_id is distinct from p_project_id or old.payload is distinct from payload then raise exception 'Original request belongs to another action' using errcode='23505';end if;
  recorded:=private.project_chat_build_record_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
  perform set_config('lock_timeout',old_timeout,true);
  return jsonb_build_object('receipt',recorded->'receipt','state',recorded->'state','replayed',true);
 end if;
 review:=private.project_chat_build_source_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_context);
 if review->>'review_sha256' is distinct from p_review_sha256 or review->>'chat_review_sha256' is distinct from p_chat_review_sha256 then raise exception 'Reviewed Chat package sources changed' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-block:'||p_organization_id::text||':'||p_actor_id::text||':'||p_request_id::text,0));
 if exists(select 1 from private.website_block_inputs where organization_id=p_organization_id and created_by=p_actor_id and request_id=p_request_id) then raise exception 'Original native request belongs to another flow' using errcode='23505';end if;
 saved:=public.start_website_block_build(p_organization_id,p_project_id,e,p_actor_id,(p_context->>'design_id')::uuid,p_request_id,p_review_sha256);
 if saved->'created' is distinct from 'true'::jsonb then raise exception 'New canonical claim required' using errcode='40001';end if;
 receipt:=jsonb_build_object('version',1,'kind','build_native_package','status','claimed','organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',e,'conversation_id',p_conversation_id,'source_message_id',p_source_message_id,'actor_id',p_actor_id,'request_id',p_request_id,'selection',p_context->'selection','origin_request_id',p_context->'design_request_id','output',jsonb_build_object('kind','website_native_package','job_id',saved->'job'->'id','design_id',p_context->'design_id','page_id',p_context->'page_id'));
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,p_actor_id,p_request_id,payload,receipt);
 perform set_config('lock_timeout',old_timeout,true);
 return jsonb_build_object('receipt',receipt,'state',private.project_chat_native_build_state_actor(p_actor_id,p_organization_id,p_project_id,e,(saved->'job'->>'id')::uuid),'replayed',false,'native',saved);
exception when lock_not_available or deadlock_detected then raise exception 'Package sources busy; retain original request for recovery' using errcode='40001';
end;$$;
revoke all on function public.start_project_chat_native_build(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.start_project_chat_native_build(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text) to service_role;

-- LOCAL WIP. Native verification required before candidate acceptance.
create function public.get_project_chat_native_build_review(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_context jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare result jsonb;old_timeout text:=current_setting('lock_timeout');
begin
 if auth.uid() is null then raise exception 'Authenticated actor required' using errcode='42501';end if;
 perform set_config('lock_timeout','500ms',true);
 result:=private.project_chat_build_source_actor(auth.uid(),p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_context);
 perform set_config('lock_timeout',old_timeout,true);return result;
exception when lock_not_available or deadlock_detected then raise exception 'Package source busy; retain reviewed draft' using errcode='40001';
end;$$;
revoke all on function public.get_project_chat_native_build_review(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_project_chat_native_build_review(uuid,uuid,uuid,uuid,jsonb) to authenticated;

create function private.project_chat_build_record_actor(a uuid,o uuid,p uuid,c uuid,m uuid,r uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='500ms' as $$
declare prior private.project_work_commands;i private.website_block_inputs;j public.wordpress_export_jobs;e uuid;
begin
 perform private.project_chat_design_owner_actor(a,o,p,c,m,false);
 if r is null or m is null then raise exception 'Exact original request and message required' using errcode='22023';end if;
 select * into prior from private.project_work_commands where organization_id=o and actor_id=a and request_id=r;
 if not found then return jsonb_build_object('status','not_recorded','must_not_submit',true);end if;
 if prior.project_id is distinct from p or prior.payload->>'action' is distinct from 'project_chat_native_build_v1'
 or prior.payload->>'conversation_id' is distinct from c::text or prior.payload->>'source_message_id' is distinct from m::text
 then raise exception 'Original request belongs to another action' using errcode='42501';end if;
 e:=(prior.payload->'context'->>'engagement_id')::uuid;
 if not prior.result @> jsonb_build_object('version',1,'kind','build_native_package','status','claimed','organization_id',o,'project_id',p,'engagement_id',e,'conversation_id',c,'source_message_id',m,'actor_id',a,'request_id',r)
 or prior.result->'selection' is distinct from prior.payload->'context'->'selection'
 or prior.result->'origin_request_id' is distinct from prior.payload->'context'->'design_request_id'
 then raise exception 'Original Chat package association differs' using errcode='42501';end if;
 select * into i from private.website_block_inputs where job_id=(prior.result->'output'->>'job_id')::uuid and organization_id=o and project_id=p and engagement_id=e and created_by=a;
 select * into j from public.wordpress_export_jobs where id=i.job_id and organization_id=o and requested_by=a;
 if i.job_id is null or i.request_id is distinct from r or i.design_id::text is distinct from prior.payload->'context'->>'design_id' or i.page_id::text is distinct from prior.payload->'context'->>'page_id'
 or i.review_sha256 is distinct from prior.payload->>'review_sha256' or j.id is null or j.website_page_design_id is distinct from i.design_id or j.provider_job_id is distinct from 'anka-native-block-v1'
 or prior.result->'output' is distinct from jsonb_build_object('kind','website_native_package','job_id',i.job_id,'design_id',i.design_id,'page_id',i.page_id)
 then raise exception 'Original Chat package canonical input differs' using errcode='42501';end if;
 return jsonb_build_object('status','recorded','receipt',prior.result,'state',private.project_chat_native_build_state_actor(a,o,p,(prior.result->>'engagement_id')::uuid,(prior.result->'output'->>'job_id')::uuid),'must_not_submit',true);
end;$$;
revoke all on function private.project_chat_build_record_actor(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.recover_project_chat_native_build_action(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
begin
 return private.project_chat_build_record_actor(auth.uid(),p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
exception when lock_not_available or deadlock_detected then raise exception 'Original package state busy; retain request for recovery' using errcode='40001';
end;
$$;
revoke all on function public.recover_project_chat_native_build_action(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.recover_project_chat_native_build_action(uuid,uuid,uuid,uuid,uuid) to authenticated;

create function public.read_project_chat_native_build_actions(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare a uuid:=auth.uid();items jsonb:='[]';entry private.project_work_commands;observed jsonb;more boolean;
begin
 perform private.project_chat_design_owner_actor(a,p_organization_id,p_project_id,p_conversation_id,null,false);
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Bounded history required' using errcode='22023';end if;
 for entry in select * from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=a and payload->>'action'='project_chat_native_build_v1' and payload->>'conversation_id'=p_conversation_id::text order by created_at desc,request_id desc limit p_limit offset p_offset loop
  observed:=private.project_chat_build_record_actor(a,p_organization_id,p_project_id,p_conversation_id,(entry.payload->>'source_message_id')::uuid,entry.request_id);
  items:=items||jsonb_build_array(jsonb_build_object('receipt',observed->'receipt','state',observed->'state'));
 end loop;
 select exists(select 1 from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=a and payload->>'action'='project_chat_native_build_v1' and payload->>'conversation_id'=p_conversation_id::text order by created_at desc,request_id desc limit 1 offset p_offset+p_limit) into more;
 return jsonb_build_object('items',items,'limit',p_limit,'offset',p_offset,'has_more',more);
exception when lock_not_available or deadlock_detected then raise exception 'Original package history busy; retain request for recovery' using errcode='40001';
end;$$;
revoke all on function public.read_project_chat_native_build_actions(uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_project_chat_native_build_actions(uuid,uuid,uuid,integer,integer) to authenticated;

create function public.finish_project_chat_native_build(p_actor_id uuid,p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid,p_package_sha256 text,p_source_sha256 text,p_package_bytes integer,p_source_bytes integer,p_file_hashes jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare prior private.project_work_commands;review jsonb;state jsonb;job uuid;e uuid;old_timeout text:=current_setting('lock_timeout');
begin
 perform set_config('lock_timeout','500ms',true);
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform 1 from public.projects where organization_id=p_organization_id and id=p_project_id and archived_at is null for update;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,true);
 select * into prior from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=p_actor_id and request_id=p_request_id;
 if prior.request_id is null or prior.payload->>'action' is distinct from 'project_chat_native_build_v1'
 or prior.payload->>'conversation_id' is distinct from p_conversation_id::text or prior.payload->>'source_message_id' is distinct from p_source_message_id::text
 then raise exception 'Exact original Chat build claim required' using errcode='42501';end if;
 perform private.project_chat_build_record_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
 e:=(prior.result->>'engagement_id')::uuid;job:=(prior.result->'output'->>'job_id')::uuid;
 review:=private.project_chat_build_source_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,prior.payload->'context');
 if review->>'review_sha256' is distinct from prior.payload->>'review_sha256' or review->>'chat_review_sha256' is distinct from prior.payload->>'chat_review_sha256' then raise exception 'Original Chat build source changed before finish' using errcode='40001';end if;
 perform public.finish_website_block_build(p_organization_id,p_project_id,e,p_actor_id,job,p_package_sha256,p_source_sha256,p_package_bytes,p_source_bytes,p_file_hashes);
 state:=private.project_chat_native_build_state_actor(p_actor_id,p_organization_id,p_project_id,e,job);
 perform set_config('lock_timeout',old_timeout,true);
 return jsonb_build_object('receipt',prior.result,'state',state,'replayed',false);
exception when lock_not_available or deadlock_detected then raise exception 'Build completion source busy; preserve original request' using errcode='40001';
end;$$;
revoke all on function public.finish_project_chat_native_build(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.finish_project_chat_native_build(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb) to service_role;

-- LOCAL UNTESTED staging extension. No remote invocation is authorized by this file.
create function private.project_chat_staging_source_actor(a uuid,o uuid,p uuid,c uuid,m uuid,x jsonb,head uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='500ms' as $$
declare e uuid;origin private.project_work_commands;build jsonb;state jsonb;native jsonb;chat jsonb;selection jsonb;
begin
 if x is null or jsonb_typeof(x)<>'object' or octet_length(x::text)>8192
 or (select count(*) from jsonb_object_keys(x))<>8
 or not x?&array['engagement_id','selection','build_request_id','job_id','design_id','page_id','target_id','previous_run_id']
 then raise exception 'Exact bounded Chat staging context required' using errcode='22023';end if;
 e:=(x->>'engagement_id')::uuid;selection:=nullif(x->'selection','null'::jsonb);
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||o::text||':'||p::text,0));
 perform 1 from public.projects where id=p and organization_id=o and archived_at is null for update;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(a,o,p,c,m,true);
 select * into origin from private.project_work_commands where organization_id=o and project_id=p and actor_id=a and request_id=(x->>'build_request_id')::uuid;
 if origin.request_id is null or origin.payload->>'action' is distinct from 'project_chat_native_build_v1'
 or origin.payload->>'conversation_id' is distinct from c::text or origin.result->>'engagement_id' is distinct from e::text
 or origin.result->'output'->>'job_id' is distinct from x->>'job_id' or origin.result->'output'->>'design_id' is distinct from x->>'design_id'
 or origin.result->'output'->>'page_id' is distinct from x->>'page_id'
 then raise exception 'Exact original owned Chat package receipt required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(a,o,p,c,(origin.payload->>'source_message_id')::uuid,false);
 perform private.project_chat_build_record_actor(a,o,p,c,(origin.payload->>'source_message_id')::uuid,origin.request_id);
 if (case when selection is null then 'null'::jsonb else selection-'context_sha256' end)
 is distinct from (case when nullif(origin.result->'selection','null'::jsonb) is null then 'null'::jsonb else (origin.result->'selection')-'context_sha256' end)
 then raise exception 'Retain original package selection; refresh only its checksum' using errcode='40001';end if;
 build:=private.project_chat_build_source_actor(a,o,p,c,m,(origin.payload->'context')||jsonb_build_object('selection',x->'selection'));
 if build->>'review_sha256' is distinct from origin.payload->>'review_sha256' then raise exception 'Original package sources changed' using errcode='40001';end if;
 state:=private.project_chat_native_build_state_actor(a,o,p,e,(x->>'job_id')::uuid);
 if state->>'status' is distinct from 'complete' or jsonb_array_length(state->'stale_sources')<>0 then raise exception 'Exact current completed package required' using errcode='40001';end if;
 native:=public.get_website_staging_dispatch(o,p,e,a,null,(x->>'target_id')::uuid,(x->>'job_id')::uuid,head);
 if native->'source'->>'design_id' is distinct from x->>'design_id' or native->>'page_id' is distinct from x->>'page_id'
 or native->'job'->>'requested_by' is distinct from a::text or native->'job'->>'artifact_sha256' is distinct from state->>'artifact_sha256'
 then raise exception 'Reviewed staging package identity differs' using errcode='42501';end if;
 chat:=jsonb_build_object('version',1,'organization_id',o,'project_id',p,'engagement_id',e,'conversation_id',c,'source_message_id',m,'actor_id',a,'context',x,'origin_receipt',origin.result);
 return native||jsonb_build_object('chat_context',chat,'chat_review_sha256',encode(sha256(convert_to(jsonb_build_array(chat,native->>'review_sha256',head)::text,'UTF8')),'hex'));
end;$$;
revoke all on function private.project_chat_staging_source_actor(uuid,uuid,uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create function private.project_chat_staging_record_actor(a uuid,o uuid,p uuid,c uuid,m uuid,request uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='500ms' as $$
declare prior private.project_work_commands;r private.website_staging_runs;result private.website_staging_results;t private.website_staging_targets;i private.website_block_inputs;j public.wordpress_export_jobs;output jsonb;evidence jsonb;
begin
 perform private.project_chat_design_owner_actor(a,o,p,c,m,false);
 if request is null or m is null then raise exception 'Exact original request and message required' using errcode='22023';end if;
 select * into prior from private.project_work_commands where organization_id=o and actor_id=a and request_id=request;
 if not found then return jsonb_build_object('status','not_recorded','must_not_submit',true);end if;
 if prior.project_id is distinct from p or prior.payload->>'action' is distinct from 'project_chat_native_staging_v1'
 or prior.payload->>'conversation_id' is distinct from c::text or prior.payload->>'source_message_id' is distinct from m::text
 then raise exception 'Original request belongs to another action' using errcode='42501';end if;
 output:=prior.result->'output';
 if not prior.result @> jsonb_build_object('version',1,'kind','stage_native_package','status','claimed','organization_id',o,'project_id',p,'engagement_id',prior.payload->'context'->'engagement_id','conversation_id',c,'source_message_id',m,'actor_id',a,'request_id',request)
 or prior.result->'selection' is distinct from prior.payload->'context'->'selection' or prior.result->'origin_request_id' is distinct from prior.payload->'context'->'build_request_id'
 or output->>'kind' is distinct from 'website_private_staging'
 or exists(select 1 from unnest(array['job_id','design_id','page_id','target_id','previous_run_id']) k where output->k is distinct from prior.payload->'context'->k)
 then raise exception 'Original Chat staging association differs' using errcode='42501';end if;
 perform private.website_block_actor(o,p,(prior.result->>'engagement_id')::uuid,a,false);
 select * into r from private.website_staging_runs where id=(output->>'run_id')::uuid and organization_id=o and project_id=p and engagement_id=(prior.result->>'engagement_id')::uuid and created_by=a and request_id=request for share;
 if r.id is null or r.job_id::text is distinct from output->>'job_id' or r.target_id::text is distinct from output->>'target_id'
 or r.page_id::text is distinct from output->>'page_id' or to_jsonb(r.previous_run_id) is distinct from nullif(output->'previous_run_id','null'::jsonb)
 then raise exception 'Original owned staging run unavailable' using errcode='42501';end if;
 select * into t from private.website_staging_targets where id=r.target_id and organization_id=o and project_id=p and engagement_id=r.engagement_id;
 select * into i from private.website_block_inputs where job_id=r.job_id and organization_id=o and project_id=p and engagement_id=r.engagement_id and created_by=a;
 select * into j from public.wordpress_export_jobs where id=i.job_id and organization_id=o and requested_by=a;
 if t.id is null or t.site_id::text is distinct from output->>'site_id' or t.base_url is distinct from output->>'base_url'
 or i.job_id is null or i.request_id::text is distinct from prior.result->>'origin_request_id' or i.design_id::text is distinct from output->>'design_id' or i.page_id is distinct from r.page_id
 or j.id is null or j.website_page_design_id is distinct from i.design_id or j.artifact_sha256 is distinct from output->>'package_sha256'
 or r.review_sha256 is distinct from prior.payload->>'review_sha256' or to_jsonb(r.remote_head) is distinct from nullif(prior.payload->'remote_head','null'::jsonb)
 then raise exception 'Original staging canonical input differs' using errcode='42501';end if;
 select * into result from private.website_staging_results where run_id=r.id;
 if result.run_id is not null then
  evidence:=result.evidence;
  if octet_length(evidence::text)>16000 or evidence->>'request_id' is distinct from request::text or evidence->>'site_id' is distinct from output->>'site_id'
  or evidence->>'base_url' is distinct from output->>'base_url' or evidence->'published' is distinct from 'false'::jsonb or evidence->>'environment' is distinct from 'staging' or evidence->>'package_sha256' is distinct from output->>'package_sha256'
  or (result.outcome='staged' and (evidence->>'package_sha256' is distinct from output->>'package_sha256' or evidence->'preview_verified' is distinct from 'true'::jsonb or evidence->>'preview_url' is distinct from (output->>'base_url')||'/?anka_staging_preview='||request::text))
  then raise exception 'Original verified staging evidence differs' using errcode='40001';end if;
  select jsonb_object_agg(key,value) into evidence from jsonb_each(evidence) where key=any(array['wordpress_version','php_version','compiler','protocol','environment','published','base_url','site_id','request_id','package_sha256','status','unresolved_paths']) or (result.outcome='staged' and key=any(array['preview_url','preview_verified']));
 end if;
 return jsonb_build_object('status','recorded','receipt',prior.result,'state',jsonb_build_object('kind','website_private_staging','status',coalesce(result.outcome,'uncertain'),'evidence',evidence),'must_not_submit',true);
end;$$;
revoke all on function private.project_chat_staging_record_actor(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_project_chat_native_staging_dispatch(p_actor_id uuid,p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_context jsonb,p_remote_head uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare answer jsonb;old_timeout text:=current_setting('lock_timeout');
begin
 perform set_config('lock_timeout','500ms',true);
 answer:=private.project_chat_staging_source_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_context,p_remote_head);
 perform set_config('lock_timeout',old_timeout,true);return answer;
exception when lock_not_available or deadlock_detected then raise exception 'Staging sources busy; retain original review' using errcode='40001';
end;$$;
revoke all on function public.get_project_chat_native_staging_dispatch(uuid,uuid,uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_chat_native_staging_dispatch(uuid,uuid,uuid,uuid,uuid,jsonb,uuid) to service_role;

create function public.recover_project_chat_native_staging_action(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
begin
 return private.project_chat_staging_record_actor(auth.uid(),p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
exception when lock_not_available or deadlock_detected then raise exception 'Original staging state busy; retain request for recovery' using errcode='40001';
end;
$$;
revoke all on function public.recover_project_chat_native_staging_action(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.recover_project_chat_native_staging_action(uuid,uuid,uuid,uuid,uuid) to authenticated;

-- LOCAL WIP. Service entry points receive an actor verified by the existing JWT Edge handler.
create function public.start_project_chat_native_staging(p_actor_id uuid,p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid,p_context jsonb,p_remote_head uuid,p_review_sha256 text,p_chat_review_sha256 text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare old private.project_work_commands;payload jsonb;review jsonb;saved jsonb;receipt jsonb;recorded jsonb;e uuid;old_timeout text:=current_setting('lock_timeout');
begin
 if p_actor_id is null or p_request_id is null or p_source_message_id is null or p_context is null or octet_length(p_context::text)>8192
 or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' or p_chat_review_sha256 is null or p_chat_review_sha256!~'^[a-f0-9]{64}$'
 then raise exception 'Exact reviewed Chat staging request required' using errcode='22023';end if;
 e:=(p_context->>'engagement_id')::uuid;
 perform set_config('lock_timeout','500ms',true);
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id and archived_at is null for update;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 perform private.project_chat_design_owner_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,false);
 perform private.website_block_actor(p_organization_id,p_project_id,e,p_actor_id,false);
 payload:=jsonb_build_object('action','project_chat_native_staging_v1','conversation_id',p_conversation_id,'source_message_id',p_source_message_id,'context',p_context,'remote_head',p_remote_head,'review_sha256',p_review_sha256,'chat_review_sha256',p_chat_review_sha256);
 perform pg_advisory_xact_lock(hashtextextended('project-work:'||p_organization_id::text||':'||p_actor_id::text||':'||p_request_id::text,0));
 select * into old from private.project_work_commands where organization_id=p_organization_id and actor_id=p_actor_id and request_id=p_request_id;
 if found then
  if old.project_id is distinct from p_project_id or old.payload is distinct from payload then raise exception 'Original request belongs to another action' using errcode='23505';end if;
  recorded:=private.project_chat_staging_record_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
  perform set_config('lock_timeout',old_timeout,true);
  return jsonb_build_object('receipt',recorded->'receipt','state',recorded->'state','replayed',true);
 end if;
 review:=private.project_chat_staging_source_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_context,p_remote_head);
 if review->>'review_sha256' is distinct from p_review_sha256 or review->>'chat_review_sha256' is distinct from p_chat_review_sha256 then raise exception 'Reviewed Chat staging sources changed' using errcode='40001';end if;
 -- Match the canonical target/page lock before checking for a standalone request.
 perform pg_advisory_xact_lock(hashtextextended('website-staging-run:'||(p_context->>'target_id')||':'||(review->>'page_id'),0));
 if exists(select 1 from private.website_staging_runs where request_id=p_request_id) then raise exception 'Original native staging request belongs to another flow' using errcode='23505';end if;
 saved:=public.start_website_staging_run(p_organization_id,p_project_id,e,p_actor_id,(p_context->>'target_id')::uuid,(p_context->>'job_id')::uuid,p_remote_head,p_review_sha256,(p_context->>'previous_run_id')::uuid,p_request_id);
 if saved->'created' is distinct from 'true'::jsonb then raise exception 'New canonical staging claim required' using errcode='40001';end if;
 receipt:=jsonb_build_object('version',1,'kind','stage_native_package','status','claimed','organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',e,'conversation_id',p_conversation_id,'source_message_id',p_source_message_id,'actor_id',p_actor_id,'request_id',p_request_id,'selection',p_context->'selection','origin_request_id',p_context->'build_request_id','output',jsonb_build_object('kind','website_private_staging','run_id',saved->'run'->'id','job_id',p_context->'job_id','design_id',p_context->'design_id','page_id',p_context->'page_id','target_id',p_context->'target_id','site_id',review->'target'->'site_id','previous_run_id',p_context->'previous_run_id','package_sha256',review->'job'->'artifact_sha256','base_url',review->'target'->'base_url'));
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,p_actor_id,p_request_id,payload,receipt);
 recorded:=private.project_chat_staging_record_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
 perform set_config('lock_timeout',old_timeout,true);
 -- Native transport data is service-only; the Edge must return only receipt/state/replayed.
 return jsonb_build_object('receipt',receipt,'state',recorded->'state','replayed',false,'native',review||jsonb_build_object('run',saved->'run'));
exception when lock_not_available or deadlock_detected then raise exception 'Staging sources busy; retain original request for recovery' using errcode='40001';
end;$$;
revoke all on function public.start_project_chat_native_staging(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.start_project_chat_native_staging(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,uuid,text,text) to service_role;

create function public.get_project_chat_native_staging_recovery(p_actor_id uuid,p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare recorded jsonb;r private.website_staging_runs;ctx jsonb;e uuid;
begin
 recorded:=private.project_chat_staging_record_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
 if recorded->>'status'='not_recorded' then return recorded;end if;
 if recorded->'state'->>'status' in ('staged','failed') then return recorded;end if;
 e:=(recorded->'receipt'->>'engagement_id')::uuid;
 perform private.website_block_actor(p_organization_id,p_project_id,e,p_actor_id,true);
 select * into r from private.website_staging_runs where id=(recorded->'receipt'->'output'->>'run_id')::uuid and organization_id=p_organization_id and project_id=p_project_id and engagement_id=e and created_by=p_actor_id and request_id=p_request_id for share;
 if r.id is null then raise exception 'Original owned staging run unavailable' using errcode='42501';end if;
 -- Resolve the exact owned run first, never a request-only cross-actor lookup. Recovery
 -- checks the original bound target and current access without requiring old sources current.
 ctx:=public.get_website_staging_dispatch(p_organization_id,p_project_id,e,p_actor_id,null,r.target_id,null,null);
 if ctx->'target'->>'site_id' is distinct from recorded->'receipt'->'output'->>'site_id' or ctx->'target'->>'base_url' is distinct from recorded->'receipt'->'output'->>'base_url'
 then raise exception 'Original staging target identity differs' using errcode='40001';end if;
 return recorded||jsonb_build_object('native',ctx||jsonb_build_object('run',to_jsonb(r),'result',(select to_jsonb(z) from private.website_staging_results z where z.run_id=r.id),'source',(select i.source from private.website_block_inputs i where i.job_id=r.job_id),'job',(select to_jsonb(j) from public.wordpress_export_jobs j where j.id=r.job_id)));
exception when lock_not_available or deadlock_detected then raise exception 'Original staging recovery busy; retain request' using errcode='40001';
end;$$;
revoke all on function public.get_project_chat_native_staging_recovery(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_chat_native_staging_recovery(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;

create function public.record_project_chat_native_staging_result(p_actor_id uuid,p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_source_message_id uuid,p_request_id uuid,p_outcome text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare recorded jsonb;e uuid;
begin
 recorded:=private.project_chat_staging_record_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
 if recorded->>'status' is distinct from 'recorded' then raise exception 'Original Chat staging claim required' using errcode='42501';end if;
 e:=(recorded->'receipt'->>'engagement_id')::uuid;
 perform public.record_website_staging_result(p_organization_id,p_project_id,e,p_actor_id,(recorded->'receipt'->'output'->>'run_id')::uuid,p_outcome,p_evidence);
 -- Revalidation against immutable receipt also makes a mismatched result roll back.
 recorded:=private.project_chat_staging_record_actor(p_actor_id,p_organization_id,p_project_id,p_conversation_id,p_source_message_id,p_request_id);
 return jsonb_build_object('receipt',recorded->'receipt','state',recorded->'state');
exception when lock_not_available or deadlock_detected then raise exception 'Original staging result busy; retain request' using errcode='40001';
end;$$;
revoke all on function public.record_project_chat_native_staging_result(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_project_chat_native_staging_result(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;

create function public.read_project_chat_native_staging_actions(p_organization_id uuid,p_project_id uuid,p_conversation_id uuid,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare a uuid:=auth.uid();row private.project_work_commands;recorded jsonb;items jsonb:='[]';total bigint;
begin
 perform private.project_chat_design_owner_actor(a,p_organization_id,p_project_id,p_conversation_id,null,false);
 if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'Bounded history required' using errcode='22023';end if;
 select count(*) into total from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=a and payload->>'action'='project_chat_native_staging_v1' and payload->>'conversation_id'=p_conversation_id::text;
 for row in select * from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=a and payload->>'action'='project_chat_native_staging_v1' and payload->>'conversation_id'=p_conversation_id::text order by created_at desc,request_id limit p_limit offset p_offset loop
  recorded:=private.project_chat_staging_record_actor(a,p_organization_id,p_project_id,p_conversation_id,(row.payload->>'source_message_id')::uuid,row.request_id);
  items:=items||jsonb_build_array(jsonb_build_object('receipt',recorded->'receipt','state',recorded->'state'));
 end loop;
 return jsonb_build_object('items',items,'limit',p_limit,'offset',p_offset,'has_more',total>p_offset+p_limit);
exception when lock_not_available or deadlock_detected then raise exception 'Original staging history busy; retain request' using errcode='40001';
end;$$;
revoke all on function public.read_project_chat_native_staging_actions(uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_project_chat_native_staging_actions(uuid,uuid,uuid,integer,integer) to authenticated;

commit;
