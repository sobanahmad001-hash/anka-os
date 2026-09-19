-- N1 shadow records only: existing roles, policies and write paths are unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Freeze source facts while deriving deterministic seeds and exception rows.
lock table public.organizations, public.organization_memberships, public.departments,
  public.projects, public.engagements in share mode;

alter table public.departments add constraint n1_department_tenant_key
  unique (id, organization_id);

create table public.organization_department_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  department_id text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  source text not null check (source in ('legacy_department', 'explicit')),
  source_details jsonb not null default '{}'::jsonb check (jsonb_typeof(source_details) = 'object'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null and revoked_at >= created_at)),
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete restrict,
  foreign key (department_id, organization_id) references public.departments(id, organization_id) on delete restrict
);
create unique index n1_department_active_key on public.organization_department_memberships(organization_id, user_id, department_id) where status = 'active';
create index n1_department_member_history on public.organization_department_memberships(organization_id, user_id);
create index n1_department_scope on public.organization_department_memberships(department_id, organization_id);

create table public.organization_contributor_designations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  designation text not null check (designation in ('intern', 'executive')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  source text not null default 'explicit' check (source = 'explicit'),
  source_details jsonb not null default '{}'::jsonb check (jsonb_typeof(source_details) = 'object'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null and revoked_at >= created_at)),
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete restrict
);
create unique index n1_designation_active_key on public.organization_contributor_designations(organization_id, user_id) where status = 'active';
create index n1_designation_member_history on public.organization_contributor_designations(organization_id, user_id);

create table public.project_manager_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  project_id uuid not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  source text not null check (source in ('verified_project_owner', 'explicit')),
  source_details jsonb not null default '{}'::jsonb check (jsonb_typeof(source_details) = 'object'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null and revoked_at >= created_at)),
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete restrict,
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete restrict
);
-- Uniqueness is per member/project, deliberately NOT per project.
create unique index n1_pm_active_key on public.project_manager_bindings(organization_id, user_id, project_id) where status = 'active';
create index n1_pm_member_history on public.project_manager_bindings(organization_id, user_id);
create index n1_pm_project_scope on public.project_manager_bindings(project_id, organization_id);

comment on table public.organization_contributor_designations is 'Non-authorizing contributor labels. executive here is never the legacy executive authority role.';
comment on table public.project_manager_bindings is 'N1 compatibility records only; not consulted by existing authorization. Multiple active managers per project are supported.';

-- A durable, private reconciliation ledger; no legacy row is rewritten.
create table private.n1_authority_backfill_issues (
  source_kind text not null check (source_kind in ('membership', 'project')),
  source_id uuid not null,
  organization_id uuid not null,
  reason text not null,
  recorded_at timestamptz not null default now(),
  primary key (source_kind, source_id, reason)
);
revoke all on private.n1_authority_backfill_issues from public, anon, authenticated, service_role;
alter table private.n1_authority_backfill_issues enable row level security;
grant select on private.n1_authority_backfill_issues to service_role;

create function private.n1_guard_compatibility_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'N1 history cannot be deleted.' using errcode = '42501';
  elsif tg_op = 'UPDATE' then
    if old.status <> 'active' or new.status <> 'revoked'
       or (to_jsonb(new) - array['status', 'revoked_at'])
          is distinct from (to_jsonb(old) - array['status', 'revoked_at']) then
      raise exception 'Only revocation is allowed; create a new record for a new binding.' using errcode = '42501';
    end if;
  else
    if new.status <> 'active' or not exists (
      select 1 from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
      where m.organization_id = new.organization_id and m.user_id = new.user_id
        and m.member_kind = 'team' and m.status = 'active' and o.status = 'active'
        and (tg_table_name <> 'organization_contributor_designations' or m.role = 'contributor')
    ) then
      raise exception 'An active team membership (contributor for designation) is required.' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.n1_guard_compatibility_history() from public, anon, authenticated;
