-- Add a real independently named Branding group to the existing reviewed plan.
-- Original published-template, actor, activation/run and work writers remain required.
-- No publication records, approvals, services, work, assignments or cycles are seeded.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('apply_project_setup(uuid,uuid,uuid,text,jsonb)')),chr(13),'')) is distinct from '2ee76e4b0baf46e318b6cf419275afe1' then raise exception 'Exact prior Branding pipeline prerequisite changed: public.apply_project_setup' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('create_project_pipeline_group(uuid,uuid,uuid,text,text,uuid)')),chr(13),'')) is distinct from '0b6bfffed7b762cc2e0c0a364e3b8ffe' then raise exception 'Exact prior Branding pipeline prerequisite changed: public.create_project_pipeline_group' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.preview_combined_setup(uuid,uuid,text,jsonb)')),chr(13),'')) is distinct from '20dfbf3ec8ba04b6d2db85d640d37a1b' then raise exception 'Exact prior Branding pipeline prerequisite changed: private.preview_combined_setup' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.build_service_project_plan(uuid,uuid,uuid,jsonb)')),chr(13),'')) is distinct from 'bbe223c4a0f573984c13efbb22eda476' then raise exception 'Exact prior Branding pipeline prerequisite changed: private.build_service_project_plan' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.build_combined_service_plan(uuid,uuid,uuid,jsonb,jsonb)')),chr(13),'')) is distinct from 'e51db7bec2a7682ccd172fc406a1f4e9' then raise exception 'Exact prior Branding pipeline prerequisite changed: private.build_combined_service_plan' using errcode='55000';end if;
 if to_regprocedure('private.branding_preset_current(uuid,uuid)') is not null then raise exception 'New Branding preset validator already exists' using errcode='55000';end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.project_pipeline_groups'::regclass and conname='project_pipeline_groups_kind_check') is distinct from 'f9dc495520cc7dc4a3719a1334935168' then raise exception 'Exact prior pipeline kind constraint changed' using errcode='55000';end if;
