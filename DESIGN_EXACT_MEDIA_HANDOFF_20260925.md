# Exact media references and private-video draft copy

## Candidate, not release authorization

Integrated branch: `feat/design-exact-media-main-20260925`, based on released `6607fcdbc4f198677358551181f2a76716522a6f` (PR254).
Worktree: `C:/Users/Soban/Documents/ChatGPT/Anka Sphere/anka-os-design-exact-media-20260925`.
Original candidate `6c51594` and correction `984f3b6` are preserved on `feat/design-exact-media-20260925`. Prior frozen `a4d4b7a83b82bab70aaa06d972f2b1a8693dd72e` is preserved and its already released private-image behavior is unchanged by this package.

The user explicitly approved the lifecycle rule in master: allow an **unapproved video draft** wherever the caller has access and the Design service/catalog is active, matching existing image promotion. Current source access and matching organization/brand remain required. There is **no** new `planning|active` engagement restriction; existing approval/delivery restrictions remain unchanged. The policy hold is cleared. No global list, legacy image, N1, approval, or release rules changed. UI says “context with active Design service.” Master owns rollout after acceptance gates; this document does not authorize deployment.

## Contract

- Brief content optionally contains `media_references: [{kind: 'design_asset_version', id: UUID}]`. Only canonical exact saved versions are accepted; no artifact IDs, private job IDs, latest aliases, paths, tokens, or URLs. Legacy artifact `source_version_ids` and approved identity references remain separate.
- Save validates caller-visible source versions; official references must match the exact engagement/brand. Freeze rechecks source visibility. Immutable links in `design_creative_brief_media_sources` are materialized in the brief-version transaction. Same-key changed-content/reference retries are rejected at the Edge boundary.
- `preview_video_promotion` and `promote_private_video` accept the owner-private `job_id`, target engagement and service. Confirm additionally requires the preview checksum and UUID operation key. Preview returns only whitelisted metadata, not source paths or provider URLs.
- The service-only preparation RPC reuses the existing owner/membership gate, checks ready source identity and active target service, derives original brief name/rights notes, and reserves immutable asset/version IDs under the operation key. Oversized original rights notes fail closed rather than being silently truncated.
- Edge rechecks caller source, source brief, target, pinned artifact visibility, and approved identity/brand; downloads and hashes the exact stored output; copies with `upsert:false`; verifies existing destination bytes on retry; rechecks access before canonical registration. No provider calls or regeneration.
- Completion rechecks preparation even on replay and creates one canonical `design_assets.output_type='video'` root and `design_asset_versions.source_kind='private_video_copy'` version with private job provenance, checksum, existing private video bucket, and `draft` lifecycle. No review/approval is copied. No cleanup deletes a possibly committed object after uncertain completion.
- Existing image/video buckets are unchanged. Canonical video signing validates its exact asset/version path and batches by bucket. Image upload/review/comparison behavior remains image-only. Video replacement/editor/review/release extensions are not part of this package.

## Migration

`supabase/migrations/20260925140000_design_exact_media_references_promotion.sql`

Created through CLI `migration new` as `20260925080013` (host clock), then explicitly moved before application to `20260925140000` to sort after the already released `20260925130000` guard. No applied ledger edits, `include-all`, live application, or bucket migration. New exposed table has RLS and least-privilege grants; private receipt table is inaccessible to browser roles; privileged RPC execution is service-only with empty search paths.

## Verification on this candidate

