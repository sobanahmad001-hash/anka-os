# Exact media references and private-video draft copy

## Candidate, not release authorization

Integrated branch: `feat/design-exact-media-main-20260925`, based on released `6607fcdbc4f198677358551181f2a76716522a6f` (PR254).
Worktree: `C:/Users/Soban/Documents/ChatGPT/Anka Sphere/anka-os-design-exact-media-20260925`.
Original candidate `6c51594` and correction `984f3b6` are preserved on `feat/design-exact-media-20260925`. Prior frozen `a4d4b7a83b82bab70aaa06d972f2b1a8693dd72e` is preserved and its already released private-image behavior is unchanged by this package.

Master has explicitly held the engagement-lifecycle restriction pending user policy choice. This candidate follows the closest existing Design image-draft contract: current source access, accessible target, matching organization/brand, and active Design service/catalog. It does **not** add a `planning|active` engagement restriction. No global list, legacy image, N1, approval, or release rules changed. UI says “context with active Design service.” Do not release pending master's decision and independent QA.

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

```powershell
$env:DENO_DIR='C:/Users/Soban/Documents/ChatGPT/Anka Sphere/.tmp_design_media_deno'
& 'C:/Users/Soban/Documents/Codex/2026-09-19/anka-build-management/verification/native-runtimes/deno/deno.exe' test --no-lock --node-modules-dir=none --allow-env --allow-read supabase/functions/design-workshop
node --test src/data/designAssetLibrary.test.js src/data/designAssetLibraryComponent.test.js src/data/designCreativeBriefs.test.js src/data/designCreativeBriefsSchema.test.js src/data/designVideoCapabilitiesMounted.test.js src/data/designVideoPromotionMounted.test.js src/data/designWorkshopRepositoryScope.test.js src/data/designAssetVersions.test.js
$env:ANKA_PGLITE_ROOT='C:/Users/Soban/Documents/Codex/2026-09-19/anka-build-management/verification/n7-pglite/node_modules/@electric-sql/pglite'
node scripts/verify-design-exact-media.mjs
.\node_modules\.bin\vite.cmd build
```

The integrated 52-test run also includes `src/data/designPrivatePromotionMounted.test.js` from released main. The migration and SQL fixture were byte-for-byte unchanged by integration from `984f3b6`; the complete offline fixture had passed there, including the reproduced legacy freeze interleaving and corrected outcomes.

No production data, fixtures, provider calls, deployment, PR, or release occurred. Existing CLI update metadata remains untouched in the original worktree; the integrated worktree is clean. Master/build management own integration and release; QA receives the exact commit separately.
