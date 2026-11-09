-- A binding allocates an existing unit. It never creates or activates a service.
create table private.website_scope_leaf_bindings (
  scope_id uuid primary key references public.project_service_scopes(id),
  organization_id uuid not null,
  project_id uuid not null,
  engagement_id uuid not null,
  engagement_service_id uuid not null unique,
  parent_service_id uuid not null,
  leaf_id uuid not null references private.service_setup_leaves(service_id),
  scope_revision bigint not null,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  unique (project_id, leaf_id),
  foreign key (engagement_service_id,organization_id) references public.engagement_services(id,organization_id)
);
alter table private.website_scope_leaf_bindings enable row level security;
revoke all on private.website_scope_leaf_bindings from public, anon, authenticated, service_role;

create function private.website_scope_leaf_options(p_org uuid,p_project uuid,p_engagement uuid)
returns table(scope_id uuid, scope_revision bigint, engagement_service_id uuid, parent_service_id uuid, leaf_id uuid, leaf_name text)
language sql stable set search_path='' as $$
  select s.id,s.revision,es.id,s.service_id,l.service_id,leaf.name
  from public.project_service_scopes s
  join public.engagement_services es on es.id=s.engagement_service_id and es.organization_id=s.organization_id
    and es.service_id=s.service_id and es.status='active'
  join public.engagements e on e.id=es.engagement_id and e.organization_id=s.organization_id and e.project_id=s.project_id
  join private.service_setup_leaves l on l.organization_id=s.organization_id and l.legacy_service_id=s.service_id
  join public.service_catalog leaf on leaf.id=l.service_id and leaf.organization_id=s.organization_id and leaf.is_active
  join public.service_catalog parent on parent.id=s.service_id and parent.organization_id=s.organization_id
    and parent.department_id=leaf.department_id and parent.is_active
  where s.organization_id=p_org and s.project_id=p_project and es.engagement_id=p_engagement
    and e.status in ('planning','active') and s.status='active' and s.quantity=1
    and leaf.slug in ('setup_content_new_website_copy','setup_design_unique_page_ui_layout','setup_development_website_page_build')
    and not exists(select 1 from public.project_service_scopes other where other.project_id=s.project_id and other.service_id=leaf.id)
    and not exists(select 1 from public.engagement_services other where other.organization_id=p_org and other.engagement_id=e.id and other.service_id=leaf.id)
