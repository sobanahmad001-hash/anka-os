# RET3 Monthly Retainer Planning Review Gate

## Scope

RET3 adds the first retainer planning UI inside the canonical Project Engagement Workspace.
It composes existing RET1 plan/version/approval facts and RET2 manual occurrence generation
into one selected plan-local calendar month.

A period belongs to the month only when its canonical period_start falls in that month.
Each plan is interpreted in the immutable IANA timezone of the applicable approved version.

## Approved behavior

- Active organization team members keep existing read-only access to recurring-plan facts.
- Only the current Service Owner may preview or confirm periods.
- The Project Owner remains the authority for immutable plan-version approval and lifecycle.
- Reviews are read-only display of existing immutable plan-version approval facts.
- Exceptions are computed current-state warnings only. RET3 adds no failed, skipped, waived,
  or accepted occurrence state.
- Coverage is factual assignment/activity counts only: assigned, unassigned, active,
  inactive, and already-generated work. It adds no capacity, SLA, or performance policy.
- Month previews enumerate canonical weekly/monthly starts on the server and reuse the
  authoritative RET2 one-period preview for dates, eligibility, and work-item intent.
- Confirmation remains an explicit one-period action with a new request UUID and the
  existing bounded past-period reason.

## Security and collision boundaries

- The month-preview RPC is stable, security-invoker, service-role-only, and performs no write.
- Organization is derived from the selected plan/project, never from a browser-selected
  active organization.
- RET3 adds no table and changes no RLS policy, work-item constraint, or provenance value.
- WCH Department Chat profiles and actions remain untouched.
- QTS promotion rows remain separate; RET3 counts generated work only when recurring
  provenance is present and created_via is recurring_plan.
- Existing Project Tasks and Engagement Work Items remain distinct.

## Verification

- Migration: 20260903185206_ret3_monthly_planning_preview.sql
- Rollback verifier: verify_20260903185206_ret3_monthly_planning_preview.sql
- Focused Node model/contract tests and Deno normalization tests
- Full Node tests
- Full frozen CI-listed Deno tests and type-check
- Lint with zero errors
- Production build
- RET1 + RET2 + RET3 disposable PostgreSQL execution and all named rollback checks
- git diff --check
- Exact merge-base and exact-head CI before any authorized merge

## Explicitly out of scope

No RET4 scheduler, Cron, scheduled local clock, DST gap/fold conversion, notifications,
automatic or bulk catch-up, occurrence acceptance, durable exception workflow, Quick Task
promotion change, Department Chat change, live database operation, deployment, or merge.

Manual-generation reliability must remain proven by RET2's advisory serialization,
plan-period uniqueness, stable request replay, and injected partial-failure rollback checks.
RET3 does not weaken or replace those gates.
