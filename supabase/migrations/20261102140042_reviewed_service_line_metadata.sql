-- Explicit v2 scope/date/timezone intent in the existing atomic setup contract.
-- No new record store, scheduler opt-in, recurring generation or execution permission.
-- target_date remains a planned target/deadline, not an implicit service/recurrence end.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('public.apply_project_setup(uuid,uuid,uuid,text,jsonb)')),chr(13),'')) is distinct from 'd3fc5ab85a177f632724dfe549dfd47e'
  or md5(replace(pg_get_functiondef(to_regprocedure('private.preview_combined_setup(uuid,uuid,text,jsonb)')),chr(13),'')) is distinct from '0cdb4348a0f70cb315e59589b3409e2b'
  or to_regprocedure('private.review_setup_line_metadata(jsonb,jsonb,jsonb,text)') is not null then raise exception 'Exact prior setup contracts differ' using errcode='55000';end if;
end;$$;
create function private.review_setup_line_metadata(p_line jsonb,p_leaf jsonb,p_version jsonb,p_cadence text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare start_value date; target_value date;trim_chars text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
begin
 if p_version is null then
  if p_line is not null then raise exception 'Explicit version 2 service-line review required' using errcode='22023';end if;
  return '{}'::jsonb;
 end if;
 if p_version is distinct from '2'::jsonb or p_line is null or jsonb_typeof(p_line) is distinct from 'object' then raise exception 'Review complete version 2 service-line metadata' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_line))<>8
  or exists(select 1 from jsonb_object_keys(p_line) k where k not in ('catalogue_version','service_group','start_date','target_date','timezone','generation_horizon','scope_statement','exclusions'))
  or p_line->'catalogue_version' is distinct from '1'::jsonb or p_leaf->'business_group_version' is distinct from '1'::jsonb
  or jsonb_typeof(p_leaf->'business_groups') is distinct from 'array' then raise exception 'Current versioned service catalogue metadata required' using errcode='22023';end if;
 if jsonb_typeof(p_line->'service_group') is distinct from 'string' or not (p_leaf->'business_groups' ? (p_line->>'service_group')) then raise exception 'Business scope does not match this exact service' using errcode='22023';end if;
 if p_cadence is null or p_cadence not in ('once','per_batch','weekly','monthly','quarterly','custom') then raise exception 'Review the service cadence' using errcode='22023';end if;
 if jsonb_typeof(p_line->'start_date') is distinct from 'string' or (p_line->>'start_date')!~'^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or (p_line->'target_date' is distinct from 'null'::jsonb and (jsonb_typeof(p_line->'target_date') is distinct from 'string' or (p_line->>'target_date')!~'^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then raise exception 'Explicit ISO service dates required' using errcode='22023';end if;
 begin
  start_value:=(p_line->>'start_date')::date;target_value:=(p_line->>'target_date')::date;
 exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Valid calendar service dates required' using errcode='22023';end;
 if target_value<start_value then raise exception 'Service target date precedes start date' using errcode='22023';end if;
 if jsonb_typeof(p_line->'timezone') is distinct from 'string' or length(p_line->>'timezone')>100
  or (p_line->>'timezone')!~'^[A-Za-z][A-Za-z0-9_+./-]*$'
  or not exists(select 1 from pg_catalog.pg_timezone_names() t where lower(t.name)=lower(p_line->>'timezone')) then raise exception 'Explicit valid IANA timezone required' using errcode='22023';end if;
 if p_cadence in ('weekly','monthly','quarterly') then
  if jsonb_typeof(p_line->'generation_horizon') is distinct from 'number' or (p_line->>'generation_horizon')!~'^[0-9]+$' then raise exception 'Review a finite cycle horizon' using errcode='22023';end if;
  if (p_line->>'generation_horizon')::numeric not between 1 and 12 then raise exception 'Review a finite cycle horizon' using errcode='22023';end if;
 elsif p_line->'generation_horizon' is distinct from 'null'::jsonb then raise exception 'Once and custom cadence have no automatic cycle horizon' using errcode='22023';end if;
 if jsonb_typeof(p_line->'scope_statement') is distinct from 'string' or length(p_line->>'scope_statement')>4000 or length(btrim(p_line->>'scope_statement',trim_chars))=0
  or jsonb_typeof(p_line->'exclusions') is distinct from 'string' or length(p_line->>'exclusions')>4000 then raise exception 'Review the agreed scope and exclusions' using errcode='22023';end if;
 return p_line||jsonb_build_object('scope_statement',btrim(p_line->>'scope_statement',trim_chars),'exclusions',btrim(p_line->>'exclusions',trim_chars));
