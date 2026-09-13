# Design B06b exact-version submit and review UI gate

Date: 2026-09-13

Base: `origin/main` at `18658d02d5a902809e5d68aae482f8e437f980a2`

Branch: `feat/design-b06b-submit-review-20260913`

## Bounded outcome

Design S07 now continues from a saved canonical `design_delivery_package` version into the
released internal approval and proofing surfaces. A team member selects one exact immutable
package version, sees its stored work identity and pinned Design asset versions, submits that
version to the existing named-approver policy, and records or resolves feedback on that same
version.

This candidate:

- composes `ArtifactApprovalPanel` and `VersionProofingPanel` without changing them;
- uses `artifact_approval_requests`, `artifact_approval_signoffs`,
  `artifact_approvals`, and `artifact_version_comments` as the only review stores;
- creates no role, capability, policy, task, approval, package, release, publication, delivery,
  service activation, ZIP, provider operation, or paid request;
- changes no migration, Edge Function, Supabase configuration, Content comparison/library file,
  or shared approval/proofing component.

## Existing server contract

The generic approval action accepts one exact `artifact_version_id`. The released B06a
database triggers run `private.assert_design_delivery_package_ready` before both approval
request creation and final approval insertion. The database therefore rechecks current
organization, Design service, typed work, downstream service, exact asset references, active
assets, and physical private objects at both review boundaries.

Initial approval-request creation is unique per artifact version but does not accept a caller
replay key. B06b does not automatically retry that mutation. Submission immediately locks that
exact version and removes the create action. If the HTTP response is interrupted, the lock remains
until the user explicitly refreshes review status; the exact existing request is loaded before
another create action can be offered. Duplicate clicks are serialized in the component. Change
requests retain the released idempotency-key behavior.

## UI integrity

- Every review and proofing panel is keyed and populated with the selected exact package version.
- Switching versions unmounts the prior target, so late approval or proofing responses cannot
  populate or act on the newly selected version.
- Completion of an older version's in-flight approval or proofing action does not refresh the
  parent package snapshot and therefore cannot erase an unsaved draft on the current version.
- An uncertain initial approval-request response remains action-specifically locked until an
  authoritative refresh reconciles the selected exact version.
- The mounted lifecycle guard is restored during every effect setup, including React Strict
  Mode's development setup-cleanup-setup cycle.
- A loading or failed parent refresh marks the snapshot stale and removes mutations.
- Missing signed object access, exact asset versions, active Design service, or active downstream
  service blocks submission locally; the server remains authoritative and repeats the full check.
- Read-only immutable package evidence remains visible when review submission is blocked.
- Approval, request status, sign-offs, change requests, and proofing comments stay separate.
- Approval does not publish, release, deliver, complete work, or create downstream work.

## Changed files

- `src/apps/DesignWorkshop.jsx`
- `src/components/DesignPackageReviewPanel.jsx`
- `src/data/designDeliveryPackages.js`
- `src/data/designDeliveryPackages.test.js`
- `src/data/designPackageReviewInteraction.test.js`
- `docs/release/DESIGN_B06B_EXACT_VERSION_SUBMIT_REVIEW_UI_GATE.md`

## Verification

- Lockfile install: `npm ci` PASS.
- Focused B06a/B06b Node tests: 15/15 PASS, including the ambiguous-create regression mounted
  under React Strict Mode.
- Full Node data and mounted-interaction suite: 944/944 PASS.
- Testing Wave exact reproducer: 5/5 PASS, including late old-version completion with a current
  unsaved draft and interrupted initial submission requiring authoritative reconciliation.
- Artifact approval Deno tests: 6/6 PASS.
- Full backend Deno suite: 326/326 PASS.
- Integration gateway Deno tests: 14/14 PASS.
- Exact CI Deno type-check commands: PASS.
- Lint: PASS with zero errors.
- Production build: PASS, 459 modules transformed.
- Patch whitespace check: PASS.

`npm ci` also reported 12 audit findings in the unchanged dependency lockfile. This bounded
candidate changes no dependency or lockfile and does not claim those existing findings resolved.

The package has no schema, migration, function, configuration, storage-write, or provider
change. Rollback is a frontend/model/test commit revert only.

## Explicitly unverified and out of scope

- Signed-in browser journeys with contributor, named reviewer, and restricted-role fixtures.
- Private Storage expiry/revocation exercised against an authenticated non-production backend.
- Full P11 or P13 acceptance.
- Client release, Workspace delivery reopening, publication, deployment, provider calls, paid
  generation, production fixtures, merge, push, or release.

Testing Wave must independently review the exact final commit. Any later code change requires
impact-appropriate renewed checks.

The initial candidate `675326c3a3b9a3756e8c8097b0b58f3bb077f11a` and first correction
`7af3416ebaa732c5c59560b1fe56e7fe7121946a` are preserved as rejected. The final candidate
includes the bounded Testing Wave corrections described above.
