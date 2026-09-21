-- Read-only current text-route settings for active team members. Private tables remain closed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function public.list_pipeline_ai_text_route_settings(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  department text;
  route_set private.pipeline_ai_text_route_sets;
  selected_ids jsonb;
  response jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or actor is null or not exists (
    select 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Current team organization membership is required.' using errcode = '42501';
  end if;
  foreach department in array array['content', 'design', 'marketing'] loop
    select * into route_set from private.pipeline_ai_text_route_sets
      where organization_id = p_organization_id and department_id = department
      order by revision desc limit 1;
    if found then
      select coalesce(jsonb_agg(entry.model_configuration_id order by entry.priority), '[]'::jsonb)
        into selected_ids from private.pipeline_ai_text_route_entries entry
        where entry.route_set_id = route_set.id;
      response := response || jsonb_build_array(jsonb_build_object(
        'department_id', department, 'revision', route_set.revision,
        'configured_at', route_set.configured_at,
        'model_configuration_ids', selected_ids
      ));
    else
      response := response || jsonb_build_array(jsonb_build_object(
        'department_id', department, 'revision', 0,
        'model_configuration_ids', '[]'::jsonb
      ));
    end if;
  end loop;
  return response;
end;
$$;
revoke all on function public.list_pipeline_ai_text_route_settings(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pipeline_ai_text_route_settings(uuid) to authenticated;
commit;