begin;
create function public.ensure_brand_design_workstream(p_project uuid, p_service uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  org uuid;
  stream_id uuid;
begin
  select p.organization_id into org
  from public.projects p
  where p.id = p_project and p.owner_id = actor and p.archived_at is null
    and public.is_team_organization_member(p.organization_id);
  if not found then
    raise exception 'An active project owner is required' using errcode = '42501';
  end if;

  perform 1 from public.engagement_services s
  join public.engagements e on e.id = s.engagement_id and e.organization_id = org
  join public.service_catalog c on c.id = s.service_id and c.organization_id = org
  where e.project_id = p_project and s.id = p_service and s.organization_id = org
    and s.status = 'active' and c.department_id = 'design'
    and c.slug in ('brand_visual_identity','setup_design_logo_design','setup_design_visual_identity','setup_design_brand_guidelines');
  if not found then
    raise exception 'An active visual identity service on this project is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project::text, 0));
  select id into stream_id from public.workstreams
  where project_id = p_project and organization_id = org and department_id = 'design'
  order by created_at, id limit 1;
  if found then return stream_id; end if;

  insert into public.workstreams(organization_id, project_id, department_id, name, status, owner_id, client_visible, started_at)
  values (org, p_project, 'design', 'Design', 'active', actor, false, now())
  returning id into stream_id;
  return stream_id;
end;
$$;
revoke all on function public.ensure_brand_design_workstream(uuid,uuid) from public, anon;
grant execute on function public.ensure_brand_design_workstream(uuid,uuid) to authenticated;
commit;
