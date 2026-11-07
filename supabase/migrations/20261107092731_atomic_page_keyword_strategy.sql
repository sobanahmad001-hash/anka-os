-- Local candidate; Regular owns final prerequisite verification and release.
begin;
set local lock_timeout='500ms';
do $$begin
 if to_regclass('private.page_keyword_strategy_commands') is null
 or to_regprocedure('private.project_chat_design_sources_actor(uuid,uuid,uuid,uuid[])') is null
 or to_regprocedure('private.website_approved_source(uuid,uuid,uuid)') is null
 then raise exception 'Exact page receipt, actor source fence and approved page reader prerequisites required';end if;
end;$$;

create function public.save_page_keyword_strategy_atomic(
 p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,
 p_page_id uuid,p_page_key text,p_architecture_version_id uuid,p_request_id uuid,p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='500ms' as $$
declare original private.page_keyword_strategy_commands;e public.engagements;pg public.project_website_pages;
 av public.artifact_versions;architecture jsonb;input_hash text;root_id uuid;version_id uuid;content jsonb;
 keyword jsonb;resolved jsonb:='[]';target_page jsonb;request_row public.content_requests;
 stage uuid;warnings jsonb:='[]';
begin
 if p_actor_id is null or p_request_id is null or p_page_key is null or length(p_page_key) not between 1 and 1208
 or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>524288
 or (select count(*) from jsonb_object_keys(p_input))<>6
 or not p_input?&array['title','content','change_summary','ai_use_allowed','data_classification','stage_id']
 or jsonb_typeof(p_input->'ai_use_allowed') is distinct from 'boolean'
 or coalesce(p_input->>'data_classification','') not in ('public','internal','confidential','restricted')
 or jsonb_typeof(p_input->'title') is distinct from 'string' or length(btrim(p_input->>'title')) not between 1 and 240
 or jsonb_typeof(p_input->'change_summary') is distinct from 'string' or length(p_input->>'change_summary')>1000
 then raise exception 'Exact bounded page keyword strategy request required' using errcode='22023';end if;
 input_hash:=encode(sha256(convert_to(jsonb_build_array(p_project_id,p_engagement_id,p_page_id,p_page_key,p_architecture_version_id,p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id for update;
 if not found then raise exception 'Exact project required' using errcode='42501';end if;
 perform private.n1c_require_scope(p_organization_id,p_project_id,p_actor_id);
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_organization_id and m.user_id=p_actor_id and m.status='active' and m.member_kind='team' and o.status='active'
 and (m.role in ('system_owner','operations_admin','executive') or m.department_id='content') for share of m,o;
 if not found then raise exception 'Current Content authority required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('page-keyword-request:'||p_organization_id::text||':'||p_actor_id::text||':'||p_request_id::text,0));
 select * into original from private.page_keyword_strategy_commands where organization_id=p_organization_id and actor_id=p_actor_id and request_id=p_request_id;
 if found then
  if original.input_hash is distinct from input_hash then raise exception 'Original request has different exact inputs' using errcode='23505';end if;
 else
  perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id and archived_at is null;
  if not found then raise exception 'Current active project required' using errcode='42501';end if;
  select * into e from public.engagements where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id and status in ('planning','active') for update;
  if e.id is null or e.brand_id is null then raise exception 'Current branded engagement required' using errcode='42501';end if;
  perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id
  where es.organization_id=p_organization_id and es.engagement_id=p_engagement_id and es.status='active' and sc.is_active and sc.department_id='content' for share of es,sc;
  if not found then raise exception 'Active Content service required' using errcode='42501';end if;
  if exists(select 1 from public.artifacts where organization_id=p_organization_id and engagement_id=p_engagement_id and artifact_type='keyword_strategy')
  then raise exception 'A keyword strategy already exists; reopen its canonical versions' using errcode='40001';end if;
  select * into av from public.artifact_versions where id=p_architecture_version_id and organization_id=p_organization_id;
  if av.id is null then raise exception 'Exact architecture unavailable' using errcode='42501';end if;
  perform private.project_chat_design_sources_actor(p_actor_id,p_organization_id,p_project_id,array[av.artifact_id]);
  architecture:=private.website_approved_source(p_organization_id,p_project_id,p_architecture_version_id);
  if architecture->>'engagement_id' is distinct from p_engagement_id::text or architecture->>'brand_id' is distinct from e.brand_id::text then raise exception 'Exact source engagement and brand required' using errcode='42501';end if;
  select * into pg from public.project_website_pages where id=p_page_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id for share;
  if pg.id is null or pg.page_key is distinct from p_page_key or pg.brand_id is distinct from e.brand_id or pg.architecture_artifact_id is distinct from av.artifact_id
  or not exists(select 1 from jsonb_array_elements(architecture->'pages') r where r->>'page_key'=p_page_key)
  then raise exception 'Exact registered page required' using errcode='42501';end if;
  content:=p_input->'content';stage:=(p_input->>'stage_id')::uuid;
  if stage is not null then
   perform 1 from public.engagement_stage_instances where id=stage and organization_id=p_organization_id and engagement_id=p_engagement_id and accountable_department_id='content' for share;
   if not found then raise exception 'Exact Content stage required' using errcode='42501';end if;
  end if;
  if content->'schema_version' is distinct from '2'::jsonb or content->>'source_architecture_version_id' is distinct from p_architecture_version_id::text
  or jsonb_typeof(content->'keywords') is distinct from 'array' or jsonb_array_length(content->'keywords') not between 1 and 500
  or not exists(select 1 from jsonb_array_elements(content->'keywords') k where k->>'target_kind'='page' and k->>'target_page_key'=p_page_key)
  then raise exception 'Exact normalized page keyword content required' using errcode='22023';end if;
  for keyword in select value from jsonb_array_elements(content->'keywords') loop
   if jsonb_typeof(keyword) is distinct from 'object' or length(btrim(coalesce(keyword->>'term',''))) not between 1 and 500 or length(btrim(coalesce(keyword->>'locale',''))) not between 1 and 120 then raise exception 'Normalized keyword phrase and locale required' using errcode='22023';end if;
   if keyword->>'target_kind'='page' then
    select value into target_page from jsonb_array_elements(architecture->'pages') r where r->>'page_key'=keyword->>'target_page_key';
    if target_page is null then raise exception 'Keyword targets an absent architecture page' using errcode='42501';end if;
    keyword:=jsonb_set(keyword,'{target_page_slug}',target_page->'path');
   elsif keyword->>'target_kind'='content_request' then
    select * into request_row from public.content_requests where id=(keyword->>'target_content_request_id')::uuid and organization_id=p_organization_id and brand_id=e.brand_id and (mode='general' or engagement_id=p_engagement_id) for share;
    if request_row.id is null then raise exception 'Exact Content request target unavailable' using errcode='42501';end if;
   else raise exception 'Supported explicit keyword target required' using errcode='22023';end if;
   resolved:=resolved||jsonb_build_array(keyword);
  end loop;
  content:=jsonb_set(content,'{keywords}',resolved);
  if exists(select 1 from jsonb_array_elements(resolved) k group by lower(btrim(k->>'term')),lower(btrim(k->>'locale')) having count(*)>1)
  then warnings:='["Duplicate phrase and locale rows were retained without merging; review distinct intents explicitly."]';end if;
  insert into public.artifacts(organization_id,project_id,engagement_id,brand_id,engagement_stage_instance_id,artifact_type,title,created_by)
  values(p_organization_id,p_project_id,p_engagement_id,e.brand_id,stage,'keyword_strategy',btrim(p_input->>'title'),p_actor_id) returning id into root_id;
  insert into public.artifact_versions(organization_id,artifact_id,version_number,parent_version_id,content,content_checksum,change_summary,ai_use_allowed,data_classification,created_by)
  values(p_organization_id,root_id,1,null,content,encode(sha256(convert_to(content::text,'UTF8')),'hex'),p_input->>'change_summary',(p_input->>'ai_use_allowed')::boolean,p_input->>'data_classification',p_actor_id) returning id into version_id;
  insert into public.artifact_relations(organization_id,source_artifact_id,target_artifact_id,relation_type,created_by)
  values(p_organization_id,root_id,av.artifact_id,'targets_page',p_actor_id);
  insert into public.artifact_relations(organization_id,source_artifact_id,target_content_request_id,relation_type,created_by)
  select distinct p_organization_id,root_id,(k->>'target_content_request_id')::uuid,'targets_page',p_actor_id from jsonb_array_elements(resolved) k where k->>'target_kind'='content_request';
  insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
  values(p_organization_id,p_engagement_id,'artifact_version_created',p_actor_id,jsonb_build_object('record_type','artifact','record_id',root_id,'version_id',version_id,'action','version_created','artifact_type','keyword_strategy','source','manual','ai_run_id',null));
  insert into private.page_keyword_strategy_commands(organization_id,actor_id,request_id,project_id,engagement_id,page_id,page_key,architecture_version_id,input_hash,artifact_id,version_id,warnings)
  values(p_organization_id,p_actor_id,p_request_id,p_project_id,p_engagement_id,p_page_id,p_page_key,p_architecture_version_id,input_hash,root_id,version_id,warnings) returning * into original;
 end if;
 return jsonb_build_object('request_id',original.request_id,'project_id',original.project_id,'engagement_id',original.engagement_id,'page_id',original.page_id,'page_key',original.page_key,'architecture_version_id',original.architecture_version_id,'artifact_id',original.artifact_id,'version_id',original.version_id,'warnings',original.warnings);
exception when lock_not_available or deadlock_detected then raise exception 'Page strategy sources busy; retain draft and review before retry' using errcode='40001';
end;$$;
revoke all on function public.save_page_keyword_strategy_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_page_keyword_strategy_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb) to service_role;
commit;
