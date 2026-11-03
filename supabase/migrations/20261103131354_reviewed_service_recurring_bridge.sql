-- Canonical recurring-service bridge; activation, assignment and scheduler consent remain explicit.
begin;
do $preimages$ begin
 if md5(pg_get_functiondef('private.insert_recurring_plan_version(recurring_work_plans,text,text,text,text,date,date,jsonb,jsonb,uuid)'::regprocedure)) is distinct from '4b00be0de4afedf730b2e099e6b0b1a9' then raise exception 'Recurring preimage changed: insert_recurring_plan_version';end if;
 if md5(pg_get_functiondef('private.build_recurring_period_preview(uuid,date,text,uuid)'::regprocedure)) is distinct from 'b0d6b55e04df31f849fa57475eceb9d8' then raise exception 'Recurring preimage changed: build_recurring_period_preview';end if;
 if md5(pg_get_functiondef('confirm_recurring_work_period(uuid,date,uuid,text,uuid)'::regprocedure)) is distinct from '4f20d382ee6726f29f85a96457fafbe2' then raise exception 'Recurring preimage changed: confirm_recurring_work_period';end if;
 if md5(pg_get_functiondef('private.assert_scheduled_recurring_context(recurring_work_plans,recurring_work_plan_versions)'::regprocedure)) is distinct from '847f9e304bf438dcfde5f11032d81456' then raise exception 'Recurring preimage changed: assert_scheduled_recurring_context';end if;
 if md5(pg_get_functiondef('execute_recurring_schedule(uuid,uuid)'::regprocedure)) is distinct from '05bf67a92e8c237b8e7cdd5109c1d293' then raise exception 'Recurring preimage changed: execute_recurring_schedule';end if;
 if md5(pg_get_functiondef('admit_recurring_schedule(uuid,date,uuid)'::regprocedure)) is distinct from '3feed035da6742fc0fdd861f21627c64' then raise exception 'Recurring preimage changed: admit_recurring_schedule';end if;
 if md5(pg_get_functiondef('preview_recurring_work_month(uuid,date,text,uuid)'::regprocedure)) is distinct from '8556115cb09d0a5ea3cc62ad6b12136e' then raise exception 'Recurring preimage changed: preview_recurring_work_month';end if;
 if md5(pg_get_functiondef('private.n1c_assert_recurring_item(work_items,uuid)'::regprocedure)) is distinct from 'b9fd6b554cadc22c87537b967de253db' then raise exception 'Recurring preimage changed: n1c_assert_recurring_item';end if;
 if md5(pg_get_functiondef('create_recurring_work_plan(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'::regprocedure)) is distinct from '88c38d47213ab9eabb984aa2066c4c85' then raise exception 'Recurring preimage changed: create_recurring_work_plan';end if;
 if md5(pg_get_functiondef('create_recurring_work_plan_version(uuid,text,text,text,text,date,date,jsonb,jsonb,uuid)'::regprocedure)) is distinct from '32a69ddca10dddd5ac5dd56cfbcdac26' then raise exception 'Recurring preimage changed: create_recurring_work_plan_version';end if;
 if md5(pg_get_functiondef('reassign_recurring_plan_template_item(uuid,text,uuid,uuid)'::regprocedure)) is distinct from '5bb508b8a2661beb67157044d5f34fd7' then raise exception 'Recurring preimage changed: reassign_recurring_plan_template_item';end if;
 if md5(pg_get_functiondef('mutate_p5_work_item_dependency(uuid,text,uuid,uuid,bigint,uuid)'::regprocedure)) is distinct from 'c01b4e57c94bd008f86514a5e5500a22' then raise exception 'Shared Work guard preimage changed: mutate_p5_work_item_dependency';end if;
 if md5(pg_get_functiondef('private.p5_require_active_actor(uuid,uuid)'::regprocedure)) is distinct from '4403663e1d9cfab04127efea4dbd4261' then raise exception 'Shared Work guard preimage changed: p5_require_active_actor';end if;
 if md5(pg_get_functiondef('save_work_item_dependency(uuid,uuid,uuid)'::regprocedure)) is distinct from '72b63cef529a7c875c2742b44229f008' then raise exception 'Shared Work guard preimage changed: save_work_item_dependency';end if;
 if exists(select 1 from public.recurring_work_plan_versions where schedule_definition ? 'service_bridge') then raise exception 'Existing recurrence metadata namespace requires separate review';end if;
end;$preimages$;

