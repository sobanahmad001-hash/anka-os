-- Anka OS - D1 proofing layer for exact immutable versions.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.artifact_version_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  artifact_version_id uuid,
  design_direction_version_id uuid,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (length(body) > 0),
  comment_position jsonb,
  resolved boolean not null default false,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint artifact_version_comments_exactly_one_target check (
    (artifact_version_id is not null)::integer
      + (design_direction_version_id is not null)::integer = 1
  ),
  constraint artifact_version_comments_resolution_state check (
    (not resolved and resolved_by is null and resolved_at is null)
    or (resolved and resolved_by is not null and resolved_at is not null)
  ),
  constraint artifact_version_comments_artifact_target_fkey
    foreign key (artifact_version_id, organization_id)
      references public.artifact_versions(id, organization_id) on delete cascade,
  constraint artifact_version_comments_direction_target_fkey
    foreign key (design_direction_version_id, organization_id)
      references public.design_direction_versions(id, organization_id) on delete cascade
);

create index idx_artifact_version_comments_artifact
  on public.artifact_version_comments(organization_id, artifact_version_id, created_at)
  where artifact_version_id is not null;
create index idx_artifact_version_comments_direction
  on public.artifact_version_comments(organization_id, design_direction_version_id, created_at)
  where design_direction_version_id is not null;
create index idx_artifact_version_comments_unresolved
  on public.artifact_version_comments(organization_id, created_at)
  where not resolved;
create index idx_artifact_version_comments_author
  on public.artifact_version_comments(author_id, created_at desc);
create index idx_artifact_version_comments_resolver
  on public.artifact_version_comments(resolved_by)
  where resolved_by is not null;

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

revoke all on function private.enforce_artifact_version_comment_append_only()
  from public, anon, authenticated;
grant execute on function private.enforce_artifact_version_comment_append_only()
  to service_role;

create trigger trg_artifact_version_comments_append_only
before update or delete on public.artifact_version_comments
for each row execute function private.enforce_artifact_version_comment_append_only();

alter table public.artifact_version_comments enable row level security;

create policy "Team can read exact-version proofing comments"
  on public.artifact_version_comments
  for select
  to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.artifact_version_comments from anon, authenticated;
grant select on public.artifact_version_comments to authenticated;
grant select, insert, update on public.artifact_version_comments to service_role;

comment on table public.artifact_version_comments is
  'Append-only proofing feedback on exactly one artifact or design-direction version; resolution is independent from approval.';

commit;
