# Original P9 closeout — 2026-09-19

Authority: workspace `P9_SHARED_CHAT_SCOPE.md` and confirmed creator-private sharing, authorized collaborative replies, approved-model selection, and canonical exact-version specialist links. Baseline fetched from origin/main: `2a31b961ff352c0130d83c56da5823dc104c1a87`. Frozen `464b5b2` is preserved. P10–P12 feature work is paused.

This is a source reconciliation, not a production acceptance certificate. Original Testing owns release receipts and live reconciliation. PR142 metadata/history, PR143 exact-link correction and PR145 Workshop mount correction are in this baseline. A cancelled CI run is not a passing gate; reported Vercel success does not prove signed-in rendering or database/function alignment.

Original Testing subsequently reported on 2026-09-19: PR142 ledger's 11 statements match the repository after boundary-delimiter/whitespace normalization; all three persisted function bodies and ACLs match; department-chat v126 is ACTIVE with JWT verification enabled and all 12 deployed files equal current main. Testing corrected PR142's release description. This records the sole reconciler's result, not a duplicate live check by this task. Current-main CI and signed-in acceptance remain separate.

| Original requirement | Implementation on baseline | Remaining implementation / correction | Acceptance still required |
| --- | --- | --- | --- |
| One shared chat and fixed work context | Shared DepartmentChat core, scoped repository and navigation contracts used by Content, Design and Marketing | Check unsupported internal/private contexts against existing explicit-unavailable presentation; no fabricated engagement | Actual signed-in rendering and navigation in all three Workshops |
| Private saved history, search, rename and recoverable archive | Canonical conversations/messages; permitted title/message search with cursor and pending/failed indicators | None established in this audit | Creator/non-owner/leadership/client privacy and reload/search/archive behavior |
| Deliberate internal sharing and replies | Creator-selected eligible recipients; server-authorized reads/replies and source sharing; no added approval authority | None established in this audit | Owner, active contributor and existing revoked-recipient sessions; concurrent replies and revocation |
| Validated private attachments | TXT/Markdown/DOCX text; PNG/JPEG reference-only; private staging/final storage and immutable manifests | This local patch guards late uploads and revoked-scope reservations, rejects unsupported browser MIME types and displays verified type/byte size | Existing Storage records; access/revocation and authorized upload/download lifecycle; no new production fixtures |
| Approved models, allowed task modes | Verified connector/allowlist selection; answer/artifact/work-item modes; dispatch and confirmation revalidation | None established in this audit | Configured and unavailable/revoked models; shared access must not expand tool authority |
| Genuine answers, run state and safe recovery | Provider SSE adapter, durable request identity, truthful unknown outcomes and local observation stop | This patch prevents blank/overlapping submit during upload; unsaved draft navigation recovery remains missing | Reload/status without resubmission; delayed responses and user-visible error states; real provider evidence separately gated |
| Exact selected source versions before send | Server assembles approved safe context and stores exact manifest; retrospective exact-version history links exist | Explicit user selection/preview of permitted artifact input versions before send is missing; attachment selection is implemented | Current source access, source revocation and exact manifest matching |
| Output previews, metadata and official confirmation | Canonical proposal adapters, idempotent confirmation, separate selected/actual model and requested/executed tools; existing specialist history links | None established beyond release mismatch; no second inline history browser | Historical absent telemetry versus true empty tools; exact links and denied/revoked targets; no unintended official writes |
| Draft recovery and responsive accessibility | Scope replacement clears mounted state; ordinary responsive grid exists | Stay/save-to-original/Discard flow is absent; typed prompt can remain when switching saved conversations. Context/output area does not yet offer the specified narrow-screen collapse | Keyboard/focus, narrow/wide layout and stale-session/context changes |

## PR142 release mismatch: exact source contract

- Required migration: `supabase/migrations/20260913152101_p9_department_chat_proposal_execution_metadata.sql`, Git blob `451667f135905a77628d7393cbc903019d474b7c`.
- `supabase/functions/department-chat/index.ts` blob `b8c0d417586b0f0afda3cba8c1d5953b895a5fb0` calls the new execution-metadata wrappers. A claim of no migration is contradicted by this source.
- Creates `private.apply_department_chat_execution_metadata`, `public.save_department_chat_proposal_with_execution_metadata`, and `public.save_department_chat_conversation_proposal_with_execution_metadata`. All are SECURITY INVOKER with empty search_path, PUBLIC/anon/authenticated EXECUTE revoked and service_role EXECUTE granted. No new table or RLS policy.
- Canonical save and telemetry binding share one transaction. Organization, selected model and immutable configuration must match the AI run. Replay requires identical normalized execution metadata, including separate requested/executed tool arrays.
- Verifiers: `supabase/verify_20260913152101_p9_department_chat_proposal_execution_metadata.sql` and `supabase/verify_20260913152101_p9_department_chat_proposal_execution_metadata_behavior.sql`. Historical local acceptance reports catalog 4/4 and behavior 7/7 with full rollback. Those are not live receipts or a rerun at this baseline.
- Original Testing reports the ledger, function definitions/ACLs and deployed department-chat source reconciled as above. This local work does not rewrite or apply the frozen migration.

## Local correction packet

- Attachment completion is scoped to the mounted conversation and access signal. Late success/error/finally callbacks cannot change a newer conversation; remaining old-batch files do not start after switching. A delayed reservation cannot begin Storage upload after its scope aborts.
- Browser MIME selection now rejects unsupported types. Attachment rows show the server's verified MIME and byte size. Blank prompts and submits during attachment upload are blocked locally.
- Workshop mount tests now await React unmount before restoring browser globals and clean each root before the next mock context. The original harness stalled the full suite and produced an uncaught cleanup error in isolation; the repaired five Workshop cases pass.
- Focused attachment/chat/Workshop tests: 24 passed, zero failed, including delayed success and failure with a newer upload in flight. Final full suite: 1,011 passed, zero failed/cancelled/skipped (49.36 seconds), using a 60-second per-test timeout. Production build passed (469 modules); lint passed with zero errors (`--quiet`, existing warnings not promoted). Diff whitespace check passed.
- No SQL migration or Edge Function file changed. No production, provider, paid, publishing or deployment action was performed here.

## Minimum human acceptance setup

1. Existing signed-in owner and currently authorized internal contributor sessions, plus an existing revoked/non-owner session or approved local fixture. Supply safe organization/project/engagement/conversation IDs for Content, Design and Marketing. Do not create users or change memberships merely to test.
2. Existing exact artifact/version links, one historical run without telemetry, one stored run with explicit empty requested/executed tools, and representative existing permitted/restricted attachment records. Record expected counts without exposing contents or credentials.
3. Storage lifecycle writes require a specifically authorized safe test context and cleanup plan; read-only checks can use existing records. Production fixtures are excluded from this task.
4. Provider acceptance requires separately identified organization, approved configuration, benign prompt, request-count ceiling and cost ceiling. Until then, use mocks and stored runs; no provider calls or paid actions.
5. Testing/executor supplies release receipts and actual signed-in rendering evidence. Record source completion, deployed alignment and human/provider acceptance separately.

P9 remains open until the remaining implementation and applicable acceptance/release gates are closed. Passing this local recovery patch does not complete P9.