- Full Design Edge folder: **75 passed, 0 failed**, Deno typechecking included.
- Integrated focused Node suite: **52 passed, 0 failed**, including mounted consent/retry/remount, exact image/video selection, video download labels, legacy image expiry/comparison, brief recovery, transport isolation, and released private-image promotion regressions.
- `scripts/verify-design-exact-media.mjs`: **passed** using installed PGlite 0.5.8 with real pgcrypto, in-memory only. It loads actual canonical asset/video table definitions and the new migration, with minimal surrounding schema fixtures. Covers migration parsing, image/video references, typed ID/scope failures, immutable links/receipts/versions, object prerequisites, owner/service revocation, preparation-to-completion suspension, preserved receipt/object, same-key recovery, conflicting target reuse, no duplicate drafts, ACLs, and source RLS.
- Vite production build: **passed**, existing large-chunk warning.
- Scoped ESLint: **0 errors, 10 JSX-reference warnings**. `git diff --check`: passed.
- Native multi-session PostgreSQL races/full released migration chain and live Storage transport were **not** exercised. Previous native runtime is unavailable. The in-memory SQL fixture is not a claim of full-chain/native concurrency verification.
- Required local-only `supabase db advisors --local --type security --fail-on error` could not connect (`127.0.0.1:54322`, no local Supabase server). Manual grants/RLS/search-path checklist and executable ACL checks passed; advisor status is unavailable, not passed.

## QA corrections after 6c51594

- Download CTA/fallback now say video for canonical video selections while retaining image wording for images. Mounted targeted UI/library suite: 14 passed.
- Reproduced the reported freeze gap using the actual legacy freeze RPC in the offline fixture: eligibility read, archive source, then RPC incorrectly committed. The corrected service RPC invokes an invoker-security SQL guard before mutation **and replay**; it rechecks current canonical team/source/scope eligibility and holds source/engagement/membership/organization row locks through commit. No new N1 role or engagement-lifecycle policy is introduced. Save's source check also locks the source root.
- Offline corrected tests reject archive, membership revocation and source scope change; failed freezes leave revision unchanged; an archived-source retry fails; restored eligibility reuses the same exact freeze; a key cannot be replayed with another version. This is a deterministic interleaving reproduction, not a native multi-session lock-scheduling test.

## Reproduction

Independent evidence: QA task `01a0c3f8-5482-7ad1-92b9-428d1e7d8920` independently inspected exact implementation commit `393c96bed9702ac78ebd2170d8d6eda181a933ca` and reran `scripts/verify-design-exact-media.mjs` from the clean integrated worktree (exit 0). QA confirmed the legacy freeze gap reproduction and corrected archive/membership/brand denial, unchanged revision and exact replay; no new confirmed flaw in that guard. This does not substitute for the remaining native/full-chain/Storage/browser checks.

```powershell
$env:DENO_DIR='C:/Users/Soban/Documents/ChatGPT/Anka Sphere/.tmp_design_media_deno'
& 'C:/Users/Soban/Documents/Codex/2026-09-19/anka-build-management/verification/native-runtimes/deno/deno.exe' test --no-lock --node-modules-dir=none --allow-env --allow-read supabase/functions/design-workshop
node --test src/data/designAssetLibrary.test.js src/data/designAssetLibraryComponent.test.js src/data/designCreativeBriefs.test.js src/data/designCreativeBriefsSchema.test.js src/data/designVideoCapabilitiesMounted.test.js src/data/designVideoPromotionMounted.test.js src/data/designWorkshopRepositoryScope.test.js src/data/designAssetVersions.test.js
$env:ANKA_PGLITE_ROOT='C:/Users/Soban/Documents/Codex/2026-09-19/anka-build-management/verification/n7-pglite/node_modules/@electric-sql/pglite'
node scripts/verify-design-exact-media.mjs
.\node_modules\.bin\vite.cmd build
```

The integrated 52-test run also includes `src/data/designPrivatePromotionMounted.test.js` from released main. The migration and SQL fixture were byte-for-byte unchanged by integration from `984f3b6`; the complete offline fixture had passed there, including the reproduced legacy freeze interleaving and corrected outcomes.

## Minimal deployment manifest (master-owned)

Implementation anchor: `393c96bed9702ac78ebd2170d8d6eda181a933ca`; subsequent handoff-only commits do not change its executable code.

