-- The plan reader checks is_active on exact catalogue IDs in this projection.
do $guard$
begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc
      where oid = 'public.get_project_service_scope(uuid,uuid)'::regprocedure)
      is distinct from '5a9a2a4f92d9022a59e3a15a2fc39307' then
    raise exception 'Service scope reader differs from the reviewed version';
  end if;
end;
$guard$;

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
    'catalog',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'is_active',c.is_active,
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
