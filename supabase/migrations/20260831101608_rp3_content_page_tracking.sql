-- Anka OS - RP3 content-per-page tracking through existing work items.
-- Adds one page-address field and an explicit, one-time generation function.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.work_items
  add column linked_page_path text;

alter table public.work_items
  add constraint work_items_linked_page_path_check
  check (
    linked_page_path is null
    or length(trim(linked_page_path)) between 1 and 1200
  );

create unique index work_items_content_page_unique
  on public.work_items (
    organization_id,
    engagement_id,
    linked_artifact_id,
    linked_page_path
  )
  where linked_page_path is not null;

create function private.guard_work_item_page_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.linked_page_path is not null
    and (
      new.linked_page_path is distinct from old.linked_page_path
      or new.linked_artifact_id is distinct from old.linked_artifact_id
    ) then
    raise exception 'Generated content task page links cannot be changed automatically.';
  end if;

  if new.linked_page_path is not null and not exists (
    select 1
    from public.artifacts artifact
    where artifact.id = new.linked_artifact_id
      and artifact.organization_id = new.organization_id
      and artifact.engagement_id = new.engagement_id
      and artifact.artifact_type = 'content'
  ) then
    raise exception 'A tracked page must link to this engagement''s Content artifact.';
  end if;

  return new;
end;
$$;

create trigger trg_guard_work_item_page_link
before insert or update on public.work_items
for each row execute function private.guard_work_item_page_link();

revoke all on function private.guard_work_item_page_link()
  from public, anon, authenticated;
grant execute on function private.guard_work_item_page_link()
  to service_role;

create function public.generate_content_page_work_items(
  p_engagement_id uuid,
  p_actor_id uuid
)
returns setof public.work_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_engagement public.engagements;
  v_architecture_artifact public.artifacts;
  v_architecture_version public.artifact_versions;
  v_content_artifact public.artifacts;
  v_content_version public.artifact_versions;
  v_after public.work_items;
  v_pages jsonb;
  v_uses_content_pages boolean := false;
  v_page_count integer;
  v_content_artifact_count integer;
  v_position_base integer;
