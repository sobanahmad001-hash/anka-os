# P5 Planning + Work Management Review Gate

## Approved outcome

P5 adds one project planning surface over a discriminated `(recordKind, id)` collection while retaining two canonical work systems:

- Project Tasks retain their eight-state lifecycle, deterministic `due_date ASC NULLS LAST, created_at ASC, id ASC` order, and no manual reorder.
- Engagement Work Items retain their four-state lifecycle and native position order.
- No status translation, persisted normalized status, cross-type drag, dependency, or mutation is introduced.
- List, board, due-date calendar, workload, assignment, scheduling, department handoff, and dependency visibility are connected inside the existing Project Workspace.
- Date-only values are displayed exactly as stored.

## Timezone contract

- `clients.default_timezone` is nullable.
- `projects.planning_timezone` is nullable.
- Client work resolves project override → client default → UTC.
- Internal work resolves project override → UTC and cannot inherit a client timezone.
- Inheritance is dynamic; no snapshot or backfill is created.
- Values must be exact names from PostgreSQL `pg_timezone_names`; invalid values use SQLSTATE `22023`.
- Only an active System Owner or Operations Admin may write either timezone.
- Retainer recurrence and its immutable version timezone are unchanged.

## Concurrency contract

- `tasks.row_version` and `work_items.row_version` are positive, database-managed counters.
- Every P5 mutation supplies the loaded version.
- Stale writes return SQLSTATE `40001`, mapped to a typed HTTP-style 409 in the repository. The screen refreshes while retaining the user's local editor values for deliberate reapplication.
- Project Task transitions still pass through the existing eight-state transition trigger.
- Engagement Work Item board moves lock one engagement in stable ID order and rewrite only the target column inside one transaction.

## Security

All reads remain scoped to the selected organization. The new RPCs are `SECURITY INVOKER`, have an empty search path, deny PUBLIC and `anon`, and require active organization/team context. Assignees must be active team members. Work Item handoff departments must belong to the organization. Existing RLS remains enabled on all four altered tables.

## Exact files

- `docs/release/P5_PLANNING_WORK_MANAGEMENT_REVIEW_GATE.md`
- `src/apps/ProjectEngagementWorkspace.jsx`
- `src/components/ProjectPlanningPanel.jsx`
- `src/data/internalProjectSetup.test.js`
- `src/data/planningModel.js`
- `src/data/planningModel.test.js`
- `src/data/planningRepository.js`
- `src/data/planningRepositoryFactory.js`
- `src/data/projectEngagementWorkspaceModel.js`
- `src/data/projectEngagementWorkspaceRepository.js`
- `supabase/migrations/20260904120000_p5_unified_planning.sql`
- `supabase/verify_20260904120000_p5_unified_planning.sql`

The P3 test edit replaces an obsolete assertion that P3 must forever be the final migration with an exact assertion that P5 follows P3.

## Explicitly out of scope

No P6 retainer behavior, P7 review/deliverable behavior, P8 records/collaboration behavior, Workshop code, recurrence cadence, notification policy, new dependency schema, cross-type drag, status convergence, backfill, live database work, deployment, merge, or publication.

## Verification

- Focused Node tests: 14/14 passed.
- Full Node suite: 707/707 passed.
- Frozen Deno suite: 259/259 passed.
- Frozen Deno checks: all configured source and test entrypoints passed.
- Lint: 0 errors; warnings are recorded from the repository's warning-only rules.
- Production build: passed (419 modules).
- PostgreSQL 18 native parser: migration and rollback verifier both passed.
- Runtime PostgreSQL verifier: pending because no local PostgreSQL or Docker runtime is installed. It must run rollback-safe before any permanent apply.
- Signed-in browser walkthrough: pending final testing.
