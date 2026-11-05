-- Explicit presentation bindings in the EXISTING immutable project plan.
-- No Work/asset/approval/recurrence mutation or new registry.
do $guard$ begin
 if md5(pg_get_functiondef(to_regprocedure('private.build_service_project_plan(uuid,uuid,uuid,jsonb)'))) is distinct from '3451c8794c115f0f1fcd3f206993223b' then
  raise exception 'Current service plan prerequisite differs' using errcode='55000';
 end if;
 if to_regprocedure('private.project_stage_phase_catalog()') is not null then
  raise exception 'Stage-plan namespace already installed' using errcode='55000';
 end if;
end;$guard$;

create function private.project_stage_phase_catalog() returns jsonb
language sql immutable set search_path='' as $catalog$
select '[{"key":"branding.brief","track":"branding","label":"Business brief","position":1},{"key":"branding.positioning","track":"branding","label":"Brand positioning and statement","position":2},{"key":"branding.services","track":"branding","label":"Product and service structure","position":3},{"key":"branding.identity","track":"branding","label":"Messaging and visual identity","position":4},{"key":"website.goals","track":"website","label":"Goals and audience","position":5},{"key":"website.keywords","track":"website","label":"Keyword research and search intent","position":6},{"key":"website.sitemap","track":"website","label":"Sitemap and keyword-to-page mapping","position":7},{"key":"website.content","track":"website","label":"Page content","position":8},{"key":"website.design","track":"website","label":"Design","position":9},{"key":"website.build","track":"website","label":"Build","position":10},{"key":"website.qa","track":"website","label":"QA","position":11},{"key":"website.publish","track":"website","label":"Publish","position":12},{"key":"website.marketing_ready","track":"website","label":"Ready for marketing","position":13},{"key":"marketing.goals","track":"marketing","label":"Goals and baseline","position":14},{"key":"marketing.opportunities","track":"marketing","label":"Audience and keyword opportunities","position":15},{"key":"marketing.plan","track":"marketing","label":"Campaign and content plan","position":16},{"key":"marketing.assets","track":"marketing","label":"Create assets","position":17},{"key":"marketing.review","track":"marketing","label":"Review","position":18},{"key":"marketing.launch","track":"marketing","label":"Launch","position":19},{"key":"marketing.measure","track":"marketing","label":"Measure","position":20},{"key":"marketing.improve","track":"marketing","label":"Improve and next cycle","position":21}]'::jsonb;
$catalog$;
revoke all on function private.project_stage_phase_catalog() from public,anon,authenticated,service_role;

-- Pure compiler: authoritative saved plan + publication metadata supplied ONLY by
-- the closed native resolver. The client never supplies the saved snapshot.
create function private.compile_project_stage_bindings(p_groups jsonb,p_bindings jsonb) returns jsonb
language plpgsql immutable set search_path='' as $compile$
declare item jsonb;g jsonb;s jsonb;phase jsonb;answer jsonb:='[]';begin
 if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups)>100
  or jsonb_typeof(p_bindings) is distinct from 'array' or jsonb_array_length(p_bindings)>200
  or octet_length(p_bindings::text)>65536 then
  raise exception 'Bounded exact phase bindings required' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_bindings) loop
  if jsonb_typeof(item) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(item) k where k not in ('group_id','publication_id','step_key','phase'))
   or (select count(*) from jsonb_object_keys(item))<>4
   or jsonb_typeof(item->'group_id') is distinct from 'string'
   or jsonb_typeof(item->'publication_id') is distinct from 'string'
   or jsonb_typeof(item->'step_key') is distinct from 'string'
   or length(item->>'step_key') not between 1 and 120
   or jsonb_typeof(item->'phase') is distinct from 'string' then
   raise exception 'Exact group, publication, step and phase required' using errcode='22023';end if;
  select value into g from jsonb_array_elements(p_groups)
   where value->>'pipeline_group_id'=item->>'group_id' and value->>'definition_publication_id'=item->>'publication_id';
  select value into s from jsonb_array_elements(coalesce(g->'stages','[]')) where value->>'key'=item->>'step_key';
  select value into phase from jsonb_array_elements(private.project_stage_phase_catalog()) where value->>'key'=item->>'phase';
  if g is null or s is null or phase is null or phase->>'track' is distinct from g->>'kind'
   or jsonb_typeof(s->'stage_contract') is distinct from 'object' then
   raise exception 'Phase binding is outside the exact saved published plan' using errcode='42501';end if;
  if exists(select 1 from jsonb_array_elements(answer) x where x->>'group_id'=item->>'group_id' and x->>'step_key'=item->>'step_key') then
   raise exception 'Each published step belongs to exactly one display phase' using errcode='22023';end if;
  answer:=answer||jsonb_build_array(item);
 end loop;
 select coalesce(jsonb_agg(x order by x->>'group_id',x->>'step_key'),'[]') into answer from jsonb_array_elements(answer) x;
 return answer;
