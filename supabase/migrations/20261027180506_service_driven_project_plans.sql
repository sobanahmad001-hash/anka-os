-- Service selection -> reviewed additive plan; existing work/configuration/activation history remains canonical.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('public.get_project_setup(uuid,uuid)')),chr(13),'')) is distinct from 'ee4e7f7ca08e99ef15bb4061025bb87b' or md5(replace(pg_get_functiondef(to_regprocedure('public.create_project_pipeline_group(uuid,uuid,uuid,text,text,uuid)')),chr(13),'')) is distinct from '0b6bfffed7b762cc2e0c0a364e3b8ffe' or md5(replace(pg_get_functiondef(to_regprocedure('private.n6_project_configuration_authorized(uuid,uuid,uuid)')),chr(13),'')) is distinct from 'b5005c1ed90d7fe6cf8acc091c1cfb81' then raise exception 'Exact service planning prerequisites differ' using errcode='55000';end if;
end;$$;
create table private.project_delivery_plan_versions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,
 version_number integer not null check(version_number>0),parent_version_id uuid references private.project_delivery_plan_versions(id),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=1048576),
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,project_id,engagement_id,version_number),unique(organization_id,created_by,request_id),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id)
);
create index delivery_plan_parent on private.project_delivery_plan_versions(parent_version_id);
create index delivery_plan_actor on private.project_delivery_plan_versions(created_by);
create index delivery_plan_engagement on private.project_delivery_plan_versions(engagement_id,project_id,organization_id);
alter table private.project_delivery_plan_versions enable row level security;
revoke all on private.project_delivery_plan_versions from public,anon,authenticated,service_role;
create trigger delivery_plan_immutable before update or delete on private.project_delivery_plan_versions for each row execute function private.n1b_preserve_receipt();

