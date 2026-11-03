-- LOCAL WIP: reviewed Work batch API and receipt-backed canonical writes; verification required.
-- No production application or public release authority is implied.
begin;
create function private.compile_project_pipeline_work_batch(p_context jsonb,p_proposal jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
 stages jsonb;stage jsonb;upstream jsonb;slot jsonb;choice jsonb;work jsonb;prior jsonb;mapping jsonb;asset jsonb;ref jsonb;
 slots jsonb:='[]';edges jsonb:='[]';materials jsonb:='[]';relations jsonb:='[]';retained jsonb:='[]';blockers jsonb:='[]';
 mappings jsonb;asset_choices jsonb;options jsonb;prior_slots jsonb;work_edges jsonb;allowed_assets jsonb;matches jsonb;
 dep text;idx integer;count_slots integer:=0;up_idx integer;edge_exists boolean;relation_exists boolean;
 source_slot jsonb;target_slot jsonb;row_value jsonb;counts jsonb;payload jsonb;signature text;
begin
 if jsonb_typeof(p_context) is distinct from 'object' or jsonb_typeof(p_proposal) is distinct from 'object'
  or octet_length(p_context::text)>262144 or octet_length(p_proposal::text)>65536
  or p_context->'version' is distinct from '1'::jsonb or p_proposal->'version' is distinct from '1'::jsonb
  or coalesce(p_context->>'source_sha256','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_context->'scope') is distinct from 'object' or jsonb_typeof(p_context->'partition') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_proposal) k where k not in ('version','slots','dependencies','asset_links')) then
  raise exception 'Bounded exact Work batch context and choices required' using errcode='22023';end if;
 stages:=p_context->'stages';options:=coalesce(p_context->'work_options','[]');prior_slots:=coalesce(p_context->'prior_slots','[]');
 work_edges:=coalesce(p_context->'existing_work_edges','[]');allowed_assets:=coalesce(p_context->'asset_options','[]');
 mappings:=coalesce(p_proposal->'dependencies','[]');asset_choices:=coalesce(p_proposal->'asset_links','[]');
 if jsonb_typeof(stages) is distinct from 'array' or jsonb_array_length(stages) not between 1 and 50
  or jsonb_typeof(p_proposal->'slots') is distinct from 'array' or jsonb_array_length(p_proposal->'slots')>50
  or jsonb_typeof(options) is distinct from 'array' or jsonb_array_length(options)>100
  or jsonb_typeof(prior_slots) is distinct from 'array' or jsonb_array_length(prior_slots)>50
  or jsonb_typeof(work_edges) is distinct from 'array' or jsonb_array_length(work_edges)>100
  or jsonb_typeof(allowed_assets) is distinct from 'array' or jsonb_array_length(allowed_assets)>100
  or jsonb_typeof(mappings) is distinct from 'array' or jsonb_array_length(mappings)>100
  or jsonb_typeof(asset_choices) is distinct from 'array' or jsonb_array_length(asset_choices)>100 then
  raise exception 'Work batch slot, dependency and relation bounds exceeded' using errcode='54000';end if;
 if exists(select 1 from jsonb_array_elements(stages) s group by s->>'key' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(prior_slots) s group by s->>'key',s->'instance' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(options) w group by w->>'id' having count(*)>1) then
  raise exception 'Exact distinct canonical stages and Work options required' using errcode='22023';end if;
 for stage in select value from jsonb_array_elements(stages) loop
  if jsonb_typeof(stage) is distinct from 'object' or coalesce(stage->>'key','')!~'^[A-Za-z0-9_:-]{1,120}$'
   or jsonb_typeof(stage->'label') is distinct from 'string' or length(trim(stage->>'label')) not between 1 and 240
   or jsonb_typeof(stage->'department_id') is distinct from 'string' or length(stage->>'department_id') not between 1 and 120
   or stage->>'action' is null or stage->>'action' not in ('run','reuse','omit','outside_scope')
   or jsonb_typeof(stage->'depends_on') is distinct from 'array' or jsonb_array_length(stage->'depends_on')>50
   or exists(select 1 from jsonb_array_elements(stage->'depends_on') d where jsonb_typeof(d) is distinct from 'string')
   or exists(select 1 from jsonb_array_elements(stage->'depends_on') d group by d having count(*)>1) then
   raise exception 'Exact reviewed stage contract required' using errcode='22023';end if;
  if stage->>'action'='run' then
   if jsonb_typeof(stage->'quantity') is distinct from 'number' or coalesce(stage->>'quantity','')!~'^[1-9][0-9]?$'
    or (stage->>'quantity')::integer>50 then raise exception 'Reviewed stage quantities must be 1-50' using errcode='22023';end if;
   count_slots:=count_slots+(stage->>'quantity')::integer;
  end if;
 end loop;
 if count_slots>50 then raise exception 'Choose at most fifty configured Work slots' using errcode='54000';end if;
 if exists(with recursive paths(start_key,key) as (
  select s->>'key',d from jsonb_array_elements(stages) s cross join lateral jsonb_array_elements_text(s->'depends_on') d
  union select p.start_key,d from paths p join lateral (select s from jsonb_array_elements(stages) s where s->>'key'=p.key) x on true
   cross join lateral jsonb_array_elements_text(x.s->'depends_on') d
 ) select 1 from paths where start_key=key) then raise exception 'Published stage dependencies contain a cycle' using errcode='55000';end if;
 -- A choice is required for each exact run slot. Nothing is inferred by title.
 for stage in select value from jsonb_array_elements(stages) where value->>'action'='run' loop
  for idx in 1..(stage->>'quantity')::integer loop
   select jsonb_agg(x) into matches from jsonb_array_elements(p_proposal->'slots') x where x->>'key'=stage->>'key' and x->'instance'=to_jsonb(idx);
   if coalesce(jsonb_array_length(matches),0)<>1 then raise exception 'Review each exact configured Work slot once' using errcode='22023';end if;
   choice:=matches->0;work:=null;
   if exists(select 1 from jsonb_object_keys(choice) k where k not in ('key','instance','action','work_item_id','row_version','previous_work_item_id','previous_row_version','material_reason'))
    or choice->>'action' is null or choice->>'action' not in ('create_missing','create_replacement','use_existing') then raise exception 'Explicit Work create or exact reuse choice required' using errcode='22023';end if;
   if choice->>'action'<>'create_replacement' and (choice ? 'previous_work_item_id' or choice ? 'previous_row_version') then raise exception 'Previous Work identity belongs only to an explicit replacement' using errcode='22023';end if;
   select x into prior from jsonb_array_elements(prior_slots) x where x->>'key'=stage->>'key' and x->'instance'=to_jsonb(idx);
   if choice->>'action'='create_missing' and prior is not null then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('code','existing_work_choice_required','key',stage->>'key','instance',idx,'reason','Reuse the prior exact card or explicitly review a replacement; changing configuration does not recreate Work'));
   end if;
   if choice->>'action'='create_replacement' and (prior is null or prior->'work_item_id' is distinct from choice->'previous_work_item_id' or prior->'row_version' is distinct from choice->'previous_row_version'
     or jsonb_typeof(choice->'material_reason') is distinct from 'string' or length(trim(choice->>'material_reason')) not between 1 and 500) then
    raise exception 'Review the exact previous Work version and replacement reason' using errcode='40001';end if;
   if choice->>'action'='use_existing' then
    select x into work from jsonb_array_elements(options) x where x->>'id'=choice->>'work_item_id';
    if work is null or work->'row_version' is distinct from choice->'row_version' then raise exception 'Current exact Work version required' using errcode='40001';end if;
    if work->'eligible' is distinct from 'true'::jsonb or work->>'department_id' is distinct from stage->>'department_id'
     or work->>'organization_id' is distinct from p_context->'scope'->>'organization_id'
     or work->>'project_id' is distinct from p_context->'scope'->>'project_id'
     or work->>'engagement_id' is distinct from p_context->'scope'->>'engagement_id' then raise exception 'Exact partition and project Work authority required' using errcode='42501';end if;
    if work->'material_current' is distinct from 'true'::jsonb and (jsonb_typeof(choice->'material_reason') is distinct from 'string' or length(trim(choice->>'material_reason')) not between 1 and 500) then
     blockers:=blockers||jsonb_build_array(jsonb_build_object('code','changed_work_source','key',stage->>'key','instance',idx,'reason','Review how this existing Work relates to changed material; its history is retained'));
    end if;
   elsif choice ? 'work_item_id' or choice ? 'row_version' then raise exception 'New Work must not carry an existing identity' using errcode='22023';
   elsif p_context->'creation_allowed' is distinct from 'true'::jsonb then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('code','partition_reuse_only','key',stage->>'key','instance',idx,'reason','This existing cycle supports linking its Work only; recurrence generation is separate'));
   end if;
   slots:=slots||jsonb_build_array(jsonb_build_object('key',stage->>'key','instance',idx,'action',choice->>'action','work_item_id',work->'id','row_version',work->'row_version',
    'department_id',stage->'department_id','service_id',stage->'service_id','title',stage->'label','previous_work_item_id',choice->'previous_work_item_id','previous_row_version',choice->'previous_row_version','material_current',work->'material_current','material_reason',choice->'material_reason',
    'relation_revision',work->'relation_revision','source_sha256',coalesce(stage->'source_sha256',p_context->'source_sha256')));
  end loop;
 end loop;
 if jsonb_array_length(p_proposal->'slots')<>count_slots or exists(select 1 from jsonb_array_elements(slots) s where s->>'work_item_id' is not null group by s->>'work_item_id' having count(*)>1) then
  raise exception 'A canonical Work card cannot silently stand for multiple configured slots' using errcode='22023';end if;
 if jsonb_array_length(slots)+(select count(*) from jsonb_array_elements(prior_slots) history_slot where not exists(select 1 from jsonb_array_elements(slots) current_slot where current_slot->'key'=history_slot->'key' and current_slot->'instance'=history_slot->'instance'))>50 then raise exception 'Review a smaller configuration; retain prior Work history within fifty live slot bindings' using errcode='54000';end if;
 -- Every provided mapping must be a declared dependency; no hidden extra edges.
 for mapping in select value from jsonb_array_elements(mappings) loop
  if jsonb_typeof(mapping) is distinct from 'object' or exists(select 1 from jsonb_object_keys(mapping) k where k not in ('key','instance','depends_on_key','depends_on_instance')) then raise exception 'Exact dependency instance mapping required' using errcode='22023';end if;
  select x into target_slot from jsonb_array_elements(slots) x where x->>'key'=mapping->>'key' and x->'instance'=mapping->'instance';
  select x into stage from jsonb_array_elements(stages) x where x->>'key'=mapping->>'key';
  if target_slot is null or not (stage->'depends_on' ? (mapping->>'depends_on_key')) then raise exception 'Mapping is outside the reviewed stage dependencies' using errcode='22023';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(mappings) m group by m->'key',m->'instance',m->'depends_on_key',m->'depends_on_instance' having count(*)>1) then raise exception 'Duplicate dependency mapping' using errcode='22023';end if;
 for target_slot in select value from jsonb_array_elements(slots) loop
  select x into stage from jsonb_array_elements(stages) x where x->>'key'=target_slot->>'key';
  for dep in select value from jsonb_array_elements_text(stage->'depends_on') loop
   select x into upstream from jsonb_array_elements(stages) x where x->>'key'=dep;
   if upstream is null or upstream->>'action' not in ('run','reuse') then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unfulfilled_dependency','key',stage->>'key','instance',target_slot->'instance','depends_on_key',dep));continue;
   end if;
   select coalesce(jsonb_agg(x),'[]') into matches from jsonb_array_elements(mappings) x where x->>'key'=target_slot->>'key' and x->'instance'=target_slot->'instance' and x->>'depends_on_key'=dep;
   if jsonb_array_length(matches)=0 then
    if (stage->>'quantity')::integer=1 and (upstream->>'action'='reuse' or (upstream->>'quantity')::integer=1) then
     matches:=jsonb_build_array(jsonb_build_object('key',target_slot->'key','instance',target_slot->'instance','depends_on_key',dep,'depends_on_instance',case when upstream->>'action'='run' then 1 else null end));
    else blockers:=blockers||jsonb_build_array(jsonb_build_object('code','dependency_mapping_required','key',stage->>'key','instance',target_slot->'instance','depends_on_key',dep,'reason','Choose the exact prerequisite instances; quantities do not imply paired or all-to-all work'));continue;
    end if;
   end if;
   for mapping in select value from jsonb_array_elements(matches) loop
    if upstream->>'action'='reuse' then
     if mapping->>'depends_on_instance' is not null or jsonb_typeof(upstream->'source_reference') is distinct from 'object' then raise exception 'Approved output dependency requires its exact reviewed reference, not fabricated Work' using errcode='22023';end if;
     materials:=materials||jsonb_build_array(jsonb_build_object('key',target_slot->'key','instance',target_slot->'instance','depends_on_key',dep,'source_reference',upstream->'source_reference'));
    else
     if jsonb_typeof(mapping->'depends_on_instance') is distinct from 'number' or coalesce(mapping->>'depends_on_instance','')!~'^[1-9][0-9]?$' then raise exception 'Choose a bounded exact predecessor instance' using errcode='22023';end if;
     up_idx:=(mapping->>'depends_on_instance')::integer;
     select x into source_slot from jsonb_array_elements(slots) x where x->>'key'=dep and x->'instance'=to_jsonb(up_idx);
     if source_slot is null then raise exception 'Prerequisite Work slot is outside this reviewed batch' using errcode='22023';end if;
     edge_exists:=exists(select 1 from jsonb_array_elements(work_edges) e where e->>'work_item_id'=target_slot->>'work_item_id' and e->>'depends_on_work_item_id'=source_slot->>'work_item_id');
     if target_slot->>'work_item_id' is not null and not edge_exists then
      select x into work from jsonb_array_elements(options) x where x->'id'=target_slot->'work_item_id';
      if work->>'status' is distinct from 'not_started' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','existing_work_dependency_change','key',target_slot->'key','instance',target_slot->'instance','reason','Retain active/completed Work history; choose new planned Work before adding a blocker'));end if;
     end if;
     edges:=edges||jsonb_build_array(jsonb_build_object('key',target_slot->'key','instance',target_slot->'instance','depends_on_key',dep,'depends_on_instance',up_idx,'action',case when edge_exists then 'existing' else 'add' end));
    end if;
   end loop;
  end loop;
 end loop;
 -- Normalize the preserved union plus reviewed additions. Each pair costs a row.
 for target_slot in select value from jsonb_array_elements(slots) loop
  select x into work from jsonb_array_elements(options) x where x->'id'=target_slot->'work_item_id';
  for asset in select value from jsonb_array_elements(coalesce(work->'assets','[]')) loop
   relations:=relations||jsonb_build_array(jsonb_build_object('key',target_slot->'key','instance',target_slot->'instance','kind',asset->'kind','id',asset->'id','action','existing'));
  end loop;
 end loop;
 for asset in select value from jsonb_array_elements(asset_choices) loop
  if jsonb_typeof(asset) is distinct from 'object' or exists(select 1 from jsonb_object_keys(asset) k where k not in ('key','instance','kind','id')) then raise exception 'Typed exact asset relation required' using errcode='22023';end if;
  select x into target_slot from jsonb_array_elements(slots) x where x->'key'=asset->'key' and x->'instance'=asset->'instance';
  if target_slot is null or not exists(select 1 from jsonb_array_elements(allowed_assets) x where x->'kind'=asset->'kind' and x->'id'=asset->'id') then raise exception 'Asset relation is outside the reviewed canonical partition options' using errcode='42501';end if;
  if not exists(select 1 from jsonb_array_elements(relations) x where x->'key'=asset->'key' and x->'instance'=asset->'instance' and x->'kind'=asset->'kind' and x->'id'=asset->'id') then
   relations:=relations||jsonb_build_array(asset||jsonb_build_object('action','add'));
  end if;
 end loop;
 if p_context->'partition'->>'kind' in ('website_page','campaign_asset') then
  for target_slot in select value from jsonb_array_elements(slots) loop
   if not exists(select 1 from jsonb_array_elements(relations) x where x->'key'=target_slot->'key' and x->'instance'=target_slot->'instance' and x->'kind'=p_context->'partition'->'kind' and x->'id'=p_context->'partition'->'id') then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('code','partition_asset_link_required','key',target_slot->'key','instance',target_slot->'instance','reason','Review the link to this exact canonical asset'));
   end if;
  end loop;
 end if;
 for prior in select value from jsonb_array_elements(prior_slots) loop
  if not exists(select 1 from jsonb_array_elements(slots) x where x->>'work_item_id'=prior->>'work_item_id') then retained:=retained||jsonb_build_array(jsonb_build_object('key',prior->'key','instance',prior->'instance','work_item_id',prior->'work_item_id','row_version',prior->'row_version','status',prior->'status','source_sha256',prior->'source_sha256'));end if;
 end loop;
 counts:=jsonb_build_object('slots',jsonb_array_length(slots),'edges',jsonb_array_length(edges),'relations',jsonb_array_length(relations),'material_requirements',jsonb_array_length(materials),'retained',jsonb_array_length(retained));
 if jsonb_array_length(edges)>100 or jsonb_array_length(relations)>100 or jsonb_array_length(materials)>100
  or jsonb_array_length(slots)+jsonb_array_length(edges)+jsonb_array_length(relations)+jsonb_array_length(materials)+jsonb_array_length(retained)>200
  or exists(select 1 from jsonb_array_elements(relations) x group by x->'key',x->'instance' having count(*)>50) then
  raise exception 'Combined Work slot, edge and relation budget exceeded; review a smaller explicit batch' using errcode='54000';end if;
 counts:=counts||jsonb_build_object('combined',jsonb_array_length(slots)+jsonb_array_length(edges)+jsonb_array_length(relations)+jsonb_array_length(materials)+jsonb_array_length(retained));
 select coalesce(jsonb_agg(x order by x->>'key',(x->>'instance')::integer,x->>'depends_on_key',(x->>'depends_on_instance')::integer),'[]') into edges from jsonb_array_elements(edges) x;
 select coalesce(jsonb_agg(x order by x->>'key',(x->>'instance')::integer,x->>'depends_on_key'),'[]') into materials from jsonb_array_elements(materials) x;
 select coalesce(jsonb_agg(x order by x->>'key',(x->>'instance')::integer,x->>'kind',x->>'id'),'[]') into relations from jsonb_array_elements(relations) x;
 select coalesce(jsonb_agg(x order by x->>'key',(x->>'instance')::integer,x->>'work_item_id'),'[]') into retained from jsonb_array_elements(retained) x;
 payload:=jsonb_build_object('version',1,'scope',p_context->'scope','partition',p_context->'partition','configuration_id',p_context->'configuration_id','source_sha256',p_context->'source_sha256','receipt_head',p_context->'receipt_head',
  'slots',slots,'edges',edges,'relations',relations,'material_requirements',materials,'retained',retained,'counts',counts,'blockers',blockers);
 signature:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 return payload||jsonb_build_object('review_sha256',signature,'can_apply',jsonb_array_length(blockers)=0,'ready_for_execution',false,'ready_for_traffic',false);
