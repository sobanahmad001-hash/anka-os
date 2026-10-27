-- Explicit organization-admin review of the approved reusable Website starter only.
-- Existing department publication functions, project activation and run guards are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table private.website_starter_publications (
 organization_id uuid primary key references public.organizations(id) on delete restrict,
 request_id uuid not null unique, actor_id uuid not null references auth.users(id) on delete restrict,
 review_sha256 text not null check(review_sha256 ~ '^[0-9a-f]{64}$'),
 reason text not null check(length(btrim(reason)) between 1 and 500),
 publication_path text not null check(publication_path='organization_admin_website_review'),
 template_version_id uuid not null references public.pipeline_template_versions(id),
 preset_publication_id uuid not null references public.pipeline_template_publications(id),
 definition_id uuid not null references public.pipeline_execution_definitions(id),
 execution_publication_id uuid not null references public.pipeline_execution_publications(id),
 published_at timestamptz not null default clock_timestamp(), result jsonb not null
);
create index website_starter_actor on private.website_starter_publications(actor_id);
create index website_starter_template_version on private.website_starter_publications(template_version_id);
create index website_starter_preset on private.website_starter_publications(preset_publication_id);
create index website_starter_definition on private.website_starter_publications(definition_id);
create index website_starter_execution on private.website_starter_publications(execution_publication_id);
alter table private.website_starter_publications enable row level security;
revoke all on private.website_starter_publications from public,anon,authenticated,service_role;
create trigger protect_website_starter_publications before update or delete on private.website_starter_publications
 for each row execute function private.reject_pipeline_template_mutation();
create function private.website_starter_seed() returns jsonb language sql immutable set search_path='' as $$
 select '{"revision":1,"template":{"p_pipeline_template_id":null,"p_slug":"website_core_normalized_leaf","p_name":"Website core delivery - normalized_leaf service IDs","p_description":"Reusable human Content to Design to staging Website plan. Publication does not activate project services, assign work, approve deliverables, start runs or authorize production launch.","p_service_ids":["899885a6-3c6c-5637-b8e2-1f74eedb3de6","b0fe244b-5b41-5630-b83e-e017639102a0","951714be-5684-52e3-9255-adbd9dcdaa39"],"p_source_version_id":null,"p_change_summary":"Exact leaf Website starter published after explicit organization admin review."},"execution":{"p_name":"Website core human delivery v1 - normalized_leaf","p_steps":[{"key":"copy","label":"Prepare scoped website page copy","kind":"human","department_id":"content","service_id":"899885a6-3c6c-5637-b8e2-1f74eedb3de6","depends_on":[],"stage_contract":{"optional":false,"output_label":"Scoped page copy drafts; canonical artifact approval remains separate","reuse_allowed":true,"required_inputs":[{"key":"scope_reference","label":"Client brief and agreed page scope reference","kind":"manual"}],"artifact_type":"content","output_type":"website_page_copy"}},{"key":"copy_review","label":"Review content handoff","kind":"approval_gate","department_id":"content","service_id":"899885a6-3c6c-5637-b8e2-1f74eedb3de6","depends_on":["copy"],"stage_contract":{"optional":false,"output_label":"Human review record; reference actual artifact decisions separately","reuse_allowed":false,"required_inputs":[]}},{"key":"layouts","label":"Prepare unique website UI layouts","kind":"human","department_id":"design","service_id":"b0fe244b-5b41-5630-b83e-e017639102a0","depends_on":["copy_review"],"stage_contract":{"optional":false,"output_label":"Scoped UI layout package for human review","reuse_allowed":false,"required_inputs":[{"key":"layout_scope","label":"Unique layout scope and responsive requirements","kind":"manual"}]}},{"key":"design_review","label":"Review design handoff","kind":"approval_gate","department_id":"design","service_id":"b0fe244b-5b41-5630-b83e-e017639102a0","depends_on":["layouts"],"stage_contract":{"optional":false,"output_label":"Human design handoff record; no artifact approval is inferred","reuse_allowed":false,"required_inputs":[]}},{"key":"implementation","label":"Build scoped website pages in staging","kind":"human","department_id":"development","service_id":"951714be-5684-52e3-9255-adbd9dcdaa39","depends_on":["design_review"],"stage_contract":{"optional":false,"output_label":"Staging implementation and verification notes","reuse_allowed":false,"required_inputs":[{"key":"staging_target","label":"Authorized staging target and implementation scope; no credentials","kind":"manual"}]}},{"key":"implementation_review","label":"Review implementation handoff","kind":"approval_gate","department_id":"development","service_id":"951714be-5684-52e3-9255-adbd9dcdaa39","depends_on":["implementation"],"stage_contract":{"optional":false,"output_label":"Human staging handoff record; launch remains separately authorized","reuse_allowed":false,"required_inputs":[]}}]}}'::jsonb;