end;$compile$;
revoke all on function private.compile_project_stage_bindings(jsonb,jsonb) from public,anon,authenticated,service_role;

create function private.project_stage_binding_review(p_org uuid,p_project uuid,p_engagement uuid,p_expected_plan uuid,p_bindings jsonb) returns jsonb
language plpgsql set search_path='' as $review$
declare plan private.project_delivery_plan_versions;g jsonb;current_group public.project_pipeline_groups;
 publication public.pipeline_execution_publications;definition public.pipeline_execution_definitions;
 groups jsonb:='[]';bindings jsonb;material jsonb;begin
 perform private.n2_scope_require_member(p_org,p_project,true);
 if private.n6_project_configuration_authorized(p_org,p_project,auth.uid()) is distinct from true then
  raise exception 'Current exact project configuration authority required' using errcode='42501';end if;
 perform 1 from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project and status in ('planning','active') for share;
 if not found then raise exception 'Current exact engagement required' using errcode='42501';end if;
 select * into plan from private.project_delivery_plan_versions
  where organization_id=p_org and project_id=p_project and engagement_id=p_engagement order by version_number desc limit 1;
 if plan.id is null or plan.id is distinct from p_expected_plan then
  raise exception 'Review the current saved plan before binding stages' using errcode='40001';end if;
 if jsonb_typeof(plan.snapshot->'groups') is distinct from 'array' or jsonb_array_length(plan.snapshot->'groups')>100 then
  raise exception 'Saved plan groups unavailable' using errcode='55000';end if;
 for g in select value from jsonb_array_elements(plan.snapshot->'groups') order by value->>'pipeline_group_id' loop
  select * into current_group from public.project_pipeline_groups
   where id=(g->>'pipeline_group_id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=p_engagement
    and kind=g->>'kind' and preset_publication_id=(g->>'preset_publication_id')::uuid for share;
  select * into publication from public.pipeline_execution_publications
   where id=(g->>'definition_publication_id')::uuid and organization_id=p_org for share;
  select * into definition from public.pipeline_execution_definitions
   where id=publication.definition_id and organization_id=p_org and preset_publication_id=current_group.preset_publication_id for share;
  if current_group.id is null or definition.id is null
   or definition.steps_sha256 is distinct from encode(sha256(convert_to(definition.steps::text,'UTF8')),'hex')
   or exists(select 1 from jsonb_array_elements(g->'stages') x where not exists(select 1 from jsonb_array_elements(definition.steps) s where s->>'key'=x->>'key' and s=x-'selected_service'-'planned_quantity'-'source_review_required')) then
   raise exception 'Saved published stage identity changed' using errcode='55000';end if;
  groups:=groups||jsonb_build_array(g);
 end loop;
 bindings:=private.compile_project_stage_bindings(groups,p_bindings);
 material:=jsonb_build_object('version',1,'organization_id',p_org,'project_id',p_project,'engagement_id',p_engagement,
  'parent_version_id',plan.id,'bindings',bindings);
 return material||jsonb_build_object('review_sha256',encode(sha256(convert_to(material::text,'UTF8')),'hex'),
  'changed',bindings is distinct from coalesce(plan.snapshot->'stage_bindings'->'bindings','[]'));
end;$review$;
revoke all on function private.project_stage_binding_review(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.review_project_stage_bindings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_expected_plan_id uuid,p_bindings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $review$
begin
 return private.project_stage_binding_review(p_organization_id,p_project_id,p_engagement_id,p_expected_plan_id,p_bindings);
end;$review$;
revoke all on function public.review_project_stage_bindings(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.review_project_stage_bindings(uuid,uuid,uuid,uuid,jsonb) to authenticated;

create function public.apply_project_stage_bindings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_expected_plan_id uuid,p_request_id uuid,p_review_sha256 text,p_bindings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $apply$
declare actor uuid:=auth.uid();prior private.project_delivery_plan_versions;existing private.project_delivery_plan_versions;
 answer private.project_delivery_plan_versions;review jsonb;digest text;begin
 if actor is null or p_request_id is null or p_expected_plan_id is null or coalesce(p_review_sha256,'')!~'^[a-f0-9]{64}$' then
  raise exception 'Authenticated exact reviewed stage binding required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform private.n2_scope_require_member(p_organization_id,p_project_id,true);
 if private.n6_project_configuration_authorized(p_organization_id,p_project_id,actor) is distinct from true then
  raise exception 'Current exact project configuration authority required' using errcode='42501';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array('project_stage_bindings_v1',p_project_id,p_engagement_id,p_expected_plan_id,p_review_sha256,p_bindings)::text,'UTF8')),'hex');
 select * into existing from private.project_delivery_plan_versions where organization_id=p_organization_id and created_by=actor and request_id=p_request_id;
 if found then
  if existing.request_sha256 is distinct from digest then raise exception 'Original request owns another exact plan' using errcode='23505';end if;
  return to_jsonb(existing);
 end if;
 perform 1 from public.engagements where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id and status in ('planning','active') for update;
 if not found then raise exception 'Current exact engagement required' using errcode='42501';end if;
 review:=private.project_stage_binding_review(p_organization_id,p_project_id,p_engagement_id,p_expected_plan_id,p_bindings);
 if review->>'review_sha256' is distinct from p_review_sha256 then raise exception 'Stage binding review changed' using errcode='40001';end if;
 if review->'changed' is distinct from 'true'::jsonb then raise exception 'No stage binding delta to save' using errcode='22023';end if;
 select * into prior from private.project_delivery_plan_versions where id=p_expected_plan_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;
 insert into private.project_delivery_plan_versions(organization_id,project_id,engagement_id,version_number,parent_version_id,snapshot,request_id,request_sha256,created_by)
 values(p_organization_id,p_project_id,p_engagement_id,prior.version_number+1,prior.id,
 prior.snapshot||jsonb_build_object('parent_version_id',prior.id,'stage_bindings',jsonb_build_object('version',1,'request_id',p_request_id,'bindings',review->'bindings')),
 p_request_id,digest,actor) returning * into answer;
 return to_jsonb(answer);