$$;
revoke all on function private.website_scope_leaf_options(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.apply_website_scope_leaf_bindings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_bindings jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  choice record;
  candidate record;
  saved private.website_scope_leaf_bindings;
  setup jsonb;
begin
  perform private.n2_scope_require_member(p_organization_id,p_project_id,true);
  perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
  setup:=public.get_project_setup(p_organization_id,p_project_id);
  if jsonb_typeof(p_bindings) is distinct from 'array' or jsonb_array_length(p_bindings) not between 1 and 3 then
    raise exception 'Review between one and three Website scope bindings';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_bindings) as r(scope_id uuid,leaf_id uuid)
            group by r.scope_id having count(*)>1) then raise exception 'Select each scope once'; end if;
  for choice in select * from jsonb_to_recordset(p_bindings) as r(scope_id uuid,revision bigint,leaf_id uuid,parent_service_id uuid,engagement_service_id uuid) order by scope_id loop
    perform 1 from public.project_service_scopes s join public.engagement_services es on es.id=s.engagement_service_id
      where s.id=choice.scope_id and s.project_id=p_project_id and s.organization_id=p_organization_id
        and es.organization_id=p_organization_id and es.engagement_id=p_engagement_id for update of s,es;
    select * into strict candidate from private.website_scope_leaf_options(p_organization_id,p_project_id,p_engagement_id)
      where scope_id=choice.scope_id and scope_revision=choice.revision and leaf_id=choice.leaf_id
        and parent_service_id=choice.parent_service_id and engagement_service_id=choice.engagement_service_id;
    if exists(select 1 from jsonb_array_elements(coalesce(setup#>'{state,plan,contributions}','[]')) c
      where c->>'service_id' in (candidate.parent_service_id::text,candidate.leaf_id::text)) then
      raise exception 'Review the changed project setup contribution' using errcode='40001';
    end if;
    select * into saved from private.website_scope_leaf_bindings where scope_id=choice.scope_id;
    if found then
      if (saved.leaf_id,saved.scope_revision,saved.engagement_service_id) is distinct from
         (candidate.leaf_id,candidate.scope_revision,candidate.engagement_service_id) then raise exception 'Existing binding differs from this review'; end if;
    else
      insert into private.website_scope_leaf_bindings(scope_id,organization_id,project_id,engagement_id,engagement_service_id,parent_service_id,leaf_id,scope_revision,reviewed_by)
      values(candidate.scope_id,p_organization_id,p_project_id,p_engagement_id,candidate.engagement_service_id,candidate.parent_service_id,candidate.leaf_id,candidate.scope_revision,auth.uid());
    end if;
  end loop;
end;
$$;
revoke all on function public.apply_website_scope_leaf_bindings(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_website_scope_leaf_bindings(uuid,uuid,uuid,jsonb) to authenticated;

-- Keep the original scope ID, service identity and engagement link. Only the
-- planning projection uses the reviewed leaf as its contribution identity.
create function private.website_plan_setup(p_org uuid,p_project uuid,p_engagement uuid)
returns jsonb language plpgsql volatile set search_path='' as $$
declare
  setup jsonb := public.get_project_setup(p_org,p_project);
  scopes jsonb := setup->'scopes';
  contributions jsonb := coalesce(setup#>'{state,plan,contributions}','[]'::jsonb);
  binding record;
  pos integer;
begin
  for binding in
    select o.* from private.website_scope_leaf_options(p_org,p_project,p_engagement) o
    join private.website_scope_leaf_bindings b using(scope_id,scope_revision,engagement_service_id,parent_service_id,leaf_id)
    where b.organization_id=p_org and b.project_id=p_project and b.engagement_id=p_engagement
  loop
    select ord::integer-1 into strict pos from jsonb_array_elements(scopes) with ordinality as r(s,ord)
      where s->>'id'=binding.scope_id::text;
    scopes:=jsonb_set(scopes,array[pos::text],(scopes->pos)||jsonb_build_object('service_id',binding.leaf_id));
    if exists(select 1 from jsonb_array_elements(contributions)c where c->>'service_id' in (binding.leaf_id::text,binding.parent_service_id::text)) then
      raise exception 'Review conflicting existing setup contribution before using its scope' using errcode='40001';
    end if;
    contributions:=contributions||jsonb_build_array(jsonb_build_object('service_id',binding.leaf_id,'pipeline','website',
      'scope_service_id',binding.parent_service_id,'engagement_service_id',binding.engagement_service_id));
    if jsonb_typeof(setup->'state') is distinct from 'object' then setup:=jsonb_set(setup,'{state}','{"plan":{}}');end if;
    if jsonb_typeof(setup#>'{state,plan}') is distinct from 'object' then setup:=jsonb_set(setup,'{state,plan}','{}'); end if;
    setup:=jsonb_set(setup,'{state,plan,contributions}',contributions);
  end loop;
  return jsonb_set(setup,'{scopes}',scopes);
end;
$$;
revoke all on function private.website_plan_setup(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Resolve only in the Website group and publication that the saved plan
-- associates with this exact scope, revision and engagement service.
create function private.website_step_scope_service(p_org uuid,p_engagement uuid,p_group uuid,p_publication uuid,p_leaf uuid,p_quantity integer)
returns uuid language sql stable set search_path='' as $$
  select coalesce((
    select o.parent_service_id
    from public.project_pipeline_groups pg
    cross join lateral private.website_scope_leaf_options(p_org,pg.project_id,p_engagement) o
    join private.website_scope_leaf_bindings b using(scope_id,scope_revision,engagement_service_id,parent_service_id,leaf_id)
    cross join lateral (select v.snapshot from private.project_delivery_plan_versions v
      where v.organization_id=p_org and v.project_id=pg.project_id and v.engagement_id=p_engagement order by v.version_number desc limit 1) plan
    where pg.id=p_group and pg.organization_id=p_org and pg.engagement_id=p_engagement and pg.kind='website'
      and o.leaf_id=p_leaf and p_quantity=1
      and exists(select 1 from jsonb_array_elements(plan.snapshot->'groups') g cross join lateral jsonb_array_elements(g->'contributions') c
        where g->>'pipeline_group_id'=pg.id::text and g->>'definition_publication_id'=p_publication::text
          and c->>'service_id'=p_leaf::text and c->>'scope_id'=o.scope_id::text and c->>'revision'=o.scope_revision::text
          and c->>'scope_service_id'=o.parent_service_id::text and c->>'engagement_service_id'=o.engagement_service_id::text)
  ), p_leaf)
$$;
revoke all on function private.website_step_scope_service(uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;

do $patch$
declare
  target regprocedure := 'private.build_service_project_plan(uuid,uuid,uuid,jsonb)'::regprocedure;
  ddl text := replace(pg_get_functiondef(target),chr(13),'');
begin
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) <> '3bebfc3917b1f206fcbf5780ae9d7db7' then
    raise exception 'Unreviewed prerequisite: private.build_service_project_plan';
  end if;
  ddl:=replace(ddl,$before$setup:=public.get_project_setup(p_org,p_project);$before$,$after$setup:=private.website_plan_setup(p_org,p_project,p_engagement);$after$);
  ddl:=replace(ddl,$before$result:=result||case when foundation is null$before$,$after$
  if (setup->>'can_manage')::boolean then
    result:=result||jsonb_build_object('website_scope_options',coalesce((
      select jsonb_agg(to_jsonb(o)||jsonb_build_object('parent_name',c.name) order by c.name,o.leaf_name,o.scope_id)
      from private.website_scope_leaf_options(p_org,p_project,p_engagement) o
      join public.service_catalog c on c.id=o.parent_service_id
      where not exists(select 1 from private.website_scope_leaf_bindings b where b.scope_id=o.scope_id or
        (b.project_id=p_project and b.leaf_id=o.leaf_id))
      and not exists(select 1 from jsonb_array_elements(coalesce(setup#>'{state,plan,contributions}','[]')) x
        where x->>'service_id' in (o.parent_service_id::text,o.leaf_id::text))
    ),'[]'::jsonb));
  end if;
  result:=result||case when foundation is null$after$);
  execute ddl;
end;
$patch$;

do $patch$
declare
  target regprocedure := 'private.project_pipeline_work_context(uuid,uuid,uuid,uuid,jsonb,uuid[])'::regprocedure;
  ddl text := replace(pg_get_functiondef(target),chr(13),'');
begin
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) <> 'be6b68d18ac678d4cc29f41e1d959054' then
    raise exception 'Unreviewed prerequisite: private.project_pipeline_work_context';
  end if;
  ddl:=replace(ddl,$before$cat.id=(s->>'service_id')::uuid$before$,$after$cat.id=private.website_step_scope_service(p_org,p_engagement,c.pipeline_group_id,c.definition_publication_id,(s->>'service_id')::uuid,(decision->>'quantity')::integer)$after$);
  ddl:=replace(ddl,$before$service_id=(s->>'service_id')::uuid$before$,$after$service_id=private.website_step_scope_service(p_org,p_engagement,c.pipeline_group_id,c.definition_publication_id,(s->>'service_id')::uuid,(decision->>'quantity')::integer)$after$);
  execute ddl;
end;
$patch$;

do $patch$
declare
  target regprocedure := 'public.start_project_pipeline_group_run(uuid,uuid,uuid,uuid,uuid[])'::regprocedure;
  ddl text := replace(pg_get_functiondef(target),chr(13),'');
begin
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) <> 'ad20c1bc95685a857e59d6c4ef79292b' then
    raise exception 'Unreviewed prerequisite: public.start_project_pipeline_group_run';
  end if;
  ddl:=replace(ddl,$before$(step.value->>'service_id')::uuid=item.service_id$before$,$after$private.website_step_scope_service(p_organization_id,engagement.id,configuration.pipeline_group_id,configuration.definition_publication_id,(step.value->>'service_id')::uuid,(selected.value->>'quantity')::integer)=item.service_id$after$);
  ddl:=replace(ddl,$before$es.service_id=(step.value->>'service_id')::uuid$before$,$after$es.service_id=private.website_step_scope_service(p_organization_id,engagement.id,configuration.pipeline_group_id,configuration.definition_publication_id,(step.value->>'service_id')::uuid,(selected.value->>'quantity')::integer)$after$);
  execute ddl;
end;
$patch$;

do $patch$
declare
  target regprocedure := 'private.create_project_chat_content_slot(uuid,uuid,uuid,jsonb,jsonb,uuid,jsonb)'::regprocedure;
  ddl text := replace(pg_get_functiondef(target),chr(13),'');
begin
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) <> 'c49a5370945dfd512855f61cefa38b35' then
    raise exception 'Unreviewed prerequisite: private.create_project_chat_content_slot';
  end if;
  ddl:=replace(ddl,$before$es.service_id=(stage->>'service_id')::uuid$before$,$after$es.service_id=private.website_step_scope_service(p_org,p_engagement,(p_selection->>'group_id')::uuid,(select pc.definition_publication_id from public.project_pipeline_configurations pc where pc.id=(partition_read->>'configuration_id')::uuid),(stage->>'service_id')::uuid,(stage->>'quantity')::integer)$after$);
  execute ddl;
end;
$patch$;

do $patch$
declare
  target regprocedure := 'private.require_project_chat_content_contract(uuid,uuid,uuid,jsonb,text,jsonb,uuid)'::regprocedure;
  ddl text := replace(pg_get_functiondef(target),chr(13),'');
begin
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) <> '16feed41cd26bd859008fcfb6bc1c0cd' then
    raise exception 'Unreviewed prerequisite: private.require_project_chat_content_contract';
  end if;
  ddl:=replace(ddl,$before$es.service_id=(step->>'service_id')::uuid$before$,$after$es.service_id=private.website_step_scope_service(p_org,p_engagement,c.pipeline_group_id,c.definition_publication_id,(step->>'service_id')::uuid,1)$after$);
  execute ddl;
end;
$patch$;

do $patch$
declare
  target regprocedure := 'public.activate_project_pipeline_configuration(uuid,uuid,uuid,text,boolean)'::regprocedure;
  ddl text := replace(pg_get_functiondef(target),chr(13),'');
begin
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) <> '0f74f8fa6a6b3c4a993dd3f8b7b272ea' then
    raise exception 'Unreviewed prerequisite: public.activate_project_pipeline_configuration';
  end if;
  ddl:=replace(ddl,$before$(ds.value->>'service_id')::uuid$before$,$after$private.website_step_scope_service(p_organization_id,engagement.id,configuration.pipeline_group_id,configuration.definition_publication_id,(ds.value->>'service_id')::uuid,(selected->>'quantity')::integer)$after$);
  ddl:=replace(ddl,$before$(step.value ->> 'service_id')::uuid$before$,$after$private.website_step_scope_service(p_organization_id,engagement.id,configuration.pipeline_group_id,configuration.definition_publication_id,(step.value ->> 'service_id')::uuid,(selected->>'quantity')::integer)$after$);
  execute ddl;
end;
$patch$;

do $patch$
declare
  target regprocedure := 'public.create_project_pipeline_group_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint)'::regprocedure;
  ddl text := replace(pg_get_functiondef(target),chr(13),'');
begin
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) <> 'e9574df75f04c6ecf6372f91f02111be' then
    raise exception 'Unreviewed prerequisite: public.create_project_pipeline_group_configuration';
  end if;
  ddl:=replace(ddl,$before$(definition_step->>'service_id')::uuid$before$,$after$private.website_step_scope_service(p_organization_id,engagement.id,p_pipeline_group_id,p_definition_publication_id,(definition_step->>'service_id')::uuid,selected_quantity)$after$);
  ddl:=replace(ddl,$before$(definition_step ->> 'service_id')::uuid$before$,$after$private.website_step_scope_service(p_organization_id,engagement.id,p_pipeline_group_id,p_definition_publication_id,(definition_step ->> 'service_id')::uuid,selected_quantity)$after$);
  execute ddl;
end;
$patch$;

