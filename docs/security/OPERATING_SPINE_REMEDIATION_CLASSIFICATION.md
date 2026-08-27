# Operating Spine security remediation classification

Date: 2026-08-27

Status: classification completed before remediation policy authoring.

## Evidence reviewed

- Live RLS state, table grants, policies, exact row counts, columns, and foreign keys.
- Supabase security advisors, including GraphQL exposure, callable
  `SECURITY DEFINER` functions, and Auth password protection.
- Active React and Edge Function references in this repository.
- Historical migrations describing the retired or incomplete subsystems.

All eleven no-policy tables named in the execution brief currently contain zero
rows.

## No-policy table classification

| Table | Classification | Reason |
|---|---|---|
| `design_reviews` | Service-role-only, retired | Replaced by canonical deliverables, immutable versions, approvals, and comments. Browser grants were already revoked. |
| `review_comments` | Service-role-only, retired | Child of the retired design review subsystem. Browser grants were already revoked. |
| `deployments` | Service-role-only, legacy | No organisation key and no active UI; the former route redirects to the Development department workspace. |
| `review_checks` | Service-role-only, legacy | No organisation key and no active client repository. External CI ingestion must use a server boundary. |
| `sprint_tasks` | Service-role-only, legacy | No organisation key and no active client repository. It cannot be safely exposed through an organisation-scoped policy. |
| `issue_labels` | Service-role-only, legacy | No organisation key and no active client repository. It inherits an incomplete legacy development model. |
| `department_metrics` | Service-role-only, system aggregate | No organisation key. Operational aggregates must be produced and projected by a trusted server process. |
| `system_health_logs` | Service-role-only, sensitive operations | Contains internal health telemetry and no organisation key. |
| `user_activity_logs` | Service-role-only, sensitive audit data | Contains user/resource metadata and no organisation key. Use the canonical organisation-scoped audit records instead. |
| `as_crm_signals` | Service-role-only, legacy outbox | No active application reference; tied to the retired `as_*` client/project model. |
| `as_project_phases` | Service-role-only, legacy execution | Tied to the retired `as_projects` model and lacks organisation scope. One stale Admin Dashboard update remains, but RLS already prevents it; opening the table would create a cross-organisation risk. |

The remediation migration must revoke browser-role privileges for every table in
this list and must not add authenticated policies to organisation-less legacy
data.

## `environment_variables`

The live table contains zero rows. No active React or Edge Function references
it; only the historical Phase 13 SQL defines it. It is classified as legacy and
unused. It must remain service-role-only, and no row may be written until a new
organisation-scoped model and explicit access policy are reviewed.

## GraphQL exposure

The active application uses Supabase REST, Auth, Realtime, Storage, and Edge
Functions. It contains no GraphQL request path. Supabase derives REST and
GraphQL table visibility from the same PostgreSQL table grants, so revoking
`authenticated SELECT` table-by-table would also break the existing RLS-gated
REST application.

The safe remediation is therefore to revoke `anon` and `authenticated` access
to the `graphql.resolve` execution boundary while preserving the explicit table
grants required by REST. Supabase's static per-table GraphQL lint can continue
to report the underlying table grants; the verification requirement is that
browser roles cannot execute the GraphQL resolver.

## Callable `SECURITY DEFINER` functions

| Function | Result |
|---|---|
| `is_organization_member(uuid)` | Boolean only; binds the lookup to `auth.uid()`, active membership, and the supplied organisation. A caller learns only whether their own identity belongs to the organisation they supplied. |
| `is_team_organization_member(uuid)` | Boolean only; additionally requires `member_kind = 'team'`. A caller learns only whether their own identity is an active team member. |
| `has_organization_role(uuid, text[])` | Boolean only; binds role lookup to `auth.uid()` and active membership. A caller learns only whether their own membership contains one of the supplied roles. |
| `can_access_task(uuid)` | Requires remediation. Its department-head branch checks department but not organisation, so it can disclose cross-organisation task existence. Replace it with an organisation-membership-aware definition. |

All four helpers must retain an empty fixed `search_path`, deny anonymous
execution, return `false` for both nonexistent and unauthorised targets, and
never include target-row data or distinct error messages. Authenticated execute
remains intentional because the existing RLS policies invoke these helpers.

## Auth configuration

Supabase advisors confirm leaked-password protection is disabled. Enabling it
changes live Auth configuration and is therefore held for the explicit
production sign-off required by the Operating Spine execution brief.
