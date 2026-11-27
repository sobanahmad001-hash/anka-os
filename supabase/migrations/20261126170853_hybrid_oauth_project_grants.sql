-- A separate non-inheriting role prevents OAuth tokens from inheriting app/table/storage access.
create role hybrid_mcp nologin noinherit;
grant hybrid_mcp to authenticator;
grant usage on schema public to hybrid_mcp;
create table private.hybrid_oauth_grants (
 user_id uuid not null references auth.users(id), client_id uuid not null,
 organization_id uuid not null references public.organizations(id), project_id uuid not null references public.projects(id),
 can_save boolean not null default false, revoked_at timestamptz, updated_at timestamptz not null default now(),
 primary key(user_id,client_id)
);
revoke all on private.hybrid_oauth_grants from public,anon,authenticated,service_role;

create function public.set_hybrid_oauth_grant(p_client uuid,p_org uuid,p_project uuid,p_save boolean,p_revoke boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role()<>'authenticated' or auth.jwt()->>'client_id' is not null then raise insufficient_privilege;end if;
 if p_revoke then
  update private.hybrid_oauth_grants set revoked_at=now(),updated_at=now() where user_id=auth.uid() and client_id=p_client;return;
 end if;
 if p_client is null or p_save is null or not exists(select from auth.oauth_clients where id=p_client)
 or not exists(select from public.projects where id=p_project and organization_id=p_org and archived_at is null)
 or not coalesce(public.is_team_organization_member(p_org),false)
 or not coalesce(private.can_access_project(p_project),false) then raise insufficient_privilege;end if;
 insert into private.hybrid_oauth_grants(user_id,client_id,organization_id,project_id,can_save)
 values(auth.uid(),p_client,p_org,p_project,p_save)
 on conflict(user_id,client_id) do update set organization_id=excluded.organization_id,project_id=excluded.project_id,can_save=excluded.can_save,revoked_at=null,updated_at=now();
end;$$;
revoke all on function public.set_hybrid_oauth_grant(uuid,uuid,uuid,boolean,boolean) from public,anon,service_role;
grant execute on function public.set_hybrid_oauth_grant(uuid,uuid,uuid,boolean,boolean) to authenticated;

create function private.require_hybrid_oauth_grant(p_org uuid,p_project uuid,p_write boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role()<>'hybrid_mcp' or auth.jwt()->>'client_id' is null then raise insufficient_privilege;end if;
 if not exists(select from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and oauth_client_id::text=auth.jwt()->>'client_id' and (not_after is null or not_after>now())) then raise insufficient_privilege;end if;
 perform 1 from private.hybrid_oauth_grants g join public.projects p on p.id=g.project_id and p.organization_id=g.organization_id
 where g.user_id=auth.uid() and g.client_id::text=auth.jwt()->>'client_id' and g.organization_id=p_org and g.project_id=p_project
 and g.revoked_at is null and (not p_write or g.can_save) and p.archived_at is null for share of g,p;
 if not found or not coalesce(public.is_team_organization_member(p_org),false) or not coalesce(private.can_access_project(p_project),false)
 then raise insufficient_privilege;end if;
end;$$;
revoke all on function private.require_hybrid_oauth_grant(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create table private.hybrid_oauth_resource (singleton boolean primary key default true check(singleton), audience text not null);
insert into private.hybrid_oauth_resource values(true,'https://fhoxaogfjszftoqtnbav.supabase.co/functions/v1/hybrid-mcp');
revoke all on private.hybrid_oauth_resource from public,anon,authenticated,service_role;

-- Configure this hook only AFTER all resource guards have been deployed and verified.
create function public.hybrid_oauth_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare claims jsonb:=event->'claims';
begin
 if coalesce(event->>'client_id',claims->>'client_id') is not null then
  claims:=jsonb_set(claims,'{role}','"hybrid_mcp"'::jsonb);
  claims:=jsonb_set(claims,'{aud}',to_jsonb((select audience from private.hybrid_oauth_resource where singleton)));
 end if;
 return jsonb_build_object('claims',claims);
end;$$;
revoke all on function public.hybrid_oauth_token_hook(jsonb) from public,anon,authenticated,service_role,hybrid_mcp;
grant execute on function public.hybrid_oauth_token_hook(jsonb) to supabase_auth_admin;

-- OAuth tokens are only usable at these two narrow RPCs, including PUBLIC functions.
-- Install as db_pre_request only after inspecting any existing hook; never overwrite it blindly.
create function public.hybrid_oauth_api_guard() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'client_id' is not null or auth.role()='hybrid_mcp' then
  if auth.role()<>'hybrid_mcp' or coalesce(current_setting('request.path',true),'') not in ('/rpc/hybrid_mcp_context','/rpc/save_hybrid_work_draft')
  then raise insufficient_privilege;end if;
 end if;
end;$$;
revoke all on function public.hybrid_oauth_api_guard() from public,anon,service_role;
grant execute on function public.hybrid_oauth_api_guard() to authenticated,hybrid_mcp,anon;

create function public.hybrid_mcp_context(p_org uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.projects; refs jsonb; gaps jsonb:='[]'; engagement jsonb; engagement_count integer;
begin
 perform private.require_hybrid_oauth_grant(p_org,p_project,false);
 select * into strict p from public.projects where id=p_project and organization_id=p_org;
 select count(*) into engagement_count from public.engagements where project_id=p_project and organization_id=p_org;
 if engagement_count=1 then select jsonb_build_object('id',id,'status',status) into engagement from public.engagements where project_id=p_project and organization_id=p_org and status in ('planning','active');end if;
 if engagement is null then gaps:=gaps||jsonb_build_array(jsonb_build_object('code',case when engagement_count>1 then 'engagement_ambiguous' when engagement_count=0 then 'engagement_missing' else 'engagement_inactive' end));end if;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into refs from (
  select a.id as artifact_id,a.artifact_type,v.id as artifact_version_id,v.version_number,v.content_checksum,
   ap.id as approval_id,ap.approved_at,v.created_at as evidence_created_at,false as body_included
  from public.artifacts a join public.artifact_versions v on v.artifact_id=a.id and v.organization_id=a.organization_id
  join public.artifact_approvals ap on ap.artifact_id=a.id and ap.artifact_version_id=v.id and ap.organization_id=a.organization_id and ap.engagement_id=a.engagement_id
  join public.engagements e on e.id=a.engagement_id and e.project_id=p_project and e.organization_id=p_org
  where engagement is not null and a.organization_id=p_org and a.project_id=p_project and ap.decision='approved' and v.ai_use_allowed
  and v.data_classification in ('public','internal','confidential') and e.status in ('planning','active')
  order by ap.approved_at desc,ap.id limit 201
 ) x;
 if jsonb_array_length(refs)>200 then raise exception 'Context exceeds bounds';end if;
 if jsonb_array_length(refs)=0 then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','approved_shared_sources_missing'));end if;
 if nullif(btrim(p.description),'') is null then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','business_description_missing'));end if;
 if nullif(btrim(p.scope_statement),'') is null then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','scope_missing'));end if;
 return jsonb_build_object('schema_version',1,'operation','project.get_context','organization_id',p_org,'project_id',p_project,'actor_id',auth.uid(),
  'observed_at',now(),'project',jsonb_build_object('id',p.id,'name',p.name,'status',p.status,'business_description',p.description,'scope_statement',p.scope_statement,'input_state','recorded_not_approval'),
  'engagement',engagement,'positioning',null,'approved_versions',refs,'gaps',gaps,'private_chat_included',false,'external_write_authorized',false);
end;$$;
revoke all on function public.hybrid_mcp_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.hybrid_mcp_context(uuid,uuid) to hybrid_mcp;
-- Thin transactional adapter over canonical Work content; no provider execution.
create or replace function public.save_hybrid_work_draft(p_org uuid,p_project uuid,p_card_kind text,p_card_id uuid,p_request uuid,p_previous uuid,p_title text,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved private.work_content_versions; base private.work_content_versions; latest uuid;
begin
 if auth.role()='hybrid_mcp' then perform private.require_hybrid_oauth_grant(p_org,p_project,true);
 elsif auth.uid() is null or auth.role() is distinct from 'authenticated' or auth.jwt()->>'client_id' is not null then raise insufficient_privilege;end if;
 if p_request is null or p_card_kind not in ('project_task','engagement_work_item') then raise invalid_parameter_value;end if;
 perform private.work_asset_card(p_org,p_project,p_card_kind,p_card_id,true);
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for share;
 if not found then raise insufficient_privilege;end if;
 -- Serialize a document across cards, as one document can be reused on several cards.
 if p_previous is not null then
  select * into strict base from private.work_content_versions where id=p_previous and project_id=p_project;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(base.document_id,p_request)::text,113));
 perform pg_advisory_xact_lock(hashtextextended(p_card_id::text,112));
 if not exists(select from private.work_content_versions where id=p_request) and p_previous is not null then
  select id into latest from private.work_content_versions where project_id=p_project and document_id=base.document_id order by version desc limit 1;
  if latest is distinct from p_previous then raise exception 'Reopen the latest draft before saving' using errcode='40001';end if;
 end if;
 perform public.save_work_content(p_org,p_project,p_card_kind,p_card_id,p_request,p_previous,p_title,p_body);
 select * into strict saved from private.work_content_versions where id=p_request and project_id=p_project;
 return jsonb_build_object('schema_version',1,'organization_id',p_org,'project_id',p_project,'card_kind',p_card_kind,'card_id',p_card_id,'request_id',p_request,'asset_kind','content','document_id',saved.document_id,'version_id',saved.id,'version_number',saved.version,'state','draft');
end;$$;
revoke all on function public.save_hybrid_work_draft(uuid,uuid,text,uuid,uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.save_hybrid_work_draft(uuid,uuid,text,uuid,uuid,uuid,text,text) to authenticated;
notify pgrst,'reload schema';

grant execute on function public.save_hybrid_work_draft(uuid,uuid,text,uuid,uuid,uuid,text,text) to hybrid_mcp;


create function public.list_hybrid_oauth_grants() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role()<>'authenticated' or auth.jwt()->>'client_id' is not null then raise insufficient_privilege;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('client_id',g.client_id,'organization_id',g.organization_id,'project_id',g.project_id,'project_name',p.name,'can_save',g.can_save)),'[]')
 from private.hybrid_oauth_grants g join public.projects p on p.id=g.project_id where g.user_id=auth.uid() and g.revoked_at is null);
end;$$;
revoke all on function public.list_hybrid_oauth_grants() from public,anon,service_role;
grant execute on function public.list_hybrid_oauth_grants() to authenticated;
notify pgrst,'reload schema';

-- Preserve any existing request hook rather than silently replacing it.
do $$ begin
 if exists(select from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) c
 where r.rolname='authenticator' and c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request=public.hybrid_oauth_api_guard')
 then raise exception 'Existing API request hook requires explicit integration';end if;
end $$;
alter role authenticator set pgrst.db_pre_request='public.hybrid_oauth_api_guard';
notify pgrst,'reload config';

