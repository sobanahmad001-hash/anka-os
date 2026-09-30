-- Workspace B2: resume reviews exact current impact and retains the existing command/receipt contract.
-- Definition reconciled against the approved installed metadata receipt.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
CREATE OR REPLACE FUNCTION public.change_project_service_scope(p_organization_id uuid, p_project_id uuid, p_request_id uuid, p_action text, p_scope_id uuid DEFAULT NULL::uuid, p_service_id uuid DEFAULT NULL::uuid, p_scope_statement text DEFAULT ''::text, p_exclusions text DEFAULT ''::text, p_quantity integer DEFAULT 1, p_owner_id uuid DEFAULT NULL::uuid, p_start_date date DEFAULT NULL::date, p_target_date date DEFAULT NULL::date, p_expected_revision bigint DEFAULT NULL::bigint, p_impact_token text DEFAULT NULL::text, p_impact_acknowledged boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); project public.projects%rowtype; scope public.project_service_scopes%rowtype;
  prior_status text; target_engagement_id uuid; service_row_id uuid; task_count bigint; work_count bigint;
  output_count bigint; actual_token text; payload jsonb; receipt private.n2_service_scope_commands%rowtype;
  result jsonb; impact jsonb:='{}'::jsonb;
begin
  project:=private.n2_scope_require_member(p_organization_id,p_project_id,true);
  if p_request_id is null or p_action is null
    or p_action not in ('add','activate','pause','resume','complete','cancel') then
    raise exception 'Valid service-scope command required.' using errcode='22023';
  end if;
  payload:=jsonb_build_object('project_id',p_project_id,'action',p_action,'scope_id',p_scope_id,
    'service_id',p_service_id,'scope_statement',trim(coalesce(p_scope_statement,'')),
    'exclusions',trim(coalesce(p_exclusions,'')),'quantity',p_quantity,'owner_id',p_owner_id,
    'start_date',p_start_date,'target_date',p_target_date,'expected_revision',p_expected_revision,
    'impact_token',p_impact_token,'impact_acknowledged',p_impact_acknowledged);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
  select * into receipt from private.n2_service_scope_commands
    where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.payload is distinct from payload then
      raise exception 'Request ID already used with different inputs.' using errcode='23505';
    end if;
    return receipt.result||jsonb_build_object('replayed',true);
  end if;
  if p_action='add' then
    if p_scope_id is not null or p_service_id is null or p_quantity is null or p_quantity<=0
      or (p_start_date is not null and p_target_date is not null and p_target_date<p_start_date) then
      raise exception 'Valid proposed service details required.' using errcode='22023';
    end if;
    perform 1 from public.service_catalog c where c.id=p_service_id
      and c.organization_id=p_organization_id and c.is_active for share;
    if not found then raise exception 'Active same-organization catalogue service required.' using errcode='42501'; end if;
    if p_owner_id is not null then
      perform 1 from public.organization_memberships m where m.organization_id=p_organization_id
        and m.user_id=p_owner_id and m.member_kind='team' and m.status='active' for share;
      if not found then raise exception 'Service owner must be an active same-organization member.' using errcode='42501'; end if;
    end if;
    insert into public.project_service_scopes(organization_id,project_id,service_id,scope_statement,
      exclusions,quantity,owner_id,start_date,target_date,source,created_by)
    values(p_organization_id,p_project_id,p_service_id,trim(coalesce(p_scope_statement,'')),
      trim(coalesce(p_exclusions,'')),p_quantity,p_owner_id,p_start_date,p_target_date,
      case when project.status='planning' then 'project_setup' else 'later_addition' end,actor)
    returning * into scope;
  else
    select * into scope from public.project_service_scopes where id=p_scope_id
      and organization_id=p_organization_id and project_id=p_project_id for update;
    if not found then raise exception 'Same-project service scope required.' using errcode='42501'; end if;
    if p_expected_revision is distinct from scope.revision then
      raise exception 'Service scope changed; review the current version.' using errcode='40001';
    end if;
    prior_status:=scope.status;
    if (p_action='activate' and scope.status<>'proposed')
      or (p_action='resume' and scope.status not in ('on_hold','cancelled'))
      or (p_action in ('pause','complete','cancel') and scope.status<>'active') then
      raise exception 'Service-scope transition is unavailable.' using errcode='40001';
    end if;
    if p_action in ('activate','resume') and project.status<>'active' then
      raise exception 'Activate the project before activating a service.' using errcode='40001';
    end if;
    if p_action in ('pause','resume','complete','cancel') then
      select count(*) into task_count from public.tasks t where t.project_id=p_project_id
        and t.organization_id=p_organization_id and t.archived_at is null;
      select count(*) into work_count from public.work_items w where w.project_id=p_project_id
        and w.organization_id=p_organization_id and w.deleted_at is null;
      select count(*) into output_count from public.deliverables d where d.project_id=p_project_id
        and d.organization_id=p_organization_id and d.archived_at is null;
      actual_token:=pg_catalog.md5(scope.id::text||':'||scope.revision::text||':'||
        task_count::text||':'||work_count::text||':'||output_count::text);
      if not coalesce(p_impact_acknowledged,false) or p_impact_token is distinct from actual_token then
        raise exception 'Review current project-wide work impact before changing service scope.' using errcode='40001';
      end if;
      impact:=jsonb_build_object('project_tasks',task_count,'engagement_work_items',work_count,
        'deliverables',output_count,'exact_service_linkage_known',false);
    end if;
    if p_action in ('activate','resume') then
      if project.engagement_type<>'internal' then
        select e.id into target_engagement_id from public.engagements e where e.project_id=p_project_id
          and e.organization_id=p_organization_id and e.status='active' for share;
        if not found then raise exception 'Active canonical engagement required.' using errcode='42501'; end if;
        if scope.engagement_service_id is null then
          insert into public.engagement_services(organization_id,engagement_id,service_id,owner_id,
            target_date,status,activated_by)
          values(p_organization_id,target_engagement_id,scope.service_id,scope.owner_id,
            scope.target_date,'active',actor) returning id into service_row_id;
          scope.engagement_service_id:=service_row_id;
        else
          update public.engagement_services set status='active' where id=scope.engagement_service_id
            and organization_id=p_organization_id and engagement_id=target_engagement_id;
        end if;
      end if;
      scope.status:='active';
    else
      scope.status:=case p_action when 'pause' then 'on_hold' when 'complete' then 'completed' else 'cancelled' end;
      if scope.engagement_service_id is not null then
        update public.engagement_services set status=scope.status where id=scope.engagement_service_id
          and organization_id=p_organization_id;
      end if;
    end if;
    update public.project_service_scopes set status=scope.status,
      engagement_service_id=scope.engagement_service_id,revision=revision+1,
      updated_at=clock_timestamp() where id=scope.id returning * into scope;
  end if;
  insert into private.n2_service_scope_events(organization_id,project_id,scope_id,actor_id,
    action,before_status,after_status,impact,request_id)
  values(p_organization_id,p_project_id,scope.id,actor,p_action,prior_status,scope.status,impact,p_request_id);
  result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,
    'scope_id',scope.id,'status',scope.status,'revision',scope.revision,'request_id',p_request_id,
    'replayed',false);
  insert into private.n2_service_scope_commands(organization_id,actor_id,request_id,payload,result)
    values(p_organization_id,actor,p_request_id,payload,result);
  return result;
end; $function$;

commit;
