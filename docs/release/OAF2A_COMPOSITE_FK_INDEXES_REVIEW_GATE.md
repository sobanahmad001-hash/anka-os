# OAF2a Composite Foreign-Key Indexes — Review Gate

Status: branch-only performance follow-up. Do not merge or apply the migration until Admin/Testing approves it.

## Scope

- Add exact child-side indexes for the three composite foreign keys introduced by OAF2.
- Preserve the OAF2 schema, constraints, RLS, functions, and application behavior.
- Provide a rollback-safe verifier that inspects index validity, readiness, predicates, column order, retained indexes, and foreign keys.

## Index plan

| Child table | Foreign-key columns | OAF2a covering index |
| --- | --- | --- |
| `artifacts` | `(engagement_id, project_id, organization_id)` | `idx_artifacts_engagement_project_organization` |
| `work_items` | `(engagement_id, project_id, organization_id)` | `idx_work_items_engagement_project_organization` |
| `ai_runs` | `(engagement_id, project_id, organization_id)` | `idx_ai_runs_engagement_project_organization` |

## Redundancy audit

- Keep `idx_artifacts_project`: it leads with `project_id`, orders by `created_at desc`, and is partial. It serves project-history reads and cannot cover an FK lookup led by `engagement_id`.
- Keep `idx_work_items_project_active`: it leads with `project_id`, orders by `position`, and excludes deleted rows. It serves active project queues and cannot cover the composite FK.
- Keep `idx_work_items_engagement_fk`: `(engagement_id, organization_id)` supports lookups that do not supply `project_id`. The OAF2a index places `project_id` second, so it does not preserve the existing index's two-column prefix.
- Keep `idx_ai_runs_engagement_created`: it orders engagement history by `created_at desc` and excludes redacted rows. The new index does not preserve that ordering or predicate.
- Drop `idx_ai_runs_engagement_project`: its partial `(engagement_id, project_id)` key is the exact leading prefix of the new full `(engagement_id, project_id, organization_id)` index. The new index supports every equality lookup supported by the old key while also covering the FK; retaining both would duplicate maintenance cost.
- No existing artifact or work-item index begins with the complete FK column sequence.

## Required evidence

- Focused and full Node tests.
- `npm run lint` and `npm run build`.
- `git diff --check`.
- Supabase linked migration dry-run only; never a push from this task.
- Exact-head CI.
- After Admin/Testing applies the migration, run `supabase/verify_20260903060726_oaf2a_cover_composite_fks.sql` and retain all named results.

## Recorded branch evidence

- Base ancestry: branch created directly from current `origin/main` at deployed OAF2 merge `73f20f098f3d8c7922452b7232bcdbf8210b8420`.
- Official Supabase changelog reviewed; no current breaking change affects ordinary PostgreSQL B-tree index creation or catalog verification.
- Live read-only catalog audit confirmed every current index definition on `artifacts`, `work_items`, and `ai_runs` before the plan was finalized.
- Live read-only probe confirmed the verifier's catalog expression returns the existing AI index key as `{engagement_id,project_id}`, marks it valid/ready, and detects its partial predicate.
- Focused OAF2a structural tests: 3 passed, 0 failed.
- Full Node suite: 350 passed, 0 failed.
- ESLint: 0 errors; 284 pre-existing warnings.
- Production build: passed (343 modules transformed).
- `git diff --check`: passed.
- Supabase CLI `2.115.0` linked migration dry-run: passed and reported only `20260903060726_oaf2a_cover_composite_fks.sql` pending; no database push was performed.
- Local migration-ledger verification is unavailable because the local PostgreSQL runtime is not running on this host.
- Exact-head CI is required after the branch is pushed.

## Rollout boundary

This task must not apply the migration, merge the pull request, or deploy any application component. Admin/Testing owns the live apply and post-apply advisor verification.