end;$$;
revoke all on function private.review_setup_line_metadata(jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.apply_project_setup(p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_expected_token text,p_plan jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 or jsonb_typeof(p_plan->'pipelines') is distinct from 'array' or jsonb_array_length(p_plan->'pipelines')>2
 or exists(select 1 from jsonb_array_elements(p_plan->'pipelines') p where p not in ('"website"'::jsonb,'"marketing"'::jsonb))
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
   or item->>'pipeline' is null or item->>'pipeline' not in ('website','marketing','undecided')
   or (item->>'pipeline'<>'undecided' and not (p_plan->'pipelines' ? (item->>'pipeline')))
   or item->>'audience' is null or item->>'audience' not in ('standard','remarketing','undecided')
   or item->>'delivery_method' is null or item->>'delivery_method' not in ('human','ai_assisted','automated','undecided')
   or jsonb_typeof(item->'channels') is distinct from 'array' or jsonb_array_length(item->'channels')>10
   or exists(select 1 from jsonb_array_elements(item->'channels') c where jsonb_typeof(c)<>'string' or length(trim(c#>>'{}')) not between 1 and 80)
   or (select count(*) from jsonb_array_elements(item->'channels'))<>(select count(distinct x) from jsonb_array_elements(item->'channels') x)
   or jsonb_typeof(item->'deliverable_key') is distinct from 'string' or length(item->>'deliverable_key')>80
   or jsonb_typeof(item->'evidence') is distinct from 'string' or length(trim(item->>'evidence')) not between 1 and 500 then raise exception 'Invalid setup quantity, cadence, scope or evidence' using errcode='22023'; end if;

  line_metadata:=private.review_setup_line_metadata(item->'service_line',leaf.definition,p_plan->'service_line_version',item->>'cadence');
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
end; $$;

create or replace function private.preview_combined_setup(p_organization_id uuid,p_project_id uuid,p_expected_token text,p_plan jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 or jsonb_typeof(p_plan->'pipelines') is distinct from 'array' or jsonb_array_length(p_plan->'pipelines')>2
 or exists(select 1 from jsonb_array_elements(p_plan->'pipelines') p where p not in ('"website"'::jsonb,'"marketing"'::jsonb))
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
   or item->>'pipeline' is null or item->>'pipeline' not in ('website','marketing','undecided')
   or (item->>'pipeline'<>'undecided' and not (p_plan->'pipelines' ? (item->>'pipeline')))
   or item->>'audience' is null or item->>'audience' not in ('standard','remarketing','undecided')
   or item->>'delivery_method' is null or item->>'delivery_method' not in ('human','ai_assisted','automated','undecided')
   or jsonb_typeof(item->'channels') is distinct from 'array' or jsonb_array_length(item->'channels')>10
   or exists(select 1 from jsonb_array_elements(item->'channels') c where jsonb_typeof(c)<>'string' or length(trim(c#>>'{}')) not between 1 and 80)
   or (select count(*) from jsonb_array_elements(item->'channels'))<>(select count(distinct x) from jsonb_array_elements(item->'channels') x)
   or jsonb_typeof(item->'deliverable_key') is distinct from 'string' or length(item->>'deliverable_key')>80
   or jsonb_typeof(item->'evidence') is distinct from 'string' or length(trim(item->>'evidence')) not between 1 and 500 then raise exception 'Invalid setup quantity, cadence, scope or evidence' using errcode='22023'; end if;

  line_metadata:=private.review_setup_line_metadata(item->'service_line',leaf.definition,p_plan->'service_line_version',item->>'cadence');
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
end; $$;
commit;
