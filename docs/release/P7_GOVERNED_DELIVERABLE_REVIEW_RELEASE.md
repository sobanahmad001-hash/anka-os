# P7 — Governed deliverable review and release

## Review identity

- Branch: `feat/p7-governed-deliverable-release`
- Required base: `f0494186dc5c05c942f36bacd7c81e3122fdf0f6`
- Publication, live database work, merge, and deployment are excluded from this local package.
- Coordinator-reserved migration timestamp: `20260904130000`, immediately after P5 `20260904120000`.

## Delivered contract

- The server derives organization, project, deliverable, workstream, and client from the exact immutable deliverable version.
- New assignment, lifecycle, and replay tables use composite tenant foreign keys, explicit grants, RLS, and append-only evidence.
- Submission names one eligible reviewer. There is no open claim path, creator/owner self-review, or browser override.
- Only the current named reviewer decides. Department managers may review their department but cannot release.
- System owners, operations admins, executives, and the exact Project Owner may release and record closure evidence.
- Formal client decisions require an active `client_admin` or `client_approver` membership plus matching active client contact and exact-project access.
- Create, submit, assign/reassign, review, release, client decision, delivered, and published are separate atomic RPCs.
- Every action requires `state_version` and a request ID. Exact retries replay; changed payloads conflict.
- `client_approval_required` defaults false and becomes immutable on first release. Release may precede approval; closure requires exact-version approval only when both the flag and organization feature are enabled.
- Delivered and published are independent append-only facts. A legacy `delivered_published` row receives delivered plus a legacy marker and never an invented published event.
- Browser consumers render actions from server capability flags; they do not infer authority from profile roles.

## Integration correction found by PostgreSQL verification

The existing delivery activity trigger authorized team actors against one seeded organization literal. That made a valid governed action fail for every other organization. P7 preserves the trigger's existing activity and notification behavior but derives membership authorization from the exact project's organization. The rollback verifier proves a non-seeded organization completes the lifecycle and that an actor from another organization cannot read capability data.

## Exact file scope

P7-owned:

- `supabase/migrations/20260904130000_p7_governed_deliverable_release.sql`
- `supabase/verify_20260904130000_p7_governed_deliverable_release.sql`
- `src/data/deliverableGovernance.js`
- `src/data/deliverableGovernance.test.js`
- this review gate

Shared P4 delivery consumers, frozen pending P5 overlap reconciliation:

- `src/apps/MyWork.jsx`
- `src/apps/AnkaSpherePortal.jsx`
- `src/data/deliveryRepository.js`
- `src/data/clientApprovals.js`
- `src/data/myWorkRoutes.test.js`
- `src/data/clientPortal.test.js`

No Edge Function, routing, authentication, organization-provider, P5 planning, or deployment file is changed.

## Verification evidence

- Node: 706/706 passed.
- Deno: 283/283 passed with cached dependencies.
- Deno type-check: all 25 Edge Function entrypoints passed.
- ESLint: 0 errors; 441 pre-existing warnings.
- Production build: passed.
- PostgreSQL 17: migration compiled and committed in a dedicated disposable database.
- Rollback verifier: 28/28 named checks passed; final `ROLLBACK` preserved no fixtures.
- No shared or live database was contacted.

The verifier covers RLS, ACLs, fixed function search paths, composite foreign keys, one-current-reviewer uniqueness, append-only evidence, graph derivation, exact replay, changed-payload conflict, self-review denial, department eligibility, reviewer revalidation after assignment, no open claim, department-manager release denial, Project Owner release, optional post-release client approval, approval-gated closure, independent delivered/published facts, tenant isolation, and content-free replay records.

## Remaining release gates

1. Reconcile P5's selected implementation and confirm exact shared-file overlap.
2. Rebase P7 onto the resulting current `origin/main`.
3. Assign the coordinator-ordered migration timestamp and update migration/verifier references once.
4. Repeat the complete local and disposable-PostgreSQL gate on the rebased exact head.
5. Publish only after Admin authorizes the final reviewed commit.
