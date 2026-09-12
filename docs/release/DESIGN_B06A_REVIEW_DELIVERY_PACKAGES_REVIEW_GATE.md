# Design B06a — Review delivery packages gate

Date: 2026-09-13

Base: `origin/main` at `bfdd77983366c33de06caf32706e835b57b830ca`

Branch: `feat/design-b06a-review-packages-20260913`

Migration: `supabase/migrations/20260912201144_design_b06a_review_delivery_packages.sql`

## Approval record

The user approved the architecture gate in the administration/testing task with the message: `approved`.
The approval authorizes local implementation and sending this evidence to master task
`01a05ea2-d766-7b00-bb20-e6370006eecc`. It does not authorize deployment, release,
publication, client delivery, downstream service activation, or automatic ZIP creation.

## Frozen architecture

- `design_delivery_package` is one new canonical artifact type.
- `artifact_versions` is the only immutable package-version truth.
- Two narrow relational tables bind each package version to one typed existing-work record,
  its current Design service, an optional already-active downstream service, and exact Design
  asset/version pairs.
- Generic artifact approval requests and approvals remain the only approval authority.
- Saving creates an unapproved package version only. Missing downstream service is an explicit
  planning block, not an invented service, delivery record, publication, or work item.
- Private previews use five-minute signed URLs. Stored objects are neither copied nor deleted.
- The shared Content-owned approval/proofing panels are unchanged; their cross-department UI
  adoption remains outside this bounded candidate.

## Security and integrity evidence

- Browser access is read-only and organization-scoped; writes are service-role-only.
- Save authority is derived from active Design membership and current canonical roots.
- Preview and save validate the active engagement, brand, exact typed work record, current
  Design service, optional permitted downstream service, exact visible asset versions, and
  private object availability.
- Stable actor-scoped operation identity gives exact replay and rejects changed replay intent.
- Exact expected-latest-version checks reject stale version creation.
- Asset archive and package reference creation serialize on the same root lock.
- Review is rejected when a referenced root is archived, a physical private object is missing
  or marked archived, or the selected downstream service is no longer current.
- A package version is accepted only through the canonical atomic save boundary, must have its
  exact context and references complete at commit, and seals its reference set when context is
  committed. Plain incomplete version inserts and later reference appends are rejected.
- Save rechecks private-object availability after preview. Save and review both recheck active
  organization, current Design service, and current typed work state.
- Editing or opening another draft releases obsolete pending UI state without accepting late
  results. Reopened package drafts retain their stored immutable work provenance until a user
  explicitly relinks the new draft.

## Verification results

- Ordered migration chain on a fresh disposable PostgreSQL database: PASS.
- Rollback-only B06a database verifier: 30/30 PASS.
- Testing Wave's ten SQL gap/revocation probes: 10/10 rejected as required.
- Archive-first/reference-second race: waited, then package save rejected — PASS.
- Reference-first/archive-second race: waited, then archive rejected — PASS.
- Race residue: one package, one exact reference, first asset archived, second asset active,
  zero storage deletions — PASS.
- Full repository data tests: 919/919 PASS.
- Design Workshop server tests: 49/49 PASS.
- Exact missing-object server reproductions: 2/2 PASS; save performed one storage check and zero
  database mutations.
- Exact mounted correction reproductions: 4/4 PASS (retry, pending preview edit, pending save edit,
  and stored-work provenance).
- Design Workshop server type-check: PASS.
- Lint: PASS with zero errors (492 pre-existing warnings).
- Production build: PASS (456 modules).
- Patch whitespace check: PASS.
- Shared Content approval/proofing panel diff: empty.

All database verification used disposable loopback PostgreSQL clones. No hosted database,
storage, provider, deployment, publication, release, or client-delivery action was performed.

The first frozen candidate `273bd15f8a4a7065b6480c0f59e7ab725e1b3337` was independently
rejected on the five corrected issues above and remains preserved in history. Acceptance applies
only to a later correction commit after a new independent Testing Wave review.
