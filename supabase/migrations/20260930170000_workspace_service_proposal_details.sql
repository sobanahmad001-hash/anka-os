-- B2: explicit descriptive unit/recurrence; never schedules or executes work.
-- Legacy scope remains unspecified; no catalogue rows or customer records are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.service_catalog add column unit text check(unit is null or (length(trim(unit)) between 1 and 80)), add column recurrence text check(recurrence is null or (length(trim(recurrence)) between 1 and 120));
alter table public.project_service_scopes add column unit text check(unit is null or (length(trim(unit)) between 1 and 80)), add column recurrence text check(recurrence is null or (length(trim(recurrence)) between 1 and 120));
create table private.workspace_service_proposal_details (
 organization_id uuid not null, actor_id uuid not null, request_id uuid not null,
 scope_id uuid not null unique references public.project_service_scopes(id) on delete restrict,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,actor_id,request_id)
);
alter table private.workspace_service_proposal_details enable row level security;
revoke all on private.workspace_service_proposal_details from public,anon,authenticated,service_role;
create trigger workspace_service_proposal_details_immutable before update or delete on private.workspace_service_proposal_details for each row execute function private.n1b_preserve_receipt();
CREATE OR REPLACE FUNCTION public.get_project_service_scope(p_organization_id uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare project public.projects%rowtype; task_count bigint; work_count bigint; output_count bigint;
begin
  project:=private.n2_scope_require_member(p_organization_id,p_project_id,false);
  select count(*) into task_count from public.tasks t where t.project_id=p_project_id and t.organization_id=p_organization_id
    and t.archived_at is null;
  select count(*) into work_count from public.work_items w where w.project_id=p_project_id
    and w.organization_id=p_organization_id and w.deleted_at is null;
  select count(*) into output_count from public.deliverables d where d.project_id=p_project_id
    and d.organization_id=p_organization_id and d.archived_at is null;
  return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'project_status',project.status,
    'impact',jsonb_build_object('project_tasks',task_count,'engagement_work_items',work_count,
      'deliverables',output_count,'exact_service_linkage_known',false),
    'catalog',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
      'department_id',c.department_id,'description',c.description,'unit',c.unit,'recurrence',c.recurrence) order by c.display_order,c.name)
      from public.service_catalog c where c.organization_id=p_organization_id and c.is_active),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,
      'name',coalesce(nullif(trim(p.full_name),''),m.user_id::text)) order by m.user_id)
      from public.organization_memberships m left join public.profiles p on p.id=m.user_id
      where m.organization_id=p_organization_id and m.member_kind='team' and m.status='active'),'[]'::jsonb),
    'scopes',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'service_id',s.service_id,
      'status',s.status,'scope_statement',s.scope_statement,'exclusions',s.exclusions,
      'quantity',s.quantity,'unit',s.unit,'recurrence',s.recurrence,'owner_id',s.owner_id,'start_date',s.start_date,
      'target_date',s.target_date,'revision',s.revision,'source',s.source,
      'engagement_service_id',s.engagement_service_id,
      'impact_token',pg_catalog.md5(s.id::text||':'||s.revision::text||':'||
        task_count::text||':'||work_count::text||':'||output_count::text)) order by s.created_at,s.id)
      from public.project_service_scopes s where s.project_id=p_project_id
        and s.organization_id=p_organization_id),'[]'::jsonb));
end; $function$;
create function public.propose_workspace_service_scope(p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_service_id uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); project public.projects; actor_role text; receipt private.workspace_service_proposal_details;
 payload jsonb; result jsonb; sid uuid; unit_value text:=trim(p_details->>'unit'); recurrence_value text:=trim(p_details->>'recurrence');
 quantity_value integer; owner_value uuid; start_value date; target_value date;
begin
 project:=private.n2_scope_require_member(p_organization_id,p_project_id,true);
 -- Hold exact PM authority through this transaction, including concurrent revocation.
 select m.role into actor_role from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=actor and m.status='active' and m.member_kind='team';
 if actor_role not in ('system_owner','operations_admin') then
  perform 1 from public.project_manager_bindings b where b.organization_id=p_organization_id and b.project_id=p_project_id and b.user_id=actor and b.status='active' for share;
  if not found then raise exception 'Exact project-manager authority changed.' using errcode='42501'; end if;
 end if;
 if p_request_id is null or p_service_id is null or jsonb_typeof(p_details) is distinct from 'object'
   or unit_value is null or length(unit_value) not between 1 and 80
   or recurrence_value is null or length(recurrence_value) not between 1 and 120
   or exists(select 1 from jsonb_object_keys(p_details) key where key not in ('unit','recurrence','scope_statement','exclusions','quantity','owner_id','start_date','target_date')) then
  raise exception 'Explicit service unit and recurrence details are required.' using errcode='22023';
 end if;
 quantity_value:=(p_details->>'quantity')::integer;
 owner_value:=nullif(p_details->>'owner_id','')::uuid;
 start_value:=nullif(p_details->>'start_date','')::date;
 target_value:=nullif(p_details->>'target_date','')::date;
 if quantity_value is null or quantity_value<1 then raise exception 'Positive whole service quantity required.' using errcode='22023'; end if;
 payload:=jsonb_build_object('project_id',p_project_id,'service_id',p_service_id,'unit',unit_value,'recurrence',recurrence_value,
  'scope_statement',trim(coalesce(p_details->>'scope_statement','')),'exclusions',trim(coalesce(p_details->>'exclusions','')),
  'quantity',quantity_value,'owner_id',owner_value,'start_date',start_value,'target_date',target_value);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.workspace_service_proposal_details where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.payload is distinct from payload then raise exception 'Request ID already used with different service details.' using errcode='23505'; end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 -- A historical legacy command cannot acquire new details through a reused key.
 if exists(select 1 from private.n2_service_scope_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id) then
  raise exception 'Request ID belongs to an existing legacy service command.' using errcode='23505';
 end if;
 result:=public.change_project_service_scope(p_organization_id=>p_organization_id,p_project_id=>p_project_id,p_request_id=>p_request_id,p_action=>'add',p_service_id=>p_service_id,
  p_scope_statement=>payload->>'scope_statement',p_exclusions=>payload->>'exclusions',p_quantity=>quantity_value,p_owner_id=>owner_value,p_start_date=>start_value,p_target_date=>target_value);
 sid:=(result->>'scope_id')::uuid;
 update public.project_service_scopes set unit=unit_value,recurrence=recurrence_value where id=sid and organization_id=p_organization_id and project_id=p_project_id and status='proposed' and revision=1;
 if not found then raise exception 'Exact new proposal changed.' using errcode='40001'; end if;
 result:=result||jsonb_build_object('unit',unit_value,'recurrence',recurrence_value);
 insert into private.workspace_service_proposal_details(organization_id,actor_id,request_id,scope_id,payload,result) values(p_organization_id,actor,p_request_id,sid,payload,result);
 return result;
end; $$;
revoke all on function public.propose_workspace_service_scope(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.propose_workspace_service_scope(uuid,uuid,uuid,uuid,jsonb) to authenticated;
commit;
