-- Anka OS - D3 generic relations between canonical artifacts.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.artifact_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_artifact_id uuid not null,
  target_artifact_id uuid not null,
  relation_type text not null
    check (relation_type in ('feeds_into', 'derived_from', 'referenced_by')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint artifact_relations_source_artifact_fkey
    foreign key (source_artifact_id, organization_id)
      references public.artifacts(id, organization_id) on delete cascade,
  constraint artifact_relations_target_artifact_fkey
    foreign key (target_artifact_id, organization_id)
      references public.artifacts(id, organization_id) on delete cascade,
  constraint artifact_relations_distinct_artifacts_check
    check (source_artifact_id <> target_artifact_id),
  constraint artifact_relations_unique_link
    unique (source_artifact_id, target_artifact_id, relation_type)
);

create index idx_artifact_relations_source
  on public.artifact_relations(organization_id, source_artifact_id, created_at desc);
create index idx_artifact_relations_target
  on public.artifact_relations(organization_id, target_artifact_id, created_at desc);

alter table public.artifact_relations enable row level security;

-- A row is readable only while both endpoint artifacts are readable to the caller.
-- The endpoint lookups intentionally run as the invoker, so future artifact-level
-- RLS restrictions automatically narrow this rollup without a cached visibility copy.
create policy "Team can read visible artifact relations"
on public.artifact_relations for select to authenticated
using (
  public.is_team_organization_member(organization_id)
  and exists (
    select 1
    from public.artifacts source
    where source.id = artifact_relations.source_artifact_id
      and source.organization_id = artifact_relations.organization_id
  )
  and exists (
    select 1
    from public.artifacts target
    where target.id = artifact_relations.target_artifact_id
      and target.organization_id = artifact_relations.organization_id
  )
);

revoke all on public.artifact_relations from anon, authenticated;
grant select on public.artifact_relations to authenticated;
grant select, insert, update, delete on public.artifact_relations to service_role;

commit;