| Surface | Required change |
| --- | --- |
| Database | Apply only `20260925140000_design_exact_media_references_promotion.sql`, after the verified released migration chain through `20260925130000`. Adds two tables, media constraints/FK/indexes, RLS/grants and functions listed below. No bucket, fixture or provider configuration. |
| Edge deployment | Only `design-workshop`: changed `index.ts` and `creativeBriefs.ts`; new `mediaReferences.ts` and `videoPromotion.ts`. No other deployed Edge function changes. |
| Frontend build | Existing Design brief/library/version/video components plus new `DesignVideoPromotion.jsx`; repository transport and media-type mapping. Deploy the matching build, not an older PNG-only reader. |

Database function manifest:

- NEW `public.prepare_design_video_promotion(uuid,uuid,uuid,uuid,uuid,uuid,text)` and `public.complete_design_video_promotion(uuid,uuid,uuid,uuid,uuid,uuid,text)`: service-only private-ledger bridge, security definer, empty search path.
- NEW `private.record_design_brief_media_sources()` and `private.guard_design_asset_media_kind()`: invoker-security insert trigger functions; new `private.assert_design_brief_media_freeze(uuid,uuid,uuid,uuid)`: invoker-security transaction guard.
- REPLACE `public.freeze_design_creative_brief_version(uuid,uuid,uuid,uuid,integer,uuid)`: same signature and service-only invoker-security contract, adds atomic media validation and exact replay identity check.
- Tables: NEW `public.design_creative_brief_media_sources`, NEW `private.design_video_promotions`; EXTEND `public.design_assets` and `public.design_asset_versions` only. Existing private generation ledger, N1 authority, budgets, quote and dispatch functions are not changed.

Rollout sequence after acceptance:

1. Master confirms the integration SHA and database ledger, no unintended pending migrations, required referenced schemas/constraints, and existing private buckets. Reconcile ordering if the ledger moved; never silently use `include-all`, rewrite applied history or assume this file is already installed.
2. Apply the single transaction-bound migration using the established release mechanism. A lock/statement timeout or SQL error must stop rollout and roll back that transaction; do not deploy the frontend against a failed/partial schema.
3. Deploy matching `design-workshop`, then the matching frontend. No provider/model toggles, new secrets, bucket policies or rendering upgrades are required. Confirm service-only RPC ACLs and the strengthened freeze definition before exposing writes.
4. Acceptance owner verifies owner/other-user/other-organization denial, old PNG read compatibility, exact saved video read, same-key retry with one draft, and freeze/source revocation. Use authorized non-production fixtures; production smoke must not create paid requests or unapproved test data.

Recovery / rollback boundaries:

- Before migration commit, transaction rollback is the recovery; preserve the ledger and diagnose the failed statement. After a successful schema commit, prefer retaining additive DDL even if application deployment is postponed.
- If no new-media writes occurred, master may revert application code to the previous released build while retaining the additive schema. Establish the absence of new refs/video drafts first; do not infer it from a failed browser response.
- Once any new references, receipts or video drafts exist, do **not** blindly restore the old PNG-only Edge/frontend readers or the old freeze RPC. Master should deploy a narrow server-side pause of the new write actions or a forward fix while preserving compatible readers, atomic guards, immutable receipts and exact retry keys. UI hiding alone is not a write stop.
- No automatic destructive down migration, removal of immutable rows, storage cleanup, checksum replacement, or applied-ledger edits. Uncertain copy outcomes retain their receipt/object for same-key recovery; any later cleanup or schema contraction requires a separately approved plan.

## Remaining acceptance coordination

QA has been asked to close or identify exact prerequisites for native multi-session PostgreSQL lock scheduling, full released-chain application, and actual Storage/browser-RLS behavior. Required evidence should identify the implementation SHA, disposable environment/chain, actor scopes and observed denial/replay outcomes. No production credentials or signed tokens belong in the packet. The current blocker is missing acceptance environment/evidence, **not** optional lifecycle tightening. Master decides rollout only after these gates are handled; no new timeline/editor/Google-1080 or storage programme is included.

No production data, fixtures, provider calls, deployment, PR, or release occurred. Existing CLI update metadata remains untouched in the original worktree; the integrated worktree is clean. Master/build management own integration and release; QA receives the exact commit separately.