begin
  select engagement.* into v_engagement
  from public.engagements engagement
  where engagement.id = p_engagement_id;

  if not found then
    raise exception 'Engagement not found.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_engagement.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;

  -- Two simultaneous human clicks must not produce two task sets or artifacts.
  perform pg_advisory_xact_lock(
    hashtextextended('rp3-content-pages:' || v_engagement.organization_id::text
      || ':' || v_engagement.id::text, 0)
  );

  select artifact.* into v_architecture_artifact
  from public.artifact_approvals approval
  join public.artifacts artifact
    on artifact.id = approval.artifact_id
   and artifact.organization_id = approval.organization_id
  where approval.organization_id = v_engagement.organization_id
    and approval.engagement_id = v_engagement.id
    and artifact.artifact_type = 'website_architecture'
  order by approval.approved_at desc, approval.id desc
  limit 1;

  if not found then
    raise exception 'An approved website architecture is required.';
  end if;

  select version.* into v_architecture_version
  from public.artifact_approvals approval
  join public.artifact_versions version
    on version.id = approval.artifact_version_id
   and version.organization_id = approval.organization_id
  where approval.organization_id = v_engagement.organization_id
    and approval.engagement_id = v_engagement.id
    and approval.artifact_id = v_architecture_artifact.id
  order by approval.approved_at desc, approval.id desc
  limit 1;

  select count(*) into v_content_artifact_count
  from public.artifacts artifact
  where artifact.organization_id = v_engagement.organization_id
    and artifact.engagement_id = v_engagement.id
    and artifact.artifact_type = 'content';

  if v_content_artifact_count > 1 then
    raise exception 'Multiple content artifacts exist for this engagement; reconcile them before generating tasks.';
  end if;

  if v_content_artifact_count = 1 then
    select artifact.* into v_content_artifact
    from public.artifacts artifact
    where artifact.organization_id = v_engagement.organization_id
      and artifact.engagement_id = v_engagement.id
      and artifact.artifact_type = 'content';

    if exists (
      select 1
      from public.work_items work_item
      where work_item.organization_id = v_engagement.organization_id
        and work_item.engagement_id = v_engagement.id
        and work_item.linked_artifact_id = v_content_artifact.id
        and work_item.linked_page_path is not null
    ) then
      raise exception 'Content page tasks have already been generated for this engagement.';
    end if;

    select version.* into v_content_version
    from public.artifact_versions version
    where version.organization_id = v_engagement.organization_id
      and version.artifact_id = v_content_artifact.id
    order by version.version_number desc
    limit 1;
  else
    insert into public.artifacts (
      organization_id, brand_id, engagement_id, artifact_type, title, created_by
    ) values (
      v_engagement.organization_id,
      v_engagement.brand_id,
      v_engagement.id,
      'content',
      'Website content',
      p_actor_id
    ) returning * into v_content_artifact;
  end if;

  if v_content_version.id is not null
    and jsonb_typeof(v_content_version.content -> 'pages') = 'array'
    and jsonb_array_length(v_content_version.content -> 'pages') > 0 then
    v_pages := v_content_version.content -> 'pages';
    v_uses_content_pages := true;
  else
    v_pages := v_architecture_version.content -> 'pages';
  end if;

  if jsonb_typeof(v_pages) is distinct from 'array' then
    raise exception 'The source artifact does not contain a page list.';
  end if;

  select count(*) into v_page_count
  from jsonb_array_elements(v_pages) page;

  if v_page_count < 1 then
    raise exception 'The source artifact must contain at least one page.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_pages) page
    where trim(coalesce(
      case when v_uses_content_pages then page ->> 'page_path' else page ->> 'slug' end,
      ''
    )) = ''
  ) then
    raise exception 'Every source page requires its canonical page key.';
  end if;

  if (
    select count(distinct trim(
      case when v_uses_content_pages then page ->> 'page_path' else page ->> 'slug' end
    ))
    from jsonb_array_elements(v_pages) page
  ) <> v_page_count then
    raise exception 'Source page keys must be unique.';
  end if;

  -- Content drafts must still map exactly to the approved sitemap so titles and
  -- page identities cannot be joined by a legacy path alias or array position.
  if v_uses_content_pages
    and exists (
      select 1
      from jsonb_array_elements(v_pages) content_page
      where not exists (
        select 1
        from jsonb_array_elements(v_architecture_version.content -> 'pages') architecture_page
        where trim(architecture_page ->> 'slug') = trim(content_page ->> 'page_path')
      )
    ) then
    raise exception 'Content page paths do not match approved website architecture slugs.';
  end if;

  select coalesce(max(work_item.position), 0) into v_position_base
  from public.work_items work_item
  where work_item.organization_id = v_engagement.organization_id
    and work_item.engagement_id = v_engagement.id
    and work_item.deleted_at is null;

  for v_after in
    with source_pages as (
      select
        page.ordinality,
        trim(case
          when v_uses_content_pages then page.value ->> 'page_path'
          else page.value ->> 'slug'
        end) as page_key
      from jsonb_array_elements(v_pages) with ordinality as page(value, ordinality)
    ),
    architecture_pages as (
      select
        trim(page ->> 'slug') as slug,
        trim(page ->> 'title') as title
      from jsonb_array_elements(v_architecture_version.content -> 'pages') page
    )
    insert into public.work_items (
      organization_id, engagement_id, brand_id, department_id, title,
      description, work_item_type, priority, status, created_by,
      linked_artifact_id, linked_page_path, position
    )
    select
      v_engagement.organization_id,
      v_engagement.id,
      v_engagement.brand_id,
      'content',
      left(coalesce(nullif(architecture_page.title, ''), source_page.page_key), 240),
      left('Write and review website content for ' || source_page.page_key || '.', 20000),
      'task',
      'medium',
      'not_started',
      p_actor_id,
      v_content_artifact.id,
      source_page.page_key,
      v_position_base + (source_page.ordinality::integer * 1000)
    from source_pages source_page
    left join architecture_pages architecture_page
      on architecture_page.slug = source_page.page_key
    order by source_page.ordinality
    returning *
  loop
    insert into public.engagement_events (
      organization_id, engagement_id, event_type, actor_id, payload
    ) values (
      v_after.organization_id,
      v_after.engagement_id,
      'work_item_created',
      p_actor_id,
      jsonb_build_object(
        'record_type', 'work_item',
        'record_id', v_after.id,
        'action', 'created',
        'status', v_after.status,
        'department_id', v_after.department_id,
        'linked_artifact_id', v_after.linked_artifact_id,
        'linked_page_path', v_after.linked_page_path,
        'source', 'content_page_generation'
      )
    );
    return next v_after;
  end loop;

  return;
end;
$$;

revoke all on function public.generate_content_page_work_items(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.generate_content_page_work_items(uuid, uuid)
  to service_role;

comment on column public.work_items.linked_page_path is
  'Optional canonical website page key inside the linked content artifact; RP3 stores the approved architecture slug here.';
comment on function public.generate_content_page_work_items(uuid, uuid) is
  'Explicit one-time RP3 action. Requires active team membership and an approved website architecture, then links one work item per page to the engagement content artifact.';
comment on function private.guard_work_item_page_link() is
  'Keeps a generated page task attached to its original Content artifact and canonical page key while allowing normal status and assignment edits.';

commit;