end;$$;
revoke all on function private.compile_project_pipeline_work_batch(jsonb,jsonb) from public,anon,authenticated,service_role;
-- BEGIN WORK BATCH API
do $$begin
if md5(pg_get_functiondef('public.apply_project_work_command(uuid,uuid,uuid,uuid,uuid,jsonb,uuid)'::regprocedure)) is distinct from 'dfa535f4201b18db170b01c088284435' then raise exception 'Current Work writer preimage changed';end if;
if md5(pg_get_functiondef('public.mutate_p5_work_item_dependency(uuid,text,uuid,uuid,bigint,uuid)'::regprocedure)) is distinct from 'c01b4e57c94bd008f86514a5e5500a22' then raise exception 'Current Work writer preimage changed';end if;
if md5(pg_get_functiondef('public.save_p5_work_item(uuid,uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,bigint,text)'::regprocedure)) is distinct from '616f1653e63eccd55908227a64e2febf' then raise exception 'Current Work writer preimage changed';end if;
end;$$;
do $$begin if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.work_items'::regclass and conname='work_items_created_via_check') is distinct from 'CHECK ((created_via = ANY (ARRAY[''manual''::text, ''ai_chat_proposal''::text, ''automation_rule''::text, ''recurring_plan''::text, ''quick_task_promotion''::text])))' then raise exception 'Work source constraint preimage changed';end if; if not exists(select 1 from pg_class where oid='private.project_work_commands'::regclass and relrowsecurity and relacl::text='{postgres=arwdDxtm/postgres}') or not exists(select 1 from pg_trigger where tgrelid='private.project_work_commands'::regclass and tgfoid='private.n1b_preserve_receipt()'::regprocedure and tgenabled='O' and not tgisinternal) then raise exception 'Existing Work receipt protection changed';end if;end;$$;
alter table public.work_items drop constraint work_items_created_via_check;
alter table public.work_items add constraint work_items_created_via_check check(created_via in ('manual','ai_chat_proposal','automation_rule','recurring_plan','quick_task_promotion','pipeline_plan'));
-- Local implementation appended to the CLI-created migration; not a release approval.
-- One lock order: project-setup advisory, project UPDATE, engagement SHARE,
-- existing engagement DAG advisory, source SHARE, sorted Work UPDATE, relation commands.
create function private.project_pipeline_work_scope(p_org uuid,p_project uuid,p_engagement uuid) returns void
language plpgsql set search_path='' as $$
declare actor uuid:=auth.uid();begin
 if actor is null then raise exception 'Authenticated current project manager required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_org::text||':'||p_project::text,0));
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found then raise exception 'Current same-project scope required' using errcode='42501';end if;
 perform private.n1c_require_scope(p_org,p_project,actor);
 if private.n6_project_configuration_authorized(p_org,p_project,actor) is distinct from true then raise exception 'Current exact-project configuration authority required' using errcode='42501';end if;
 perform 1 from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project and status in ('planning','active') for share;
 if not found then raise exception 'Current planning or active engagement required' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_org::text||':'||p_engagement::text,0)) then raise exception 'Work graph is busy; retain this draft and review current Work again' using errcode='40001';end if;