create function private.build_service_project_plan(p_org uuid,p_project uuid,p_engagement uuid,p_choices jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare setup jsonb;prior private.project_delivery_plan_versions;item jsonb;old_item jsonb;candidate jsonb;ranked jsonb;contributions jsonb:='[]';unmapped jsonb:='[]';changes jsonb:='[]';bundles jsonb:='[]';bundle record;group_rows jsonb;chosen uuid;prior_group jsonb;bucket text;stages jsonb;result jsonb;catalogue jsonb;scope_row jsonb;choice text;bucket_keys text[]:='{}';
begin
 perform private.n2_scope_require_member(p_org,p_project,false);
 perform 1 from public.engagements where id=p_engagement and project_id=p_project and organization_id=p_org and status in ('planning','active') for share;
 if not found then raise exception 'Exact active project engagement required' using errcode='42501';end if;
 if jsonb_typeof(p_choices) is distinct from 'object' or octet_length(p_choices::text)>8192 then raise exception 'Bounded exact pipeline choices required' using errcode='22023';end if;
 setup:=public.get_project_setup(p_org,p_project);
 select * into prior from private.project_delivery_plan_versions where organization_id=p_org and project_id=p_project and engagement_id=p_engagement order by version_number desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('publication_id',p.id,'definition_id',d.id,'preset_publication_id',d.preset_publication_id,'name',d.name,'version_number',d.version_number,'steps',d.steps) order by p.id),'[]') into catalogue
 from public.pipeline_execution_publications p join public.pipeline_execution_definitions d on d.id=p.definition_id and d.organization_id=p.organization_id join public.pipeline_template_publications t on t.id=d.preset_publication_id and t.organization_id=d.organization_id
 where p.organization_id=p_org and jsonb_typeof(d.steps)='array' and jsonb_array_length(d.steps) between 1 and 50 and not exists(select 1 from jsonb_array_elements(d.steps) s where jsonb_typeof(s->'stage_contract') is distinct from 'object');
 if jsonb_array_length(catalogue)>100 then raise exception 'Published plan catalogue exceeds the bounded planning view; Administration must narrow it' using errcode='54000';end if;
 for scope_row in select x from jsonb_array_elements(setup->'scopes') x where x->>'status'<>'cancelled' order by x->>'service_id' loop
  select x into item from jsonb_array_elements(coalesce(setup->'state'->'plan'->'contributions','[]')) x where x->>'service_id'=scope_row->>'service_id';
  item:=coalesce(item,'{}')||jsonb_build_object('scope_id',scope_row->>'id','service_id',scope_row->>'service_id','revision',scope_row->'revision','quantity',scope_row->'quantity','status',scope_row->>'status','cadence',coalesce(scope_row->>'recurrence','unspecified'),'name',coalesce((select c->>'name' from jsonb_array_elements(setup->'catalog') c where c->>'id'=scope_row->>'service_id'),'Service'),'unit',scope_row->'unit');
  if not exists(select 1 from jsonb_array_elements(setup->'catalog') c where c->>'id'=item->>'service_id' and (c->>'is_active')::boolean) then
   item:=item||jsonb_build_object('planning_issue','This catalogue service is unavailable; review current scope before planning new work');
  elsif item->>'pipeline' is null or item->>'pipeline' not in ('website','marketing') then
   item:=item||jsonb_build_object('planning_issue','Choose Website or Marketing in the shared service setup review');
  else
   with scores as (select c,
    (select count(distinct s->>'service_id') from jsonb_array_elements(c->'steps') s where exists(select 1 from jsonb_array_elements(coalesce(setup->'state'->'plan'->'contributions','[]')) m join jsonb_array_elements(setup->'scopes') sc on sc->>'service_id'=m->>'service_id' where m->>'pipeline'=item->>'pipeline' and sc->>'recurrence'=item->>'cadence' and sc->>'status'<>'cancelled' and m->>'service_id'=s->>'service_id')) as covered,
    (select count(distinct s->>'service_id') from jsonb_array_elements(c->'steps') s where not exists(select 1 from jsonb_array_elements(coalesce(setup->'state'->'plan'->'contributions','[]')) m join jsonb_array_elements(setup->'scopes') sc on sc->>'service_id'=m->>'service_id' where m->>'pipeline'=item->>'pipeline' and sc->>'recurrence'=item->>'cadence' and sc->>'status'<>'cancelled' and m->>'service_id'=s->>'service_id')) as extra
    from jsonb_array_elements(catalogue) c where exists(select 1 from jsonb_array_elements(c->'steps') s where s->>'service_id'=item->>'service_id')),
   ranks as(select c,dense_rank() over(order by covered desc,extra,jsonb_array_length(c->'steps')) as rank from scores)
   select coalesce(jsonb_agg(c order by c->>'publication_id'),'[]') into ranked from ranks where rank=1;
   if jsonb_array_length(ranked)=1 then candidate:=ranked->0;item:=item||jsonb_build_object('publication_id',candidate->>'publication_id','preset_publication_id',candidate->>'preset_publication_id','definition_id',candidate->>'definition_id','definition_name',candidate->>'name');
   else item:=item||jsonb_build_object('planning_issue',case when jsonb_array_length(ranked)=0 then 'Administration must publish a matching service plan' else 'Matching published plans are ambiguous; Administration must resolve the reusable template mapping' end);end if;
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
  bundles:=bundles||jsonb_build_array(jsonb_build_object('bucket_key',bucket,'kind',bundle.kind,'cadence',bundle.cadence,'definition_publication_id',bundle.publication,'preset_publication_id',bundle.preset,'name',left(initcap(bundle.kind)||' · '||bundle.name,52)||' · '||left(bundle.cadence,12)||' · '||left(bucket,6),'pipeline_group_id',chosen,'binding_locked',prior_group->>'pipeline_group_id' is not null,'group_options',group_rows,'choose_group',chosen is null and choice is null and jsonb_array_length(group_rows)>1,'contributions',bundle.items,'stages',stages,'work_partition',case when bundle.kind='website' then 'registered_page' else 'deliverable_cycle' end,'downstream_review_required',exists(select 1 from jsonb_array_elements(changes) c where exists(select 1 from jsonb_array_elements(bundle.items) i where i->>'scope_id'=c->>'scope_id'))));
 end loop;
 if exists(select 1 from jsonb_object_keys(p_choices) k where not(k=any(bucket_keys))) then raise exception 'Unknown pipeline selection key' using errcode='22023';end if;
 result:=jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',p_engagement,'parent_version_id',prior.id,'setup_token',setup->>'token','can_manage',setup->'can_manage','contributions',contributions,'groups',bundles,'unmapped',unmapped,'changes',changes,'retained_groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.project_pipeline_groups g where g.organization_id=p_org and g.project_id=p_project and g.engagement_id=p_engagement),'[]'));
 if octet_length(result::text)>900000 then raise exception 'Project plan exceeds the bounded review size; no records changed' using errcode='54000';end if;
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(jsonb_build_array(result,catalogue,p_choices)::text,'UTF8')),'hex'));
end;$$;

