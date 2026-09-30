-- T04: confirm one complete owner-private canonical creative brief version atomically.
-- No parallel brief store, project promotion, price, connector or provider request is created.
begin;
set local lock_timeout='5s'; set local statement_timeout='120s';

create function private.valid_design_video_brief(v jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; maximum integer;
begin
 if v is null or jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>13
  or exists(select 1 from jsonb_object_keys(v) x where x not in ('purpose','audience','channel','assets','script_storyboard','brand_constraints','required_text','mode','duration_seconds','aspect_ratio','resolution','output_format','generate_audio')) then return false; end if;
 foreach k in array array['purpose','audience','channel','assets','script_storyboard','brand_constraints','required_text'] loop
  maximum:=case k when 'channel' then 300 when 'assets' then 1500 when 'script_storyboard' then 5000 when 'brand_constraints' then 1500 else 1000 end;
  if jsonb_typeof(v->k)<>'string' or length(btrim(v->>k)) not between 1 and maximum or (v->>k)<>btrim(v->>k) then return false; end if;
 end loop;
 foreach k in array array['mode','resolution','aspect_ratio','output_format'] loop
  if jsonb_typeof(v->k) is distinct from 'string' then return false; end if;
 end loop;
 if jsonb_typeof(v->'duration_seconds')<>'number' or (v->>'duration_seconds')!~'^[0-9]{1,2}$'
  or jsonb_typeof(v->'generate_audio')<>'boolean' or v->>'mode' not in ('explore','production')
  or v->>'resolution' not in ('480p','720p') or v->>'aspect_ratio' not in ('16:9','4:3','1:1','3:4','9:16','21:9')
  or v->>'output_format' not in ('mp4','mov') then return false; end if;
 if (v->>'duration_seconds')::integer not between 4 and 30
  or (v->>'mode'='explore' and (v->>'duration_seconds')::integer>5)
  or (v->>'mode'='production' and v->>'resolution'<>'720p') then return false; end if;
 return true;
end;
$$;
revoke all on function private.valid_design_video_brief(jsonb) from public,anon,authenticated,service_role;

create function private.require_design_video_brief_context(p_organization_id uuid,p_actor_id uuid,p_private_conversation_id uuid,p_direction_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target_project uuid;
begin
 if p_organization_id is null or p_actor_id is null or (p_private_conversation_id is null)=(p_direction_version_id is null) then raise exception 'One exact video context required' using errcode='22023'; end if;
 if p_private_conversation_id is not null then
  perform private.require_private_design_video_context(p_organization_id,p_private_conversation_id,p_actor_id); return;
 end if;
 select e.project_id into target_project from public.design_direction_versions v
 join public.design_directions d on d.id=v.direction_id and d.organization_id=v.organization_id
 join public.design_workshop_sessions s on s.id=d.session_id and s.organization_id=d.organization_id
 join public.engagements e on e.id=s.engagement_id and e.organization_id=s.organization_id and e.brand_id=s.brand_id
 where v.id=p_direction_version_id and v.organization_id=p_organization_id and not v.is_experimental;
 if target_project is null then raise exception 'Exact saved Design direction required' using errcode='42501'; end if;
 perform 1 from public.projects p where p.id=target_project and p.organization_id=p_organization_id and p.archived_at is null for share;
 if not found then raise exception 'Active Design project required' using errcode='42501'; end if;
 perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id
 where o.id=p_organization_id and o.status='active' and m.user_id=p_actor_id and m.status='active' and m.member_kind='team'
 and (m.role in ('system_owner','operations_admin','executive') or m.department_id='design') for share of o,m;
 if not found then raise exception 'Current Design team authority required' using errcode='42501'; end if;
 perform 1 from public.design_direction_versions v
 join public.design_directions d on d.id=v.direction_id and d.organization_id=v.organization_id
 join public.design_workshop_sessions s on s.id=d.session_id and s.organization_id=d.organization_id
 join public.engagements e on e.id=s.engagement_id and e.organization_id=s.organization_id and e.brand_id=s.brand_id
 join public.engagement_services es on es.id=s.engagement_service_id and es.organization_id=e.organization_id and es.engagement_id=e.id
 join public.service_catalog sc on sc.id=es.service_id
 where v.id=p_direction_version_id and v.organization_id=p_organization_id and not v.is_experimental
 and e.project_id=target_project and e.status<>'cancelled' and es.status='active' and sc.department_id='design' and sc.is_active
 for share of e,es,sc,s;
 if not found then raise exception 'Exact active Design service and direction required' using errcode='42501'; end if;
end;
$$;
revoke all on function private.require_design_video_brief_context(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.design_video_brief_content(v jsonb,scope jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('schema_version',1,'title',left(v->>'purpose',160),'output_type','video',
 'purpose',v->>'purpose','audience',v->>'audience','placement_destination',v->>'channel',
 'instructions',concat('Purpose:',E'\n',v->>'purpose',E'\n\n','Audience:',E'\n',v->>'audience',E'\n\n',
 'Channel / placement:',E'\n',v->>'channel',E'\n\n','Source assets / reuse plan:',E'\n',v->>'assets',E'\n\n',
 'Script / storyboard:',E'\n',v->>'script_storyboard',E'\n\n','Brand constraints:',E'\n',v->>'brand_constraints',E'\n\n',
 'Required text:',E'\n',v->>'required_text'),
 'exclusions_constraints',v->>'brand_constraints','rights_notes',v->>'assets','requested_outputs',jsonb_build_array('video'),
 'video_brief',v,'video_context',scope,'video_provider','higgsfield','video_model_id','bytedance/seedance-2.5/text-to-video');
$$;
revoke all on function private.design_video_brief_content(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.confirm_design_video_brief(
 p_organization_id uuid,p_actor_id uuid,p_private_conversation_id uuid,p_direction_version_id uuid,
 p_creative_brief_id uuid,p_expected_revision integer,p_operation_key uuid,p_video_brief jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; content jsonb; validation jsonb; checksum text; prior public.design_creative_brief_versions;
 root public.design_creative_briefs; saved jsonb; frozen jsonb;
begin
 if p_operation_key is null or p_expected_revision is null or p_expected_revision<0 or private.valid_design_video_brief(p_video_brief) is distinct from true then raise exception 'Complete exact supported video brief required; clarify unknowns first' using errcode='22023'; end if;
 perform private.require_design_video_brief_context(p_organization_id,p_actor_id,p_private_conversation_id,p_direction_version_id);
 scope:=case when p_private_conversation_id is not null then jsonb_build_object('private_conversation_id',p_private_conversation_id) else jsonb_build_object('direction_version_id',p_direction_version_id) end;
 content:=private.design_video_brief_content(p_video_brief,scope);
 if length(content->>'instructions')>12000 then raise exception 'Complete video prompt exceeds 12000 characters' using errcode='22023'; end if;
 checksum:=encode(pg_catalog.sha256(convert_to(content::text,'UTF8')),'hex');
 validation:=jsonb_build_object('valid',true,'output_type','video','missing',jsonb_build_array(),'unsupported',false,
 'video_confirmation',jsonb_build_object('action','confirm_video_brief','actor_id',p_actor_id,'expected_revision',p_expected_revision,'requested_root_id',p_creative_brief_id));
 -- Scope serialization prevents two simultaneous first confirmations from making separate roots.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('video-brief:'||p_organization_id::text||':'||p_actor_id::text||':'||scope::text,0));
 -- Match the preserved canonical save lock order before taking any root row lock.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||p_actor_id::text||':'||p_operation_key::text,0));
 select * into prior from public.design_creative_brief_versions where organization_id=p_organization_id and created_by=p_actor_id and operation_key=p_operation_key;
 if found then
  select * into root from public.design_creative_briefs where id=prior.creative_brief_id and organization_id=p_organization_id;
  if prior.content<>content or prior.validation_snapshot<>validation or root.visibility<>'private' or root.created_by<>p_actor_id
   or (p_creative_brief_id is not null and root.id<>p_creative_brief_id) then raise exception 'Operation key binds a different exact video brief' using errcode='23505'; end if;
  return jsonb_build_object('brief',to_jsonb(root),'version',to_jsonb(prior),'idempotent_replay',true,'confirmation_current',root.frozen_version_id=prior.id);
 end if;
 select b.* into root from public.design_creative_brief_versions v join public.design_creative_briefs b on b.id=v.creative_brief_id and b.organization_id=v.organization_id
 where v.organization_id=p_organization_id and v.created_by=p_actor_id and v.content->>'output_type'='video' and v.content->'video_context'=scope
 and b.visibility='private' and b.created_by=p_actor_id order by v.created_at desc,v.id desc limit 1;
 if found then
  if p_creative_brief_id is null or p_creative_brief_id<>root.id or p_expected_revision<>root.revision then raise exception 'Video brief changed; inspect the current exact version before confirming' using errcode='40001'; end if;
 else
  if p_creative_brief_id is not null or p_expected_revision<>0 then raise exception 'New scoped video brief required' using errcode='40001'; end if;
 end if;
 if root.id is not null then
  -- Canonical freeze takes this mutex before its row lock. Acquire it before save.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||root.id::text,0));
 end if;
 saved:=public.save_design_creative_brief_version(p_organization_id,p_actor_id,root.id,'private',null,null,null,null,null,p_expected_revision,p_operation_key,content,checksum,validation,array[]::uuid[]);
 frozen:=public.freeze_design_creative_brief_version(p_organization_id,p_actor_id,(saved->'brief'->>'id')::uuid,(saved->'version'->>'id')::uuid,(saved->'brief'->>'revision')::integer,p_operation_key);
 return jsonb_build_object('brief',frozen->'brief','version',saved->'version','idempotent_replay',false,'confirmation_current',true);
end;
$$;
revoke all on function public.confirm_design_video_brief(uuid,uuid,uuid,uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.confirm_design_video_brief(uuid,uuid,uuid,uuid,uuid,integer,uuid,jsonb) to service_role;

create function public.get_design_video_brief(p_organization_id uuid,p_actor_id uuid,p_private_conversation_id uuid,p_direction_version_id uuid,p_operation_key uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; version public.design_creative_brief_versions; root public.design_creative_briefs;
begin
 perform private.require_design_video_brief_context(p_organization_id,p_actor_id,p_private_conversation_id,p_direction_version_id);
 scope:=case when p_private_conversation_id is not null then jsonb_build_object('private_conversation_id',p_private_conversation_id) else jsonb_build_object('direction_version_id',p_direction_version_id) end;
 select v.* into version from public.design_creative_brief_versions v join public.design_creative_briefs b on b.id=v.creative_brief_id and b.organization_id=v.organization_id
 where v.organization_id=p_organization_id and v.created_by=p_actor_id and v.content->>'output_type'='video' and v.content->'video_context'=scope
 and b.visibility='private' and b.created_by=p_actor_id and (p_operation_key is null or v.operation_key=p_operation_key)
 order by v.created_at desc,v.id desc limit 1;
 if not found then return jsonb_build_object('brief',null,'version',null); end if;
 select * into root from public.design_creative_briefs where id=version.creative_brief_id and organization_id=p_organization_id;
 return jsonb_build_object('brief',to_jsonb(root),'version',to_jsonb(version),'confirmation_current',root.frozen_version_id=version.id);
end;
$$;
revoke all on function public.get_design_video_brief(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_design_video_brief(uuid,uuid,uuid,uuid,uuid) to service_role;
-- Queries remain owner/scoped through the RPC and existing canonical private-brief RLS.
create index design_video_brief_context_history on public.design_creative_brief_versions(organization_id,created_by,(content->'video_context'),created_at desc,id desc) where content->>'output_type'='video';
commit;