$$;
revoke all on function private.website_starter_seed() from public,anon,authenticated,service_role;
create function private.website_starter_review(p_organization_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); seed jsonb:=private.website_starter_seed(); service uuid; rows jsonb; manifest jsonb; receipt jsonb;
begin
 if actor is null then raise exception 'Sign in to review the Website plan' using errcode='42501';end if;
 -- Current selected-organization membership, never a global profile or client claim.
 -- Exclusive lock matches existing author functions and serializes revocation/publication.
 perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id
 where o.id=p_organization_id and o.status='active' and m.user_id=actor and m.member_kind='team'
 and m.status='active' and m.role in ('system_owner','operations_admin') for update of o,m;
 if not found then raise exception 'Current organization owner or operations admin required' using errcode='42501';end if;
 select to_jsonb(w) into receipt from private.website_starter_publications w where w.organization_id=p_organization_id;
 if receipt is not null then return jsonb_build_object('published',true,'receipt',receipt);end if;
 for service in select value::uuid from jsonb_array_elements_text(seed->'template'->'p_service_ids') order by value loop
  perform 1 from public.service_catalog c where c.id=service and c.organization_id=p_organization_id and c.is_active for share;
  if not found then raise exception 'Exact Website leaf services are unavailable in this organization' using errcode='55000';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'department',c.department_id,'unit',c.unit,'recurrence',c.recurrence) order by s.position)
 into rows from jsonb_array_elements_text(seed->'template'->'p_service_ids') with ordinality s(id,position)
 join public.service_catalog c on c.id=s.id::uuid and c.organization_id=p_organization_id;
 if exists(select 1 from jsonb_array_elements(seed->'execution'->'p_steps') x
 join public.service_catalog c on c.id=(x->>'service_id')::uuid and c.organization_id=p_organization_id
 where c.department_id is distinct from x->>'department_id' or c.unit is distinct from 'page' or c.recurrence is distinct from 'per_batch') then
 raise exception 'Website leaf service contract changed; review the catalogue' using errcode='40001';end if;
 if exists(select 1 from public.pipeline_templates t where t.organization_id=p_organization_id and t.slug=seed->'template'->>'p_slug') then
 raise exception 'A Website starter draft already exists; review its exact versions in Advanced' using errcode='23505';end if;
 manifest:=private.pipeline_rule_manifest(p_organization_id,array(select value::uuid from jsonb_array_elements_text(seed->'template'->'p_service_ids')));
 return jsonb_build_object('published',false,'plan',seed,'services',rows,'manifest',manifest,'review_sha256',encode(extensions.digest(convert_to(
 jsonb_build_object('organization_id',p_organization_id,'seed',seed,'services',rows,'manifest',manifest)::text,'UTF8'),'sha256'),'hex'));
end;$$;
revoke all on function private.website_starter_review(uuid) from public,anon,authenticated,service_role;
create function public.review_website_starter(p_organization_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select private.website_starter_review(p_organization_id);
$$;
revoke all on function public.review_website_starter(uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_website_starter(uuid) to authenticated;
create function public.publish_website_starter(p_organization_id uuid,p_request_id uuid,p_review_sha256 text,p_reason text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); review jsonb; seed jsonb; created jsonb; version public.pipeline_template_versions;
 preset uuid; definition uuid; publication uuid; manifest jsonb; response jsonb; previous private.website_starter_publications;
begin
 if p_request_id is null or p_review_sha256 is null or p_review_sha256 !~ '^[0-9a-f]{64}$' or p_reason is null
 or length(btrim(p_reason)) not between 1 and 500 then raise exception 'Review the exact plan and provide a publication reason' using errcode='22023';end if;
 review:=private.website_starter_review(p_organization_id); -- authority also rechecked for every replay
 if (review->>'published')::boolean then
  select * into previous from private.website_starter_publications where organization_id=p_organization_id;
  if previous.request_id<>p_request_id or previous.actor_id<>actor or previous.review_sha256<>p_review_sha256 or previous.reason<>btrim(p_reason) then
   raise exception 'This organization already has a published Website starter; refresh its receipt' using errcode='23505';end if;
  return previous.result || jsonb_build_object('idempotent_replay',true);
 end if;
 if review->>'review_sha256'<>p_review_sha256 then raise exception 'Website plan changed; review it again' using errcode='40001';end if;
 seed:=review->'plan';
 created:=public.create_pipeline_template_version(p_organization_id,null,seed->'template'->>'p_slug',seed->'template'->>'p_name',
 seed->'template'->>'p_description',array(select value::uuid from jsonb_array_elements_text(seed->'template'->'p_service_ids')),null,seed->'template'->>'p_change_summary');
 select * into strict version from public.pipeline_template_versions where id=(created->>'pipeline_template_version_id')::uuid and organization_id=p_organization_id for update;
 manifest:=review->'manifest';
 -- Explicit new admin publication authority. No department approval rows are manufactured.
 insert into public.pipeline_template_publications(organization_id,pipeline_template_id,pipeline_template_version_id,publication_number,published_rule_manifest,published_rule_sha256,published_by)
 values(p_organization_id,version.pipeline_template_id,version.id,1,manifest,encode(extensions.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex'),actor) returning id into preset;
 -- Reuse the existing author validation for service membership, dependencies and input/output contracts.
 created:=public.create_pipeline_execution_definition(p_organization_id,preset,p_request_id,seed->'execution'->>'p_name',seed->'execution'->'p_steps');
 definition:=(created->>'definition_id')::uuid;
 insert into public.pipeline_execution_publications(organization_id,definition_id,published_by) values(p_organization_id,definition,actor) returning id into publication;
 response:=jsonb_build_object('template_version_id',version.id,'preset_publication_id',preset,'definition_id',definition,'execution_publication_id',publication,
 'name',seed->'execution'->>'p_name','review_sha256',p_review_sha256,'published_by',actor,'publication_path','organization_admin_website_review','idempotent_replay',false);
 insert into private.website_starter_publications(organization_id,request_id,actor_id,review_sha256,reason,publication_path,template_version_id,preset_publication_id,definition_id,execution_publication_id,result)
 values(p_organization_id,p_request_id,actor,p_review_sha256,btrim(p_reason),'organization_admin_website_review',version.id,preset,definition,publication,response);
 return response;
end;$$;
revoke all on function public.publish_website_starter(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_website_starter(uuid,uuid,text,text) to authenticated;
comment on table private.website_starter_publications is 'Immutable actual organization-admin review and atomic exact Website preset/execution publication receipt. No department signoffs inferred.';
commit;