end;$$;
revoke all on function private.project_pipeline_work_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Index only the new namespace. Legacy command request ownership and storage stay intact.
create unique index project_work_batch_revision_unique on private.project_work_commands
 (organization_id,project_id,(result->>'batch_key'),((result->>'revision')::bigint))
 where payload->>'action'='pipeline_work_batch_v1';

create function private.project_pipeline_work_context(p_org uuid,p_project uuid,p_engagement uuid,p_configuration uuid,p_partition jsonb,p_work_ids uuid[]) returns jsonb
language plpgsql set search_path='' as $$
declare c public.project_pipeline_configurations;d public.pipeline_execution_definitions;g public.project_pipeline_groups;
 e public.engagements;page public.project_website_pages;asset public.project_campaign_assets;occ public.recurring_work_occurrences;
 stage_review jsonb;stages jsonb:='[]';s jsonb;decision jsonb;ref jsonb;source jsonb;partition_source jsonb;stage_hash text;batch_key text;
 head private.project_work_commands;prior jsonb:='[]';options jsonb:='[]';edges jsonb;assets jsonb;w public.work_items;r bigint;binding jsonb;ids uuid[];answer jsonb;prior_lock_timeout text:=current_setting('lock_timeout');
begin
 if (select setting::bigint from pg_settings where name='lock_timeout') not between 1 and 500 then perform set_config('lock_timeout','500ms',true);end if;
 perform private.project_pipeline_work_scope(p_org,p_project,p_engagement);
 if jsonb_typeof(p_partition) is distinct from 'object' or octet_length(p_partition::text)>2048 or p_partition->>'kind' is null
  or exists(select 1 from jsonb_object_keys(p_partition) k where k not in ('kind','id','architecture_version_id'))
  or p_partition->>'id' is null or coalesce(cardinality(p_work_ids),0)>100 then raise exception 'Bounded exact partition and Work identities required' using errcode='22023';end if;
 select * into e from public.engagements where id=p_engagement and organization_id=p_org;
 select * into c from public.project_pipeline_configurations where id=p_configuration and organization_id=p_org and project_id=p_project and engagement_id=p_engagement for share;
 if not found then raise exception 'Exact reviewed configuration required' using errcode='42501';end if;
 if exists(select 1 from public.project_pipeline_configurations x where x.organization_id=p_org and x.engagement_id=p_engagement and x.pipeline_group_id is not distinct from c.pipeline_group_id and x.revision>c.revision) then raise exception 'Configuration superseded; review the exact current configuration' using errcode='40001';end if;
 select x.* into d from public.pipeline_execution_publications p join public.pipeline_execution_definitions x on x.id=p.definition_id and x.organization_id=p.organization_id where p.id=c.definition_publication_id and p.organization_id=p_org for share of p,x;
 if d.id is null or d.steps_sha256<>encode(sha256(convert_to(d.steps::text,'UTF8')),'hex') or c.selected_steps_sha256<>encode(sha256(convert_to(c.selected_steps::text,'UTF8')),'hex') then raise exception 'Published configuration integrity changed' using errcode='55000';end if;
 if c.pipeline_group_id is not null then
  select * into g from public.project_pipeline_groups where id=c.pipeline_group_id and organization_id=p_org and project_id=p_project and engagement_id=p_engagement and preset_publication_id=d.preset_publication_id for share;
  if not found then raise exception 'Exact configured pipeline group required' using errcode='42501';end if;
 end if;
 stage_review:=private.current_pipeline_stage_review(p_org,c.id);
 if stage_review is null then raise exception 'Review every configured stage before creating Work' using errcode='55000';end if;
 if p_partition->>'kind'='engagement' then
  if (p_partition->>'id')::uuid<>e.id or g.kind in ('website','marketing') or p_partition ? 'architecture_version_id' then raise exception 'Use the existing page or deliverable partition for this track' using errcode='42501';end if;
  partition_source:=jsonb_build_object('kind','engagement','id',e.id,'brand_id',e.brand_id);
 elsif p_partition->>'kind'='website_page' then
  select * into page from public.project_website_pages where id=(p_partition->>'id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=e.id and brand_id=e.brand_id for share;
  if not found or g.kind is distinct from 'website' or p_partition->>'architecture_version_id' is null then raise exception 'Exact existing Website page and approved architecture required' using errcode='42501';end if;
  source:=private.website_approved_source(p_org,p_project,(p_partition->>'architecture_version_id')::uuid);
  if source->>'engagement_id' is distinct from e.id::text or source->>'brand_id' is distinct from e.brand_id::text
   or not exists(select 1 from public.artifact_versions v where v.id=(p_partition->>'architecture_version_id')::uuid and v.organization_id=p_org and v.artifact_id=page.architecture_artifact_id)
   or not exists(select 1 from jsonb_array_elements(source->'pages') x where x->>'page_key'=page.page_key) then raise exception 'Exact registered page no longer belongs to the approved architecture' using errcode='55000';end if;
  partition_source:=jsonb_build_object('kind','website_page','id',page.id,'page_key',page.page_key,'source_reference',source->'reference');
 elsif p_partition->>'kind'='campaign_asset' then
  if g.kind is distinct from 'marketing' or p_partition ? 'architecture_version_id' then raise exception 'Exact Marketing asset partition required' using errcode='42501';end if;
  select * into asset from public.project_campaign_assets where id=(p_partition->>'id')::uuid and organization_id=p_org and project_id=p_project and brand_id=e.brand_id for share;
  if not found then raise exception 'Exact existing campaign asset required' using errcode='42501';end if;
  source:=private.campaign_asset_source(p_org,p_project,e.brand_id,asset.source_kind,asset.source_version_id);
  if source->>'reference_checksum' is distinct from asset.source_reference_checksum then raise exception 'Exact registered campaign source reference changed' using errcode='55000';end if;
  -- Current canonical descriptor/reference checksum is revalidated by the existing asset helper.
  perform private.asset_relation_assets(p_org,p_project,jsonb_build_array(jsonb_build_object('kind','campaign_asset','id',asset.id)));
  partition_source:=jsonb_build_object('kind','campaign_asset','id',asset.id,'source_version_id',asset.source_version_id,'source_reference_checksum',asset.source_reference_checksum,'source_sha256',encode(sha256(convert_to(source::text,'UTF8')),'hex'));
 elsif p_partition->>'kind'='recurring_occurrence' then
  if p_partition ? 'architecture_version_id' then raise exception 'Exact existing occurrence only' using errcode='22023';end if;
  select * into occ from public.recurring_work_occurrences where id=(p_partition->>'id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=e.id and status='generated' for share;
  if not found then raise exception 'Exact current existing occurrence required' using errcode='42501';end if;
  partition_source:=jsonb_build_object('kind','recurring_occurrence','id',occ.id,'plan_version_id',occ.plan_version_id,'engagement_service_id',occ.engagement_service_id,'period_start',occ.period_start,'period_end',occ.period_end,'timezone',occ.timezone);
 else raise exception 'Choose one existing canonical partition' using errcode='22023';end if;
 batch_key:=encode(sha256(convert_to(jsonb_build_array(p_engagement,c.pipeline_group_id,p_partition->>'kind',p_partition->>'id')::text,'UTF8')),'hex');
 select * into head from private.project_work_commands where organization_id=p_org and project_id=p_project and payload->>'action'='pipeline_work_batch_v1' and result->>'batch_key'=batch_key order by (result->>'revision')::bigint desc limit 1;
 -- Material fingerprints deliberately exclude configuration ID/quantity/receipt head.
 for s in select value from jsonb_array_elements(d.steps) loop
  select value into decision from jsonb_array_elements(stage_review->'decisions') where value->>'key'=s->>'key';
  if decision is null then raise exception 'Every published stage requires its original reviewed decision' using errcode='55000';end if;
  if decision->>'action'='run' then
   perform 1 from public.service_catalog cat join public.engagement_services es on es.service_id=cat.id and es.organization_id=cat.organization_id
    where cat.id=(s->>'service_id')::uuid and cat.organization_id=p_org and cat.is_active and cat.department_id=s->>'department_id' and es.engagement_id=e.id and es.status in ('planned','active') order by es.id for share of cat,es;
   if not found then raise exception 'Current scoped service commitment required; no activation is performed' using errcode='42501';end if;
   perform 1 from public.project_service_scopes where organization_id=p_org and project_id=p_project and service_id=(s->>'service_id')::uuid order by id for share;
   if exists(select 1 from public.project_service_scopes sc where sc.organization_id=p_org and sc.project_id=p_project and sc.service_id=(s->>'service_id')::uuid and sc.status<>'active') then raise exception 'Current accepted service scope required' using errcode='42501';end if;
  end if;
  select value->'reference' into ref from jsonb_array_elements(stage_review->'resolved_artifacts') where value->>'step_key'=s->>'key' and value->'input_key'='null'::jsonb;
  stage_hash:=encode(sha256(convert_to(jsonb_build_object('step',s,'decision',decision-'quantity','resolved', (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(stage_review->'resolved_artifacts') x where x->>'step_key'=s->>'key'), 'foundation',(stage_review->'foundation_context')-'plan_version_id','partition',partition_source)::text,'UTF8')),'hex');
  stages:=stages||jsonb_build_array(jsonb_build_object('key',s->'key','label',s->'label','department_id',s->'department_id','service_id',s->'service_id','quantity',decision->'quantity','depends_on',s->'depends_on','action',decision->'action','source_reference',ref,'source_sha256',stage_hash));
 end loop;
 select array_agg(distinct id) into ids from (select unnest(coalesce(p_work_ids,'{}')) id union select (x->>'work_item_id')::uuid from jsonb_array_elements(coalesce(head.result->'bindings','[]')) x) q;
 if coalesce(cardinality(ids),0)>100 then raise exception 'Choose at most 100 exact existing Work identities' using errcode='54000';end if;
 for w in select * from public.work_items where id=any(coalesce(ids,'{}')) and organization_id=p_org and project_id=p_project and engagement_id=e.id and deleted_at is null order by id for update nowait loop
  if p_partition->>'kind'='recurring_occurrence' and w.recurring_occurrence_id is distinct from occ.id then raise exception 'Only exact occurrence Work may be reused' using errcode='42501';end if;
  select x into binding from jsonb_array_elements(coalesce(head.result->'bindings','[]')) x where x->>'work_item_id'=w.id::text;
  select coalesce(max(revision),0) into r from private.project_asset_relation_revisions where organization_id=p_org and project_id=p_project and subject_kind='engagement_work_item' and subject_id=w.id;
  select x.assets into assets from private.project_asset_relation_revisions x where x.organization_id=p_org and x.project_id=p_project and x.subject_kind='engagement_work_item' and x.subject_id=w.id and x.revision=r for share;
  options:=options||jsonb_build_array(jsonb_build_object('id',w.id,'row_version',w.row_version,'organization_id',p_org,'project_id',p_project,'engagement_id',e.id,'department_id',w.department_id,'eligible',true,'status',w.status,'relation_revision',r,'assets',coalesce(assets,'[]'),'material_current',binding is not null and exists(select 1 from jsonb_array_elements(stages) x where x->>'key'=binding->>'key' and x->>'source_sha256'=binding->>'source_sha256')));
  if binding is not null then prior:=prior||jsonb_build_array(binding||jsonb_build_object('row_version',w.row_version,'status',w.status));end if;
 end loop;
 if jsonb_array_length(options)<>coalesce(cardinality(ids),0) then raise exception 'Exact same-project live Work unavailable; history is not silently replaced' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('work_item_id',x.work_item_id,'depends_on_work_item_id',x.depends_on_work_item_id) order by x.work_item_id,x.depends_on_work_item_id),'[]') into edges from public.work_item_dependencies x where x.organization_id=p_org and x.work_item_id=any(coalesce(ids,'{}')) and x.depends_on_work_item_id=any(coalesce(ids,'{}'));
 if jsonb_array_length(prior)>50 or jsonb_array_length(edges)>100 then raise exception 'Review a smaller explicit batch; preserve original receipts' using errcode='54000';end if;
 answer:=jsonb_build_object('version',1,'scope',jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',e.id),'configuration_id',c.id,'partition',p_partition,'partition_source',partition_source,'batch_key',batch_key,'receipt_head',case when head.request_id is null then 'null'::jsonb else jsonb_build_object('request_id',head.request_id,'actor_id',head.actor_id,'revision',head.result->'revision','review_sha256',head.result->'review_sha256') end,'receipt_revision',coalesce((head.result->>'revision')::bigint,0),'creation_allowed',p_partition->>'kind'<>'recurring_occurrence','stages',stages,'work_options',options,'prior_slots',prior,'existing_work_edges',edges,'asset_options',case when p_partition->>'kind' in ('website_page','campaign_asset') then jsonb_build_array(jsonb_build_object('kind',p_partition->'kind','id',p_partition->'id')) else '[]'::jsonb end,'source_sha256',encode(sha256(convert_to(jsonb_build_object('configuration_id',c.id,'selected',c.selected_steps_sha256,'stage_review_sha256',stage_review->'review_sha256','stages',stages,'partition',partition_source)::text,'UTF8')),'hex'));
 perform set_config('lock_timeout',prior_lock_timeout,true);return answer;
exception when lock_not_available or deadlock_detected then raise exception 'Work or its source is busy; retain this draft and review current Work again' using errcode='40001';
end;$$;
revoke all on function private.project_pipeline_work_context(uuid,uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;

create function public.get_project_pipeline_work_batch_context(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_configuration_id uuid,p_partition jsonb,p_work_item_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$begin return private.project_pipeline_work_context(p_organization_id,p_project_id,p_engagement_id,p_configuration_id,p_partition,p_work_item_ids);end;$$;
create function public.review_project_pipeline_work_batch(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_configuration_id uuid,p_partition jsonb,p_proposal jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;ids uuid[];begin
 if jsonb_typeof(p_proposal) is distinct from 'object' or octet_length(p_proposal::text)>65536 or jsonb_typeof(p_proposal->'slots') is distinct from 'array' or jsonb_array_length(p_proposal->'slots')>50 then raise exception 'Bounded exact batch choices required' using errcode='22023';end if;
 select array_agg(distinct (x->>'work_item_id')::uuid) filter(where x->>'work_item_id' is not null) into ids from jsonb_array_elements(p_proposal->'slots') x;
 context:=private.project_pipeline_work_context(p_organization_id,p_project_id,p_engagement_id,p_configuration_id,p_partition,ids);
 return private.compile_project_pipeline_work_batch(context,p_proposal);
end;$$;

create function public.apply_project_pipeline_work_batch(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_configuration_id uuid,p_partition jsonb,p_proposal jsonb,p_review_sha256 text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();payload jsonb;receipt private.project_work_commands;context jsonb;review jsonb;ids uuid[];slot jsonb;edge jsonb;item public.work_items;
 bindings jsonb:='[]';lookup jsonb:='{}';assets jsonb;rel_review jsonb;relation jsonb;relations jsonb:='[]';outcome jsonb;target uuid;predecessor uuid;rowversion bigint;rid uuid;next_revision bigint;bumps jsonb:='[]';bump jsonb;prior_lock_timeout text:=current_setting('lock_timeout');
begin
 if (select setting::bigint from pg_settings where name='lock_timeout') not between 1 and 500 then perform set_config('lock_timeout','500ms',true);end if;
 perform private.project_pipeline_work_scope(p_organization_id,p_project_id,p_engagement_id);
 if p_request_id is null or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' or jsonb_typeof(p_proposal) is distinct from 'object' or octet_length(p_proposal::text)>65536 then raise exception 'Original request and exact reviewed bounded batch required' using errcode='22023';end if;
 payload:=jsonb_build_object('action','pipeline_work_batch_v1','engagement_id',p_engagement_id,'configuration_id',p_configuration_id,'partition',p_partition,'proposal',p_proposal,'review_sha256',p_review_sha256);
 -- Same request namespace as legacy Work commands: no request can adopt a different action.
 perform pg_advisory_xact_lock(hashtextextended('project-work:'||p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.project_work_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then if receipt.project_id<>p_project_id or (receipt.payload-'_writer_xid8') is distinct from payload then raise exception 'Original Work request owns another exact payload' using errcode='23505';end if;perform set_config('lock_timeout',prior_lock_timeout,true);return receipt.result;end if;
 select array_agg(distinct (x->>'work_item_id')::uuid) filter(where x->>'work_item_id' is not null) into ids from jsonb_array_elements(p_proposal->'slots') x;
 context:=private.project_pipeline_work_context(p_organization_id,p_project_id,p_engagement_id,p_configuration_id,p_partition,ids);
 review:=private.compile_project_pipeline_work_batch(context,p_proposal);
 if review->>'review_sha256'<>p_review_sha256 then raise exception 'Work, source or receipt head changed; review this exact batch again' using errcode='40001';end if;
 if review->'can_apply' is distinct from 'true'::jsonb then raise exception 'Resolve the explicit batch review blockers' using errcode='55000';end if;
 -- All frozen versions validated under source and Work locks before the first write.
 for slot in select value from jsonb_array_elements(review->'slots') loop
  if slot->>'action'='use_existing' then select * into item from public.work_items where id=(slot->>'work_item_id')::uuid;
  else item:=public.save_p5_work_item(p_organization_id,null,p_engagement_id,slot->>'title','','task','medium','not_started',null,slot->>'department_id',null,null,null,null,null,0,null,actor,null,'pipeline_plan');end if;
  lookup:=lookup||jsonb_build_object(slot->>'key'||':'||(slot->>'instance'),item.id);
  bindings:=bindings||jsonb_build_array(slot||jsonb_build_object('work_item_id',item.id,'initial_row_version',item.row_version,'row_version',item.row_version,'created',slot->>'action'<>'use_existing'));
 end loop;
 -- Freeze the complete outcome before writing dependencies. The immutable receipt
 -- is also a transaction-local capability for exact canonical P5 version bumps.
 for edge in select value from jsonb_array_elements(review->'edges') where value->>'action'='add' loop
  target:=(lookup->>(edge->>'key'||':'||(edge->>'instance')))::uuid;predecessor:=(lookup->>(edge->>'depends_on_key'||':'||(edge->>'depends_on_instance')))::uuid;
  select (x->>'initial_row_version')::bigint into rowversion from jsonb_array_elements(bindings) x where x->>'work_item_id'=target::text;
  rowversion:=rowversion+(select count(*) from jsonb_array_elements(bumps) x where x->>'work_item_id'=target::text);
  bumps:=bumps||jsonb_build_array(jsonb_build_object('work_item_id',target,'depends_on_work_item_id',predecessor,'before',rowversion,'after',rowversion+1));
 end loop;
 for slot in select value from jsonb_array_elements(bindings) loop
  if exists(select 1 from jsonb_array_elements(review->'relations') x where x->'key'=slot->'key' and x->'instance'=slot->'instance' and x->>'action'='add') then
   relations:=relations||jsonb_build_array(jsonb_build_object('work_item_id',slot->'work_item_id','relation_request_id',gen_random_uuid(),'revision',coalesce((slot->>'relation_revision')::bigint,0)+1));
  end if;
 end loop;
 select coalesce(jsonb_agg(x||jsonb_build_object('row_version',(x->>'initial_row_version')::bigint+(select count(*) from jsonb_array_elements(bumps) b where b->'work_item_id'=x->'work_item_id')) order by x->>'key',(x->>'instance')::integer),'[]'::jsonb) into bindings from jsonb_array_elements(bindings) x;
 -- Keep exact outside-current slots as lineage bindings; historical replaced cards remain in original receipts.
 select coalesce(jsonb_agg(x),'[]') into assets from jsonb_array_elements(context->'prior_slots') x where not exists(select 1 from jsonb_array_elements(bindings) b where b->'key'=x->'key' and b->'instance'=x->'instance');
 if jsonb_array_length(bindings)+jsonb_array_length(assets)>50 then raise exception 'Bounded lineage exceeded; preserve original receipts and review a smaller configuration' using errcode='54000';end if;
 next_revision:=(context->>'receipt_revision')::bigint+1;
 outcome:=jsonb_build_object('action','pipeline_work_batch_v1','request_id',p_request_id,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'configuration_id',p_configuration_id,'partition',p_partition,'batch_key',context->'batch_key','revision',next_revision,'parent_receipt',context->'receipt_head','review_sha256',p_review_sha256,'source_sha256',context->'source_sha256','bindings',bindings||assets,'reviewed_slots',bindings,'retained',review->'retained','edges',review->'edges','material_requirements',review->'material_requirements','relations',relations,'version_bumps',bumps,'atomic',true,'ready_for_execution',false,'ready_for_traffic',false);
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,actor,p_request_id,payload||jsonb_build_object('_writer_xid8',pg_current_xact_id()::text),outcome);
 -- Receipt, Work, graph and relationships share this transaction; any later
 -- failure removes every row, including this precomputed immutable outcome.
 for bump in select value from jsonb_array_elements(bumps) loop
  target:=(bump->>'work_item_id')::uuid;predecessor:=(bump->>'depends_on_work_item_id')::uuid;
  perform private.asset_relation_subject(p_organization_id,p_project_id,'engagement_work_item',target,true);
  perform public.mutate_p5_work_item_dependency(p_organization_id,'add',target,predecessor,(bump->>'before')::bigint,actor);
 end loop;
 for slot in select value from jsonb_array_elements(bindings) loop
  target:=(slot->>'work_item_id')::uuid;
  select x into relation from jsonb_array_elements(relations) x where x->>'work_item_id'=target::text;
  if relation is not null then
   select jsonb_agg(jsonb_build_object('kind',x->'kind','id',x->'id') order by x->>'kind',x->>'id') into assets from jsonb_array_elements(review->'relations') x where x->'key'=slot->'key' and x->'instance'=slot->'instance';
   rel_review:=public.review_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',target,(relation->>'revision')::bigint-1,(slot->>'row_version')::bigint,assets);
   perform public.save_project_asset_relations(p_organization_id,p_project_id,'engagement_work_item',target,(relation->>'revision')::bigint-1,(slot->>'row_version')::bigint,assets,rel_review->>'review_sha256',(relation->>'relation_request_id')::uuid);
  end if;
  perform 1 from public.work_items where id=target and row_version=(slot->>'row_version')::bigint;
  if not found then raise exception 'Canonical Work command outcome differs from the immutable receipt' using errcode='40001';end if;
 end loop;
 perform set_config('lock_timeout',prior_lock_timeout,true);return outcome;
exception when lock_not_available or deadlock_detected then raise exception 'Work or its source is busy; retain the original request and review current Work again' using errcode='40001';
end;$$;

create function public.recover_project_pipeline_work_batch(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt private.project_work_commands;begin
 if auth.uid() is null or p_request_id is null then raise exception 'Original authenticated request required' using errcode='42501';end if;
 perform private.n1c_require_scope(p_organization_id,p_project_id,auth.uid());
 perform 1 from public.engagements where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id for share;
 if not found then raise exception 'Original same-project engagement required' using errcode='42501';end if;
 -- Serialize uncertain completion with apply using the original lock. Recovery never resends.
 perform pg_advisory_xact_lock(hashtextextended('project-work:'||p_organization_id::text||':'||auth.uid()::text||':'||p_request_id::text,0));
 select * into receipt from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=auth.uid() and request_id=p_request_id and payload->>'action'='pipeline_work_batch_v1' and payload->>'engagement_id'=p_engagement_id::text;
 if not found then return jsonb_build_object('status','not_applied');end if;
 return jsonb_build_object('status','applied','original_result',receipt.result);
end;$$;

-- Provenance is receipt-backed, not a client-supplied magic flag or GUC.
create function private.guard_pipeline_work_receipt() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.created_via='pipeline_plan' and not exists(select 1 from private.project_work_commands r cross join lateral jsonb_array_elements(r.result->'reviewed_slots') s where r.organization_id=new.organization_id and r.project_id=new.project_id and r.payload->>'action'='pipeline_work_batch_v1' and s->>'work_item_id'=new.id::text and s->'created'='true'::jsonb) then raise exception 'Pipeline Work attribution requires its immutable reviewed batch receipt' using errcode='42501';end if;
 return null;end;$$;
revoke all on function private.guard_pipeline_work_receipt() from public,anon,authenticated,service_role;
create constraint trigger pipeline_work_receipt_required after insert or update on public.work_items deferrable initially deferred for each row execute function private.guard_pipeline_work_receipt();

revoke all on function public.get_project_pipeline_work_batch_context(uuid,uuid,uuid,uuid,jsonb,uuid[]),public.review_project_pipeline_work_batch(uuid,uuid,uuid,uuid,jsonb,jsonb),public.apply_project_pipeline_work_batch(uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid),public.recover_project_pipeline_work_batch(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_pipeline_work_batch_context(uuid,uuid,uuid,uuid,jsonb,uuid[]),public.review_project_pipeline_work_batch(uuid,uuid,uuid,uuid,jsonb,jsonb),public.apply_project_pipeline_work_batch(uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid),public.recover_project_pipeline_work_batch(uuid,uuid,uuid,uuid) to authenticated;
do $$begin if md5(pg_get_functiondef('private.n1c_guard_assignment()'::regprocedure)) is distinct from '578ab7c91cfa85b7f43d3845388e0507' then raise exception 'Current assignment guard preimage changed';end if;end;$$;

-- Exact closed-receipt capability, created by this batch in the current full xid8 transaction; savepoint-safe.
-- No manager-only inference, call-stack/GUC proof or general authenticated update.
create function private.pipeline_work_version_bump_authorized(p_old jsonb,p_new jsonb) returns boolean
language plpgsql set search_path='' as $$begin
 if auth.uid() is null or p_old is null or p_new is null
  or (p_new-array['row_version','updated_at']) is distinct from (p_old-array['row_version','updated_at'])
  or (p_new->>'row_version')::bigint is distinct from (p_old->>'row_version')::bigint+1
  or (p_new->>'updated_at')::timestamptz is distinct from now()
  or private.n6_project_configuration_authorized((p_old->>'organization_id')::uuid,(p_old->>'project_id')::uuid,auth.uid()) is distinct from true then return false;end if;
 return exists(select 1 from private.project_work_commands r cross join lateral jsonb_array_elements(r.result->'version_bumps') b
  join public.work_item_dependencies e on e.work_item_id=(b->>'work_item_id')::uuid and e.depends_on_work_item_id=(b->>'depends_on_work_item_id')::uuid
  where r.payload->>'action'='pipeline_work_batch_v1' and r.organization_id=(p_old->>'organization_id')::uuid and r.project_id=(p_old->>'project_id')::uuid and r.actor_id=auth.uid()
   and r.payload->>'_writer_xid8'=pg_current_xact_id()::text
   and b->>'work_item_id'=p_old->>'id' and b->'before'=p_old->'row_version' and b->'after'=p_new->'row_version'
   and e.organization_id=r.organization_id and e.created_by=auth.uid());
end;$$;
revoke all on function private.pipeline_work_version_bump_authorized(jsonb,jsonb) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.n1c_guard_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; project uuid; assignee uuid; previous_assignee uuid; creator uuid;
  can_assign boolean; delegation uuid; prior jsonb; next_row jsonb; is_task boolean := tg_table_name='tasks';
begin
  next_row := to_jsonb(new);
  if tg_op='UPDATE' and current_setting('role',true)='authenticated' and (is_task or not private.pipeline_work_version_bump_authorized(to_jsonb(old),next_row)) then
    raise exception 'Use a versioned server command for Project Task changes.' using errcode='42501';
  end if;
  -- Existing service commands reindex peer rows and annotate automation flags.
  -- These metadata-only writes cannot change assignment, scope or execution.
  if tg_op='UPDATE' and current_setting('role',true)='service_role'
    and (next_row - array['row_version','updated_at','position','automation_flagged_at','automation_flagged_by_rule_id'])
      = (to_jsonb(old) - array['row_version','updated_at','position','automation_flagged_at','automation_flagged_by_rule_id']) then
    return new;
  end if;
  project := new.project_id;
  if not is_task then
    select e.project_id into project from public.engagements e
      where e.id=new.engagement_id and e.organization_id=new.organization_id for share;
    if project is null or (new.project_id is not null and new.project_id<>project) then
      raise exception 'Canonical engagement/project mismatch.' using errcode='42501';
    end if;
  end if;
  creator := (next_row->>'created_by')::uuid;
  actor := private.n1c_actor(case when tg_op='INSERT' and auth.uid() is null then creator else null end);
  if not is_task and tg_op='INSERT' and next_row->>'recurring_occurrence_id' is not null then
    delegation := private.n1c_assert_recurring_item(new,actor);
    can_assign := true; -- exact initial template only; no update or general machine grant
  else
    can_assign := private.n1c_can_assign_department(new.organization_id,project,new.department_id,actor);
  end if;
  if new.department_id is not null and not exists(
    select 1 from public.departments where id=new.department_id and organization_id=new.organization_id
  ) then raise exception 'Same-organization department required.' using errcode='42501'; end if;
  assignee := (next_row->>case when is_task then 'assigned_to' else 'assignee_id' end)::uuid;
  if tg_op='INSERT' then
    if creator is distinct from actor or (is_task and (next_row->>'user_id')::uuid is distinct from actor) then
      raise exception 'Creator must match verified actor.' using errcode='42501';
    end if;
  else
    prior := to_jsonb(old);
    previous_assignee := (prior->>case when is_task then 'assigned_to' else 'assignee_id' end)::uuid;
    if new.organization_id is distinct from old.organization_id
      or new.project_id is distinct from old.project_id
      or creator is distinct from (prior->>'created_by')::uuid
      or next_row->'user_id' is distinct from prior->'user_id'
      or next_row->'engagement_id' is distinct from prior->'engagement_id'
      or next_row->'created_at' is distinct from prior->'created_at' then
      raise exception 'Work identity and canonical scope are immutable.' using errcode='42501';
    end if;
    if (not can_assign or not private.n1c_can_assign_department(old.organization_id,old.project_id,old.department_id,actor)) and (new.department_id is distinct from old.department_id
      or next_row->'workstream_id' is distinct from prior->'workstream_id') then
      raise exception 'Scoped assignment authority required for handoff.' using errcode='42501';
    end if;
    -- Assignment does not grant review/release rights. Existing creators and
    -- assignees retain execution edits; unrelated contributors cannot edit.
    if not can_assign and creator is distinct from actor and previous_assignee is distinct from actor then
      raise exception 'Assigned execution or existing creator authority required.' using errcode='42501';
    end if;
  end if;
  if (tg_op='INSERT' and assignee is not null)
    or (tg_op='UPDATE' and assignee is distinct from previous_assignee) then
    if not can_assign then raise exception 'Scoped assignment authority required; contributors create unassigned.' using errcode='42501'; end if;
  end if;
  if assignee is not null and (tg_op='INSERT' or assignee is distinct from previous_assignee) then
    perform 1 from public.organization_memberships where organization_id=new.organization_id
      and user_id=assignee and member_kind='team' and status='active' for share;
    if not found then raise exception 'Active same-organization assignee required.' using errcode='42501'; end if;
  end if;
  if is_task then
    if tg_op='INSERT' or assignee is distinct from previous_assignee then
      new.assigned_by := case when assignee is not null then actor else null end;
    elsif new.assigned_by is distinct from old.assigned_by then
      raise exception 'Assignment provenance is database-managed.' using errcode='42501';
    end if;
  end if;
  if (tg_op='INSERT' and assignee is not null) or (tg_op='UPDATE' and assignee is distinct from previous_assignee) then
    insert into private.n1c_assignment_history(organization_id,project_id,record_kind,record_id,actor_id,previous_assignee_id,assignee_id,row_version,delegation_id)
    values(new.organization_id,project,case when is_task then 'project_task' else 'engagement_work_item' end,new.id,actor,previous_assignee,assignee,
      case when tg_op='INSERT' then new.row_version else old.row_version+1 end,delegation);
  end if;
  return new;
end; $function$
;

create function private.preserve_pipeline_work_attribution() returns trigger language plpgsql set search_path='' as $$begin
 if old.created_via='pipeline_plan' and new.created_via is distinct from old.created_via then raise exception 'Original pipeline Work attribution is immutable' using errcode='55000';end if;return new;end;$$;
revoke all on function private.preserve_pipeline_work_attribution() from public,anon,authenticated,service_role;
create trigger preserve_pipeline_work_attribution before update on public.work_items for each row execute function private.preserve_pipeline_work_attribution();
commit;
