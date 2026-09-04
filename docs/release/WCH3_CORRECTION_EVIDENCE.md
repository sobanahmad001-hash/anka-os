# WCH3 correction evidence

Historical correction evidence for feat/wch3-proposals. Following the final local rebase, current origin/main and merge-base are 2047cb6546a4a174e2bb7874f96da1aae814fe09; the four WCH commits are dbdbf84, a48d6a6, e5a31b1, and b8c8322. Pre-rebase identities in earlier handoffs are historical only. Obtain the exact final identity with git rev-parse HEAD. No WKS-owned screen, shared authentication helper, historical migration, or save_work_item signature changed.

## Identity and result UI

DepartmentChat now keys its state by user, selected organization, organization scope revision, engagement, and department. It refuses missing/mismatched selected organization context. A disposed/aborted completion guard suppresses late preview, decision, official-record fetch, error, busy-state, and refresh callbacks. Development also has an explicit engagement/organization key. Nine behavioral asynchronous guard tests cover engagement/department/user/organization A-to-B changes, late decisions, newer requests, and organization aborts. These test the guard used by the component; they are not browser-driven React interaction tests.

Terminal outcomes survive HTTP errors and replace pending state. Expiry removes controls on a timer. Accepted ID links fetch the exact artifact version or work item through RLS and the selected organization, displaying the saved record within WCH. This needs no changes to WKS routes or screens.

## Authorization and SQL execution

All three proposal RPCs explicitly require an active organization and active team authority. Proposal SELECT policy explicitly checks organization activity. The edge authentication boundary also checks it. The new attempt-audit RPC checks active organization/team membership. Service-role calls are subject to these explicit RPC checks; service_role itself remains the trusted BYPASSRLS database role and raw administrative table access is not redefined.

Local runtime: portable PostgreSQL 17, separate cluster under .qa/wch3-postgres-local, bound to 127.0.0.1:55436, database wch3_test. Baseline: Admin's existing production-schema-only.dump plus synthetic reference rows. No production row export or live database call occurred. The migration applied successfully, then the final save RPC definition was reapplied during local iteration.

Verifier: 25 named checks PASS; final ROLLBACK executed. It creates four synthetic organizations, actors, canonical client/project/engagement/brand roots, services and connectors. It tests all 26 allowed targets with actual service_role calls: preview, confirm, replay, reject, stale, expiry, and injected atomic failure. It also tests authenticated/anon RPC denial, proposer-only enforcement, cross-tenant/client/revoked actors, original-proposer revocation/client conversion, inactive organizations, RLS reads, exact tenant-safe audit foreign-key/index definitions, rejection of cross-organization proposal/AI-run audit references, and an authoritative approved-context mutation between preview resolution and confirmation with zero official writes. The source snapshot contains 24 protected sentinel rows across tasks, artifacts, versions, approvals, work items and stages. Every public source table is compared after execution; only the expected WCH/canonical/audit additions are permitted, and existing rows must remain identical.

The local dump is a runtime compatibility baseline, not independently proven identical to every catalog on the final 2047cb6 base. Admin must still verify the exact release schema and final commit. No claim of release approval is made.

## Audit and provenance

A WCH-owned department_chat_audit_events table provides the closed preview_requested/generated/blocked/failed, confirmed/rejected/expired/stale, replay, official_record_created and atomic_failure vocabulary. Only identifiers and bounded reason codes are stored. Shared engagement-event enums are unchanged. Decisions and official-write events are recorded within the same transaction; a nested transaction rolls back partial canonical writes before recording atomic_failure. Work-item engagement-event payloads now include proposal_id and ai_run_id. Artifact events already carry both. Accepted replay no longer depends on a connector still being available.

WCH AI runs retain no raw prompt or raw provider-output copies. The proposal keeps validated output and prompt length/digest. Configuring retention periods for those retained proposal payloads remains the pre-existing product decision; this patch adds no purge schedule. Unauthenticated requests and actors without active organization membership are denied before the tenant-owned attempt-audit RPC; this does not create an anonymous security-log system.

## Final local gates

- Node: 469 passed, 0 failed.
- Frozen full CI Deno suite: 178 passed, 0 failed, including 48 WCH tests; full frozen type-check passed.
- Lint: 0 errors, 350 warnings. One additional warning is the scoped JSX component under the repository's existing unused-variable configuration.
- Production build: passed, 369 modules.
- Local SQL verifier: 25 named checks passed with populated sentinels, all changes rolled back.
- Diff whitespace gate: checked before commit.

## Remaining coordination and acceptance

The inherited hard-coded ORGANIZATION_ID in the edge function is unchanged. It limits WCH to the existing configured organization; extending WCH to selected organizations requires a separately coordinated server-scope change. The new UI refuses mismatched engagement/selected organization and the server still derives canonical ownership within its configured organization. This limitation must not be described as multi-organization support.

Admin owns independent exact-head/schema validation, merge, publication, live database changes and deployment. No such action was performed. The separate WKS product-edit hold remains intact. QTS stays optional; WCH keeps direct human confirmation.

Rollback additions: any Admin forward rollback must also remove the WCH audit trigger, its private function, record_department_chat_attempt RPC and audit table after preserving required audit history. Confirmed official records must remain intact.

## Narrow OAF error-path follow-up

Based on correction f25436457189dee0e3bacfeba9e6fa6e006cce82, which passed automated checks but was not release accepted. The WCH transport preserves FunctionsHttpError context status, response-envelope status, fallback error status/statusCode, and terminal outcome. Official-record PostgREST reads preserve envelope status as well. Shared DepartmentChat previews use this same WCH transport directly because inherited studio adapters discarded error metadata. The replaced Marketing adapter supplied organization_id and signal, which this narrow error-path correction did not preserve. That separate scope gap is addressed only by the subsequent selected-organization correction documented in WCH_SELECTED_ORGANIZATION_EVIDENCE.md.

Preview, confirm, reject and official-read catches call the existing organization access handler only while their captured identity/request remains current. They check again after recovery, which can synchronously abort the scope. No provider/global helper or WKS changes were made.

Thirteen new behavioral tests exercise both preview modes, confirmation, rejection and official reads: envelope-only 403 recovery, late old-context 403 suppression, transport/fallback status preservation, terminal outcome preservation and recovery-triggered abort. These are repository/completion-guard tests, not mounted React browser tests.

Historical error-path follow-up gates: configured Node suite 482 passed; full frozen CI Deno suite 178 passed; full frozen Deno check passed; lint 0 errors / 350 existing warnings; production build passed; whitespace check passed. An initial unrestricted Node discovery also attempted Deno-owned tests and failed those; the configured Node scope and separate Deno commands above both passed. Later selected-organization, audit-FK, TOCTOU, and invalid-output corrections supersede those gate totals; current final totals and the 25-check rollback verifier are recorded in WCH_SELECTED_ORGANIZATION_EVIDENCE.md.
