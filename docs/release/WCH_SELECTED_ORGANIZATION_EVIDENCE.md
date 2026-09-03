# WCH selected-organization correction

Date: 2026-09-04. Separate correction directly atop a32659051c4ec425959b790d5ef413b3a88b93b4 on feat/wch3-proposals; main baseline c30b4fab1cf95ed2eec88f7c211e05a2d9cd3607. Prior heads passed automated checks, not whole-package release acceptance. Admin retains SQL/browser/scope acceptance, merge, publication and deployment.

## Before-change reproduction

Read Admin's .qa/OAF_WAVE5_SCOPE_REPRODUCTION.md. Before editing product code, executed the actual requireDepartmentEngagement function against a predicate-honoring synthetic query client, supplying engagement-B and an explicit B selection. Result: Engagement not found; captured filter was organization_id = 8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25. The supplied B selection was ignored. No provider or database call occurred.

Retained harness: .qa/wch-selected-org-reproduce.ts. This is a historical reproduction intended to run against the parent source, not the corrected head: copy the harness into a checkout of a326590 and run deno run --frozen .qa/wch-selected-org-reproduce.ts. The current request-level regression tests assert the corrected behavior instead.

## Corrected contract

The common component explicitly supplies OAF activeOrganizationId and requestSignal. All preview/confirm/reject requests include organization_id and the exact signal; official-record reads use selected organization and abortSignal. Missing selection and already-aborted requests fail locally. The server has no default tenant: it verifies the authenticated user with getUser, checks an active selected organization and that user's exact active team membership, and uses only the validated selection thereafter. Caller actor/project values do not establish authority: actor is authenticated and project is derived from canonical engagement ownership.

Organization scope now reaches engagement, client/project/brand, service, approved context, stage, connector, organization configuration, hourly actor-run count, monthly cost, proposal persistence and attempt audit. Hourly counting is now actor-within-selected-organization, consistent with the requested scoped budget lookup. Confirm/reject first resolve the proposal inside that organization; unchanged SQL RPCs derive official writes and audits from that stored proposal. Membership/role/action restrictions and confirmation semantics are unchanged. Missing/unauthorized selection cannot fall back to A. No deep-link selection change was added.

Existing terminal outcomes, access-error recovery, identity remount and stale completion guards remain. Cancellation is transport cancellation, not a guarantee of rolling back server work already admitted; late completions cannot update the new selection's UI or invoke its recovery callback.

The old studio onPropose/onProposeWorkItem adapters remain unused by the common component, as at the parent head. Current Content, Design, Marketing and Development chat routes all reach that component. No unrelated studio adapter, provider, WKS screen, migration, role, attribution, retention policy or Quick-Task promotion path was changed. Broader studio selected-organization loading remains outside this WCH server/common-transport correction.

## Verification

- Configured Node suite: 487 passed, 0 failed. Five additional transport tests cover every action's organization/signal, official-read scope, missing/aborted requests, and delayed A success/error after B selection. Prior stale-context/error regressions remain passing.
- Full frozen CI Deno suite: 191 passed, 0 failed; WCH 61. Thirteen new request-level tests execute real authentication, membership, context, connector and RPC-call boundaries using synthetic clients/credentials and a fake provider. Valid B works; nonmember C, missing selection, inactive organization/membership and client membership fail closed; A engagement/project/stage and department mismatch under B fail. Reads and audit/save arguments are B-scoped. Confirm/reject cannot resolve A proposals under B. These RPC responses are mocked, not SQL proof.
- Full configured frozen Deno check: passed. Lint: 0 errors, 350 warnings. Production build and whitespace checks: passed.
- Separately reran the unchanged rollback-only SQL verifier on isolated localhost:55436/wch3_test, using its existing schema baseline. All 23 named checks passed with 24 protected sentinel rows, four synthetic organizations and all 26 targets; final ROLLBACK executed. This covers actual atomic writes, tenant ownership, audit vocabulary, service-role/anonymous/authenticated boundaries, inactive/client/revoked actors, stale/expiry/replay and failure rollback. No schema changes were made. Two initial login attempts used incorrect local role names; the recorded fixture administrator qts_admin succeeded. The local server is stopped, credentials were not printed, and the separate cluster on port 55435 was untouched.

No mounted React/browser test, live provider call, live database verification, publication or deployment was performed. Local SQL evidence is on the existing restored baseline, not a claim that every production catalog matches. Admin's independent exact-head and release-schema review remains required.

## Supabase guidance and security review

Reviewed https://supabase.com/changelog.md and https://supabase.com/docs/guides/functions/auth.md on 2026-09-04, plus installed functions-js signal implementation. No relevant breaking notice required an SDK/framework change. Kept verified-user authentication and server-only privileged client; no editable user metadata authority, public secret, RLS bypass change, schema/ACL change or new dependency. The selected organization is a requested scope, not proof of membership.
