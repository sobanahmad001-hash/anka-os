# Design handoff/export readiness review gate

Date: 2026-09-13

Base: current released `origin/main` at `63b64aeac7ef8c04bfee895f9ffb04aa71dbca32`

Branch: `feat/design-handoff-readiness-20260913`

## Original-brief mapping

- **Retain:** DS6's released-direction package table, Edge Function, exact release/version
  validation, private ZIP object, and five-minute signed-download action.
- **Retain:** B06a/B06b's separate S07 delivery-package draft and exact-version review flow.
- **Extend:** the released DS6 frontend with exact source evidence, readiness, temporary preview,
  truthful preparing/failed/download errors, read-only refresh recovery, capability messaging,
  and context-reset accessibility.
- **Not implemented:** release/client visibility for an approved S07 delivery-package artifact.
  No released canonical contract maps that artifact to DS6, so this candidate does not invent a
  release record, delivery action, signed URL, storage policy, or downstream work item.

## Bounded implementation

The panel now identifies the exact released direction version and checksum, lists only its
canonical media and variant rows, blocks preparation when the exact version or required stored
source object is unavailable, and never substitutes another version. Existing temporary source
previews are validated through the released Design asset access helper.

Preparing, refreshing, previewing, and downloading remain distinct. An uncertain create response
is retained by the Workshop parent across its loading replacement and locks another create until
an explicit successful read refresh. Refreshing does not rebuild a package.
Download failure offers a safe repeat of the existing signed-link action and does not recreate the
archive. A context-keyed panel clears local errors and locks when the exact release changes.
Open preview links re-evaluate at their conservative expiry without unrelated user interaction.

This candidate changes no schema, migration, Edge Function, RLS policy, Storage policy, provider,
generation capability, shared approval/proofing component, release action, client delivery, or
publication behavior.

## Verification and remaining acceptance

- Lockfile install: PASS; the unchanged lockfile still reports 12 existing audit findings.
- Focused handoff, asset-access, Workshop, and B06b regression suite: 42/42 PASS,
  including mounted parent-remount uncertainty and automatic expiry regressions.
- Full Node suite: 960/960 PASS.
- Lint: PASS with zero errors.
- Production build: PASS.
- Patch whitespace and clean-worktree checks are required after the final commit.
- Backend and shared approval/proofing sources are unchanged; their prior evidence remains
  attributed and no duplicate broad backend run is claimed.

Mocked exact-version, unavailable-object, revoked-variant, context-switch, and recovery evidence
does not establish signed-in private Storage acceptance.

Still open:

- contributor/restricted-role signed-in browser journeys;
- expired/revoked private Storage links against an authorized non-production backend;
- a real ready archive reopen/download journey;
- S07 delivery-package release/client-visibility policy and canonical contract;
- full Design B07, P11, and P13 acceptance.

No push, PR, merge, migration, deployment, provider call, paid action, external write, production
fixture, publication, or release is authorized by this packet.

The initial candidate `1aeffdc887c6a33f3c860e492649181af70fd4d2` is preserved as
rejected. The correction retains exact-release uncertainty in the Workshop parent until a
successful authoritative refresh and adds expiry-driven plus activation-time preview checks.
