-- xmin is the row's PostgreSQL transaction version. It changes even for ordinary
-- project updates that leave updated_at or the description unchanged.
create function public.read_project_business_brief(p_organization_id uuid, p_project_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'organization_id', p.organization_id,
    'description', p.description, 'updated_at', p.updated_at, 'revision', p.xmin::text)
  from public.projects p
  where p.organization_id = p_organization_id and p.id = p_project_id and auth.uid() is not null;
$$;

create function public.save_project_business_brief(
  p_organization_id uuid, p_project_id uuid, p_actor_id uuid,
  p_original_revision text, p_original_updated_at timestamptz,
  p_original_description text, p_description text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  update public.projects p set description = p_description
  where auth.uid() = p_actor_id and p.organization_id = p_organization_id and p.id = p_project_id
    and p.xmin::text = p_original_revision and p.updated_at = p_original_updated_at
    and p.description = p_original_description and p_description is not null
  returning jsonb_build_object('id', p.id, 'organization_id', p.organization_id,
    'description', p.description, 'updated_at', p.updated_at, 'revision', p.xmin::text);
$$;

revoke all on function public.read_project_business_brief(uuid,uuid),
  public.save_project_business_brief(uuid,uuid,uuid,text,timestamptz,text,text) from public, anon;
grant execute on function public.read_project_business_brief(uuid,uuid),
  public.save_project_business_brief(uuid,uuid,uuid,text,timestamptz,text,text) to authenticated;
