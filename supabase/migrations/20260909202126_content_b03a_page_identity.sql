-- Anka OS - Content B03a stable website-page identity.
-- Existing slug-only artifact versions and work items remain unchanged. New
-- tracked work derives an immutable page key from the exact approved sitemap.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.work_items
  add column linked_page_key text;

alter table public.work_items
  add constraint work_items_linked_page_key_check
  check (
    linked_page_key is null
    or length(trim(linked_page_key)) between 1 and 1208
  );

create unique index work_items_content_page_key_unique
  on public.work_items (
    organization_id,
    engagement_id,
    linked_artifact_id,
    linked_page_key
  )
  where linked_page_key is not null;

create function private.normalize_content_page_path(p_value text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_path text;
begin
  v_path := lower(trim(both '/' from regexp_replace(
    replace(trim(coalesce(p_value, '')), chr(92), '/'),
    '/+', '/', 'g'
  )));
  v_path := regexp_replace(v_path, '[[:space:]]+', '-', 'g');

  if v_path = '' then
    raise exception 'Website page path is required.';
  end if;
  if length(v_path) > 1200 or v_path ~ '[?#[:cntrl:]]'
    or exists (
      select 1
      from unnest(string_to_array(v_path, '/')) segment
      where segment in ('.', '..')
    ) then
    raise exception 'Website page path contains unsupported characters.';
  end if;
  return v_path;
end;
$$;

create or replace function private.guard_work_item_page_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected_key text;
  v_normalized_path text;
begin
  if tg_op = 'UPDATE'
    and old.linked_page_path is not null
    and (
      new.linked_page_path is distinct from old.linked_page_path
      or new.linked_page_key is distinct from old.linked_page_key
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

  if tg_op = 'INSERT' and new.linked_page_path is not null then
    v_normalized_path := private.normalize_content_page_path(new.linked_page_path);

    select coalesce(
      nullif(trim(page.value ->> 'page_key'), ''),
      'legacy:' || private.normalize_content_page_path(page.value ->> 'slug')
    ) into v_expected_key
    from (
      select approval.*
      from public.artifact_approvals approval
      join public.artifacts architecture
        on architecture.id = approval.artifact_id
       and architecture.organization_id = approval.organization_id
       and architecture.engagement_id = approval.engagement_id
       and architecture.artifact_type = 'website_architecture'
      where approval.organization_id = new.organization_id
        and approval.engagement_id = new.engagement_id
      order by approval.approved_at desc, approval.id desc
      limit 1
    ) approval
    join public.artifact_versions version
      on version.id = approval.artifact_version_id
     and version.organization_id = approval.organization_id
     and version.artifact_id = approval.artifact_id
    cross join lateral jsonb_array_elements(version.content -> 'pages') page(value)
    where private.normalize_content_page_path(page.value ->> 'slug') = v_normalized_path
    limit 1;

    if v_expected_key is null then
      raise exception 'Tracked page path is not present in the latest approved Website architecture.';
    end if;
    if new.linked_page_key is not null and trim(new.linked_page_key) <> v_expected_key then
      raise exception 'Tracked page key does not match the approved Website architecture.';
    end if;

    new.linked_page_path := v_normalized_path;
    new.linked_page_key := v_expected_key;
  elsif tg_op = 'INSERT' and new.linked_page_key is not null then
    raise exception 'A tracked page key requires its current page path.';
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_content_page_path(text)
  from public, anon, authenticated;
grant execute on function private.normalize_content_page_path(text)
  to service_role;

comment on column public.work_items.linked_page_key is
  'Stable website page identity for new Content page tasks. Legacy path-only rows remain valid and are resolved through their original path-derived key.';
comment on function private.normalize_content_page_path(text) is
  'B03a canonical path normalization shared by guarded Content page-task creation.';
comment on function private.guard_work_item_page_link() is
  'Keeps Content page tasks bound to their immutable approved page identity while preserving legacy path-only rows.';

commit;
