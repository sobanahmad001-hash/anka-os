-- Compose existing service setup and immutable project plan in one reviewed transaction.
-- No replacement of canonical tasks, work, output, activation or approval records.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
create table private.project_delivery_setup_commands(
 organization_id uuid not null,project_id uuid not null,actor_id uuid not null references auth.users(id),request_id uuid not null,
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=110000),result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=1500000),created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,actor_id,request_id),foreign key(project_id,organization_id) references public.projects(id,organization_id)
);
alter table private.project_delivery_setup_commands enable row level security;
create index delivery_setup_project on private.project_delivery_setup_commands(project_id,organization_id);
create index delivery_setup_actor on private.project_delivery_setup_commands(actor_id);
revoke all on private.project_delivery_setup_commands from public,anon,authenticated,service_role;
create trigger delivery_setup_immutable before update or delete on private.project_delivery_setup_commands for each row execute function private.n1b_preserve_receipt();
create function private.delivery_setup_semantics(p_value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;begin
 if jsonb_typeof(p_value)='object' then select coalesce(jsonb_object_agg(k,private.delivery_setup_semantics(v)),'{}') into result from jsonb_each(p_value) t(k,v) where k not in ('scope_id','setup_token','review_sha256');return result;
 elsif jsonb_typeof(p_value)='array' then return coalesce((select jsonb_agg(private.delivery_setup_semantics(v) order by case when not exists(select 1 from jsonb_array_elements(p_value) x where not (x ? 'scope_id')) then v->>'service_id' end,ord) from jsonb_array_elements(p_value) with ordinality t(v,ord)),'[]');
 else return p_value;end if;
end;$$;
create function private.preview_combined_setup(p_organization_id uuid,p_project_id uuid,p_expected_token text,p_plan jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p_request_id uuid:=gen_random_uuid(); projected_scopes jsonb; projected jsonb; actor uuid:=auth.uid(); role_value text; snapshot jsonb; receipt private.project_setup_commands; payload jsonb;
 item jsonb; leaf private.service_setup_leaves; service public.service_catalog; scope public.project_service_scopes; quantity_value integer; cadence text;
 result jsonb; results jsonb:='[]'; seen uuid[]:='{}'; sid uuid; command_id uuid; metadata jsonb:='[]'; state_revision integer; conflict_count integer;
begin
 if auth.uid() is null then raise exception 'Authenticated setup required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform private.n2_scope_require_member(p_organization_id,p_project_id,true);
 select m.role into role_value from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=actor and m.status='active' and m.member_kind='team';
 if role_value not in ('system_owner','operations_admin') then
  perform 1 from public.project_manager_bindings b where b.organization_id=p_organization_id and b.project_id=p_project_id and b.user_id=actor and b.status='active' for share;
  if not found then raise exception 'Exact project manager authority required' using errcode='42501'; end if;
 end if;
 if actor is null or p_request_id is null or p_expected_token is null or jsonb_typeof(p_plan) is distinct from 'object'
 or exists(select 1 from jsonb_object_keys(p_plan) k where k not in ('items','pipelines','questions','explanation','legacy_acknowledgements'))
 or jsonb_typeof(p_plan->'items') is distinct from 'array' or jsonb_array_length(p_plan->'items') not between 1 and 50
 or jsonb_typeof(p_plan->'pipelines') is distinct from 'array' or jsonb_array_length(p_plan->'pipelines')>2
 or exists(select 1 from jsonb_array_elements(p_plan->'pipelines') p where p not in ('"website"'::jsonb,'"marketing"'::jsonb))
 or (select count(*) from jsonb_array_elements(p_plan->'pipelines'))<>(select count(distinct x) from jsonb_array_elements(p_plan->'pipelines') x)
 or p_plan->'questions' is distinct from '[]'::jsonb or jsonb_typeof(p_plan->'explanation') is distinct from 'string' or length(p_plan->>'explanation')>1500
 or jsonb_typeof(p_plan->'legacy_acknowledgements') is distinct from 'array' or jsonb_array_length(p_plan->'legacy_acknowledgements')>50 or octet_length(p_plan::text)>90000 then raise exception 'Review a complete bounded setup proposal' using errcode='22023'; end if;
 snapshot:=public.get_project_setup(p_organization_id,p_project_id);
 if snapshot->>'token'<>p_expected_token then raise exception 'Project setup changed; refresh and review the current diff' using errcode='40001'; end if;
 projected_scopes:=snapshot->'scopes';
 for item in select value from jsonb_array_elements(p_plan->'items') loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('service_id','quantity','cadence','custom_cadence','pipeline','channels','audience','delivery_method','deliverable_key','evidence','unit','expected_revision')) then raise exception 'Unsupported setup fields' using errcode='22023'; end if;
  sid:=(item->>'service_id')::uuid;
  if sid is null or sid=any(seen) then raise exception 'One contribution per service; update the quantity' using errcode='22023'; end if;
  seen:=array_append(seen,sid);
  select * into leaf from private.service_setup_leaves l where l.service_id=sid and l.organization_id=p_organization_id for share;
  select * into service from public.service_catalog c where c.id=sid and c.organization_id=p_organization_id and c.is_active for share;
  if leaf.service_id is null or service.id is null or item->>'unit' is distinct from leaf.definition->>'unit' then raise exception 'Exact current catalogue leaf required' using errcode='22023'; end if;
  if jsonb_typeof(item->'quantity') is distinct from 'number' or (item->>'quantity')!~'^[0-9]+$' then raise exception 'Clarify a positive whole quantity' using errcode='22023'; end if;
  quantity_value:=(item->>'quantity')::integer;
  if quantity_value not between 1 and 1000000 or item->>'cadence' is null or item->>'cadence' not in ('once','per_batch','weekly','monthly','quarterly','custom')
   or jsonb_typeof(item->'custom_cadence') is distinct from 'string' or length(item->>'custom_cadence')>120 or (item->>'cadence'='custom' and length(trim(item->>'custom_cadence'))=0)
   or item->>'pipeline' is null or item->>'pipeline' not in ('website','marketing','undecided')
   or (item->>'pipeline'<>'undecided' and not (p_plan->'pipelines' ? (item->>'pipeline')))
   or item->>'audience' is null or item->>'audience' not in ('standard','remarketing','undecided')
   or item->>'delivery_method' is null or item->>'delivery_method' not in ('human','ai_assisted','automated','undecided')
   or jsonb_typeof(item->'channels') is distinct from 'array' or jsonb_array_length(item->'channels')>10
   or exists(select 1 from jsonb_array_elements(item->'channels') c where jsonb_typeof(c)<>'string' or length(trim(c#>>'{}')) not between 1 and 80)
   or (select count(*) from jsonb_array_elements(item->'channels'))<>(select count(distinct x) from jsonb_array_elements(item->'channels') x)
   or jsonb_typeof(item->'deliverable_key') is distinct from 'string' or length(item->>'deliverable_key')>80
   or jsonb_typeof(item->'evidence') is distinct from 'string' or length(trim(item->>'evidence')) not between 1 and 500 then raise exception 'Invalid setup quantity, cadence, scope or evidence' using errcode='22023'; end if;
  -- Never silently bill a legacy parent and its new children. Any overlap must be acknowledged in this exact review.
  if exists(select 1 from public.project_service_scopes s where s.organization_id=p_organization_id and s.project_id=p_project_id and s.service_id=leaf.legacy_service_id and s.status not in ('cancelled','completed'))
    and not (p_plan->'legacy_acknowledgements' ? leaf.legacy_service_id::text) then raise exception 'Review the existing legacy scope overlap before adding this leaf' using errcode='22023'; end if;
  cadence:=case when item->>'cadence'='custom' then item->>'custom_cadence' else item->>'cadence' end;
  select * into scope from public.project_service_scopes s where s.organization_id=p_organization_id and s.project_id=p_project_id and s.service_id=sid for share;
  if found then
   if scope.status<>'proposed' or scope.revision is distinct from (item->>'expected_revision')::integer then raise exception 'Service already activated or changed; use its current change review' using errcode='40001'; end if;
   projected:=to_jsonb(scope)||jsonb_build_object('quantity',quantity_value,'unit',service.unit,'recurrence',cadence,'revision',scope.revision+1);
  else
   if item->>'expected_revision' is not null then raise exception 'Service proposal no longer exists' using errcode='40001';end if;
   projected:=jsonb_build_object('id',md5(p_project_id::text||':'||sid::text)::uuid,'service_id',sid,'organization_id',p_organization_id,'project_id',p_project_id,'quantity',quantity_value,'unit',service.unit,'recurrence',cadence,'status','proposed','revision',1);
  end if;
  projected_scopes:=coalesce((select jsonb_agg(x order by x->>'service_id') from jsonb_array_elements(projected_scopes) x where x->>'service_id'<>sid::text),'[]')||jsonb_build_array(projected);
  result:=jsonb_build_object('scope_id',projected->>'id');
  results:=results||jsonb_build_array(result);
  metadata:=metadata||jsonb_build_array((item-'quantity'-'unit'-'expected_revision')||jsonb_build_object('scope_id',result->>'scope_id'));
 end loop;
 metadata:=coalesce((select jsonb_agg(x) from private.project_setup_state s cross join lateral jsonb_array_elements(s.plan->'contributions') x where s.project_id=p_project_id and s.organization_id=p_organization_id and not ((x->>'service_id')::uuid=any(seen))),'[]'::jsonb)||metadata;
 if exists(select 1 from jsonb_array_elements(metadata) m where m->>'pipeline'<>'undecided' and not (p_plan->'pipelines' ? (m->>'pipeline'))) then raise exception 'Existing contributions retain their pipeline scope; review them before removing it' using errcode='22023'; end if;
 -- The same deliverable is a set of departmental contributions, never summed as separate posts.
 select count(*) into conflict_count from (select i->>'deliverable_key',i->>'pipeline',i->>'cadence',i->>'custom_cadence',(select jsonb_agg(c order by c) from jsonb_array_elements(i->'channels') c) from jsonb_array_elements(p_plan->'items') i where i->>'deliverable_key'<>'' group by 1,2,3,4,5 having count(distinct i->>'quantity')>1) q;
 if conflict_count>0 then raise exception 'Clarify unequal quantities for the same connected deliverable' using errcode='22023'; end if;
 return snapshot||jsonb_build_object('scopes',projected_scopes,'state',jsonb_build_object('plan',jsonb_build_object('contributions',metadata,'pipelines',p_plan->'pipelines')));
end; $$;
create function private.build_combined_service_plan(p_org uuid,p_project uuid,p_engagement uuid,p_choices jsonb,p_setup jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare setup jsonb;prior private.project_delivery_plan_versions;item jsonb;old_item jsonb;candidate jsonb;ranked jsonb;contributions jsonb:='[]';unmapped jsonb:='[]';changes jsonb:='[]';bundles jsonb:='[]';bundle record;group_rows jsonb;chosen uuid;prior_group jsonb;bucket text;stages jsonb;result jsonb;catalogue jsonb;scope_row jsonb;choice text;bucket_keys text[]:='{}';
begin
 perform private.n2_scope_require_member(p_org,p_project,false);
 perform 1 from public.engagements where id=p_engagement and project_id=p_project and organization_id=p_org and status in ('planning','active') for share;
 if not found then raise exception 'Exact active project engagement required' using errcode='42501';end if;
 if jsonb_typeof(p_choices) is distinct from 'object' or octet_length(p_choices::text)>8192 then raise exception 'Bounded exact pipeline choices required' using errcode='22023';end if;
 setup:=p_setup;
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


create function public.review_project_delivery_setup(p_organization_id uuid,p_project_id uuid,p_expected_token text,p_plan jsonb,p_engagement_id uuid default null,p_group_choices jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare current_plan jsonb;projected jsonb;draft jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 projected:=private.preview_combined_setup(p_organization_id,p_project_id,p_expected_token,p_plan);
 current_plan:=public.get_project_delivery_plan(p_organization_id,p_project_id,p_engagement_id);
 if current_plan->>'engagement_id' is null then return current_plan||jsonb_build_object('review_sha256',null);end if;
 p_engagement_id:=(current_plan->>'engagement_id')::uuid;
 draft:=private.build_combined_service_plan(p_organization_id,p_project_id,p_engagement_id,p_group_choices,projected);
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'draft',draft,'review_sha256',encode(sha256(convert_to(jsonb_build_array(p_expected_token,p_plan,p_group_choices,private.delivery_setup_semantics(draft))::text,'UTF8')),'hex'));
end;$$;
create function public.apply_project_delivery_setup(p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_expected_token text,p_plan jsonb,p_engagement_id uuid,p_group_choices jsonb,p_review_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();receipt private.project_delivery_setup_commands;payload jsonb;review jsonb;setup jsonb;draft jsonb;delivery jsonb;answer jsonb;begin
 if actor is null or p_request_id is null or p_engagement_id is null then raise exception 'Authenticated exact reviewed project setup required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 perform private.n2_scope_require_member(p_organization_id,p_project_id,true);
 if not private.n6_project_configuration_authorized(p_organization_id,p_project_id,actor) then raise exception 'Current exact project-manager authority required' using errcode='42501';end if;
 payload:=jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'token',p_expected_token,'plan',p_plan,'choices',p_group_choices,'review',p_review_sha256);
 perform pg_advisory_xact_lock(hashtextextended('delivery-setup:'||p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.project_delivery_setup_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then if receipt.payload is distinct from payload then raise exception 'Original request owns another reviewed setup' using errcode='23505';end if;return receipt.result;end if;
 review:=public.review_project_delivery_setup(p_organization_id,p_project_id,p_expected_token,p_plan,p_engagement_id,p_group_choices);
 if review->>'review_sha256' is distinct from p_review_sha256 or p_review_sha256 is null or exists(select 1 from jsonb_array_elements(review->'draft'->'groups') g where (g->>'choose_group')::boolean) then raise exception 'Review current services, exact template and pipeline choices' using errcode='40001';end if;
 setup:=public.apply_project_setup(p_organization_id,p_project_id,md5('setup:'||p_request_id::text)::uuid,p_expected_token,p_plan);
 draft:=private.build_service_project_plan(p_organization_id,p_project_id,p_engagement_id,p_group_choices);
 if private.delivery_setup_semantics(draft) is distinct from private.delivery_setup_semantics(review->'draft') then raise exception 'Projected delivery plan changed; entire setup rolled back' using errcode='40001';end if;
 delivery:=public.apply_project_delivery_plan(p_organization_id,p_project_id,p_engagement_id,md5('delivery:'||p_request_id::text)::uuid,draft->>'review_sha256',p_group_choices);
 answer:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'request_id',p_request_id,'setup',setup,'delivery',delivery,'atomic',true);
 insert into private.project_delivery_setup_commands values(p_organization_id,p_project_id,actor,p_request_id,payload,answer,clock_timestamp());return answer;
end;$$;
create function public.recover_project_delivery_setup(p_organization_id uuid,p_project_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_organization_id::text||':'||p_project_id::text,0));
 return coalesce((select result from private.project_delivery_setup_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=auth.uid() and request_id=p_request_id),jsonb_build_object('status','not_applied'));
end;$$;
revoke all on function private.delivery_setup_semantics(jsonb),private.preview_combined_setup(uuid,uuid,text,jsonb),private.build_combined_service_plan(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.review_project_delivery_setup(uuid,uuid,text,jsonb,uuid,jsonb),public.apply_project_delivery_setup(uuid,uuid,uuid,text,jsonb,uuid,jsonb,text),public.recover_project_delivery_setup(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_project_delivery_setup(uuid,uuid,text,jsonb,uuid,jsonb),public.apply_project_delivery_setup(uuid,uuid,uuid,text,jsonb,uuid,jsonb,text),public.recover_project_delivery_setup(uuid,uuid,uuid) to authenticated;
commit;