end;$apply$;
revoke all on function public.apply_project_stage_bindings(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_project_stage_bindings(uuid,uuid,uuid,uuid,uuid,text,jsonb) to authenticated;

create function public.recover_project_stage_bindings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $recover$
declare answer private.project_delivery_plan_versions;begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 select * into answer from private.project_delivery_plan_versions where organization_id=p_organization_id and project_id=p_project_id
  and engagement_id=p_engagement_id and created_by=auth.uid() and request_id=p_request_id
  and snapshot->'stage_bindings'->>'request_id'=request_id::text;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,
  'status',case when answer.id is null then 'not_found' else 'applied' end,
  'original_result',case when answer.id is null then null else to_jsonb(answer) end,'read_only',true);
end;$recover$;
revoke all on function public.recover_project_stage_bindings(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.recover_project_stage_bindings(uuid,uuid,uuid,uuid) to authenticated;

-- Service quantities/added services keep these exact display bindings in the same
-- plan history. A changed/missing publication is reported unconfigured/stale by the
-- reader; it is never silently mapped to a different step.
CREATE OR REPLACE FUNCTION private.build_service_project_plan(p_org uuid, p_project uuid, p_engagement uuid, p_choices jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare foundation jsonb;setup jsonb;prior private.project_delivery_plan_versions;item jsonb;old_item jsonb;candidate jsonb;ranked jsonb;contributions jsonb:='[]';unmapped jsonb:='[]';changes jsonb:='[]';bundles jsonb:='[]';bundle record;group_rows jsonb;chosen uuid;prior_group jsonb;bucket text;stages jsonb;result jsonb;catalogue jsonb;branding_catalogue jsonb:='[]';eligible jsonb;prior_choice text;explicit_choice text;scope_row jsonb;choice text;bucket_keys text[]:='{}';
begin
 perform private.n2_scope_require_member(p_org,p_project,false);
 perform 1 from public.engagements where id=p_engagement and project_id=p_project and organization_id=p_org and status in ('planning','active') for share;
 if not found then raise exception 'Exact active project engagement required' using errcode='42501';end if;
 if jsonb_typeof(p_choices) is distinct from 'object' or octet_length(p_choices::text)>8192 then raise exception 'Bounded exact pipeline choices required' using errcode='22023';end if;
 setup:=public.get_project_setup(p_org,p_project);
 select * into prior from private.project_delivery_plan_versions where organization_id=p_org and project_id=p_project and engagement_id=p_engagement order by version_number desc limit 1;
 foundation:=case when setup->'state'->'plan'->'foundation'->>'engagement_id'=p_engagement::text then setup->'state'->'plan'->'foundation' else prior.snapshot->'foundation' end;
 begin
  foundation:=private.resolve_project_foundation(p_org,p_project,foundation->'intent');
 exception when insufficient_privilege then
  foundation:=foundation||jsonb_build_object('binding_stale',true,'sources_available',false,'ready_for_preparation',false,'ready_for_traffic',false,'gaps',jsonb_build_array(jsonb_build_object('role','foundation','reason','Pinned guidance unavailable or changed; review exact replacement')));
 end;

 select coalesce(jsonb_agg(jsonb_build_object('publication_id',p.id,'definition_id',d.id,'preset_publication_id',d.preset_publication_id,'name',d.name,'version_number',d.version_number,'steps',d.steps) order by p.id),'[]') into catalogue
 from public.pipeline_execution_publications p join public.pipeline_execution_definitions d on d.id=p.definition_id and d.organization_id=p.organization_id join public.pipeline_template_publications t on t.id=d.preset_publication_id and t.organization_id=d.organization_id
 where p.organization_id=p_org and jsonb_typeof(d.steps)='array' and jsonb_array_length(d.steps) between 1 and 50 and not exists(select 1 from jsonb_array_elements(d.steps) s where jsonb_typeof(s->'stage_contract') is distinct from 'object');
 if jsonb_array_length(catalogue)>100 then raise exception 'Published plan catalogue exceeds the bounded planning view; Administration must narrow it' using errcode='54000';end if;

 -- Resolve/lock each relevant Branding preset once, before suggestions or pins.
 if exists(select 1 from jsonb_array_elements(coalesce(setup->'state'->'plan'->'contributions','[]')) m where m->>'pipeline'='branding') then
  with relevant as materialized (
   select distinct (c->>'preset_publication_id')::uuid as preset_id from jsonb_array_elements(catalogue) c
   where exists(select 1 from jsonb_array_elements(c->'steps') s
    join jsonb_array_elements(coalesce(setup->'state'->'plan'->'contributions','[]')) m on m->>'service_id'=s->>'service_id'
    join jsonb_array_elements(setup->'scopes') sc on sc->>'service_id'=m->>'service_id'
    where m->>'pipeline'='branding' and sc->>'status'<>'cancelled')
  ), current_presets as materialized (
   select preset_id,private.branding_preset_current(p_org,preset_id) as allowed from relevant
  )
  select coalesce(jsonb_agg(c order by c->>'publication_id'),'[]') into branding_catalogue
  from jsonb_array_elements(catalogue) c join current_presets p on p.preset_id=(c->>'preset_publication_id')::uuid where p.allowed;
 end if;
 if foundation is distinct from prior.snapshot->'foundation' then changes:=changes||jsonb_build_array(jsonb_build_object('kind','foundation','name','Brand foundation','action','Review changed guideline binding; prior output and review evidence retained','foundation_before',prior.snapshot->'foundation','foundation_after',foundation));end if;
 for scope_row in select x from jsonb_array_elements(setup->'scopes') x where x->>'status'<>'cancelled' order by x->>'service_id' loop
  select x into item from jsonb_array_elements(coalesce(setup->'state'->'plan'->'contributions','[]')) x where x->>'service_id'=scope_row->>'service_id';
  item:=coalesce(item,'{}')||jsonb_build_object('scope_id',scope_row->>'id','service_id',scope_row->>'service_id','revision',scope_row->'revision','quantity',scope_row->'quantity','status',scope_row->>'status','cadence',coalesce(scope_row->>'recurrence','unspecified'),'name',coalesce((select c->>'name' from jsonb_array_elements(setup->'catalog') c where c->>'id'=scope_row->>'service_id'),'Service'),'unit',scope_row->'unit');
  if not exists(select 1 from jsonb_array_elements(setup->'catalog') c where c->>'id'=item->>'service_id' and (c->>'is_active')::boolean) then
   item:=item||jsonb_build_object('planning_issue','This catalogue service is unavailable; review current scope before planning new work');
  elsif item->>'pipeline' is null or item->>'pipeline' not in ('branding','website','marketing') then
   item:=item||jsonb_build_object('planning_issue','Choose Branding, Website or Marketing in the shared service setup review');
  else
   select coalesce(jsonb_agg(c order by c->>'publication_id'),'[]') into eligible
   from jsonb_array_elements(case when item->>'pipeline'='branding' then branding_catalogue else catalogue end) c
   where exists(select 1 from jsonb_array_elements(c->'steps') s where s->>'service_id'=item->>'service_id');
   with scores as (select c,
    (select count(distinct s->>'service_id') from jsonb_array_elements(c->'steps') s where exists(select 1 from jsonb_array_elements(coalesce(setup->'state'->'plan'->'contributions','[]')) m join jsonb_array_elements(setup->'scopes') sc on sc->>'service_id'=m->>'service_id' where m->>'pipeline'=item->>'pipeline' and sc->>'recurrence'=item->>'cadence' and sc->>'status'<>'cancelled' and m->>'service_id'=s->>'service_id')) as covered,
    (select count(distinct s->>'service_id') from jsonb_array_elements(c->'steps') s where not exists(select 1 from jsonb_array_elements(coalesce(setup->'state'->'plan'->'contributions','[]')) m join jsonb_array_elements(setup->'scopes') sc on sc->>'service_id'=m->>'service_id' where m->>'pipeline'=item->>'pipeline' and sc->>'recurrence'=item->>'cadence' and sc->>'status'<>'cancelled' and m->>'service_id'=s->>'service_id')) as extra
    from jsonb_array_elements(eligible) c),
   ranks as(select c,dense_rank() over(order by covered desc,extra,jsonb_array_length(c->'steps')) as rank from scores)
   select coalesce(jsonb_agg(c order by c->>'publication_id'),'[]') into ranked from ranks where rank=1;
   candidate:=null;
   explicit_choice:=p_choices->>('definition:'||(item->>'service_id'));prior_choice:=null;
   select x->>'publication_id' into prior_choice from jsonb_array_elements(coalesce(prior.snapshot->'contributions','[]'::jsonb)) x where x->>'scope_id'=item->>'scope_id';
   if explicit_choice is not null then
    select c into candidate from jsonb_array_elements(eligible) c where c->>'publication_id'=explicit_choice;
    if candidate is null then raise exception 'Choose an exact current matching published definition' using errcode='42501';end if;
    bucket_keys:=array_append(bucket_keys,'definition:'||(item->>'service_id'));
   elsif prior_choice is not null then
    -- Ranking is a suggestion, never a reason to replace a still-valid pin.
    select c into candidate from jsonb_array_elements(eligible) c where c->>'publication_id'=prior_choice;
   elsif jsonb_array_length(ranked)=1 then candidate:=ranked->0;
   end if;
   if candidate is not null then
    item:=item||jsonb_build_object('publication_id',candidate->>'publication_id','preset_publication_id',candidate->>'preset_publication_id','definition_id',candidate->>'definition_id','definition_name',candidate->>'name');
   else
    item:=item||jsonb_build_object('planning_issue',case when prior_choice is not null then 'The pinned published definition is no longer eligible; review an exact replacement' when jsonb_array_length(eligible)=0 then 'Administration must publish a matching service plan' else 'Review and select an exact matching published plan for this service' end,
      'previous_publication_id',prior_choice,'definition_choice_key','definition:'||(item->>'service_id'),'definition_options',eligible);
   end if;
  end if;
  select x into old_item from jsonb_array_elements(coalesce(prior.snapshot->'contributions','[]')) x where x->>'scope_id'=item->>'scope_id';
  if old_item is distinct from item then changes:=changes||jsonb_build_array(jsonb_build_object('scope_id',item->>'scope_id','service_id',item->>'service_id','name',item->>'name','action',case when old_item is null then 'add' else 'review change' end,'before',old_item,'after',item));end if;
  contributions:=contributions||jsonb_build_array(item);
  if item ? 'planning_issue' then unmapped:=unmapped||jsonb_build_array(item);end if;
 end loop;
 for old_item in select x from jsonb_array_elements(coalesce(prior.snapshot->'contributions','[]')) x where not exists(select 1 from jsonb_array_elements(contributions) c where c->>'scope_id'=x->>'scope_id') loop
  changes:=changes||jsonb_build_array(jsonb_build_object('scope_id',old_item->>'scope_id','name',old_item->>'name','action','removed from current scope; completed work and history retained','before',old_item));
 end loop;
 for bundle in select c->>'pipeline' as kind,c->>'cadence' as cadence,c->>'publication_id' as publication,c->>'preset_publication_id' as preset,c->>'definition_name' as name,jsonb_agg(c order by c->>'scope_id') as items from jsonb_array_elements(contributions) c where c ? 'publication_id' group by 1,2,3,4,5 order by 1,2,3 loop
  bucket:=md5(jsonb_build_array(bundle.kind,bundle.cadence,bundle.publication)::text);bucket_keys:=array_append(bucket_keys,bucket);
  select x into candidate from jsonb_array_elements(catalogue) x where x->>'publication_id'=bundle.publication;
  with recursive needed(key) as (select s->>'key' from jsonb_array_elements(candidate->'steps') s where exists(select 1 from jsonb_array_elements(bundle.items) i where i->>'service_id'=s->>'service_id') union select dep from needed n join jsonb_array_elements(candidate->'steps') s on s->>'key'=n.key cross join lateral jsonb_array_elements_text(s->'depends_on') dep)
  select jsonb_agg(s||jsonb_build_object('selected_service',exists(select 1 from jsonb_array_elements(bundle.items) i where i->>'service_id'=s->>'service_id'),'planned_quantity',(select i->'quantity' from jsonb_array_elements(bundle.items) i where i->>'service_id'=s->>'service_id'),'source_review_required',true) order by ord) into stages from jsonb_array_elements(candidate->'steps') with ordinality as t(s,ord) where s->>'key' in (select key from needed);
  select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') into group_rows from public.project_pipeline_groups g where g.organization_id=p_org and g.project_id=p_project and g.engagement_id=p_engagement and g.kind=bundle.kind and g.preset_publication_id=bundle.preset::uuid;
  select x into prior_group from jsonb_array_elements(coalesce(prior.snapshot->'groups','[]')) x where x->>'bucket_key'=bucket;
  choice:=p_choices->>bucket;chosen:=null;
  if prior_group->>'pipeline_group_id' is not null then chosen:=(prior_group->>'pipeline_group_id')::uuid;if choice is not null and choice<>chosen::text then raise exception 'An existing reviewed plan binding cannot move completed work to another pipeline' using errcode='22023';end if;
  elsif choice is not null and choice<>'new' then if not exists(select 1 from jsonb_array_elements(group_rows) g where g->>'id'=choice) then raise exception 'Chosen pipeline belongs to another exact scope or template' using errcode='42501';end if;chosen:=choice::uuid;
  elsif choice is null and jsonb_array_length(group_rows)=1 then chosen:=(group_rows->0->>'id')::uuid;end if;
  bundles:=bundles||jsonb_build_array(jsonb_build_object('bucket_key',bucket,'kind',bundle.kind,'cadence',bundle.cadence,'definition_publication_id',bundle.publication,'preset_publication_id',bundle.preset,'name',left(initcap(bundle.kind)||' · '||bundle.name,52)||' · '||left(bundle.cadence,12)||' · '||left(bucket,6),'pipeline_group_id',chosen,'binding_locked',prior_group->>'pipeline_group_id' is not null,'group_options',group_rows,'choose_group',chosen is null and choice is null and jsonb_array_length(group_rows)>1,'contributions',bundle.items,'stages',stages,'work_partition',case when bundle.kind='branding' then 'brand_foundation' when bundle.kind='website' then 'registered_page' else 'deliverable_cycle' end,'downstream_review_required',exists(select 1 from jsonb_array_elements(changes) c where exists(select 1 from jsonb_array_elements(bundle.items) i where i->>'scope_id'=c->>'scope_id'))));
 end loop;
 if exists(select 1 from jsonb_object_keys(p_choices) k where not(k=any(bucket_keys))) then raise exception 'Unknown pipeline selection key' using errcode='22023';end if;
 result:=jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',p_engagement,'parent_version_id',prior.id,'setup_token',setup->>'token','can_manage',setup->'can_manage','contributions',contributions,'groups',bundles,'unmapped',unmapped,'changes',changes,'retained_groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.project_pipeline_groups g where g.organization_id=p_org and g.project_id=p_project and g.engagement_id=p_engagement),'[]'));
 result:=result||case when prior.snapshot ? 'stage_bindings' then jsonb_build_object('stage_bindings',prior.snapshot->'stage_bindings') else '{}'::jsonb end;
 result:=result||case when foundation is null then '{}'::jsonb else jsonb_build_object('foundation',foundation) end;
 if octet_length(result::text)>900000 then raise exception 'Project plan exceeds the bounded review size; no records changed' using errcode='54000';end if;
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(jsonb_build_array(result,catalogue,p_choices)::text,'UTF8')),'hex'));
end;$function$
;
