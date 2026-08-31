-- Run only with explicit production approval. The transaction always rolls back.
begin;

do $$
declare
  v_organization_id uuid;
  v_actor_id uuid;
  v_client_id uuid;
  v_brand_id uuid;
  v_engagement_id uuid;
  v_architecture_id uuid;
  v_architecture_version_id uuid;
  v_content_artifact_id uuid;
  v_generated public.work_items[];
begin
  select organization_id, user_id into v_organization_id, v_actor_id
  from public.organization_memberships
  where member_kind = 'team' and status = 'active'
  limit 1;

  if v_actor_id is null then
    raise exception 'Verification requires one active team member fixture.';
  end if;

  insert into public.agency_clients (organization_id, name, status, created_by)
  values (v_organization_id, 'RP3 verification client', 'active', v_actor_id)
  returning id into v_client_id;

  insert into public.brands (organization_id, client_id, name, status, created_by)
  values (v_organization_id, v_client_id, 'RP3 verification brand', 'active', v_actor_id)
  returning id into v_brand_id;

  insert into public.engagements (
    organization_id, client_id, brand_id, name, engagement_type, status, created_by
  ) values (
    v_organization_id, v_client_id, v_brand_id, 'RP3 verification engagement',
    'project', 'active', v_actor_id
  ) returning id into v_engagement_id;

  insert into public.artifacts (
    organization_id, brand_id, engagement_id, artifact_type, title, created_by
  ) values (
    v_organization_id, v_brand_id, v_engagement_id,
    'website_architecture', 'Approved verification sitemap', v_actor_id
  ) returning id into v_architecture_id;

  insert into public.artifact_versions (
    organization_id, artifact_id, version_number, content, content_checksum,
    change_summary, created_by
  ) values (
    v_organization_id, v_architecture_id, 1,
    jsonb_build_object(
      'site_goal', 'Verify RP3',
      'navigation_principles', jsonb_build_array('Clear paths'),
      'pages', jsonb_build_array(
        jsonb_build_object('slug', 'home', 'title', 'Homepage', 'parent_slug', null, 'page_type', 'hub', 'purpose', 'Orient visitors'),
        jsonb_build_object('slug', 'properties', 'title', 'Properties', 'parent_slug', 'home', 'page_type', 'service', 'purpose', 'Present listings'),
        jsonb_build_object('slug', 'contact', 'title', 'Contact', 'parent_slug', 'home', 'page_type', 'supporting', 'purpose', 'Capture enquiries')
      )
    ),
    repeat('a', 64), 'RP3 verification sitemap', v_actor_id
  ) returning id into v_architecture_version_id;

  insert into public.artifact_approvals (
    organization_id, artifact_id, artifact_version_id, engagement_id, approved_by
  ) values (
    v_organization_id, v_architecture_id, v_architecture_version_id,
    v_engagement_id, v_actor_id
  );

  select array_agg(item order by item.position) into v_generated
  from public.generate_content_page_work_items(v_engagement_id, v_actor_id) item;

  if cardinality(v_generated) <> 3 then
    raise exception 'Expected three generated content tasks.';
  end if;

  select id into v_content_artifact_id
  from public.artifacts
  where engagement_id = v_engagement_id and artifact_type = 'content';

  if exists (
    select 1
    from unnest(v_generated) item
    where item.linked_artifact_id <> v_content_artifact_id
      or item.linked_page_path is null
  ) then
    raise exception 'Generated tasks are not linked to the content artifact and page key.';
  end if;

  if (select array_agg(item.linked_page_path order by item.position) from unnest(v_generated) item)
    <> array['home', 'properties', 'contact']::text[] then
    raise exception 'Generated page slugs do not preserve sitemap order.';
  end if;

  begin
    update public.work_items
    set linked_page_path = 'silently-renamed'
    where id = (v_generated[1]).id;
    raise exception 'Generated page identity unexpectedly changed.';
  exception
    when others then
      if sqlerrm not like 'Generated content task page links cannot be changed automatically%' then
        raise;
      end if;
  end;

  begin
    perform public.generate_content_page_work_items(v_engagement_id, v_actor_id);
    raise exception 'Duplicate generation unexpectedly succeeded.';
  exception
    when others then
      if sqlerrm not like 'Content page tasks have already been generated%' then
        raise;
      end if;
  end;
end;
$$;

rollback;
