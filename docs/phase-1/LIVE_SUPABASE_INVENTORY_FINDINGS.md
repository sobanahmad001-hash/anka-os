# Phase 1 Live Supabase Inventory Findings

Date: 2026-08-25

Project reference: `fhoxaogfjszftoqtnbav`

Status: structural inventory and exact row counts completed.

## Verified live state

| Area | Finding |
|---|---:|
| Public tables | 95 |
| Public-table RLS enabled | 95 of 95 |
| RLS policies | 208 |
| Tables with no RLS policy | 9 |
| Public functions | 4 |
| Security-definer functions | 4 |
| Public triggers | 3 trigger events on `tasks` |
| Supabase migration records | 1 |
| Authentication users | 5 |
| Storage buckets | 2 |
| Exact public rows | 128 across 25 non-empty tables |

The only recorded Supabase migration version is `20260319124658`.

## Confirmed architecture conflicts

The live database contains overlapping execution models:

- `clients` and `as_clients`
- `projects` and `as_projects`
- `tasks` and `as_tasks`
- `project_documents` and `as_project_documents`
- `notifications` and `as_notifications`

The live schema is not reproducible from committed migrations:

- 24 live tables were not found in committed `CREATE TABLE` statements.
- Four committed target tables are absent live: `ai_project_memory`, `documents`, `rules`, and `task_dependencies`.
- The repository contains many historical phase SQL files, while the live migration ledger records only one applied migration.

No historical phase SQL file is safe to apply blindly.

## Security findings

RLS is enabled on every public table, but enabling RLS alone does not establish correct isolation.

Nine tables have no policies and are therefore inaccessible through normal client requests unless a security-definer path bypasses them:

- `as_crm_signals`
- `as_project_phases`
- `department_metrics`
- `deployments`
- `issue_labels`
- `review_checks`
- `sprint_tasks`
- `system_health_logs`
- `user_activity_logs`

Several policies grant organization-wide or system-wide reads to any authenticated user, including records in `clients`, `client_projects`, `content_items`, `messages`, `comments`, `design_reviews`, and `review_comments`. These policies do not yet implement organization, project-membership, department, internal-only, or client-visibility boundaries required by the Release 1 authority.

The `departments`, `profiles`, and `environments` tables also contain policies with unconditional read expressions. These must be reviewed against intended internal and client roles.

All four public functions use `SECURITY DEFINER`:

- `can_access_task(uuid)`
- `handle_new_user()`
- `rls_auto_enable()`
- `update_project_progress()`

Their ownership, execute grants, and fixed `search_path` must be checked before relying on them for authorization.

The `sphere-deliverables` storage bucket is public. This conflicts with the rule that deliverables become client-visible only after an internal quality gate. It must not be used for controlled deliverables in its current public form.

## Data preservation status

The first inventory returned stale zero-row estimates. The exact follow-up count confirmed 128 public rows across 25 non-empty tables.

The active duplicate execution records include:

- generic core: two `projects` and two `tasks`;
- legacy Anka Sphere core: two `as_clients`, three `as_projects`, four `as_tasks`, and three `as_deliverables`;
- delivery reference data: two `as_wp_sites`, 20 `as_wp_pages`, 12 `as_project_pages`, and two `as_project_documents`;
- identity and AI history: five `profiles`, seven `ai_conversations`, nine `ai_messages`, two `as_assistant_threads`, and ten `as_assistant_messages`.

On 2026-08-25, the owner classified all 128 inventoried application rows as test data. They may be replaced through a reviewed reset migration. Authentication identities remain protected by default; test-data classification alone does not authorize deleting `auth.users` accounts.

## Safe next sequence

1. Run the additive organization/access foundation migration; do not rename or drop legacy tables.
2. Verify the migration and client-visibility gates in Supabase.
3. Capture function definitions, grants, storage policies, and remaining schema dependencies needed for the complete RLS matrix.
4. Reset disposable application records only after the exact table scope and verification query are reviewed.
5. Run read/write authorization tests for internal and client roles.
6. Migrate data and application reads in controlled batches.
7. Retire compatibility paths only after reconciliation and rollback checkpoints pass.
