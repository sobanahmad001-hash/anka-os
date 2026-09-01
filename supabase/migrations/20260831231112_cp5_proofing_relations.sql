-- Anka OS - CP5 proofing and artifact relations targetting content requests.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.artifact_version_comments
  add column if not exists content_request_id uuid;

alter table public.artifact_version_comments
  drop constraint if exists artifact_version_comments_exactly_one_target;
alter table public.artifact_version_comments
  add constraint artifact_version_comments_exactly_one_target check (
    (artifact_version_id is not null)::integer
      + (design_direction_version_id is not null)::integer
      + (content_request_id is not null)::integer = 1
  );

alter table public.artifact_version_comments
  add constraint artifact_version_comments_content_request_fk
    foreign key (content_request_id, organization_id)
      references public.content_requests(id, organization_id) on delete cascade;

create index if not exists idx_artifact_version_comments_content_request
  on public.artifact_version_comments(organization_id, content_request_id, created_at)
  where content_request_id is not null;

alter table public.artifact_version_comments
  drop constraint if exists artifact_version_comments_append_only;

create or replace function private.enforce_artifact_version_comment_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Proofing comments are append-only.' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.artifact_version_id is distinct from old.artifact_version_id
    or new.design_direction_version_id is distinct from old.design_direction_version_id
    or new.content_request_id is distinct from old.content_request_id
    or new.author_id is distinct from old.author_id
    or new.body is distinct from old.body
    or new.comment_position is distinct from old.comment_position
    or new.created_at is distinct from old.created_at then
    raise exception 'Proofing comment content, author, target, and creation time are immutable.'
      using errcode = '55000';
  end if;

  if old.resolved or not new.resolved
    or new.resolved_by is null or new.resolved_at is null then
    raise exception 'Only a one-way resolution with resolver and time is permitted.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

-- keep existing invocation privileges from the D1 migration for this function path.

drop policy if exists "Team can read exact-version proofing comments"
  on public.artifact_version_comments;
drop policy if exists "Team can read permitted exact-version proofing comments"
  on public.artifact_version_comments;
create policy "Team can read permitted exact-version proofing comments"
  on public.artifact_version_comments
  for select to authenticated
  using (
    public.is_team_organization_member(organization_id)
    and (
      (artifact_version_id is not null and exists (
        select 1
        from public.artifact_versions
        where id = artifact_version_id
          and organization_id = public.artifact_version_comments.organization_id
      ))
      or (design_direction_version_id is not null and exists (
        select 1
        from public.design_direction_versions
        where id = design_direction_version_id
          and organization_id = public.artifact_version_comments.organization_id
      ))
      or (content_request_id is not null and exists (
        select 1
        from public.content_requests
        where id = content_request_id
          and organization_id = public.artifact_version_comments.organization_id
      ))
    )
  );

alter table public.artifact_relations
  add column if not exists target_content_request_id uuid;
alter table public.artifact_relations
  alter column target_artifact_id drop not null;


alter table public.artifact_relations
  drop constraint if exists artifact_relations_distinct_artifacts_check;
alter table public.artifact_relations
  add constraint artifact_relations_target_artifact_self_check check (
    target_artifact_id is null or source_artifact_id <> target_artifact_id
  );

alter table public.artifact_relations
  drop constraint if exists artifact_relations_exactly_one_target;
alter table public.artifact_relations
  add constraint artifact_relations_exactly_one_target check (
    (target_artifact_id is not null)::integer
      + (target_content_request_id is not null)::integer = 1
  );

alter table public.artifact_relations
  drop constraint if exists artifact_relations_target_content_request_fkey;
alter table public.artifact_relations
  add constraint artifact_relations_target_content_request_fkey
    foreign key (target_content_request_id, organization_id)
      references public.content_requests(id, organization_id) on delete cascade;

drop index if exists artifact_relations_unique_link;
alter table public.artifact_relations
  drop constraint if exists artifact_relations_unique_link;
create unique index if not exists artifact_relations_unique_artifact_link
  on public.artifact_relations(organization_id, source_artifact_id, target_artifact_id, relation_type)
  where target_artifact_id is not null;
create unique index if not exists artifact_relations_unique_request_link
  on public.artifact_relations(organization_id, source_artifact_id, target_content_request_id, relation_type)
  where target_content_request_id is not null;

drop index if exists idx_artifact_relations_target;
create index if not exists idx_artifact_relations_target
  on public.artifact_relations(organization_id, target_artifact_id, created_at desc)
  where target_artifact_id is not null;
create index if not exists idx_artifact_relations_target_request
  on public.artifact_relations(organization_id, target_content_request_id, created_at desc)
  where target_content_request_id is not null;

drop policy if exists "Team can read visible artifact relations"
  on public.artifact_relations;
create policy "Team can read visible artifact relations"
on public.artifact_relations for select to authenticated
using (
  public.is_team_organization_member(organization_id)
  and exists (
    select 1 from public.artifacts source
    where source.id = source_artifact_id
      and source.organization_id = artifact_relations.organization_id
  )
  and (
    (target_artifact_id is not null and exists (
      select 1 from public.artifacts target
      where target.id = target_artifact_id
        and target.organization_id = artifact_relations.organization_id
    ))
    or (target_content_request_id is not null and exists (
      select 1 from public.content_requests target_request
      where target_request.id = target_content_request_id
        and target_request.organization_id = artifact_relations.organization_id
    ))
  )
);

comment on table public.artifact_version_comments is
  'Append-only proofing feedback on exactly one artifact version, design-direction version, or content request.';
comment on table public.artifact_relations is
  'Relations from a source artifact to either an artifact or a content request.';

commit;