# RET4 local review gate

Status: local implementation verified; Admin release review required. No publication or activation authorized.

## Scope and operational contract

- Base: c30b4fab1cf95ed2eec88f7c211e05a2d9cd3607. Branch: ret4-scheduled-recurrence.
- Migration: supabase/migrations/20260903195540_ret4_scheduled_recurrence.sql.
- Service Owner drafts a new immutable version with an explicit scheduler object:
  `{"scheduler":{"enabled":true,"local_time":"09:00","policy":"ret4_v1"}}`.
  09:00 is only a suggestion. Empty/legacy definitions never enroll; no existing version is backfilled. Project Owner approval remains required.
- Authenticated machine endpoint `recurring-scheduler` accepts one action/target per request:
  `{"action":"admit","planId":"<uuid>","periodStart":"YYYY-MM-DD"}`, then
  `{"action":"execute","admissionId":"<uuid>"}`.
- Identity comes from verified Auth getUser(), never a submitted owner/actor or clock. Database RPCs remain service-role-only SECURITY INVOKER.
- There is no due-discovery/dispatch loop, Cron configuration, credential, machine provisioning or deployment in this change. An Admin-approved future runner must submit individual canonical periods. Config registration is code-only; package bulk-deploy commands were not expanded.

## Approved authorization exception

Only private.assert_recurring_scheduler(uuid,uuid) is SECURITY DEFINER, owned by the migration owner with empty search_path. Its explicit actor/org checks reject missing/disabled bindings, any human membership, deleted/banned accounts, inactive organizations and wrong-tenant bindings. It holds SELECT FOR SHARE locks on binding, auth user and organization. It grants only service_role EXECUTE after explicit revocation from PUBLIC/anon/authenticated/service_role. No direct auth.users access or registry UPDATE grant is added. The service role still cannot read auth.users.

The Edge function verifies the identity before supplying the explicit actor to trusted RPCs; the helper is private and intentionally does not treat the service-role JWT as a human auth.uid(). This is the narrow exception explicitly reviewed by Admin, not a general privilege escalation of the public actions.

## Timing, safety and evidence

- First admission: [due, due+5 minutes), on that plan-local day; approval and activation must both predate due strictly.
- Admission is immutable, with retry deadline min(admission+15 minutes, next local midnight). Retries never extend it.
- Clock predicates have explicit internal time parameters solely for exact tests; public RPCs always supply clock_timestamp().
- Inactive plan/context, changed applicable version, status transition or exhausted window closes execution to manual review.
- Applicable version: effective_start descending, then version_number descending, effective_end inclusive.
- Existing occurrences retain original IDs and recorded version. Manual and scheduled generation use the same plan-period advisory lock.
- Every work batch is atomic. Failures roll back business rows; admission and failure evidence survive in separate transactions. A final deadline/authority check protects batch completion.
- No automatic catch-up, carryover, bulk generation, notifications, RET5 UI or scheduler reporting.
- DST gaps resolve to first valid instant, folds to earlier instant; weekly anchors and month clamps reuse RET2 logic.

## Verification completed locally on 2026-09-04

| Gate | Result |
| --- | --- |
| Complete migration on fresh schema-only local PostgreSQL database | Passed |
| RET4 clock/security/rollback diagnostic | 16/16 |
| Actual service_role behavioral + concurrent-session suite | 40/40 |
| Existing RET2 rollback regression | 29/29 |
| Existing RET3 rollback regression | 9/9 |
| Node tests, including 5 RET4 contracts | 458/458 |
| Updated configured Deno tests | 149/149 |
| Updated configured Deno checks | Passed |
| Lint | 0 errors; 347 existing frontend warnings |
| Production build | Passed |
| Whitespace check | Passed |

The behavioral suite proves observed database lock waits, not merely sequential requests: manual-first and scheduler-first each create exactly one occurrence/two work items; disable/ban wait for share locks and then reject admission; pause waits behind execution and closes subsequent execution. It also covers actual service-role identity/tenant denial, foreign-member RLS, immutability, precise admission/retry predicates, late approval, version precedence/end dates, replay identity, lifecycle/assignee/context eligibility, missed-period human recovery, injected second-item failure with full rollback and successful retry, and deadline-crossing rollback.

The standalone diagnostic rolls back its synthetic identity/binding and verifies absence afterwards. The behavioral suite intentionally retains synthetic fixtures only in the disposable local cluster for review. Its injected failure trigger is removed on successful completion. No production rows are imported.

## Reproduction and release hold

Local Windows harness: `node scripts/verify-ret4-local.mjs`, with `RET4_TEST_DATABASE=ret4_clean_20260904` for the freshly migrated database. It pins host 127.0.0.1, port 55444, login ret4_admin and allowlists only ret4/ret4_clean_20260904. It reads the isolated cluster password privately from the sibling .qa directory and reuses PostgreSQL binaries read-only; it never connects to the QTS database. Never run the fixture SQL against shared/live systems.

Run supabase/verify_ret4_clock_and_runtime_gate.sql with psql ON_ERROR_STOP against the isolated database after applying the migration. It returns nonzero after rollback if a gate fails. The full behavioral harness is not automatically run against hosted CI databases.

Hosted Supabase advisors, remote exact-head CI, current-main integration and live scheduling are not claimed. No shared/live database or migration history was changed. Initial fixture mistakes (SQL delimiter/address format and unsupported membership status) were corrected and the final full suite rerun successfully; initial permission failures remain documented in local history.

Admin must coordinate this unapplied migration with QTS5, PLN2 and WCH before release and assess the final current-main diff. No ledger repair or independent renumbering. This RET4 task made no RET5 changes. RET5 independently advanced from the earlier observed 1121088e0084c19c054c4c6a0ee3ea5a0b399022 to a clean ret5-retainer-review at 56a62bc08336b270a321224251eb8b58fd278cff during verification; that is an observation, not work performed here. The exact resulting local RET4 commit and database stop status are recorded outside the repo in .qa/RET4_CURRENT_STATE.md.
