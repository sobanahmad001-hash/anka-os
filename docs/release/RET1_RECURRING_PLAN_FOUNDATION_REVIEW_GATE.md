# RET1 recurring-plan foundation review gate

## Decision scope

RET1 is additive foundation only: recurring plan headers, immutable versions and template items, append-only approvals, lifecycle transitions, audit events, read repositories, and five narrowly scoped server actions. It does not create occurrences, calculate dates, expose a calendar/planning UI, run a scheduler, send notifications, or converge `tasks` and `work_items`.

## Approved invariants

- Cadence is limited to `weekly` and `monthly`.
- Every plan belongs to one canonical project, its 1:1 retainer engagement, and one activated engagement service.
- The plan timezone is an IANA timezone validated by PostgreSQL's timezone catalogue.
- The current engagement-service `owner_id` drafts plans and versions.
- The canonical project `owner_id` approves versions and changes lifecycle state.
- Existing active team membership is required; RET1 introduces no global role or permission vocabulary.
- The matching service department manager handles internal template reassignment by creating a new immutable version; the project owner must still approve it.
- Browser clients can read organization-scoped rows under RLS but cannot write tables or execute mutation RPCs directly.

## Unresolved generation semantics (explicitly deferred)

`schedule_definition`, `start_offset_days`, and `due_offset_days` are stored as immutable intent. RET1 deliberately does not define or guess weekly anchor interpretation, monthly short-month behavior, daylight-saving behavior, catch-up behavior, idempotency keys, or occurrence windows. RET2 must resolve and approve these rules before implementing manual generation. Scheduled generation remains disabled.

## Required pre-merge evidence

- [ ] Branch merge-base and starting HEAD equal the recorded `origin/main` SHA.
- [ ] Migration is exactly `20260903071706_ret1_recurring_plan_foundation.sql`.
- [ ] Full Node tests, lint, and production build pass.
- [ ] Full CI-listed Deno tests and type-check pass at exact PR head.
- [ ] Local migration reset and rollback-safe verifier pass without retained test data. The verifier must emit its complete named result before failing, if any check fails.
- [ ] SQL diff review shows only intended additive objects plus the audit vocabulary extension.
- [ ] Linked migration dry-run succeeds; no migration is applied to a remote database.
- [ ] PR review confirms no occurrence generation, cron/scheduler, notification, UI, or task/work-item convergence code.

## Rollout boundary

This pull request must not be merged, deployed, or applied as part of RET1 implementation. A later authorized rollout must run the matching verifier immediately after migration and stop on any failed check.

The rollback verifier creates fresh rollback-only `auth.users` identities and representative data for two organizations inside a transaction, without reading or changing real user memberships. It exercises service-owner creation, project-owner approval and lifecycle authority, department-manager immutable reassignment, wrong-role and cross-organization rejection, validation constraints, append-only guards, and audit events, then always ends in `ROLLBACK`. Its catalog checks cover the complete anon/authenticated/service-role ACL matrix across all four tables and five RPCs, the exact SELECT-only RLS policies, and every named tenant-composite foreign key with its supporting index.

Because the implementation host has no Docker or Podman, a full local `supabase db reset` could not be run. The migration and verifier were instead executed against a disposable embedded PostgreSQL instance, and the linked CLI dry-run identified only the reserved RET1 migration. This does not replace rollout verification.

After a separately authorized migration application, Admin must run `supabase/verify_20260903071706_ret1_recurring_plan_foundation.sql`, capture its named JSON result at the applied commit SHA, and persist that result in the release evidence record. A failed or missing persisted result blocks rollout completion.