grant execute on function private.n1_guard_compatibility_history() to service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array['organization_department_memberships', 'organization_contributor_designations', 'project_manager_bindings'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant select, insert, update on public.%I to service_role', table_name);
    execute format('create trigger n1_preserve_history before insert or update or delete on public.%I for each row execute function private.n1_guard_compatibility_history()', table_name);
    execute format($policy$
      create policy n1_self_read on public.%I for select to authenticated
      using (user_id = (select auth.uid()) and exists (
        select 1 from public.organization_memberships m
        join public.organizations o on o.id = m.organization_id
        where m.organization_id = %I.organization_id and m.user_id = (select auth.uid())
          and m.member_kind = 'team' and m.status = 'active' and o.status = 'active'
      ))
    $policy$, table_name, table_name);
  end loop;
end; $$;

-- Deterministic one-time facts, not a continuing synchronization or permission grant.
insert into public.organization_department_memberships(id, organization_id, user_id, department_id, source, source_details)
select md5('n1:department:' || m.id::text || ':' || d.id)::uuid,
  m.organization_id, m.user_id, d.id, 'legacy_department',
  jsonb_build_object('membership_id', m.id, 'legacy_role', m.role, 'department_id', m.department_id)
from public.organization_memberships m
join public.organizations o on o.id = m.organization_id and o.status = 'active'
join public.departments d on d.id = m.department_id and d.organization_id = m.organization_id
where m.member_kind = 'team' and m.status = 'active';

insert into public.project_manager_bindings(id, organization_id, user_id, project_id, source, source_details)
select md5('n1:pm:' || p.id::text || ':' || m.id::text)::uuid,
  p.organization_id, m.user_id, p.id, 'verified_project_owner',
  jsonb_build_object('membership_id', m.id, 'legacy_role', m.role, 'project_owner_id', p.owner_id)
from public.projects p
join public.organizations o on o.id = p.organization_id and o.status = 'active'
join public.organization_memberships m on m.organization_id = p.organization_id
  and m.user_id = p.owner_id and m.member_kind = 'team' and m.status = 'active'
where p.archived_at is null and not exists (
  select 1 from public.engagements e where e.project_id = p.id
    and (e.organization_id <> p.organization_id or e.lead_owner_id is distinct from p.owner_id)
);

insert into private.n1_authority_backfill_issues(source_kind, source_id, organization_id, reason)
select 'membership', m.id, m.organization_id, 'legacy_department_unverified'
from public.organization_memberships m
where m.member_kind = 'team' and m.department_id is not null
  and not exists (select 1 from public.organization_department_memberships d
    where d.organization_id = m.organization_id and d.user_id = m.user_id and d.department_id = m.department_id)
union all
select 'membership', m.id, m.organization_id, 'legacy_elevated_role_not_reinterpreted'
from public.organization_memberships m where m.member_kind = 'team' and m.role in ('executive', 'project_owner')
union all
select 'project', p.id, p.organization_id, 'project_owner_unverified_or_absent'
from public.projects p where not exists (
  select 1 from public.project_manager_bindings b where b.project_id = p.id
);
-- No designation backfill: neither profile titles nor legacy executive prove it.

create function public.get_my_authority_compatibility(p_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare membership public.organization_memberships;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select m.* into membership from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = p_organization_id and m.user_id = auth.uid()
    and m.member_kind = 'team' and m.status = 'active' and o.status = 'active';
  if not found then
    raise exception 'Active team organization membership required.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'schema_version', 1, 'compatibility_only', true,
    'organization_id', membership.organization_id, 'user_id', membership.user_id,
    'membership_id', membership.id,
    'legacy_role', membership.role, 'legacy_department_id', membership.department_id,
    'department_memberships', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.department_id, d.created_at, d.id)
      from public.organization_department_memberships d
      where d.organization_id = p_organization_id and d.user_id = membership.user_id
    ), '[]'::jsonb),
    'contributor_designations', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at, d.id)
      from public.organization_contributor_designations d
      where d.organization_id = p_organization_id and d.user_id = membership.user_id
    ), '[]'::jsonb),
    'project_manager_bindings', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.project_id, b.created_at, b.id)
      from public.project_manager_bindings b
      where b.organization_id = p_organization_id and b.user_id = membership.user_id
    ), '[]'::jsonb)
  );
end; $$;
revoke all on function public.get_my_authority_compatibility(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_authority_compatibility(uuid) to authenticated;
comment on function public.get_my_authority_compatibility(uuid) is
  'Opt-in self-only compatibility history. Not effective permissions. Legacy enforcement is unchanged; no fallback or new grants are inferred.';

commit;
