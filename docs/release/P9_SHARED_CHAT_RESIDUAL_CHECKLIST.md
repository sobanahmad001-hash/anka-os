# P9 Shared Workshop Chat — actual-code residual checklist

Baseline: current-main `dd3d10425d6c46eaae130b045fae68f75ad97775`.
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
- Selection is revalidated before saved-turn reservation, immediately before dispatch, and before proposal confirmation. No stale-choice fallback.
- The exact model plus immutable configuration identity is stored on the proposal and AI-run ledger. Revocation blocks new dispatch/confirmation while preserving old history and an already-dispatched result.
- Capabilities remain honest: text generation; validated text attachments only; PNG/JPEG reference-only; PDF/OCR/vision unavailable.

## Still required before P9 can be called complete

- Product slice: ordinary conversational answers are not implemented; current actions are only `propose_artifact` and `propose_work_item`.
- Product slice: streaming/cancel presentation from the scope is not implemented.
- Integration: reconcile the separately owned Workshop navigation/denied-state candidate without editing its owned files in this branch.
- Verification: run the Deno Edge suite and the rollback-only Postgres verifier in an environment with Deno plus disposable Supabase/Postgres; this workstation currently exposes neither runtime.
- Review: independent Testing/security review, signed-in three-Workshop acceptance, accessibility/error-state pass, and exact-head integration checks.
- Release: migration application, Edge deployment, push/PR/merge and production verification remain separately authorized actions and were not performed here.

Excluded throughout: attachments beyond the released formats, model/provider calls for discovery, arbitrary model IDs, new providers/accounts, paid tests/actions, releases, publishing, and deployment.
