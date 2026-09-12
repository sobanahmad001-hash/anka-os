# P9 Shared Workshop Chat — actual-code residual checklist

Original implementation base: `dd3d10425d6c46eaae130b045fae68f75ad97775`.
Navigation integration base: `af5df30f592a39228e8ecbca28bec22f5cc6122c`.
Freshness-reconciled current main baseline: `c1477868c4b9c015e777d6668bece65b2a4fe55d`.
Scope authority: workspace `P9_SHARED_CHAT_SCOPE.md`.
Candidate: `P9-MODELS-1` (local only).

## Implemented in current main before this candidate

- Saved Content, Design and Marketing conversations with fixed organization/project/engagement/department context.
- Creator-private history, deliberate internal sharing, shared-author replies, and immediate later-read/reply revocation.
- Private validated TXT/Markdown/DOCX attachment text; PNG/JPEG reference-only; PDF/OCR/vision unsupported and stated honestly.
- Durable turn identity, idempotency, proposal confirmation, source manifests, and `outcome_unknown` handling.
- Existing artifact/work-item preview and confirmation adapters; Development remains proposal-only.

The scope note's older statement that attachments are unavailable is superseded by the released CHAT-3 code and migration `20260911121056_p9_chat_private_attachments.sql`.

## Implemented by P9-MODELS-1

- One opaque model-configuration selector shared by Content, Design and Marketing.
- Existing verified connector `model_id` is seeded as the sole initial approved/default choice.
- Existing organization leadership manages the allowlist; no new role, provider, account, spend, release, or publishing authority.
- Browser-supplied raw model IDs are ignored. Server selection is the intersection of immutable allowlist identity, verified connector facts, department mapping, engagement mapping, active service, organization and current role.
- New turns revalidate selection after idempotent reservation and again immediately before dispatch; replayed turns exit before any fresh model lookup. Confirmation also revalidates. No stale-choice fallback.
- The exact model plus immutable configuration identity is stored on the proposal and AI-run ledger. Revocation blocks new dispatch/confirmation while preserving old history and an already-dispatched result.
- Capabilities remain honest: text generation; validated text attachments only; PNG/JPEG reference-only; PDF/OCR/vision unavailable.
- The model-selection migration is ordered after CHAT-3 as `20260911130000_p9_department_chat_model_selection.sql`.
- The rollback-only verifier now exercises schema, RLS/ACLs, tenant/role boundaries, replay, revocation, immutable ledger binding, explicit-empty allowlists and no-side-effect denial paths.
- The freshness-reconciled main baseline is integrated. At accepted code head `719bdeb4aa89d25571f7ce0d30e2764c171d0cd0`, local gates pass 838 Node tests, 88 affected Deno tests (79 department-chat and 9 integration-gateway), both affected Edge type-checks, lint with zero errors and the 438-module production build.
- A fresh disposable PostgreSQL 17 environment applied 84 ordered migrations and passed all 26 rollback-only verifier checks. Catalog verification confirmed RLS enabled, authenticated read-only access and service-role-only writes; the disposable runtime was then removed.
- Independent Testing reproduced the focused and full suites, type-checks, lint, build, diff integrity, migration application and all 26 PostgreSQL verifier checks at the accepted code head without finding a code defect.

## Still required before P9 can be called complete

- Product slice: ordinary conversational answers are not implemented; current actions are only `propose_artifact` and `propose_work_item`.
- Product slice: streaming/cancel presentation from the scope is not implemented.
- Review: signed-in three-Workshop acceptance and accessibility/error-state pass.
- Release: migration application, Edge deployment, push/PR/merge and production verification remain separately authorized actions and were not performed here.

Excluded throughout: attachments beyond the released formats, model/provider calls for discovery, arbitrary model IDs, new providers/accounts, paid tests/actions, releases, publishing, and deployment.
