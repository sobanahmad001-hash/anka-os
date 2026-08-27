-- Anka OS - Operating Spine prerequisite security remediation.
-- Classification: docs/security/OPERATING_SPINE_REMEDIATION_CLASSIFICATION.md

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- These empty legacy/system tables do not carry a trustworthy organisation
-- key. Keep them available only to trusted server-side processes rather than
-- inventing a broad browser policy.
revoke all privileges on
  public.deployments,
  public.design_reviews,
  public.review_checks,
  public.review_comments,
  public.sprint_tasks,
  public.system_health_logs,
  public.user_activity_logs,
  public.department_metrics,
  public.as_crm_signals,
  public.as_project_phases,
  public.issue_labels,
  public.environment_variables
from anon, authenticated;

grant all privileges on
  public.deployments,
  public.design_reviews,
  public.review_checks,
  public.review_comments,
  public.sprint_tasks,
  public.system_health_logs,
  public.user_activity_logs,
  public.department_metrics,
  public.as_crm_signals,
  public.as_project_phases,
  public.issue_labels,
  public.environment_variables
to service_role;

-- Anka OS does not use GraphQL. Disable the GraphQL execution boundary for
-- browser roles while preserving the table grants used by REST + RLS. The
-- guard keeps fresh projects valid after pg_graphql stops being enabled by
-- default.
do $$
begin
  if to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)') is not null then
    execute 'revoke execute on function graphql.resolve(text,jsonb,text,jsonb) from public, anon, authenticated';
    execute 'grant execute on function graphql.resolve(text,jsonb,text,jsonb) to service_role';
  end if;
end
$$;

-- Preserve the existing authorization shape but require active membership in
-- the task's organisation before any role/department/ownership branch can
-- succeed. Missing and unauthorised task IDs both return false.
create or replace function public.can_access_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks task
    where task.id = p_task_id
      and task.organization_id is not null
      and public.is_team_organization_member(task.organization_id)
      and (
        exists (
          select 1
          from public.organization_memberships membership
          where membership.organization_id = task.organization_id
            and membership.user_id = (select auth.uid())
            and membership.member_kind = 'team'
            and membership.status = 'active'
            and membership.role in (
              'system_owner',
              'operations_admin',
              'executive'
            )
        )
        or task.user_id = (select auth.uid())
        or task.assigned_to = (select auth.uid())
        or exists (
          select 1
          from public.profiles profile
          where profile.id = (select auth.uid())
            and profile.role = 'department_head'
            and profile.department = task.department_id
        )
      )
  );
$$;

revoke all on function public.can_access_task(uuid) from public, anon;
grant execute on function public.can_access_task(uuid)
  to authenticated, service_role;

comment on function public.can_access_task(uuid) is
  'RLS helper. Returns only whether the current authenticated team member can access the task; never exposes target data.';

comment on table public.environment_variables is
  'Legacy and unused as of 2026-08-27. Service-role-only; do not write rows without a reviewed organisation-scoped replacement.';

commit;
