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
- Stale writes return SQLSTATE `40001` with exact record kind, record ID, expected version, and current version fields; the Edge boundary maps them to HTTP 409. Editors retain local intent for deliberate reapplication after refresh.
- Project Task transitions still pass through the existing eight-state transition trigger.
- Engagement Work Item board moves use one engagement-scoped advisory lock plus stable row locking, rewrite only the target column inside one transaction, and return every changed row.

## Security

All reads remain scoped to the selected organization. Mutation RPCs are service-role-only behind the authenticated `work-items` Edge boundary; they are `SECURITY INVOKER`, have an empty search path, deny PUBLIC, `anon`, and `authenticated`, authorize the selected organization before record/version lookup, and require active organization/team context. Their two private helpers are executable only by `service_role`. Assignees must be active team members. Existing RLS remains enabled on all four altered tables.

## Exact files

- `docs/release/P5_PLANNING_WORK_MANAGEMENT_REVIEW_GATE.md`
- `src/apps/ProjectEngagementWorkspace.jsx`
- `src/apps/CanonicalProjects.jsx`
- `src/apps/DepartmentWorkshop.jsx`
- `src/apps/ExternalEvents.jsx`
- `src/apps/MyWork.jsx`
- `src/components/ProjectPlanningPanel.jsx`
- `src/components/WorkItemsPanel.jsx`
- `src/data/automationRules.test.js`
- `src/data/deliveryRepository.js`
- `src/data/deliveryRepository.test.js`
- `src/data/internalProjectSetup.test.js`
- `src/data/planningModel.js`
- `src/data/planningModel.test.js`
- `src/data/planningRepository.js`
- `src/data/planningRepositoryFactory.js`
- `src/data/projectEngagementWorkspaceModel.js`
- `src/data/projectEngagementWorkspaceRepository.js`
- `src/data/workItems.js`
- `src/data/workItemsRepository.js`
- `scripts/p5-planning-concurrency.ts`
- `supabase/functions/work-items/index.ts`
- `supabase/functions/work-items/index.test.ts`
- `supabase/migrations/20260904120000_p5_unified_planning.sql`
- `supabase/verify_20260904120000_p5_unified_planning.sql`

The P3 test edit replaces an obsolete assertion that P3 must forever be the final migration with an ordered-neighbor assertion: P3 exists exactly once and precedes P5, while later migrations remain valid. P7 owns later My Work/delivery governance changes and reserved `20260904130000`; P5 owns only the version-aware Project Task transition contract those changes must preserve.

## Explicitly out of scope

No P6 retainer behavior, P7 review/deliverable lifecycle behavior, P8 records/collaboration behavior, recurrence cadence, notification policy, new dependency schema, cross-type drag, status convergence, backfill, live database work, deployment, merge, or publication. Existing Workshop/My Work/Work Item mutation callers change only to carry selected organization and expected row version through the one governed boundary.

## Verification

- Focused shared-consumer tests: 29/29 passed.
- Full Node suite: 709/709 passed.
- Frozen Deno suite: 285/285 passed.
- Frozen Deno checks: all 36 Edge source entrypoints plus every P5-changed test/script passed.
- Lint: 0 errors; 453 pre-existing warning-only findings.
- Production build: passed (419 modules).
- PostgreSQL 17: the ordered migration applied cleanly to a disposable exact-schema clone.
- Rollback verifier: all 55 named checks returned true and the transaction ended in `ROLLBACK`.
- Two-session PostgreSQL 17 proof: the competing Project Task mutation waited then received the exact typed stale payload; concurrent Work Item moves serialized and produced one unique final order. Its random clone was dropped.
- Signed-in browser walkthrough: pending final testing.