create function private.service_recurring_timezone_probe_matches(p_zone text,p_after_change timestamptz,p_winter timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select case
  when p_zone in ('America/Vancouver','Canada/Pacific') then coalesce(p_after_change='2026-11-02 19:00+00'::timestamptz and p_winter='2027-01-15 19:00+00'::timestamptz,false)
  when p_zone in ('America/Edmonton','Canada/Mountain') then coalesce(p_after_change='2026-11-02 18:00+00'::timestamptz and p_winter='2027-01-15 18:00+00'::timestamptz,false)
  when p_zone in ('Africa/Casablanca','Africa/El_Aaiun') then coalesce(p_after_change='2026-10-01 12:00+00'::timestamptz and p_winter='2027-01-15 12:00+00'::timestamptz,false)
  else true end
$$;
revoke all on function private.service_recurring_timezone_probe_matches(text,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function private.compile_service_recurring_bridge(p_context jsonb,p_proposal jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
 anchor jsonb;item jsonb;s jsonb;dep jsonb;pred jsonb;target jsonb;channels jsonb;cohort jsonb:='[]';templates jsonb:='[]';edges jsonb:='[]';pins jsonb:='[]';
 matches jsonb;stage_map jsonb:='{}';template_map jsonb:='{}';metadata jsonb;definition jsonb;payload jsonb;
 quantity integer;horizon integer;i integer;position_value integer:=0;month_offset integer;card_count integer;
 anchor_date date;cutover date;end_exclusive date;frequency text;zone text;key text;from_key text;target_key text;source_sha text;
begin
 if jsonb_typeof(p_context) is distinct from 'object' or p_context->'version' is distinct from '1'::jsonb
  or jsonb_typeof(p_proposal) is distinct from 'object' or p_proposal->'version' is distinct from '1'::jsonb
  or octet_length(p_context::text)>262144 or octet_length(p_proposal::text)>8192
  or exists(select 1 from jsonb_object_keys(p_proposal) k where k not in ('version','effective_start','scheduler'))
  or jsonb_typeof(p_context->'contributions') is distinct from 'array'
  or jsonb_array_length(p_context->'contributions') not between 1 and 50
  or jsonb_typeof(p_context->'stages') is distinct from 'array'
  or jsonb_array_length(p_context->'stages') not between 1 and 50 then
  raise exception 'Bounded exact reviewed service context required' using errcode='22023';end if;
 select jsonb_agg(x) into matches from jsonb_array_elements(p_context->'contributions') x where x->>'scope_id'=p_context->>'selected_scope_id';
 if jsonb_array_length(matches) is distinct from 1 then raise exception 'Choose one exact canonical service scope' using errcode='22023';end if;
 anchor:=matches->0;frequency:=anchor->>'cadence';zone:=anchor->'service_line'->>'timezone';
 if frequency is null or frequency not in ('weekly','monthly') then raise exception 'This recurring bridge supports reviewed weekly or monthly cadence; no cadence is substituted' using errcode='22023';end if;
 if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Exact supported project timezone required; no fallback is used' using errcode='22023';end if;
 if zone in ('America/Vancouver','Canada/Pacific','America/Edmonton','Canada/Mountain','Africa/Casablanca','Africa/El_Aaiun')
 and not private.service_recurring_timezone_probe_matches(zone,
  (case when zone in ('Africa/Casablanca','Africa/El_Aaiun') then timestamp '2026-10-01 12:00' else timestamp '2026-11-02 12:00' end) at time zone zone,
  timestamp '2027-01-15 12:00' at time zone zone) then
  raise exception 'This timezone requires verified server tzdata before new recurring bridge use' using errcode='55000';end if;
 if coalesce(anchor->>'quantity','')!~'^[1-9][0-9]?$' or (anchor->>'quantity')::integer>50
  or coalesce(anchor->'service_line'->>'generation_horizon','')!~'^[1-9][0-9]?$'
  or (anchor->'service_line'->>'generation_horizon')::integer>12 then raise exception 'Review 1-50 deliverables and a finite 1-12 cycle horizon' using errcode='22023';end if;
 quantity:=(anchor->>'quantity')::integer;horizon:=(anchor->'service_line'->>'generation_horizon')::integer;
 if jsonb_typeof(anchor->'channels') is distinct from 'array' then raise exception 'Reviewed exact channel set required' using errcode='22023';end if;
 select coalesce(jsonb_agg(x order by x),'[]') into channels from jsonb_array_elements(anchor->'channels') x;
 if (select count(*) from jsonb_array_elements(channels))<>(select count(distinct x) from jsonb_array_elements(channels) x) then raise exception 'Duplicate channels need source review' using errcode='22023';end if;
 for item in select x from jsonb_array_elements(p_context->'contributions') x order by x->>'scope_id' loop
  if item->>'scope_id'=anchor->>'scope_id' or (coalesce(anchor->>'deliverable_key','')<>'' and item->>'deliverable_key'=anchor->>'deliverable_key'
    and item->>'pipeline'=anchor->>'pipeline' and item->>'cadence'=frequency
    and (select coalesce(jsonb_agg(c order by c),'[]') from jsonb_array_elements(item->'channels') c)=channels) then
   if item->'quantity' is distinct from anchor->'quantity' then raise exception 'Shared deliverable contributions have unequal quantities; review the existing exact scope instead of multiplying deliverables' using errcode='22023';end if;
   if item->'service_line'->>'timezone' is distinct from zone
     or item->'service_line'->'generation_horizon' is distinct from anchor->'service_line'->'generation_horizon'
     or item->'service_line'->'start_date' is distinct from anchor->'service_line'->'start_date' then
    raise exception 'Connected contributions need one reviewed timezone, start date and cycle horizon' using errcode='22023';end if;
   cohort:=cohort||jsonb_build_array(item||jsonb_build_object('channels',channels));
  end if;
 end loop;
 if coalesce(anchor->>'deliverable_key','')='' and exists(select 1 from jsonb_array_elements(p_context->'contributions') x
  where x->>'scope_id'<>anchor->>'scope_id' and x->>'pipeline'=anchor->>'pipeline' and x->>'cadence'=frequency
  and (select coalesce(jsonb_agg(c order by c),'[]') from jsonb_array_elements(x->'channels') c)=channels) then
  raise exception 'Shared deliverable linkage is ambiguous; review its existing deliverable key before creating recurring cards' using errcode='22023';end if;
 card_count:=quantity*jsonb_array_length(cohort);
 if jsonb_array_length(cohort)>10 or card_count>100 then raise exception 'Review a smaller cohort: at most 100 cards and ten contributions' using errcode='54000';end if;
 anchor_date:=(anchor->'service_line'->>'start_date')::date;cutover:=(p_proposal->>'effective_start')::date;
 if anchor_date is null or cutover is null or cutover<anchor_date then raise exception 'Review an exact cycle cutover on or after the saved service start' using errcode='22023';end if;
 perform private.recurring_period_end(frequency,anchor_date,cutover);
 if frequency='weekly' then end_exclusive:=cutover+7*horizon;
 else
  month_offset:=(extract(year from cutover)::integer-extract(year from anchor_date)::integer)*12+extract(month from cutover)::integer-extract(month from anchor_date)::integer;
  end_exclusive:=private.recurring_month_anchor(anchor_date,month_offset+horizon);
 end if;
 for item in select x from jsonb_array_elements(cohort) x loop
  select jsonb_agg(x) into matches from jsonb_array_elements(p_context->'stages') x where x->>'service_id'=item->>'service_id' and x->>'action'='run';
  if jsonb_array_length(matches) is distinct from 1 then raise exception 'Recurring contribution needs one exact reviewed run stage; resolve missing or ambiguous published stage mapping' using errcode='22023';end if;
  s:=matches->0;
  if s->'quantity' is distinct from to_jsonb(quantity) or s->>'department_id' is distinct from item->>'department_id'
   or jsonb_typeof(s->'depends_on') is distinct from 'array' then raise exception 'Stage quantity or department differs from the reviewed canonical contribution' using errcode='22023';end if;
  if stage_map ? (s->>'key') then raise exception 'A recurring stage cannot represent two different contribution scopes' using errcode='22023';end if;
  stage_map:=stage_map||jsonb_build_object(s->>'key',item);
  for i in 1..quantity loop
   key:='s_'||replace(item->>'scope_id','-','')||'_'||i::text;
   templates:=templates||jsonb_build_array(jsonb_build_object('template_key',key,'title',left(item->>'name',210)||' - '||i::text,
    'description',coalesce(item->'service_line'->>'scope_statement','')||case when coalesce(item->'service_line'->>'exclusions','')='' then '' else E'\nExclusions: '||(item->'service_line'->>'exclusions') end,
    'work_item_type','task','priority','medium','department_id',item->>'department_id','default_assignee_id',(select x->'default_assignee_id' from jsonb_array_elements(coalesce(p_context->'head_template_items','[]')) x where x->>'template_key'=key and x->>'department_id'=item->>'department_id'),
    'start_offset_days',0,'due_offset_days',0,'acceptance_criteria','','position',position_value));
   template_map:=template_map||jsonb_build_object(key,jsonb_build_object('scope_id',item->>'scope_id','service_id',item->>'service_id',
     'engagement_service_id',item->>'engagement_service_id','department_id',item->>'department_id','stage_key',s->>'key','deliverable_instance',i));
   position_value:=position_value+1;
  end loop;
 end loop;
 for s in select x from jsonb_array_elements(p_context->'stages') x where stage_map ? (x->>'key') loop
  item:=stage_map->(s->>'key');
  for dep in select value from jsonb_array_elements(s->'depends_on') loop
   if jsonb_typeof(dep) is distinct from 'string' then raise exception 'Exact stage dependency keys required' using errcode='22023';end if;
   pred:=stage_map->(dep#>>'{}');
   if pred is null then
    select jsonb_agg(x) into matches from jsonb_array_elements(p_context->'stages') x where x->>'key'=dep#>>'{}' and x->>'action'='reuse' and jsonb_typeof(x->'source_reference')='object';
    if jsonb_array_length(matches) is distinct from 1 then raise exception 'A prerequisite lacks an exact approved source or shared deliverable mapping; review that existing stage' using errcode='22023';end if;
    pins:=pins||matches;
   else
    if pred->>'scope_id'=item->>'scope_id' then raise exception 'A recurring stage cannot depend on itself' using errcode='22023';end if;
    for i in 1..quantity loop
     from_key:='s_'||replace(pred->>'scope_id','-','')||'_'||i::text;target_key:='s_'||replace(item->>'scope_id','-','')||'_'||i::text;
     edges:=edges||jsonb_build_array(jsonb_build_object('work_template_key',target_key,'depends_on_template_key',from_key));
    end loop;
   end if;
  end loop;
 end loop;
 if jsonb_array_length(edges)>100 then raise exception 'Recurring dependency bound exceeded' using errcode='54000';end if;
 if exists(with recursive walk(start_key,key) as (
  select x->>'work_template_key',x->>'depends_on_template_key' from jsonb_array_elements(edges) x
  union select w.start_key,x->>'depends_on_template_key' from walk w join jsonb_array_elements(edges) x on x->>'work_template_key'=w.key
 ) select 1 from walk w where w.start_key=w.key) then raise exception 'Recurring stage graph contains a cycle' using errcode='22023';end if;
 source_sha:=encode(sha256(convert_to(jsonb_build_object('contributions',cohort,'stages',p_context->'stages','configuration',p_context->'configuration_source')::text,'UTF8')),'hex');
 metadata:=jsonb_build_object('version',1,'source_checksum',source_sha,'source_plan_version_id',p_context->>'source_plan_version_id',
  'selected_scope_id',anchor->>'scope_id','contributors',cohort,'deliverable_key',anchor->>'deliverable_key','channels',channels,
  'deliverable_count',quantity,'work_card_count',card_count,'cycle_anchor',anchor_date,'generation_horizon',horizon,
  'date_policy','cycle_start_through_end_minus_one','template_map',template_map,'dependencies',edges,'approved_prerequisites',pins,
  'configuration_source',p_context->'configuration_source');
 definition:=jsonb_build_object('service_bridge',metadata);
 if p_proposal ? 'scheduler' and p_proposal->'scheduler'<>'null'::jsonb then
  if jsonb_typeof(p_proposal->'scheduler') is distinct from 'object' then raise exception 'Explicit scheduler consent choice required' using errcode='22023';end if;
  definition:=definition||jsonb_build_object('scheduler',p_proposal->'scheduler');
 end if;
 payload:=jsonb_build_object('title',left(coalesce(nullif(anchor->>'deliverable_key',''),anchor->>'name')||' - '||frequency,240),
  'scope',anchor->'service_line'->>'scope_statement','frequency',frequency,'timezone',zone,'effective_start',cutover,
  'effective_end',end_exclusive-1,'cycle_end_exclusive',end_exclusive,'schedule_definition',definition,'template_items',templates,
  'deliverable_count',quantity,'work_card_count',card_count,'dependency_count',jsonb_array_length(edges),'channels',channels,
  'unassigned',true,'automatic_provider_execution',false,'target_date_is_recurrence_end',false);
 return payload||jsonb_build_object('review_sha256',encode(sha256(convert_to(jsonb_build_object('source',p_context,'proposal',p_proposal,'compiled',payload)::text,'UTF8')),'hex'));
end;$$;
revoke all on function private.compile_service_recurring_bridge(jsonb,jsonb) from public,anon,authenticated,service_role;
create function private.service_recurring_source_context(p_org uuid,p_project uuid,p_engagement uuid,p_scope uuid,p_plan uuid default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare
 sc public.project_service_scopes;anchor public.engagement_services;e public.engagements;v private.project_delivery_plan_versions;state private.project_setup_state;
 bundle jsonb;item jsonb;current_metadata jsonb;contributions jsonb:='[]';groups_found jsonb;stage_review jsonb;stages jsonb:='[]';step jsonb;decision jsonb;ref jsonb;
 c public.project_pipeline_configurations;d public.pipeline_execution_definitions;cat public.service_catalog;es public.engagement_services;row_scope public.project_service_scopes;
 plans jsonb;plan_row public.recurring_work_plans;head public.recurring_work_plan_versions;max_end date;selected_group uuid;config_source jsonb;
begin
 select * into e from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project and status in ('planning','active');
 if not found or e.engagement_type<>'retainer' then raise exception 'Existing same-project retainer engagement required; no engagement conversion is performed' using errcode='42501';end if;
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null;
 if not found then raise exception 'Current same-organization project required' using errcode='42501';end if;
 select * into sc from public.project_service_scopes where id=p_scope and organization_id=p_org and project_id=p_project and status in ('proposed','active','on_hold');
 if not found or sc.engagement_service_id is null then raise exception 'Exact existing activated service link required; no activation or ownership is assigned' using errcode='55000';end if;
 select * into anchor from public.engagement_services where id=sc.engagement_service_id and organization_id=p_org and engagement_id=e.id and service_id=sc.service_id and status in ('planned','active','on_hold');
 if not found then raise exception 'Saved scope and canonical engagement service differ' using errcode='55000';end if;
 select * into state from private.project_setup_state where organization_id=p_org and project_id=p_project;
 select * into v from private.project_delivery_plan_versions where organization_id=p_org and project_id=p_project and engagement_id=e.id order by version_number desc limit 1;
 if v.id is null or state.project_id is null then raise exception 'Review the existing shared service setup and immutable project plan before recurring work' using errcode='55000';end if;
 select jsonb_agg(x) into groups_found from jsonb_array_elements(v.snapshot->'groups') x where exists(select 1 from jsonb_array_elements(x->'contributions') i where i->>'scope_id'=sc.id::text);
 if jsonb_array_length(groups_found) is distinct from 1 then raise exception 'An exact shared service-plan bundle is missing or ambiguous; review its existing binding' using errcode='55000';end if;
 bundle:=groups_found->0;
 selected_group:=(bundle->>'pipeline_group_id')::uuid;
 if selected_group is null then raise exception 'Existing pipeline-group binding is missing' using errcode='55000';end if;
 select * into c from public.project_pipeline_configurations where organization_id=p_org and project_id=p_project and engagement_id=e.id and pipeline_group_id=selected_group order by revision desc limit 1;
 if c.id is null then raise exception 'Review the existing pipeline configuration before recurring work' using errcode='55000';end if;
 select x.* into d from public.pipeline_execution_publications p join public.pipeline_execution_definitions x on x.id=p.definition_id and x.organization_id=p.organization_id
  where p.id=c.definition_publication_id and p.organization_id=p_org;
 if d.id is null or d.steps_sha256<>encode(sha256(convert_to(d.steps::text,'UTF8')),'hex') or c.selected_steps_sha256<>encode(sha256(convert_to(c.selected_steps::text,'UTF8')),'hex')
  or c.definition_publication_id::text is distinct from bundle->>'definition_publication_id' then raise exception 'Published pipeline source or selected configuration changed' using errcode='55000';end if;
 stage_review:=private.current_pipeline_stage_review(p_org,c.id);
 if stage_review is null then raise exception 'Use the existing exact stage review before recurring Work' using errcode='55000';end if;
 for item in select x from jsonb_array_elements(bundle->'contributions') x order by x->>'scope_id' loop
  select * into row_scope from public.project_service_scopes where id=(item->>'scope_id')::uuid and organization_id=p_org and project_id=p_project
   and service_id=(item->>'service_id')::uuid and status in ('proposed','active','on_hold');
  select x into current_metadata from jsonb_array_elements(state.plan->'contributions') x where x->>'service_id'=item->>'service_id';
  if row_scope.id is null or current_metadata is null or current_metadata->'service_line' is distinct from item->'service_line'
    or row_scope.quantity is distinct from (item->>'quantity')::integer or row_scope.recurrence is distinct from item->>'cadence'
    or row_scope.unit is distinct from item->>'unit' or current_metadata->'channels' is distinct from item->'channels'
    or current_metadata->>'deliverable_key' is distinct from item->>'deliverable_key'
    or row_scope.start_date is distinct from (item->'service_line'->>'start_date')::date
    or row_scope.target_date is distinct from (item->'service_line'->>'target_date')::date
    or row_scope.scope_statement is distinct from item->'service_line'->>'scope_statement'
    or row_scope.exclusions is distinct from item->'service_line'->>'exclusions' then
   raise exception 'Current canonical service intent differs from the saved project plan; review that existing source' using errcode='40001';end if;
  select * into es from public.engagement_services where id=row_scope.engagement_service_id and engagement_id=e.id and organization_id=p_org and service_id=row_scope.service_id and status in ('planned','active','on_hold');
  select * into cat from public.service_catalog where id=row_scope.service_id and organization_id=p_org and is_active;
  if es.id is null or cat.id is null or cat.unit is distinct from row_scope.unit then raise exception 'Current contributing service or catalogue is unavailable' using errcode='55000';end if;
  contributions:=contributions||jsonb_build_array(jsonb_build_object('scope_id',row_scope.id,'service_id',cat.id,'engagement_service_id',es.id,'department_id',cat.department_id,
   'name',cat.name,'quantity',row_scope.quantity,'unit',row_scope.unit,'cadence',row_scope.recurrence,'pipeline',item->>'pipeline','deliverable_key',item->>'deliverable_key','channels',item->'channels','service_line',item->'service_line'));
 end loop;
 for step in select x from jsonb_array_elements(d.steps) x where c.selected_steps ? (x->>'key') loop
  select x into decision from jsonb_array_elements(stage_review->'decisions') x where x->>'key'=step->>'key';
  if decision is null then raise exception 'Every published recurring stage needs its exact reviewed decision' using errcode='55000';end if;
  select x->'reference' into ref from jsonb_array_elements(stage_review->'resolved_artifacts') x where x->>'step_key'=step->>'key' and x->'input_key'='null'::jsonb;
  stages:=stages||jsonb_build_array(jsonb_build_object('key',step->>'key','service_id',step->>'service_id','department_id',step->>'department_id','quantity',decision->'quantity','action',decision->>'action','depends_on',step->'depends_on','source_reference',ref));
 end loop;
 config_source:=jsonb_build_object('configuration_id',c.id,'revision',c.revision,'selected_steps_sha256',c.selected_steps_sha256,
  'stage_review_sha256',stage_review->'review_sha256','foundation',(stage_review->'foundation_context')-'plan_version_id');
 if p_plan is not null then
  select * into plan_row from public.recurring_work_plans where id=p_plan and organization_id=p_org and project_id=p_project and engagement_id=e.id;
  if not found then raise exception 'Exact existing recurring plan is outside this project' using errcode='42501';end if;
 else
  select jsonb_agg(to_jsonb(p)) into plans from public.recurring_work_plans p where p.organization_id=p_org and p.project_id=p_project and p.engagement_id=e.id
   and p.status not in ('ended','archived') and (p.engagement_service_id=anchor.id or exists(
    select 1 from public.recurring_work_plan_versions rv cross join lateral jsonb_array_elements(coalesce(rv.schedule_definition->'service_bridge'->'contributors','[]')) i
    where rv.plan_id=p.id and i->>'scope_id'=sc.id::text));
  if coalesce(jsonb_array_length(plans),0)>1 then raise exception 'Several exact recurring plans already cover this scope; choose the intended existing plan' using errcode='22023';end if;
  if jsonb_array_length(plans)=1 then select * into plan_row from public.recurring_work_plans where id=(plans->0->>'id')::uuid;end if;
 end if;
 if plan_row.id is not null then
  select * into head from public.recurring_work_plan_versions where plan_id=plan_row.id and organization_id=p_org order by version_number desc limit 1;
  if plan_row.status in ('ended','archived') or (head.id is not null and (head.schedule_definition->'service_bridge'->'version' is distinct from '1'::jsonb
   or not exists(select 1 from jsonb_array_elements(head.schedule_definition->'service_bridge'->'contributors') x where x->>'scope_id'=sc.id::text))) then
   raise exception 'Use the original recurring-plan editor for this existing plan; no legacy conversion is performed' using errcode='55000';end if;
  select * into anchor from public.engagement_services where id=plan_row.engagement_service_id and organization_id=p_org and engagement_id=e.id and status in ('planned','active','on_hold');
  if not found then raise exception 'Current primary service unavailable' using errcode='55000';end if;
  select max(period_end) into max_end from public.recurring_work_occurrences where plan_id=plan_row.id and organization_id=p_org;
 end if;
 return jsonb_build_object('version',1,'organization_id',p_org,'project_id',p_project,'engagement_id',e.id,'selected_scope_id',sc.id,
  'source_plan_version_id',v.id,'primary_engagement_service_id',anchor.id,'primary_owner_id',anchor.owner_id,'contributions',contributions,'stages',stages,
  'configuration_source',config_source,'existing_plan_id',plan_row.id,'plan_head_id',head.id,'approved_version_id',plan_row.approved_version_id,'last_generated_end',max_end,
  'existing_plan_status',plan_row.status,'head_template_items',coalesce((select jsonb_agg(to_jsonb(t) order by t.position,t.id) from public.recurring_work_plan_template_items t where t.plan_version_id=coalesce(plan_row.approved_version_id,head.id)),'[]'::jsonb),'plan_head',case when head.id is null then null else to_jsonb(head) end);
end;$$;
revoke all on function private.service_recurring_source_context(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.lock_service_recurring_source(p_org uuid,p_project uuid,p_engagement uuid) returns void
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p_org::text||':'||p_project::text,0));
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for share;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 perform 1 from public.engagements where id=p_engagement and project_id=p_project and organization_id=p_org for share;
 if not found then raise exception 'Exact engagement required' using errcode='42501';end if;
 perform 1 from public.project_service_scopes where project_id=p_project and organization_id=p_org order by id for share;
 perform 1 from public.engagement_services where engagement_id=p_engagement and organization_id=p_org order by id for share;
 perform 1 from public.service_catalog where organization_id=p_org and id in(select service_id from public.project_service_scopes where project_id=p_project and organization_id=p_org) order by id for share;
 perform 1 from private.project_setup_state where project_id=p_project and organization_id=p_org for share;
 perform 1 from public.project_pipeline_configurations where project_id=p_project and engagement_id=p_engagement and organization_id=p_org order by id for share;
 perform 1 from public.pipeline_execution_publications where organization_id=p_org and id in(select definition_publication_id from public.project_pipeline_configurations where project_id=p_project and engagement_id=p_engagement and organization_id=p_org) order by id for share;
 perform 1 from public.pipeline_execution_definitions where organization_id=p_org and id in(select definition_id from public.pipeline_execution_publications where organization_id=p_org and id in(select definition_publication_id from public.project_pipeline_configurations where project_id=p_project and engagement_id=p_engagement and organization_id=p_org)) order by id for share;
end;$$;
revoke all on function private.lock_service_recurring_source(uuid,uuid,uuid) from public,anon,authenticated,service_role;


create function private.service_recurring_period_end(p_version public.recurring_work_plan_versions,p_period_start date) returns date
language plpgsql immutable set search_path='' as $$
begin
 return private.recurring_period_end(p_version.frequency,
  case when p_version.schedule_definition->'service_bridge'->'version'='1'::jsonb then (p_version.schedule_definition->'service_bridge'->>'cycle_anchor')::date else p_version.effective_start end,p_period_start);
end;$$;
revoke all on function private.service_recurring_period_end(public.recurring_work_plan_versions,date) from public,anon,authenticated,service_role;

create function private.service_recurring_work_date(p_version public.recurring_work_plan_versions,p_start date,p_end date,p_offset integer,p_due boolean) returns date
language sql immutable set search_path='' as $$
 select case when p_version.schedule_definition->'service_bridge'->'version'='1'::jsonb then case when p_due then p_end-1 else p_start end else p_start+p_offset end
$$;
revoke all on function private.service_recurring_work_date(public.recurring_work_plan_versions,date,date,integer,boolean) from public,anon,authenticated,service_role;

create function private.lock_service_recurring_plan(p_plan uuid) returns void
language plpgsql set search_path='' as $$
declare p public.recurring_work_plans;begin
 select * into p from public.recurring_work_plans where id=p_plan;
 if p.id is null or not exists(select 1 from public.recurring_work_plan_versions where plan_id=p.id and schedule_definition->'service_bridge'->'version'='1'::jsonb) then return;end if;
 perform private.lock_service_recurring_source(p.organization_id,p.project_id,p.engagement_id);
 if not pg_try_advisory_xact_lock(hashtextextended(p.organization_id::text||':'||p.engagement_id::text,0)) then
  raise exception 'Work graph is busy; retain the exact recurring request for fresh review' using errcode='40001';end if;
 perform 1 from public.recurring_work_plans where id=p.id and organization_id=p.organization_id for share;
end;$$;
revoke all on function private.lock_service_recurring_plan(uuid) from public,anon,authenticated,service_role;

create function private.validate_service_recurring_version(p_plan public.recurring_work_plans,p_title text,p_scope text,p_frequency text,p_timezone text,p_start date,p_end date,p_definition jsonb,p_items jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare context jsonb;compiled jsonb;normalized jsonb;expected jsonb;begin
 if not p_definition ? 'service_bridge' then
  if exists(select 1 from public.recurring_work_plan_versions v where v.plan_id=p_plan.id and v.schedule_definition ? 'service_bridge') then
   raise exception 'A reviewed service bridge cannot be silently converted to an unbound legacy plan' using errcode='55000';
  end if;
  return null;
 end if;
 perform private.lock_service_recurring_source(p_plan.organization_id,p_plan.project_id,p_plan.engagement_id);
 if p_definition->'service_bridge'->'version' is distinct from '1'::jsonb or p_definition->'service_bridge'->>'selected_scope_id' is null then
  raise exception 'Unsupported service-recurring binding metadata' using errcode='22023';end if;
 context:=private.service_recurring_source_context(p_plan.organization_id,p_plan.project_id,p_plan.engagement_id,(p_definition->'service_bridge'->>'selected_scope_id')::uuid,p_plan.id);
 compiled:=private.compile_service_recurring_bridge(context,jsonb_build_object('version',1,'effective_start',p_start,'scheduler',p_definition->'scheduler'));
 if exists(select 1 from jsonb_array_elements(p_items) x where x ? 'department_id' and x->>'department_id' is distinct from
  p_definition->'service_bridge'->'template_map'->(x->>'template_key')->>'department_id') then
  raise exception 'Exact pinned recurring template department required' using errcode='40001';end if;
 select jsonb_agg((x-'default_assignee_id')||jsonb_build_object('department_id',p_definition->'service_bridge'->'template_map'->(x->>'template_key')->>'department_id') order by x->>'template_key')
  into normalized from jsonb_array_elements(p_items) x;
 select jsonb_agg(x-'default_assignee_id' order by x->>'template_key') into expected from jsonb_array_elements(compiled->'template_items') x;
 if p_frequency is distinct from compiled->>'frequency' or p_timezone is distinct from compiled->>'timezone'
  or p_start is distinct from (compiled->>'effective_start')::date or p_end is distinct from (compiled->>'effective_end')::date
  or trim(p_title) is distinct from compiled->>'title' or p_scope is distinct from compiled->>'scope'
  or p_definition is distinct from compiled->'schedule_definition' or normalized is distinct from expected then
  raise exception 'Recurring template content or mapping differs from the exact canonical service review' using errcode='40001';end if;
 return compiled;
end;$$;
revoke all on function private.validate_service_recurring_version(public.recurring_work_plans,text,text,text,text,date,date,jsonb,jsonb) from public,anon,authenticated,service_role;

create function private.assert_service_recurring_current(p_plan public.recurring_work_plans,p_version public.recurring_work_plan_versions,p_period_start date) returns void
language plpgsql stable set search_path='' as $$
declare meta jsonb:=p_version.schedule_definition->'service_bridge';context jsonb;compiled jsonb;item jsonb;begin
 if meta is null then return;end if;
 if meta->'version' is distinct from '1'::jsonb then raise exception 'Unsupported service-recurring binding' using errcode='55000';end if;
 context:=private.service_recurring_source_context(p_plan.organization_id,p_plan.project_id,p_plan.engagement_id,(meta->>'selected_scope_id')::uuid,p_plan.id);
 compiled:=private.compile_service_recurring_bridge(context,jsonb_build_object('version',1,'effective_start',p_version.effective_start,'scheduler',p_version.schedule_definition->'scheduler'));
 if meta->>'source_checksum' is distinct from compiled->'schedule_definition'->'service_bridge'->>'source_checksum'
  or meta->'template_map' is distinct from compiled->'schedule_definition'->'service_bridge'->'template_map'
  or meta->'dependencies' is distinct from compiled->'schedule_definition'->'service_bridge'->'dependencies'
  or meta->'date_policy' is distinct from '"cycle_start_through_end_minus_one"'::jsonb
  or p_version.effective_end is distinct from (compiled->>'effective_end')::date
  or p_version.frequency is distinct from compiled->>'frequency' or p_version.timezone is distinct from compiled->>'timezone' then
  raise exception 'Recurring service material changed; review a new future version, retaining original cycles and Work' using errcode='55000';end if;
 if p_period_start<p_version.effective_start or p_period_start>p_version.effective_end then
  raise exception 'Requested cycle is outside the explicitly reviewed finite horizon' using errcode='55000';end if;
 perform private.service_recurring_period_end(p_version,p_period_start);
 for item in select x from jsonb_array_elements(compiled->'schedule_definition'->'service_bridge'->'contributors') x loop
  perform 1 from public.project_service_scopes where id=(item->>'scope_id')::uuid and organization_id=p_plan.organization_id and project_id=p_plan.project_id and status='active';
  if not found then raise exception 'A connected recurring service scope is no longer active' using errcode='55000';end if;
  perform 1 from public.engagement_services where id=(item->>'engagement_service_id')::uuid and organization_id=p_plan.organization_id and engagement_id=p_plan.engagement_id and service_id=(item->>'service_id')::uuid and status='active';
  if not found then raise exception 'A connected activated service is no longer active' using errcode='55000';end if;
 end loop;
end;$$;
revoke all on function private.assert_service_recurring_current(public.recurring_work_plans,public.recurring_work_plan_versions,date) from public,anon,authenticated,service_role;

create function private.materialize_service_recurring_edges(p_plan public.recurring_work_plans,p_version public.recurring_work_plan_versions,p_occurrence uuid,p_actor uuid,p_execution_path text) returns void
language plpgsql set search_path='' as $$
declare edge jsonb;target public.work_items;predecessor public.work_items;
 machine boolean;admission public.recurring_schedule_admissions;occurrence public.recurring_work_occurrences;applicable uuid;cycle_exists boolean;
begin
 if p_version.schedule_definition->'service_bridge'->'version' is distinct from '1'::jsonb then return;end if;
 if p_execution_path is null or p_execution_path not in ('manual','scheduler') then raise exception 'Trusted recurring execution path required' using errcode='22023';end if;
 -- Only the two closed server call sites choose this required path. No membership-based fallback.
 machine:=p_execution_path='scheduler';
 if machine then
  -- This CLOSED helper is entered by the existing service-only scheduler entry.
  -- Its actual principal remains the creator; no human actor is substituted.
  if current_setting('role',true)<>'service_role' or auth.uid() is not null then
   raise exception 'Verified scheduler entry required' using errcode='42501';end if;
  perform private.assert_recurring_scheduler(p_actor,p_plan.organization_id);
  perform private.n1c_require_recurring_delegation(p_plan.id,p_version.id);
  perform private.assert_scheduled_recurring_context(p_plan,p_version);
  select * into occurrence from public.recurring_work_occurrences where id=p_occurrence and organization_id=p_plan.organization_id
   and plan_id=p_plan.id and plan_version_id=p_version.id and project_id=p_plan.project_id and engagement_id=p_plan.engagement_id
   and engagement_service_id=p_plan.engagement_service_id and service_id=p_plan.service_id and generated_by=p_actor;
  if not found or occurrence.timezone is distinct from p_version.timezone
   or occurrence.period_end is distinct from private.service_recurring_period_end(p_version,occurrence.period_start) then
   raise exception 'Exact canonical machine occurrence required' using errcode='42501';end if;
  select * into admission from public.recurring_schedule_admissions where organization_id=p_plan.organization_id and plan_id=p_plan.id
   and plan_version_id=p_version.id and period_start=occurrence.period_start and actor_id=p_actor for share;
  if not found or admission.timezone is distinct from occurrence.timezone
   or admission.plan_status_changed_at is distinct from p_plan.status_changed_at
   or not private.recurring_execution_open(clock_timestamp(),admission.retry_deadline,admission.period_start,admission.timezone)
   or exists(select 1 from public.recurring_schedule_executions where admission_id=admission.id and outcome='manual_review')
   or not exists(select 1 from public.recurring_schedule_consents where plan_version_id=p_version.id and plan_id=p_plan.id and organization_id=p_plan.organization_id)
   or p_version.schedule_definition->'scheduler'->'enabled' is distinct from 'true'::jsonb then
   raise exception 'Current exact scheduler consent and admission required' using errcode='55000';end if;
  select v.id into applicable from public.recurring_work_plan_versions v join public.recurring_work_plan_version_approvals a on a.plan_version_id=v.id
   where v.organization_id=p_plan.organization_id and v.plan_id=p_plan.id and v.effective_start<=occurrence.period_start
    and (v.effective_end is null or v.effective_end>=occurrence.period_start) order by v.effective_start desc,v.version_number desc limit 1;
  if applicable is distinct from p_version.id then raise exception 'Applicable machine version changed' using errcode='55000';end if;
 end if;
 if not machine then perform private.assert_recurring_generation_actor(p_plan,p_actor);end if;
 for edge in select x from jsonb_array_elements(p_version.schedule_definition->'service_bridge'->'dependencies') x loop
  select * into target from public.work_items where organization_id=p_plan.organization_id and project_id=p_plan.project_id and engagement_id=p_plan.engagement_id
   and recurring_occurrence_id=p_occurrence and recurring_plan_version_id=p_version.id and recurring_template_key=edge->>'work_template_key' and deleted_at is null for update;
  select * into predecessor from public.work_items where organization_id=p_plan.organization_id and project_id=p_plan.project_id and engagement_id=p_plan.engagement_id
   and recurring_occurrence_id=p_occurrence and recurring_plan_version_id=p_version.id and recurring_template_key=edge->>'depends_on_template_key' and deleted_at is null for update;
  if target.id is null or predecessor.id is null then raise exception 'Exact same-occurrence recurring dependency card unavailable' using errcode='55000';end if;
  if not machine then
   perform public.mutate_p5_work_item_dependency(p_plan.organization_id,'add',target.id,predecessor.id,target.row_version,p_actor);
  else
   if target.id=predecessor.id or target.created_by is distinct from p_actor or predecessor.created_by is distinct from p_actor
    or target.created_via<>'recurring_plan' or predecessor.created_via<>'recurring_plan'
    or target.recurring_plan_id is distinct from p_plan.id or predecessor.recurring_plan_id is distinct from p_plan.id
    or target.status<>'not_started' or predecessor.status<>'not_started' then
    raise exception 'Only exact approved initial machine cards may be connected' using errcode='42501';end if;
   -- Same canonical engagement serialization and live cycle predicate used by
   -- save_work_item_dependency. Public P5/member authority stays unchanged.
   perform pg_advisory_xact_lock(hashtextextended(p_plan.organization_id::text||':'||p_plan.engagement_id::text,0));
   with recursive reachable(id) as (
    select d.depends_on_work_item_id from public.work_item_dependencies d join public.work_items w
     on w.id=d.depends_on_work_item_id and w.organization_id=d.organization_id and w.deleted_at is null
     where d.work_item_id=predecessor.id and d.organization_id=p_plan.organization_id
    union
    select d.depends_on_work_item_id from public.work_item_dependencies d join reachable r on d.work_item_id=r.id
     join public.work_items w on w.id=d.depends_on_work_item_id and w.organization_id=d.organization_id and w.deleted_at is null
     where d.organization_id=p_plan.organization_id
   ) select exists(select 1 from reachable where id=target.id) into cycle_exists;
   if cycle_exists then raise exception 'Dependency would create a cycle' using errcode='23514';end if;
   insert into public.work_item_dependencies(organization_id,work_item_id,depends_on_work_item_id,created_by)
    values(p_plan.organization_id,target.id,predecessor.id,p_actor);
   -- Existing P5 row-version and N1C metadata/provenance triggers still execute.
   update public.work_items set updated_at=now() where id=target.id;
  end if;
 end loop;
end;$$;
revoke all on function private.materialize_service_recurring_edges(public.recurring_work_plans,public.recurring_work_plan_versions,uuid,uuid,text) from public,anon,authenticated,service_role;

create function private.build_service_recurring_plan_review(p_org uuid,p_project uuid,p_engagement uuid,p_scope uuid,p_plan uuid,p_proposal jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare actor uuid:=auth.uid();context jsonb;proposal jsonb;compiled jsonb;anchor jsonb;cutover date;boundary date;offset_value integer;answer jsonb;
begin
 if actor is null then raise exception 'Authenticated service owner required' using errcode='42501';end if;
 perform private.n1c_require_scope(p_org,p_project,actor);
 perform private.lock_service_recurring_source(p_org,p_project,p_engagement);
 context:=private.service_recurring_source_context(p_org,p_project,p_engagement,p_scope,p_plan);
 if context->>'primary_owner_id' is distinct from actor::text then raise exception 'Only the current primary activated service owner may draft this recurring plan' using errcode='42501';end if;
 if context->>'existing_plan_id' is not null then
  perform 1 from public.recurring_work_plans where id=(context->>'existing_plan_id')::uuid and organization_id=p_org for share;
  context:=private.service_recurring_source_context(p_org,p_project,p_engagement,p_scope,(context->>'existing_plan_id')::uuid);
 end if;
 if p_proposal is null then
  select x into anchor from jsonb_array_elements(context->'contributions') x where x->>'scope_id'=p_scope::text;
  cutover:=(anchor->'service_line'->>'start_date')::date;boundary:=(context->>'last_generated_end')::date;
  if boundary is not null and boundary>cutover then
   if anchor->>'cadence'='weekly' then cutover:=cutover+(((boundary-cutover+6)/7)*7);
   elsif anchor->>'cadence'='monthly' then
    offset_value:=(extract(year from boundary)::integer-extract(year from cutover)::integer)*12+extract(month from boundary)::integer-extract(month from cutover)::integer;
    if private.recurring_month_anchor(cutover,offset_value)<boundary then offset_value:=offset_value+1;end if;
    cutover:=private.recurring_month_anchor(cutover,offset_value);
   end if;
  end if;
  proposal:=jsonb_build_object('version',1,'effective_start',cutover,'scheduler',context->'plan_head'->'schedule_definition'->'scheduler');
 else
  if not p_proposal ? 'scheduler' then raise exception 'Review the explicit scheduler choice; consent is never inferred' using errcode='22023';end if;
  proposal:=p_proposal;
 end if;
 compiled:=private.compile_service_recurring_bridge(context,proposal);
 if context->>'last_generated_end' is not null and (compiled->>'effective_start')::date<(context->>'last_generated_end')::date then
  raise exception 'A new plan version must start after existing generated cycles; original Work and history stay intact' using errcode='40001';end if;
 answer:=jsonb_build_object('version',1,'context',context,'proposal',proposal,'compiled',compiled,'can_apply',true,
  'requires_existing_plan_approval',true,'requires_existing_version_delegation',true,'activation_performed',false,'assignment_performed',false,
  'provider_execution',false,'client_publication',false);
 return answer||jsonb_build_object('review_sha256',encode(sha256(convert_to(answer::text,'UTF8')),'hex'));
end;$$;
revoke all on function private.build_service_recurring_plan_review(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.get_service_recurring_plan_context(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_scope_id uuid,p_plan_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin return private.build_service_recurring_plan_review(p_organization_id,p_project_id,p_engagement_id,p_scope_id,p_plan_id,null);end;$$;
create function public.review_service_recurring_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_scope_id uuid,p_plan_id uuid,p_proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin return private.build_service_recurring_plan_review(p_organization_id,p_project_id,p_engagement_id,p_scope_id,p_plan_id,p_proposal);end;$$;

create function public.apply_service_recurring_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_scope_id uuid,p_plan_id uuid,p_proposal jsonb,p_review_sha256 text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();payload jsonb;receipt private.project_work_commands;review jsonb;context jsonb;compiled jsonb;plan_row public.recurring_work_plans;version_row public.recurring_work_plan_versions;result jsonb;
begin
 if actor is null or p_request_id is null or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_proposal) is distinct from 'object' or octet_length(p_proposal::text)>8192 then raise exception 'Original request and exact reviewed recurring intent required' using errcode='22023';end if;
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 perform pg_advisory_xact_lock(hashtextextended('service-recurring-request:'||p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 payload:=jsonb_build_object('action','service_recurring_bridge_v1','project_id',p_project_id,'engagement_id',p_engagement_id,'scope_id',p_scope_id,'plan_id',p_plan_id,'proposal',p_proposal,'review_sha256',p_review_sha256);
 select * into receipt from private.project_work_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.project_id is distinct from p_project_id or receipt.payload is distinct from payload then raise exception 'Original request belongs to different exact recurring intent' using errcode='23505';end if;
  return receipt.result;
 end if;
 review:=private.build_service_recurring_plan_review(p_organization_id,p_project_id,p_engagement_id,p_scope_id,p_plan_id,p_proposal);
 if review->>'review_sha256' is distinct from p_review_sha256 then raise exception 'Service, plan head or reviewed source changed; retain the draft and review current intent' using errcode='40001';end if;
 context:=review->'context';compiled:=review->'compiled';
 if context->>'existing_plan_id' is null then
  plan_row:=public.create_recurring_work_plan((context->>'primary_engagement_service_id')::uuid,compiled->>'title',compiled->>'scope',compiled->>'frequency',compiled->>'timezone',
   (compiled->>'effective_start')::date,(compiled->>'effective_end')::date,compiled->'schedule_definition',compiled->'template_items',actor);
  select * into version_row from public.recurring_work_plan_versions where plan_id=plan_row.id and organization_id=p_organization_id order by version_number desc limit 1;
 else
  select * into plan_row from public.recurring_work_plans where id=(context->>'existing_plan_id')::uuid and organization_id=p_organization_id for update;
  version_row:=public.create_recurring_work_plan_version(plan_row.id,compiled->>'title',compiled->>'scope',compiled->>'frequency',compiled->>'timezone',
   (compiled->>'effective_start')::date,(compiled->>'effective_end')::date,compiled->'schedule_definition',compiled->'template_items',actor);
 end if;
 result:=jsonb_build_object('version',1,'request_id',p_request_id,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,
  'scope_id',p_scope_id,'plan_id',plan_row.id,'plan_version_id',version_row.id,'plan_version_number',version_row.version_number,'plan_status',plan_row.status,
  'deliverable_count',compiled->'deliverable_count','work_card_count',compiled->'work_card_count','dependency_count',compiled->'dependency_count',
  'frequency',version_row.frequency,'timezone',version_row.timezone,'effective_start',version_row.effective_start,'effective_end',version_row.effective_end,
  'requires_existing_plan_approval',true,'requires_existing_version_delegation',true,'activation_performed',false,'assignment_performed',false,'work_created',false,
  'scheduler_consent_created',version_row.schedule_definition ? 'scheduler','provider_execution',false,'client_publication',false);
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,actor,p_request_id,payload,result);
 return result;
end;$$;
create function public.recover_service_recurring_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt private.project_work_commands;begin
 if auth.uid() is null or p_request_id is null then raise exception 'Authenticated original request required' using errcode='42501';end if;
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 select * into receipt from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=auth.uid() and request_id=p_request_id;
 if not found then return jsonb_build_object('status','not_applied','request_id',p_request_id);end if;
 if receipt.payload->>'action' is distinct from 'service_recurring_bridge_v1' or receipt.payload->>'engagement_id' is distinct from p_engagement_id::text then
  raise exception 'Original request is outside this exact recurring scope' using errcode='42501';end if;
 return jsonb_build_object('status','applied','request_id',p_request_id,'original_result',receipt.result);
end;$$;
revoke all on function public.get_service_recurring_plan_context(uuid,uuid,uuid,uuid,uuid),public.review_service_recurring_plan(uuid,uuid,uuid,uuid,uuid,jsonb),
 public.apply_service_recurring_plan(uuid,uuid,uuid,uuid,uuid,jsonb,text,uuid),public.recover_service_recurring_plan(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_service_recurring_plan_context(uuid,uuid,uuid,uuid,uuid),public.review_service_recurring_plan(uuid,uuid,uuid,uuid,uuid,jsonb),
 public.apply_service_recurring_plan(uuid,uuid,uuid,uuid,uuid,jsonb,text,uuid),public.recover_service_recurring_plan(uuid,uuid,uuid,uuid) to authenticated;


CREATE OR REPLACE FUNCTION private.insert_recurring_plan_version(p_plan recurring_work_plans, p_title text, p_scope text, p_frequency text, p_timezone text, p_effective_start date, p_effective_end date, p_schedule_definition jsonb, p_template_items jsonb, p_actor_id uuid)
 RETURNS recurring_work_plan_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_version public.recurring_work_plan_versions;
  v_item jsonb;
  v_department_id text;
begin
  perform private.validate_service_recurring_version(p_plan,p_title,p_scope,p_frequency,p_timezone,p_effective_start,p_effective_end,p_schedule_definition,p_template_items);
  select service.department_id into v_department_id from public.service_catalog service
  where service.id = p_plan.service_id and service.organization_id = p_plan.organization_id;
  if coalesce(jsonb_typeof(p_template_items), '') <> 'array' or jsonb_array_length(p_template_items) = 0 then
    raise exception 'At least one template item is required.' using errcode = '22023';
  end if;
  insert into public.recurring_work_plan_versions (
    organization_id, plan_id, version_number, title, scope, frequency, timezone,
    effective_start, effective_end, schedule_definition, created_by
  ) values (
    p_plan.organization_id, p_plan.id,
    coalesce((select max(plan_version.version_number) + 1 from public.recurring_work_plan_versions plan_version where plan_version.plan_id = p_plan.id), 1),
    trim(p_title), coalesce(p_scope, ''), p_frequency, trim(p_timezone),
    p_effective_start, p_effective_end, coalesce(p_schedule_definition, '{}'::jsonb), p_actor_id
  ) returning * into v_version;
  for v_item in select value from jsonb_array_elements(p_template_items) loop
    if nullif(v_item->>'default_assignee_id', '') is not null and not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = p_plan.organization_id
        and membership.user_id = (v_item->>'default_assignee_id')::uuid
        and membership.member_kind = 'team' and membership.status = 'active'
    ) then raise exception 'Template assignees must be active organization team members.' using errcode = '42501'; end if;
    insert into public.recurring_work_plan_template_items (
      organization_id, plan_id, plan_version_id, template_key, title, description,
      work_item_type, priority, department_id, default_assignee_id,
      start_offset_days, due_offset_days, acceptance_criteria, position, created_by
    ) values (
      p_plan.organization_id, p_plan.id, v_version.id, trim(v_item->>'template_key'), trim(v_item->>'title'),
      coalesce(v_item->>'description', ''), coalesce(nullif(v_item->>'work_item_type', ''), 'task'),
      coalesce(nullif(v_item->>'priority', ''), 'medium'),
      case when p_schedule_definition->'service_bridge'->'version'='1'::jsonb then p_schedule_definition->'service_bridge'->'template_map'->(v_item->>'template_key')->>'department_id' else v_department_id end,
      nullif(v_item->>'default_assignee_id', '')::uuid,
      coalesce((v_item->>'start_offset_days')::integer, 0), coalesce((v_item->>'due_offset_days')::integer, 0),
      coalesce(v_item->>'acceptance_criteria', ''), (v_item->>'position')::integer, p_actor_id
    );
  end loop;
  return v_version;
end;
$function$

;
CREATE OR REPLACE FUNCTION private.build_recurring_period_preview(p_plan_id uuid, p_period_start date, p_past_period_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_plan public.recurring_work_plans;
  v_version public.recurring_work_plan_versions;
  v_engagement public.engagements;
  v_service public.engagement_services;
  v_catalog public.service_catalog;
  v_period_end date;
  v_local_today date;
  v_reasons text[] := array[]::text[];
  v_items jsonb := '[]'::jsonb;
begin
  if p_period_start is null then raise exception 'Period start is required.' using errcode = '22023'; end if;
  select * into v_plan from public.recurring_work_plans where id = p_plan_id;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_generation_actor(v_plan, p_actor_id);

  select version.* into v_version
  from public.recurring_work_plan_versions version
  join public.recurring_work_plan_version_approvals approval on approval.plan_version_id = version.id
  where version.plan_id = v_plan.id and version.organization_id = v_plan.organization_id
    and version.effective_start <= p_period_start
    and (version.effective_end is null or version.effective_end >= p_period_start)
  order by version.effective_start desc, version.version_number desc
  limit 1;

  if not found then
    v_reasons := array_append(v_reasons, 'no_approved_effective_version');
    return jsonb_build_object('eligible', false, 'reasons', to_jsonb(v_reasons),
      'plan_id', v_plan.id, 'period_start', p_period_start);
  end if;

  begin
    v_period_end := private.service_recurring_period_end(v_version,p_period_start);
  exception when sqlstate '22023' then
    v_reasons := array_append(v_reasons, 'period_start_is_not_canonical');
  end;

  if v_version.schedule_definition ? 'service_bridge' then
    begin perform private.assert_service_recurring_current(v_plan,v_version,p_period_start);
    exception when sqlstate '55000' or sqlstate '40001' or sqlstate '42501' or sqlstate '22023' then
      v_reasons:=array_append(v_reasons,'service_recurring_source_review_required');
    end;
  end if;
  select * into v_engagement from public.engagements
  where id = v_plan.engagement_id and project_id = v_plan.project_id and organization_id = v_plan.organization_id;
  select * into v_service from public.engagement_services
  where id = v_plan.engagement_service_id and engagement_id = v_plan.engagement_id
    and service_id = v_plan.service_id and organization_id = v_plan.organization_id;
  select * into v_catalog from public.service_catalog
  where id = v_plan.service_id and organization_id = v_plan.organization_id;

  if v_plan.status <> 'active' then v_reasons := array_append(v_reasons, 'plan_not_active'); end if;
  if v_engagement.engagement_type <> 'retainer' then v_reasons := array_append(v_reasons, 'engagement_not_retainer'); end if;
  if v_engagement.status <> 'active' then v_reasons := array_append(v_reasons, 'engagement_not_active'); end if;
  if v_service.status <> 'active' then v_reasons := array_append(v_reasons, 'engagement_service_not_active'); end if;
  if not coalesce(v_catalog.is_active, false) then v_reasons := array_append(v_reasons, 'service_catalog_not_active'); end if;
  if exists (
    select 1 from public.recurring_work_plan_template_items item
    where item.plan_version_id = v_version.id and item.default_assignee_id is not null
      and not exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = v_plan.organization_id
          and membership.user_id = item.default_assignee_id
          and membership.member_kind = 'team' and membership.status = 'active'
      )
  ) then v_reasons := array_append(v_reasons, 'template_assignee_not_active'); end if;

  v_local_today := (now() at time zone v_version.timezone)::date;
  if p_period_start < v_local_today and length(trim(coalesce(p_past_period_reason, ''))) = 0 then
    v_reasons := array_append(v_reasons, 'past_period_reason_required');
  end if;
  if length(coalesce(p_past_period_reason, '')) > 2000 then
    v_reasons := array_append(v_reasons, 'past_period_reason_too_long');
  end if;
  if exists (
    select 1 from public.recurring_work_occurrences occurrence
    where occurrence.organization_id = v_plan.organization_id
      and occurrence.plan_id = v_plan.id and occurrence.period_start = p_period_start
  ) then v_reasons := array_append(v_reasons, 'period_already_generated'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'template_key', item.template_key, 'title', item.title, 'description', item.description,
    'work_item_type', item.work_item_type, 'priority', item.priority,
    'assignee_id', item.default_assignee_id, 'department_id', item.department_id,
    'start_date', private.service_recurring_work_date(v_version,p_period_start,v_period_end,item.start_offset_days,false),
    'due_date', private.service_recurring_work_date(v_version,p_period_start,v_period_end,item.due_offset_days,true),
    'acceptance_criteria', item.acceptance_criteria, 'position', item.position
  ) order by item.position, item.id), '[]'::jsonb) into v_items
  from public.recurring_work_plan_template_items item where item.plan_version_id = v_version.id;

  return jsonb_build_object(
    'eligible', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons),
    'organization_id', v_plan.organization_id, 'plan_id', v_plan.id,
    'plan_version_id', v_version.id, 'version_number', v_version.version_number,
    'frequency', v_version.frequency, 'timezone', v_version.timezone,
    'period_start', p_period_start, 'period_end', v_period_end,
    'local_today', v_local_today, 'template_items', v_items
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.confirm_recurring_work_period(p_plan_id uuid, p_period_start date, p_request_key uuid, p_past_period_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.recurring_work_plans;
  v_version public.recurring_work_plan_versions;
  v_preview jsonb;
  v_occurrence public.recurring_work_occurrences;
  v_existing_attempt public.recurring_work_generation_attempts;
  v_engagement public.engagements;
  v_item public.recurring_work_plan_template_items;
  v_work_item public.work_items;
  v_work_items jsonb;
  v_outcome text := 'generated';
begin
  if p_request_key is null then raise exception 'Request key is required.' using errcode = '22023'; end if;
  select * into v_plan from public.recurring_work_plans where id = p_plan_id;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_generation_actor(v_plan, p_actor_id);
  perform private.lock_service_recurring_plan(v_plan.id);
  perform pg_advisory_xact_lock(hashtextextended(v_plan.organization_id::text || ':' || v_plan.id::text || ':' || p_period_start::text, 0));

  select * into v_existing_attempt from public.recurring_work_generation_attempts
  where organization_id = v_plan.organization_id and request_key = p_request_key;
  if found then
    if v_existing_attempt.plan_id <> v_plan.id or v_existing_attempt.requested_period_start <> p_period_start then
      raise exception 'Request key was already used for a different recurring period.' using errcode = '22023';
    end if;
    select * into v_occurrence from public.recurring_work_occurrences where id = v_existing_attempt.occurrence_id;
  else
    select * into v_occurrence from public.recurring_work_occurrences
    where organization_id = v_plan.organization_id and plan_id = v_plan.id and period_start = p_period_start;
    if found then
      v_outcome := 'replayed';
      insert into public.recurring_work_generation_attempts (
        organization_id, plan_id, plan_version_id, occurrence_id, request_key,
        requested_period_start, outcome, actor_id
      ) values (
        v_occurrence.organization_id, v_occurrence.plan_id, v_occurrence.plan_version_id,
        v_occurrence.id, p_request_key, p_period_start, v_outcome, p_actor_id
      );
    else
      v_preview := private.build_recurring_period_preview(
        p_plan_id, p_period_start, p_past_period_reason, p_actor_id
      );
      if not coalesce((v_preview->>'eligible')::boolean, false) then
        raise exception 'Recurring period is not eligible: %', v_preview->'reasons' using errcode = '22023';
      end if;
      perform private.n1c_require_recurring_delegation(v_plan.id,(v_preview->>'plan_version_id')::uuid);
      select * into v_version from public.recurring_work_plan_versions where id=(v_preview->>'plan_version_id')::uuid and plan_id=v_plan.id;
      select * into v_engagement from public.engagements where id = v_plan.engagement_id;
      insert into public.recurring_work_occurrences (
        organization_id, plan_id, plan_version_id, project_id, engagement_id,
        engagement_service_id, service_id, period_start, period_end, timezone,
        generated_by, past_period_reason
      ) values (
        v_plan.organization_id, v_plan.id, (v_preview->>'plan_version_id')::uuid,
        v_plan.project_id, v_plan.engagement_id, v_plan.engagement_service_id,
        v_plan.service_id, p_period_start, (v_preview->>'period_end')::date,
        v_preview->>'timezone', p_actor_id, trim(coalesce(p_past_period_reason, ''))
      ) returning * into v_occurrence;

      for v_item in select * from public.recurring_work_plan_template_items
        where plan_version_id = v_occurrence.plan_version_id order by position, id
      loop
        insert into public.work_items (
          organization_id, project_id, engagement_id, brand_id, department_id,
          title, description, work_item_type, priority, status, assignee_id,
          created_by, start_date, due_date, position, created_via,
          recurring_occurrence_id, recurring_plan_id, recurring_plan_version_id,
          recurring_template_key
        ) values (
          v_plan.organization_id, v_plan.project_id, v_plan.engagement_id,
          v_engagement.brand_id, v_item.department_id, v_item.title, v_item.description,
          v_item.work_item_type, v_item.priority, 'not_started', v_item.default_assignee_id,
          p_actor_id, private.service_recurring_work_date(v_version,p_period_start,v_occurrence.period_end,v_item.start_offset_days,false),
          private.service_recurring_work_date(v_version,p_period_start,v_occurrence.period_end,v_item.due_offset_days,true), v_item.position, 'recurring_plan',
          v_occurrence.id, v_plan.id, v_occurrence.plan_version_id, v_item.template_key
        ) returning * into v_work_item;

        insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
        values (v_plan.organization_id, v_plan.engagement_id, 'work_item_created', p_actor_id,
          jsonb_build_object(
            'record_type', 'work_item', 'record_id', v_work_item.id, 'action', 'created',
            'status', v_work_item.status, 'assignee_id', v_work_item.assignee_id,
            'department_id', v_work_item.department_id, 'parent_work_item_id', null,
            'created_via', 'recurring_plan', 'recurring_plan_id', v_plan.id,
            'recurring_plan_version_id', v_occurrence.plan_version_id,
            'recurring_occurrence_id', v_occurrence.id, 'recurring_template_key', v_item.template_key,
            'period_start', v_occurrence.period_start, 'period_end', v_occurrence.period_end,
            'request_key', p_request_key
          ));
        if v_work_item.assignee_id is not null then
          insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
          values (v_plan.organization_id, v_plan.engagement_id, 'work_item_assigned', p_actor_id,
            jsonb_build_object(
              'record_type', 'work_item', 'record_id', v_work_item.id, 'action', 'assigned',
              'previous_assignee_id', null, 'assignee_id', v_work_item.assignee_id,
              'created_via', 'recurring_plan', 'recurring_occurrence_id', v_occurrence.id
            ));
        end if;
      end loop;

      perform private.materialize_service_recurring_edges(v_plan,v_version,v_occurrence.id,p_actor_id,'manual');
      insert into public.recurring_work_generation_attempts (
        organization_id, plan_id, plan_version_id, occurrence_id, request_key,
        requested_period_start, outcome, actor_id
      ) values (
        v_occurrence.organization_id, v_occurrence.plan_id, v_occurrence.plan_version_id,
        v_occurrence.id, p_request_key, p_period_start, v_outcome, p_actor_id
      );
      insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
      values (v_plan.organization_id, v_plan.engagement_id, 'recurring_period_generated', p_actor_id,
        jsonb_build_object(
          'plan_id', v_plan.id, 'plan_version_id', v_occurrence.plan_version_id,
          'occurrence_id', v_occurrence.id, 'period_start', v_occurrence.period_start,
          'period_end', v_occurrence.period_end, 'timezone', v_occurrence.timezone,
          'request_key', p_request_key, 'created_via', 'recurring_plan'
        ));
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', work_item.id, 'template_key', work_item.recurring_template_key,
    'title', work_item.title, 'start_date', work_item.start_date,
    'due_date', work_item.due_date, 'assignee_id', work_item.assignee_id
  ) order by work_item.position, work_item.id), '[]'::jsonb) into v_work_items
  from public.work_items work_item where work_item.recurring_occurrence_id = v_occurrence.id;

  return jsonb_build_object(
    'outcome', case when v_existing_attempt.id is not null then v_existing_attempt.outcome else v_outcome end,
    'occurrence_id', v_occurrence.id, 'plan_id', v_occurrence.plan_id,
    'plan_version_id', v_occurrence.plan_version_id, 'period_start', v_occurrence.period_start,
    'period_end', v_occurrence.period_end, 'timezone', v_occurrence.timezone,
    'work_items', v_work_items
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION private.assert_scheduled_recurring_context(p_plan recurring_work_plans, p_version recurring_work_plan_versions)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_assignee uuid;
begin
  if p_version.schedule_definition ? 'service_bridge' then
    perform private.assert_service_recurring_current(p_plan,p_version,p_version.effective_start);
  end if;
  if p_plan.status <> 'active' then raise exception 'Plan inactive.' using errcode = '55000'; end if;
  perform 1 from public.engagements where id=p_plan.engagement_id and project_id=p_plan.project_id
    and organization_id=p_plan.organization_id and status='active' and engagement_type='retainer' for share;
  if not found then raise exception 'Retainer inactive.' using errcode = '55000'; end if;
  perform 1 from public.engagement_services where id=p_plan.engagement_service_id and engagement_id=p_plan.engagement_id
    and service_id=p_plan.service_id and organization_id=p_plan.organization_id and status='active' for share;
  if not found then raise exception 'Service inactive.' using errcode = '55000'; end if;
  perform 1 from public.service_catalog where id=p_plan.service_id and organization_id=p_plan.organization_id and is_active for share;
  if not found then raise exception 'Catalog inactive.' using errcode = '55000'; end if;
  for v_assignee in select distinct default_assignee_id from public.recurring_work_plan_template_items
    where plan_version_id=p_version.id and default_assignee_id is not null order by default_assignee_id
  loop
    perform 1 from public.organization_memberships where organization_id=p_plan.organization_id
      and user_id=v_assignee and status='active' and member_kind='team' for share;
    if not found then raise exception 'Assignee inactive.' using errcode = '55000'; end if;
  end loop;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.execute_recurring_schedule(p_admission_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.recurring_schedule_admissions; p public.recurring_work_plans; v public.recurring_work_plan_versions;
  o public.recurring_work_occurrences; item public.recurring_work_plan_template_items; w public.work_items;
  v_brand uuid; v_code text; v_outcome text; v_event jsonb; v_result jsonb;
begin
  select * into strict a from public.recurring_schedule_admissions where id=p_admission_id;
  perform private.assert_recurring_scheduler(p_actor_id,a.organization_id);
  if a.actor_id <> p_actor_id then raise exception 'Admission actor mismatch.' using errcode='42501'; end if;
  perform private.lock_service_recurring_plan(a.plan_id);
  perform pg_advisory_xact_lock(hashtextextended(a.organization_id::text || ':' || a.plan_id::text || ':' || a.period_start::text,0));
  select * into strict p from public.recurring_work_plans where id=a.plan_id for share;
  -- A subtransaction rolls back every business write if any insert or final deadline check fails.
  begin
    if not private.recurring_execution_open(clock_timestamp(),a.retry_deadline,a.period_start,a.timezone)
      or p.status_changed_at <> a.plan_status_changed_at
      or exists(select 1 from public.recurring_schedule_executions where admission_id=a.id and outcome='manual_review') then
      raise exception 'Execution closed; manual review required.' using errcode='55000';
    end if;
    select version.* into v from public.recurring_work_plan_versions version
      join public.recurring_work_plan_version_approvals approval on approval.plan_version_id=version.id
      where version.plan_id=p.id and version.organization_id=p.organization_id
        and version.effective_start<=a.period_start and (version.effective_end is null or version.effective_end>=a.period_start)
      order by version.effective_start desc,version.version_number desc limit 1;
    if v.id is distinct from a.plan_version_id then raise exception 'Applicable version changed.' using errcode='55000'; end if;
    perform private.n1c_require_recurring_delegation(p.id,v.id);
    perform private.assert_scheduled_recurring_context(p,v);
    select * into o from public.recurring_work_occurrences where organization_id=a.organization_id and plan_id=a.plan_id and period_start=a.period_start;
    if found then v_outcome := 'replayed';
    else
      v_outcome := 'generated';
      select brand_id into strict v_brand from public.engagements where id=p.engagement_id;
      insert into public.recurring_work_occurrences(organization_id,plan_id,plan_version_id,project_id,engagement_id,
        engagement_service_id,service_id,period_start,period_end,timezone,generated_by,past_period_reason)
      values(p.organization_id,p.id,v.id,p.project_id,p.engagement_id,p.engagement_service_id,p.service_id,
        a.period_start,private.service_recurring_period_end(v,a.period_start),a.timezone,p_actor_id,'')
      returning * into o;
      v_event := jsonb_build_object('execution_source','recurring_scheduler','scheduler_actor_id',p_actor_id,
        'admission_id',a.id,'due_at',a.due_at,'admitted_at',a.admitted_at,'retry_deadline',a.retry_deadline,
        'plan_id',p.id,'plan_version_id',v.id,'occurrence_id',o.id,'period_start',a.period_start,'period_end',o.period_end,
        'timezone',a.timezone,'request_key',a.id,'created_via','recurring_plan');
      for item in select * from public.recurring_work_plan_template_items where plan_version_id=v.id order by position,id
      loop
        insert into public.work_items(organization_id,project_id,engagement_id,brand_id,department_id,title,description,
          work_item_type,priority,status,assignee_id,created_by,start_date,due_date,position,created_via,
          recurring_occurrence_id,recurring_plan_id,recurring_plan_version_id,recurring_template_key)
        values(p.organization_id,p.project_id,p.engagement_id,v_brand,item.department_id,item.title,item.description,
          item.work_item_type,item.priority,'not_started',item.default_assignee_id,p_actor_id,
          private.service_recurring_work_date(v,a.period_start,o.period_end,item.start_offset_days,false),private.service_recurring_work_date(v,a.period_start,o.period_end,item.due_offset_days,true),item.position,'recurring_plan',
          o.id,p.id,v.id,item.template_key) returning * into w;
        insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
        values(p.organization_id,p.engagement_id,'work_item_created',p_actor_id,v_event || jsonb_build_object(
          'record_type','work_item','record_id',w.id,'action','created','status',w.status,'assignee_id',w.assignee_id,
          'department_id',w.department_id,'parent_work_item_id',null,'recurring_plan_id',p.id,
          'recurring_plan_version_id',v.id,'recurring_occurrence_id',o.id,'recurring_template_key',item.template_key));
        if w.assignee_id is not null then
          insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
          values(p.organization_id,p.engagement_id,'work_item_assigned',p_actor_id,v_event || jsonb_build_object(
            'record_type','work_item','record_id',w.id,'action','assigned','previous_assignee_id',null,'assignee_id',w.assignee_id));
        end if;
      end loop;
      perform private.materialize_service_recurring_edges(p,v,o.id,p_actor_id,'scheduler');
      insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
      values(p.organization_id,p.engagement_id,'recurring_period_generated',p_actor_id,v_event);
    end if;
    if not exists(select 1 from public.recurring_work_generation_attempts where organization_id=a.organization_id and request_key=a.id) then
      insert into public.recurring_work_generation_attempts(organization_id,plan_id,plan_version_id,occurrence_id,
        request_key,requested_period_start,outcome,actor_id)
      values(a.organization_id,a.plan_id,o.plan_version_id,o.id,a.id,a.period_start,v_outcome,p_actor_id);
    end if;
    perform private.assert_recurring_scheduler(p_actor_id,a.organization_id);
    if not private.recurring_execution_open(clock_timestamp(),a.retry_deadline,a.period_start,a.timezone)
      then raise exception 'Deadline closed before completion.' using errcode='55000'; end if;
    v_result := jsonb_build_object('outcome',v_outcome,'admission_id',a.id,'occurrence_id',o.id,'plan_version_id',o.plan_version_id);
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
    v_outcome := case when v_code in ('55000','42501') then 'manual_review' else 'retryable_failure' end;
    v_result := jsonb_build_object('outcome',v_outcome,'admission_id',a.id,'error_code',v_code,'required_action',case when v_code='42501' then 'Review current PM/admin assignment delegation and assignee eligibility for this exact plan version; withdraw stale delegation and explicitly approve again.' else 'Review plan, service, version and admission window before manual recovery.' end);
  end;
  insert into public.recurring_schedule_executions(admission_id,organization_id,outcome,error_code,occurrence_id)
    values(a.id,a.organization_id,v_outcome,v_code,case when v_outcome in ('generated','replayed') then o.id end);
  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.admit_recurring_schedule(p_plan_id uuid, p_period_start date, p_actor_id uuid)
 RETURNS recurring_schedule_admissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_plan public.recurring_work_plans; v_version public.recurring_work_plan_versions;
  v_admission public.recurring_schedule_admissions; v_due timestamptz; v_now timestamptz; v_approved timestamptz;
begin
  select * into strict v_plan from public.recurring_work_plans where id=p_plan_id;
  perform private.assert_recurring_scheduler(p_actor_id, v_plan.organization_id);
  perform private.lock_service_recurring_plan(v_plan.id);
  perform pg_advisory_xact_lock(hashtextextended(v_plan.organization_id::text || ':' || v_plan.id::text || ':' || p_period_start::text, 0));
  select * into strict v_plan from public.recurring_work_plans where id=p_plan_id for share;
  select * into v_admission from public.recurring_schedule_admissions
    where organization_id=v_plan.organization_id and plan_id=p_plan_id and period_start=p_period_start;
  if found then
    if v_admission.actor_id <> p_actor_id then raise exception 'Admission actor mismatch.' using errcode='42501'; end if;
    return v_admission; -- No new admission or extension; execute enforces the saved deadline.
  end if;
  select version.* into v_version from public.recurring_work_plan_versions version
    join public.recurring_work_plan_version_approvals approval on approval.plan_version_id=version.id
    where version.plan_id=p_plan_id and version.organization_id=v_plan.organization_id
      and version.effective_start<=p_period_start and (version.effective_end is null or version.effective_end>=p_period_start)
    order by version.effective_start desc, version.version_number desc limit 1;
  if not found or not exists(select 1 from public.recurring_schedule_consents where plan_version_id=v_version.id)
    then raise exception 'No explicitly opted-in approved schedule.' using errcode='55000'; end if;
  perform private.service_recurring_period_end(v_version,p_period_start);
  v_due := private.recurring_due_instant(p_period_start + (v_version.schedule_definition->'scheduler'->>'local_time')::time, v_version.timezone);
  select approved_at into strict v_approved from public.recurring_work_plan_version_approvals where plan_version_id=v_version.id;
  v_now := clock_timestamp();
  if not private.recurring_admission_open(v_now,v_due,p_period_start,v_version.timezone,v_approved,v_plan.status_changed_at) then
    raise exception 'Due admission window missed or not yet open; manual recovery only.' using errcode='55000';
  end if;
  perform private.n1c_require_recurring_delegation(v_plan.id,v_version.id);
  perform private.assert_scheduled_recurring_context(v_plan, v_version);
  v_now := clock_timestamp();
  if not private.recurring_admission_open(v_now,v_due,p_period_start,v_version.timezone,v_approved,v_plan.status_changed_at)
    then raise exception 'Admission window closed.' using errcode='55000'; end if;
  insert into public.recurring_schedule_admissions(organization_id,plan_id,plan_version_id,period_start,timezone,
    due_at,admitted_at,retry_deadline,plan_status_changed_at,actor_id)
  values(v_plan.organization_id,v_plan.id,v_version.id,p_period_start,v_version.timezone,v_due,v_now,
    private.recurring_retry_deadline(v_now,p_period_start,v_version.timezone),v_plan.status_changed_at,p_actor_id)
  returning * into v_admission;
  return v_admission;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.preview_recurring_work_month(p_plan_id uuid, p_month_start date, p_past_period_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_plan public.recurring_work_plans;
  v_month_end date;
  v_periods jsonb := '[]'::jsonb;
  v_has_approved_overlap boolean := false;
  v_reasons jsonb := '[]'::jsonb;
begin
  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'Month start must be the first day of a calendar month.' using errcode = '22023';
  end if;
  select * into v_plan from public.recurring_work_plans where id = p_plan_id;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_generation_actor(v_plan, p_actor_id);
  v_month_end := (p_month_start + interval '1 month')::date;

  select exists (
    select 1 from public.recurring_work_plan_versions version
    join public.recurring_work_plan_version_approvals approval
      on approval.plan_version_id = version.id and approval.plan_id = version.plan_id
      and approval.organization_id = version.organization_id
    where version.plan_id = v_plan.id and version.organization_id = v_plan.organization_id
      and version.effective_start < v_month_end
      and (version.effective_end is null or version.effective_end >= p_month_start)
  ) into v_has_approved_overlap;

  with candidate_dates as (
    select day_value::date as period_start
    from generate_series(p_month_start::timestamp, (v_month_end - 1)::timestamp, interval '1 day') day_value
  ),
  applicable_versions as (
    select candidate.period_start, version.frequency, version.effective_start
    from candidate_dates candidate
    cross join lateral (
      select candidate_version.*
      from public.recurring_work_plan_versions candidate_version
      join public.recurring_work_plan_version_approvals approval
        on approval.plan_version_id = candidate_version.id and approval.plan_id = candidate_version.plan_id
        and approval.organization_id = candidate_version.organization_id
      where candidate_version.plan_id = v_plan.id
        and candidate_version.organization_id = v_plan.organization_id
        and candidate_version.effective_start <= candidate.period_start
        and (candidate_version.effective_end is null or candidate_version.effective_end >= candidate.period_start)
      order by candidate_version.effective_start desc, candidate_version.version_number desc limit 1
    ) version
  ),
  canonical_periods as (
    select applicable.period_start from applicable_versions applicable
    where (
      applicable.frequency = 'weekly'
      and mod(applicable.period_start - applicable.effective_start, 7) = 0
    ) or (
      applicable.frequency = 'monthly'
      and private.recurring_month_anchor(
        applicable.effective_start,
        (extract(year from applicable.period_start)::integer - extract(year from applicable.effective_start)::integer) * 12
        + extract(month from applicable.period_start)::integer
        - extract(month from applicable.effective_start)::integer
      ) = applicable.period_start
    )
  ),
  previews as (
    select canonical.period_start,
      private.build_recurring_period_preview(v_plan.id, canonical.period_start, p_past_period_reason, p_actor_id) as preview
    from canonical_periods canonical
  )
  select coalesce(jsonb_agg(preview order by period_start), '[]'::jsonb) into v_periods from previews;

  if jsonb_array_length(v_periods) = 0 then
    v_reasons := jsonb_build_array(
      case when v_has_approved_overlap then 'no_period_start_in_month' else 'no_approved_effective_version' end
    );
  end if;

  return jsonb_build_object(
    'plan_id', v_plan.id, 'month_start', p_month_start, 'month_end', v_month_end,
    'membership_rule', 'period_start_in_month', 'reasons', v_reasons, 'periods', v_periods
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION private.n1c_assert_recurring_item(w work_items, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.recurring_work_plans; v public.recurring_work_plan_versions; o public.recurring_work_occurrences;
 t public.recurring_work_plan_template_items; a public.recurring_schedule_admissions; delegation uuid; applicable uuid;
begin
 if current_setting('role',true)<>'service_role' or auth.uid() is not null then
   raise exception 'Recurring reproduction requires verified server actor.' using errcode='42501';
 end if;
 select * into p from public.recurring_work_plans where id=w.recurring_plan_id and organization_id=w.organization_id and project_id=w.project_id for share;
 if not found then raise exception 'Recurring plan scope mismatch.' using errcode='42501'; end if;
 delegation:=private.n1c_require_recurring_delegation(p.id,w.recurring_plan_version_id);
 select * into v from public.recurring_work_plan_versions where id=w.recurring_plan_version_id and plan_id=p.id and organization_id=p.organization_id;
 select * into o from public.recurring_work_occurrences where id=w.recurring_occurrence_id and plan_id=p.id
   and plan_version_id=v.id and organization_id=p.organization_id and project_id=p.project_id
   and engagement_id=p.engagement_id and engagement_service_id=p.engagement_service_id and service_id=p.service_id and generated_by=p_actor;
 if not found then raise exception 'Immutable occurrence/actor scope mismatch.' using errcode='42501'; end if;
 if o.timezone is distinct from v.timezone or o.period_end is distinct from private.service_recurring_period_end(v,o.period_start) then
   raise exception 'Canonical occurrence period required.' using errcode='42501';
 end if;
 select version.id into applicable from public.recurring_work_plan_versions version
   join public.recurring_work_plan_version_approvals approval on approval.plan_version_id=version.id
   where version.plan_id=p.id and version.organization_id=p.organization_id and version.effective_start<=o.period_start
     and (version.effective_end is null or version.effective_end>=o.period_start)
   order by version.effective_start desc,version.version_number desc limit 1;
 if applicable is distinct from v.id then raise exception 'Applicable recurring version changed.' using errcode='55000'; end if;
 perform private.assert_scheduled_recurring_context(p,v);
 if exists(select 1 from public.organization_memberships where user_id=p_actor) then
   perform private.n1c_require_scope(p.organization_id,p.project_id,p_actor);
   perform private.assert_recurring_generation_actor(p,p_actor);
 else
   perform private.assert_recurring_scheduler(p_actor,p.organization_id);
   select * into a from public.recurring_schedule_admissions where organization_id=p.organization_id and plan_id=p.id
     and plan_version_id=v.id and period_start=o.period_start and actor_id=p_actor;
   if not found or a.plan_status_changed_at is distinct from p.status_changed_at or not private.recurring_execution_open(clock_timestamp(),a.retry_deadline,a.period_start,a.timezone)
     or exists(select 1 from public.recurring_schedule_executions where admission_id=a.id and outcome='manual_review') then
     raise exception 'Current admitted scheduler occurrence required.' using errcode='55000';
   end if;
 end if;
 select * into t from public.recurring_work_plan_template_items where plan_version_id=v.id and plan_id=p.id
   and organization_id=p.organization_id and template_key=w.recurring_template_key;
 if not found or w.created_via<>'recurring_plan' or w.created_by is distinct from p_actor
   or w.engagement_id is distinct from p.engagement_id or w.status<>'not_started' or w.row_version<>1
   or w.department_id is distinct from t.department_id or w.assignee_id is distinct from t.default_assignee_id
   or w.title is distinct from t.title or w.description is distinct from t.description
   or w.work_item_type is distinct from t.work_item_type or w.priority is distinct from t.priority
   or w.start_date is distinct from private.service_recurring_work_date(v,o.period_start,o.period_end,t.start_offset_days,false) or w.due_date is distinct from private.service_recurring_work_date(v,o.period_start,o.period_end,t.due_offset_days,true)
   or w.position is distinct from t.position or w.parent_work_item_id is not null or w.deleted_at is not null
   or w.linked_artifact_id is not null or w.linked_artifact_version_id is not null or w.linked_engagement_stage_instance_id is not null
   or to_jsonb(w)->>'linked_page_path' is not null or to_jsonb(w)->>'linked_page_key' is not null
   or w.automation_flagged_at is not null or w.automation_flagged_by_rule_id is not null then
   raise exception 'Only the exact approved initial recurring template may be reproduced.' using errcode='42501';
 end if;
 perform 1 from public.engagements where id=p.engagement_id and organization_id=p.organization_id and brand_id=w.brand_id;
 if not found then raise exception 'Recurring brand scope mismatch.' using errcode='42501'; end if;
 return delegation;
end; $function$

;
CREATE OR REPLACE FUNCTION public.create_recurring_work_plan(p_engagement_service_id uuid, p_title text, p_scope text, p_frequency text, p_timezone text, p_effective_start date, p_effective_end date, p_schedule_definition jsonb, p_template_items jsonb, p_actor_id uuid)
 RETURNS recurring_work_plans
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_service public.engagement_services;
  v_engagement public.engagements;
  v_plan public.recurring_work_plans;
  v_version public.recurring_work_plan_versions;
begin
  if p_schedule_definition ? 'service_bridge' then
   perform pg_advisory_xact_lock(hashtextextended('project-setup:'||e.organization_id::text||':'||e.project_id::text,0))
    from public.engagement_services es join public.engagements e on e.id=es.engagement_id and e.organization_id=es.organization_id
    where es.id=p_engagement_service_id;
  end if;
  select * into v_service from public.engagement_services where id = p_engagement_service_id for share;
  if not found then raise exception 'Activated service not found.' using errcode = 'P0002'; end if;
  select * into v_engagement from public.engagements where id = v_service.engagement_id for share;
  if v_engagement.engagement_type <> 'retainer' then
    raise exception 'Recurring plans are limited to retainer engagements in RET1.' using errcode = '22023';
  end if;
  perform private.assert_recurring_plan_actor(v_service.organization_id, p_actor_id);
  if v_service.owner_id is distinct from p_actor_id then
    raise exception 'Only the activated service owner can draft a recurring plan.' using errcode = '42501';
  end if;
  if v_service.status not in ('planned', 'active', 'on_hold') then
    raise exception 'The activated service cannot accept a recurring plan in its current status.' using errcode = '22023';
  end if;
  insert into public.recurring_work_plans (
    organization_id, project_id, engagement_id, engagement_service_id, service_id, status_changed_by, created_by
  ) values (
    v_service.organization_id, v_engagement.project_id, v_service.engagement_id,
    v_service.id, v_service.service_id, p_actor_id, p_actor_id
  ) returning * into v_plan;
  v_version := private.insert_recurring_plan_version(
    v_plan, p_title, p_scope, p_frequency, p_timezone, p_effective_start,
    p_effective_end, p_schedule_definition, p_template_items, p_actor_id
  );
  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (v_plan.organization_id, v_plan.engagement_id, 'recurring_plan_created', p_actor_id,
    jsonb_build_object('plan_id', v_plan.id, 'version_id', v_version.id, 'version_number', v_version.version_number));
  return v_plan;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.create_recurring_work_plan_version(p_plan_id uuid, p_title text, p_scope text, p_frequency text, p_timezone text, p_effective_start date, p_effective_end date, p_schedule_definition jsonb, p_template_items jsonb, p_actor_id uuid)
 RETURNS recurring_work_plan_versions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_plan public.recurring_work_plans;
  v_owner_id uuid;
  v_version public.recurring_work_plan_versions;
begin
  if p_schedule_definition ? 'service_bridge' then
    perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p.organization_id::text||':'||p.project_id::text,0))
     from public.recurring_work_plans p where p.id=p_plan_id;
   end if;
  perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p.organization_id::text||':'||p.project_id::text,0))
   from public.recurring_work_plans p where p.id=p_plan_id and exists(
    select 1 from public.recurring_work_plan_versions v where v.plan_id=p.id and v.schedule_definition ? 'service_bridge');
  select * into v_plan from public.recurring_work_plans where id = p_plan_id for update;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_plan_actor(v_plan.organization_id, p_actor_id);
  select owner_id into v_owner_id from public.engagement_services where id = v_plan.engagement_service_id;
  if v_owner_id is distinct from p_actor_id then
    raise exception 'Only the current activated service owner can draft a plan version.' using errcode = '42501';
  end if;
  if v_plan.status in ('ended', 'archived') then
    raise exception 'Ended or archived recurring plans cannot receive new versions.' using errcode = '22023';
  end if;
  if v_plan.approved_version_id is not null and exists (
    select 1
    from public.recurring_work_plan_template_items current_item
    join jsonb_array_elements(p_template_items) proposed_item
      on proposed_item->>'template_key' = current_item.template_key
    where current_item.plan_version_id = v_plan.approved_version_id
      and current_item.default_assignee_id is distinct from nullif(proposed_item->>'default_assignee_id', '')::uuid
  ) then
    raise exception 'Existing template reassignment requires the service department manager.' using errcode = '42501';
  end if;
  v_version := private.insert_recurring_plan_version(
    v_plan, p_title, p_scope, p_frequency, p_timezone, p_effective_start,
    p_effective_end, p_schedule_definition, p_template_items, p_actor_id
  );
  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (v_plan.organization_id, v_plan.engagement_id, 'recurring_plan_version_created', p_actor_id,
    jsonb_build_object('plan_id', v_plan.id, 'version_id', v_version.id, 'version_number', v_version.version_number));
  return v_version;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.reassign_recurring_plan_template_item(p_plan_id uuid, p_template_key text, p_assignee_id uuid, p_actor_id uuid)
 RETURNS recurring_work_plan_versions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_plan public.recurring_work_plans;
  v_current public.recurring_work_plan_versions;
  v_version public.recurring_work_plan_versions;
  v_department_id text;
  v_template_items jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('project-setup:'||p.organization_id::text||':'||p.project_id::text,0))
   from public.recurring_work_plans p where p.id=p_plan_id and exists(
    select 1 from public.recurring_work_plan_versions v where v.plan_id=p.id and v.schedule_definition ? 'service_bridge');
  select * into v_plan from public.recurring_work_plans where id = p_plan_id for update;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_plan_actor(v_plan.organization_id, p_actor_id);
  if v_plan.status in ('draft', 'ended', 'archived') or v_plan.approved_version_id is null then
    raise exception 'Only an approved, active, or paused plan can be reassigned.' using errcode = '22023';
  end if;
  select service.department_id into v_department_id from public.service_catalog service
  where service.id = v_plan.service_id and service.organization_id = v_plan.organization_id;
  if exists(select 1 from public.recurring_work_plan_versions v where v.id=v_plan.approved_version_id and v.schedule_definition ? 'service_bridge') then
   select t.department_id into v_department_id from public.recurring_work_plan_template_items t
    where t.plan_version_id=v_plan.approved_version_id and t.template_key=p_template_key;
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = v_plan.organization_id and membership.user_id = p_actor_id
      and membership.member_kind = 'team' and membership.status = 'active'
      and membership.role = 'department_manager' and membership.department_id = v_department_id
  ) then
    raise exception 'Only the service department manager can reassign a recurring template item.' using errcode = '42501';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = v_plan.organization_id and membership.user_id = p_assignee_id
      and membership.member_kind = 'team' and membership.status = 'active'
  ) then raise exception 'The assignee must be an active organization team member.' using errcode = '42501'; end if;
  select * into v_current from public.recurring_work_plan_versions
  where id = v_plan.approved_version_id and plan_id = v_plan.id;
  if not exists (
    select 1 from public.recurring_work_plan_template_items item
    where item.plan_version_id = v_current.id and item.template_key = p_template_key
  ) then raise exception 'Recurring template item not found.' using errcode = 'P0002'; end if;
  select jsonb_agg(jsonb_build_object(
    'template_key', item.template_key, 'title', item.title, 'description', item.description,
    'work_item_type', item.work_item_type, 'priority', item.priority,
    'default_assignee_id', case when item.template_key = p_template_key then p_assignee_id else item.default_assignee_id end,
    'start_offset_days', item.start_offset_days, 'due_offset_days', item.due_offset_days,
    'acceptance_criteria', item.acceptance_criteria, 'position', item.position
  ) order by item.position) into v_template_items
  from public.recurring_work_plan_template_items item where item.plan_version_id = v_current.id;
  v_version := private.insert_recurring_plan_version(
    v_plan, v_current.title, v_current.scope, v_current.frequency, v_current.timezone,
    v_current.effective_start, v_current.effective_end, v_current.schedule_definition,
    v_template_items, p_actor_id
  );
  insert into public.engagement_events (organization_id, engagement_id, event_type, actor_id, payload)
  values (v_plan.organization_id, v_plan.engagement_id, 'recurring_plan_version_created', p_actor_id,
    jsonb_build_object('plan_id', v_plan.id, 'version_id', v_version.id,
      'version_number', v_version.version_number, 'change_type', 'internal_reassignment',
      'template_key', p_template_key, 'assignee_id', p_assignee_id));
  return v_version;
end;
$function$

;
commit;