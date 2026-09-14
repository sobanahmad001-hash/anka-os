# P9 metadata and version-history acceptance

Candidate base: `63b64aeac7ef8c04bfee895f9ffb04aa71dbca32` (current released `origin/main` when this local candidate was created).

Scope authority: `P9_SHARED_CHAT_SCOPE.md`. This checklist covers the remaining local P9 transcript metadata and version-history experience only. It does not authorize cloud access, database changes, provider calls, paid actions, publication, merging, or deployment.

## Product decision

P9 requires the context/output area to show exact selected input versions and saved outputs, with links to existing version history. It does not require a second inline history browser. The implementation therefore deep-links each currently authorized exact artifact/version identity into its canonical Content, Design, or Marketing history surface. The receiving surface rechecks access and validates that the requested version belongs to the requested artifact.

## Evidence to record before a signed-in run

- Candidate commit and build identifier.
- Existing owner test session and existing authorized shared-recipient test session.
- Existing revoked-member session or fixture; do not create, restore, revoke, or alter membership solely for this check without separate authorization.
- Organization, project, engagement, department, conversation, artifact, and exact version IDs used.
- A historical run without execution telemetry and a stored true no-tool run with execution telemetry.
- Expected record counts for conversations, messages, artifact versions, approvals, and official work before the pass.

Do not paste credentials, access tokens, provider secrets, attachment contents, or unrestricted context manifests into the evidence packet.

## No-provider signed-in acceptance

1. As the conversation owner, reopen an existing saved conversation in Content, Design, and Marketing. Confirm every visible message uses its persisted timestamp and that run metadata is attached to the correct message.
2. Confirm a historical run without stored execution telemetry says `Not recorded for this historical run`. It must not be labeled as a no-tool run.
3. Confirm the stored true no-tool run shows the selected configuration identity, provider-reported actual model when stored, `None requested`, and `None executed`.
4. Confirm requested tools and executed tools are separate fields. Neither field may be inferred from the other or from the run mode.
5. Open each `View version history` link with the keyboard. Confirm its accessible name includes the exact version identity and that the canonical specialist surface opens the same artifact and immutable version ID.
6. Confirm unsupported, incomplete, revoked, restricted, cross-organization, cross-engagement, and wrong-department-profile version identities produce no usable history link.
7. As an existing authorized shared recipient, repeat transcript and exact-version navigation checks. Confirm sharing adds no approval, tool, release, publishing, or ownership power.
8. Using the existing revoked-member session or fixture, confirm a later transcript read/reply and every linked-version read fail closed without leaking title, version identity, message content, or metadata.
9. Exercise stale-session, organization-switch, conversation-switch, delayed response, empty, denied, and error states. Confirm prior transcript, metadata, and linked versions are cleared or remain explicitly stale and non-actionable according to the existing UI contract.
10. Tab through message metadata and version links at narrow and wide layouts. Confirm visible focus, logical order, readable wrapping, and no keyboard trap.
11. Recount conversations, messages, artifact versions, approvals, and official work. The no-provider pass must create no official artifact/work record, approval, release, publication, provider request, or paid action.

## Separately authorized provider acceptance

Run only after explicit provider and budget authority identifies the safe test organization, model configuration, prompt, maximum request count, and maximum cost.

1. Send one benign ordinary answer request with no tool definitions. Record the selected immutable configuration, provider-reported actual model, requested-tools list, executed-tools list, terminal status, and durable run timestamp.
2. Reopen the conversation and confirm the persisted metadata matches the recorded provider/run facts exactly. A model alias or provider substitution must not be silently rewritten as the selected model.
3. If local stop behavior also needs real-provider evidence, obtain separate authority for the additional request. Confirm stopping affects only local observation unless a durable upstream terminal outcome is stored; do not claim provider cancellation or cost avoidance without evidence.
4. Recount official artifacts, work items, approvals, releases, and publications. An ordinary answer must not create or mutate any of them.

## Release evidence, when separately authorized

- Exact deployed commit equals the accepted candidate.
- Exact-head CI and preview evidence are green.
- Rollback-safe database verification, persisted schema/RLS/ACL/ledger checks, and the narrowly scoped `department-chat` deployment are recorded.
- The merged `origin/main` head and production deployment are independently verified.

## Current blockers to executing this checklist here

- No existing signed-in owner, recipient, or revoked-member sessions and safe record IDs were supplied to this local task.
- No provider-call or budget authority was supplied for the provider acceptance section.
- No release authority is part of this local-only candidate.

These are execution prerequisites only; they do not broaden the candidate scope or permit creating replacement accounts, memberships, records, provider traffic, or releases.