end;$$;
alter table public.project_pipeline_groups drop constraint project_pipeline_groups_kind_check;
alter table public.project_pipeline_groups add constraint project_pipeline_groups_kind_check check(kind in ('branding','website','marketing'));
create function private.branding_preset_current(p_org uuid,p_preset uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare version_id uuid;
begin
 select p.pipeline_template_version_id into version_id from public.pipeline_template_publications p
 where p.id=p_preset and p.organization_id=p_org for share;
 if version_id is null then return false;end if;
 perform 1 from public.pipeline_template_version_services s where s.organization_id=p_org and s.pipeline_template_version_id=version_id order by s.service_id for share;
 perform 1 from public.pipeline_template_version_services s
 join private.service_setup_leaves l on l.organization_id=s.organization_id and l.service_id=s.service_id
 join public.service_catalog c on c.organization_id=s.organization_id and c.id=s.service_id
 where s.organization_id=p_org and s.pipeline_template_version_id=version_id order by s.service_id for share of l,c;
 return exists(select 1 from public.pipeline_template_version_services s where s.organization_id=p_org and s.pipeline_template_version_id=version_id)
 and not exists(select 1 from public.pipeline_template_version_services s
 left join private.service_setup_leaves l on l.organization_id=s.organization_id and l.service_id=s.service_id
 left join public.service_catalog c on c.organization_id=s.organization_id and c.id=s.service_id
 where s.organization_id=p_org and s.pipeline_template_version_id=version_id
 and (l.service_id is null or c.id is null or not c.is_active or l.definition->'business_group_version' is distinct from '1'::jsonb or not coalesce(l.definition->'business_groups' ? 'branding',false)));
end;$$;
revoke all on function private.branding_preset_current(uuid,uuid) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.apply_project_setup(p_organization_id uuid, p_project_id uuid, p_request_id uuid, p_expected_token text, p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); role_value text; snapshot jsonb; receipt private.project_setup_commands; payload jsonb;
 item jsonb; line_metadata jsonb; leaf private.service_setup_leaves; service public.service_catalog; scope public.project_service_scopes; quantity_value integer; cadence text;
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
 or exists(select 1 from jsonb_object_keys(p_plan) k where k not in ('items','pipelines','questions','explanation','legacy_acknowledgements','service_line_version'))
 or jsonb_typeof(p_plan->'items') is distinct from 'array' or jsonb_array_length(p_plan->'items') not between 1 and 50
 or jsonb_typeof(p_plan->'pipelines') is distinct from 'array' or jsonb_array_length(p_plan->'pipelines')>3
 or exists(select 1 from jsonb_array_elements(p_plan->'pipelines') p where p not in ('"branding"'::jsonb,'"website"'::jsonb,'"marketing"'::jsonb))
 or (select count(*) from jsonb_array_elements(p_plan->'pipelines'))<>(select count(distinct x) from jsonb_array_elements(p_plan->'pipelines') x)
 or p_plan->'questions' is distinct from '[]'::jsonb or jsonb_typeof(p_plan->'explanation') is distinct from 'string' or length(p_plan->>'explanation')>1500
 or jsonb_typeof(p_plan->'legacy_acknowledgements') is distinct from 'array' or jsonb_array_length(p_plan->'legacy_acknowledgements')>50 or octet_length(p_plan::text)>90000 then raise exception 'Review a complete bounded setup proposal' using errcode='22023'; end if;
 payload:=jsonb_build_object('project_id',p_project_id,'expected_token',p_expected_token,'plan',p_plan);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.project_setup_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.payload is distinct from payload then raise exception 'Request already owns another exact setup' using errcode='23505'; end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 snapshot:=public.get_project_setup(p_organization_id,p_project_id);
 if snapshot->>'token'<>p_expected_token then raise exception 'Project setup changed; refresh and review the current diff' using errcode='40001'; end if;
 for item in select value from jsonb_array_elements(p_plan->'items') loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('service_id','quantity','cadence','custom_cadence','pipeline','channels','audience','delivery_method','deliverable_key','evidence','unit','expected_revision','service_line')) then raise exception 'Unsupported setup fields' using errcode='22023'; end if;
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
   or item->>'pipeline' is null or item->>'pipeline' not in ('branding','website','marketing','undecided')
   or (item->>'pipeline'<>'undecided' and not (p_plan->'pipelines' ? (item->>'pipeline')))
   or item->>'audience' is null or item->>'audience' not in ('standard','remarketing','undecided')
   or item->>'delivery_method' is null or item->>'delivery_method' not in ('human','ai_assisted','automated','undecided')
   or jsonb_typeof(item->'channels') is distinct from 'array' or jsonb_array_length(item->'channels')>10
   or exists(select 1 from jsonb_array_elements(item->'channels') c where jsonb_typeof(c)<>'string' or length(trim(c#>>'{}')) not between 1 and 80)
   or (select count(*) from jsonb_array_elements(item->'channels'))<>(select count(distinct x) from jsonb_array_elements(item->'channels') x)
   or jsonb_typeof(item->'deliverable_key') is distinct from 'string' or length(item->>'deliverable_key')>80
   or jsonb_typeof(item->'evidence') is distinct from 'string' or length(trim(item->>'evidence')) not between 1 and 500 then raise exception 'Invalid setup quantity, cadence, scope or evidence' using errcode='22023'; end if;

  line_metadata:=private.review_setup_line_metadata(item->'service_line',leaf.definition,p_plan->'service_line_version',item->>'cadence');
  if item->>'pipeline'='branding' and (p_plan->'service_line_version' is distinct from '2'::jsonb or line_metadata->>'service_group' is distinct from 'branding') then raise exception 'Review explicit version 2 Branding scope before selecting the Branding track' using errcode='22023';end if;
  if p_plan->'service_line_version'='2'::jsonb and service.unit is distinct from leaf.definition->>'unit' then raise exception 'Canonical service unit changed; refresh the reviewed catalogue' using errcode='40001';end if;
  if p_plan->'service_line_version' is null and exists(select 1 from jsonb_array_elements(coalesce(snapshot->'state'->'plan'->'contributions','[]'::jsonb)) m where m->>'service_id'=sid::text and m ? 'service_line') then
   raise exception 'Review this service with version 2 dates and scope before changing it' using errcode='22023';
  end if;
  if p_plan->'service_line_version'='2'::jsonb then item:=item||jsonb_build_object('service_line',line_metadata);end if;
  -- Never silently bill a legacy parent and its new children. Any overlap must be acknowledged in this exact review.
  if exists(select 1 from public.project_service_scopes s where s.organization_id=p_organization_id and s.project_id=p_project_id and s.service_id=leaf.legacy_service_id and s.status not in ('cancelled','completed'))
    and not (p_plan->'legacy_acknowledgements' ? leaf.legacy_service_id::text) then raise exception 'Review the existing legacy scope overlap before adding this leaf' using errcode='22023'; end if;
  cadence:=case when item->>'cadence'='custom' then item->>'custom_cadence' else item->>'cadence' end;
  select * into scope from public.project_service_scopes s where s.organization_id=p_organization_id and s.project_id=p_project_id and s.service_id=sid for update;
  if found then
   if scope.status<>'proposed' or scope.revision is distinct from (item->>'expected_revision')::integer then raise exception 'Service already activated or changed; use its current change review' using errcode='40001'; end if;
   update public.project_service_scopes set quantity=quantity_value,unit=service.unit,recurrence=cadence,
    scope_statement=case when p_plan->'service_line_version'='2'::jsonb then line_metadata->>'scope_statement' else scope_statement end,
    exclusions=case when p_plan->'service_line_version'='2'::jsonb then line_metadata->>'exclusions' else exclusions end,
    start_date=case when p_plan->'service_line_version'='2'::jsonb then (line_metadata->>'start_date')::date else start_date end,
    target_date=case when p_plan->'service_line_version'='2'::jsonb then (line_metadata->>'target_date')::date else target_date end,
    revision=revision+1,updated_at=now() where id=scope.id returning * into scope;
   result:=jsonb_build_object('scope_id',scope.id,'revision',scope.revision,'action','updated');
  else
   if item->>'expected_revision' is not null then raise exception 'Service proposal no longer exists' using errcode='40001'; end if;
   command_id:=pg_catalog.md5(p_request_id::text||':'||sid::text)::uuid;
   result:=public.propose_workspace_service_scope(p_organization_id,p_project_id,command_id,sid,jsonb_build_object('unit',service.unit,'recurrence',cadence,'quantity',quantity_value,'scope_statement',case when p_plan->'service_line_version'='2'::jsonb then line_metadata->>'scope_statement' else '' end,
    'exclusions',case when p_plan->'service_line_version'='2'::jsonb then line_metadata->>'exclusions' else '' end,'owner_id',null,
    'start_date',case when p_plan->'service_line_version'='2'::jsonb then line_metadata->>'start_date' else null end,
    'target_date',case when p_plan->'service_line_version'='2'::jsonb then line_metadata->>'target_date' else null end));
  end if;
  results:=results||jsonb_build_array(result);
  metadata:=metadata||jsonb_build_array((item-'quantity'-'unit'-'expected_revision')||jsonb_build_object('scope_id',result->>'scope_id'));
 end loop;
 metadata:=coalesce((select jsonb_agg(x) from private.project_setup_state s cross join lateral jsonb_array_elements(s.plan->'contributions') x where s.project_id=p_project_id and s.organization_id=p_organization_id and not ((x->>'service_id')::uuid=any(seen))),'[]'::jsonb)||metadata;
 if exists(select 1 from jsonb_array_elements(metadata) m where m->>'pipeline'<>'undecided' and not (p_plan->'pipelines' ? (m->>'pipeline'))) then raise exception 'Existing contributions retain their pipeline scope; review them before removing it' using errcode='22023'; end if;
 -- The same deliverable is a set of departmental contributions, never summed as separate posts.
 select count(*) into conflict_count from (select i->>'deliverable_key',i->>'pipeline',i->>'cadence',i->>'custom_cadence',(select jsonb_agg(c order by c) from jsonb_array_elements(i->'channels') c) from jsonb_array_elements(p_plan->'items') i where i->>'deliverable_key'<>'' group by 1,2,3,4,5 having count(distinct i->>'quantity')>1) q;
 if conflict_count>0 then raise exception 'Clarify unequal quantities for the same connected deliverable' using errcode='22023'; end if;
 insert into private.project_setup_state(organization_id,project_id,plan,revision,updated_by) values(p_organization_id,p_project_id,jsonb_build_object('contributions',metadata,'pipelines',p_plan->'pipelines','pipeline_review_required',true),1,actor)
 on conflict(project_id) do update set plan=excluded.plan,revision=private.project_setup_state.revision+1,updated_by=actor,updated_at=now() returning revision into state_revision;
 result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'request_id',p_request_id,'revision',state_revision,'results',results,'pipeline_review_required',true);
 insert into private.project_setup_commands(organization_id,actor_id,request_id,project_id,payload,result) values(p_organization_id,actor,p_request_id,p_project_id,payload,result);
 return result;
end; $function$;

CREATE OR REPLACE FUNCTION public.create_project_pipeline_group(p_organization_id uuid, p_engagement_id uuid, p_preset_publication_id uuid, p_kind text, p_name text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); e public.engagements; preset public.pipeline_template_publications; existing public.project_pipeline_groups; sha text; group_id uuid;
begin
 if actor is null or p_request_id is null or p_preset_publication_id is null or p_kind is null or p_kind not in ('branding','website','marketing') or p_name is null or p_name<>btrim(p_name) or length(p_name) not between 1 and 80 then raise exception 'Exact scoped named pipeline and published preset required' using errcode='22023'; end if;
 -- Lifecycle order: project, organization/member/PM binding, then engagement.
 select * into e from public.engagements where id=p_engagement_id and organization_id=p_organization_id;
 if e.id is null or not private.n6_project_configuration_authorized(p_organization_id,e.project_id,actor) then raise exception 'Exact-project manager authority required' using errcode='42501'; end if;
 select * into e from public.engagements where id=p_engagement_id and organization_id=p_organization_id for update;
 if e.status not in ('planning','active') then raise exception 'Current engagement required' using errcode='42501'; end if;
 select * into preset from public.pipeline_template_publications where id=p_preset_publication_id and organization_id=p_organization_id;
 if preset.id is null then raise exception 'Exact published organization preset required' using errcode='42501'; end if;
 if p_kind='branding' then
  if not private.branding_preset_current(p_organization_id,p_preset_publication_id) then
   raise exception 'Published preset must contain only current explicitly Branding-eligible services' using errcode='22023';end if;
 end if;

 sha:=encode(pg_catalog.sha256(convert_to(jsonb_build_object('engagement_id',e.id,'preset_publication_id',preset.id,'kind',p_kind,'name',p_name)::text,'UTF8')),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pipeline-group:'||p_organization_id::text||':'||p_request_id::text,0));
 select * into existing from public.project_pipeline_groups where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if existing.created_by<>actor or existing.request_sha256<>sha then raise exception 'Request binds a different pipeline group' using errcode='23505'; end if;
  return jsonb_build_object('group',to_jsonb(existing),'idempotent_replay',true);
 end if;
 insert into public.project_pipeline_groups(organization_id,engagement_id,project_id,kind,name,preset_publication_id,request_id,request_sha256,created_by) values(p_organization_id,e.id,e.project_id,p_kind,p_name,preset.id,p_request_id,sha,actor) returning id into group_id;
 select * into existing from public.project_pipeline_groups where id=group_id;
 return jsonb_build_object('group',to_jsonb(existing),'idempotent_replay',false);
end; $function$;

CREATE OR REPLACE FUNCTION private.preview_combined_setup(p_organization_id uuid, p_project_id uuid, p_expected_token text, p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p_request_id uuid:=gen_random_uuid(); projected_scopes jsonb; projected jsonb; actor uuid:=auth.uid(); role_value text; snapshot jsonb; receipt private.project_setup_commands; payload jsonb;
 item jsonb; line_metadata jsonb; leaf private.service_setup_leaves; service public.service_catalog; scope public.project_service_scopes; quantity_value integer; cadence text;
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
 or exists(select 1 from jsonb_object_keys(p_plan) k where k not in ('items','pipelines','questions','explanation','legacy_acknowledgements','service_line_version'))
 or jsonb_typeof(p_plan->'items') is distinct from 'array' or jsonb_array_length(p_plan->'items') not between 1 and 50
 or jsonb_typeof(p_plan->'pipelines') is distinct from 'array' or jsonb_array_length(p_plan->'pipelines')>3
 or exists(select 1 from jsonb_array_elements(p_plan->'pipelines') p where p not in ('"branding"'::jsonb,'"website"'::jsonb,'"marketing"'::jsonb))
 or (select count(*) from jsonb_array_elements(p_plan->'pipelines'))<>(select count(distinct x) from jsonb_array_elements(p_plan->'pipelines') x)
 or p_plan->'questions' is distinct from '[]'::jsonb or jsonb_typeof(p_plan->'explanation') is distinct from 'string' or length(p_plan->>'explanation')>1500
 or jsonb_typeof(p_plan->'legacy_acknowledgements') is distinct from 'array' or jsonb_array_length(p_plan->'legacy_acknowledgements')>50 or octet_length(p_plan::text)>90000 then raise exception 'Review a complete bounded setup proposal' using errcode='22023'; end if;
 snapshot:=public.get_project_setup(p_organization_id,p_project_id);
 if snapshot->>'token'<>p_expected_token then raise exception 'Project setup changed; refresh and review the current diff' using errcode='40001'; end if;
 projected_scopes:=snapshot->'scopes';
 for item in select value from jsonb_array_elements(p_plan->'items') loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('service_id','quantity','cadence','custom_cadence','pipeline','channels','audience','delivery_method','deliverable_key','evidence','unit','expected_revision','service_line')) then raise exception 'Unsupported setup fields' using errcode='22023'; end if;
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
   or item->>'pipeline' is null or item->>'pipeline' not in ('branding','website','marketing','undecided')
   or (item->>'pipeline'<>'undecided' and not (p_plan->'pipelines' ? (item->>'pipeline')))
   or item->>'audience' is null or item->>'audience' not in ('standard','remarketing','undecided')
   or item->>'delivery_method' is null or item->>'delivery_method' not in ('human','ai_assisted','automated','undecided')
   or jsonb_typeof(item->'channels') is distinct from 'array' or jsonb_array_length(item->'channels')>10
   or exists(select 1 from jsonb_array_elements(item->'channels') c where jsonb_typeof(c)<>'string' or length(trim(c#>>'{}')) not between 1 and 80)
   or (select count(*) from jsonb_array_elements(item->'channels'))<>(select count(distinct x) from jsonb_array_elements(item->'channels') x)
   or jsonb_typeof(item->'deliverable_key') is distinct from 'string' or length(item->>'deliverable_key')>80
   or jsonb_typeof(item->'evidence') is distinct from 'string' or length(trim(item->>'evidence')) not between 1 and 500 then raise exception 'Invalid setup quantity, cadence, scope or evidence' using errcode='22023'; end if;

  line_metadata:=private.review_setup_line_metadata(item->'service_line',leaf.definition,p_plan->'service_line_version',item->>'cadence');
  if item->>'pipeline'='branding' and (p_plan->'service_line_version' is distinct from '2'::jsonb or line_metadata->>'service_group' is distinct from 'branding') then raise exception 'Review explicit version 2 Branding scope before selecting the Branding track' using errcode='22023';end if;
  if p_plan->'service_line_version'='2'::jsonb and service.unit is distinct from leaf.definition->>'unit' then raise exception 'Canonical service unit changed; refresh the reviewed catalogue' using errcode='40001';end if;
  if p_plan->'service_line_version' is null and exists(select 1 from jsonb_array_elements(coalesce(snapshot->'state'->'plan'->'contributions','[]'::jsonb)) m where m->>'service_id'=sid::text and m ? 'service_line') then
   raise exception 'Review this service with version 2 dates and scope before changing it' using errcode='22023';
  end if;
  if p_plan->'service_line_version'='2'::jsonb then item:=item||jsonb_build_object('service_line',line_metadata);end if;
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
  if p_plan->'service_line_version'='2'::jsonb then projected:=projected||jsonb_build_object('scope_statement',line_metadata->>'scope_statement','exclusions',line_metadata->>'exclusions','start_date',line_metadata->'start_date','target_date',line_metadata->'target_date');end if;
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
end; $function$;

CREATE OR REPLACE FUNCTION private.build_service_project_plan(p_org uuid, p_project uuid, p_engagement uuid, p_choices jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare setup jsonb;prior private.project_delivery_plan_versions;item jsonb;old_item jsonb;candidate jsonb;ranked jsonb;contributions jsonb:='[]';unmapped jsonb:='[]';changes jsonb:='[]';bundles jsonb:='[]';bundle record;group_rows jsonb;chosen uuid;prior_group jsonb;bucket text;stages jsonb;result jsonb;catalogue jsonb;branding_catalogue jsonb:='[]';eligible jsonb;prior_choice text;explicit_choice text;scope_row jsonb;choice text;bucket_keys text[]:='{}';
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
 if octet_length(result::text)>900000 then raise exception 'Project plan exceeds the bounded review size; no records changed' using errcode='54000';end if;
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(jsonb_build_array(result,catalogue,p_choices)::text,'UTF8')),'hex'));
end;$function$;

CREATE OR REPLACE FUNCTION private.build_combined_service_plan(p_org uuid, p_project uuid, p_engagement uuid, p_choices jsonb, p_setup jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare setup jsonb;prior private.project_delivery_plan_versions;item jsonb;old_item jsonb;candidate jsonb;ranked jsonb;contributions jsonb:='[]';unmapped jsonb:='[]';changes jsonb:='[]';bundles jsonb:='[]';bundle record;group_rows jsonb;chosen uuid;prior_group jsonb;bucket text;stages jsonb;result jsonb;catalogue jsonb;branding_catalogue jsonb:='[]';eligible jsonb;prior_choice text;explicit_choice text;scope_row jsonb;choice text;bucket_keys text[]:='{}';
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
 if octet_length(result::text)>900000 then raise exception 'Project plan exceeds the bounded review size; no records changed' using errcode='54000';end if;
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(jsonb_build_array(result,catalogue,p_choices)::text,'UTF8')),'hex'));
end;$function$;
commit;