create function public.get_project_delivery_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid default null,p_group_choices jsonb default '{}'::jsonb,p_request_id uuid default null,p_version_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare draft jsonb;latest private.project_delivery_plan_versions;selected private.project_delivery_plan_versions;history jsonb;contexts jsonb;begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'organization_id',e.organization_id,'project_id',e.project_id) order by e.id),'[]') into contexts from public.engagements e where e.organization_id=p_organization_id and e.project_id=p_project_id and e.status in ('planning','active');
 if p_engagement_id is null then
  if jsonb_array_length(contexts)=1 then p_engagement_id:=(contexts->0->>'id')::uuid;
  else return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',null,'engagements',contexts,'draft',null,'latest',null,'selected',null,'history','[]'::jsonb,'history_total',0);end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 draft:=private.build_service_project_plan(p_organization_id,p_project_id,p_engagement_id,p_group_choices);
 select * into latest from private.project_delivery_plan_versions where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id order by version_number desc limit 1;
 if p_request_id is not null then select * into selected from private.project_delivery_plan_versions where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and request_id=p_request_id and created_by=auth.uid();
 elsif p_version_id is not null then select * into selected from private.project_delivery_plan_versions where id=p_version_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;if not found then raise exception 'Exact historical project plan unavailable' using errcode='42501';end if;end if;
 select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]') into history from (select to_jsonb(v)-'snapshot' as x from private.project_delivery_plan_versions v where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id order by version_number desc limit 10) h;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'draft',draft,'latest',case when latest.id is null then null else to_jsonb(latest) end,'selected',case when selected.id is null then null else to_jsonb(selected) end,'history',history,'history_total',(select count(*) from private.project_delivery_plan_versions where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id));
end;$$;
create function public.apply_project_delivery_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid,p_review_sha256 text,p_group_choices jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();draft jsonb;existing private.project_delivery_plan_versions;parent private.project_delivery_plan_versions;group_row jsonb;group_result jsonb;groups jsonb:='[]';digest text;answer private.project_delivery_plan_versions;begin
 if actor is null or p_request_id is null or p_review_sha256 is null then raise exception 'Authenticated exact reviewed plan required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 if not private.n6_project_configuration_authorized(p_organization_id,p_project_id,actor) then raise exception 'Current exact project-manager authority required' using errcode='42501';end if;
 perform 1 from public.engagements where id=p_engagement_id and project_id=p_project_id and organization_id=p_organization_id and status in ('planning','active') for update;
 if not found then raise exception 'Exact current engagement required' using errcode='42501';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(p_project_id,p_engagement_id,p_review_sha256,p_group_choices)::text,'UTF8')),'hex');
 select * into existing from private.project_delivery_plan_versions where organization_id=p_organization_id and created_by=actor and request_id=p_request_id;
 if found then if existing.request_sha256<>digest then raise exception 'Original request owns a different plan' using errcode='23505';end if;return to_jsonb(existing);end if;
 draft:=private.build_service_project_plan(p_organization_id,p_project_id,p_engagement_id,p_group_choices);
 if draft->>'review_sha256' is distinct from p_review_sha256 then raise exception 'Services, templates or plan history changed; review the current delta' using errcode='40001';end if;
 if jsonb_array_length(draft->'contributions')=0 or jsonb_array_length(draft->'changes')=0 then raise exception 'No service plan delta to save' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(draft->'groups') g where (g->>'choose_group')::boolean) then raise exception 'Choose the existing exact pipeline before Apply' using errcode='22023';end if;
 for group_row in select g from jsonb_array_elements(draft->'groups') g loop
  if group_row->>'pipeline_group_id' is null then
   group_result:=public.create_project_pipeline_group(p_organization_id,p_engagement_id,(group_row->>'preset_publication_id')::uuid,group_row->>'kind',group_row->>'name',md5(p_request_id::text||':'||(group_row->>'bucket_key'))::uuid);
   group_row:=group_row||jsonb_build_object('pipeline_group_id',group_result->'group'->>'id');
  end if;groups:=groups||jsonb_build_array(group_row);
 end loop;
 select * into parent from private.project_delivery_plan_versions where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id order by version_number desc limit 1;
 insert into private.project_delivery_plan_versions(organization_id,project_id,engagement_id,version_number,parent_version_id,snapshot,request_id,request_sha256,created_by) values(p_organization_id,p_project_id,p_engagement_id,coalesce(parent.version_number,0)+1,parent.id,(draft-'review_sha256'-'can_manage')||jsonb_build_object('groups',groups),p_request_id,digest,actor) returning * into answer;
 return to_jsonb(answer);
end;$$;
revoke all on function private.build_service_project_plan(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_project_delivery_plan(uuid,uuid,uuid,jsonb,uuid,uuid),public.apply_project_delivery_plan(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_project_delivery_plan(uuid,uuid,uuid,jsonb,uuid,uuid),public.apply_project_delivery_plan(uuid,uuid,uuid,uuid,text,jsonb) to authenticated;
commit;
