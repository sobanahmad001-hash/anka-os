# OAF2 Canonical Ownership Convergence — Review Gate

Status: branch-only implementation. Do not merge, deploy, or apply the migration to any shared or production database until the Admin/Testing task approves the release.

## Canonical decisions

- `clients` and `projects` are the canonical commercial ownership roots.
- `agency_clients` and `engagements` remain one-to-one operating extensions.
- A canonical project's `client_id` is immutable while an engagement extension exists.
- Engagement inserts and ownership updates must resolve to the same organization and canonical client as their project.
- Existing QA-only operating records are preserved by materializing canonical roots during migration.
- `tasks` and `work_items` remain distinct in OAF2; only canonical project ownership is added to `work_items`.

## Review scope

- Migration: `20260903050747_canonical_ownership_convergence.sql`
- Rollback-safe verifier: `verify_20260903050747_canonical_ownership_convergence.sql`
- Atomic commercial-client creation RPC and repository adoption
- Canonical project context in Anka Assistant and the `ai-chat` edge function
- Structural and behavioral regression coverage

## Approval checklist

- [ ] Confirm `clients`/`projects` remain authoritative and extensions cannot be re-keyed.
- [ ] Confirm an engaged project rejects client re-keying while unrelated project updates and standalone-project behavior remain unchanged.
- [ ] Confirm mismatched same-organization engagement clients are rejected on insert and update, while unrelated engagement updates remain allowed.
- [ ] Confirm cross-organization re-key attempts remain rejected.
- [ ] Confirm QA records are preserved and gain exactly one canonical root each.
- [ ] Confirm every project has exactly one Living Record after backfill.
- [ ] Confirm artifacts, work items, and AI runs agree with their engagement's canonical project.
- [ ] Confirm portal and operating client identifiers agree where both exist.
- [ ] Confirm legacy insert paths still create canonical roots through compatibility triggers.
- [ ] Confirm authenticated users can invoke the atomic client RPC and anonymous callers cannot.
- [ ] Confirm the UI exposes one project selector and derives any operating extension.

## Required evidence before approval

- `npm test`
- `npm run lint`
- `npm run build`
- Deno check/test for the changed edge function where the repository supports it
- `git diff --check`
- Supabase linked migration dry-run only (never a live push from this branch task)

## Required corrected-head evidence

- Focused and full Node test results from the final source state.
- Full Deno test and type-check results from exact-head CI, including the five canonical AI context paths.
- Lint and production build results from the final source state.
- `git diff --check` and Supabase linked dry-run results.
- Runtime verifier output is required after Admin/Testing applies the migration through its controlled process.
- Local database reset remains unavailable on this branch host because Docker/Podman is not installed.

## Recorded correction evidence

Implementation head `a4acb34d93a3519c79047e6ee8883aedc4196675` passed the following checks before this evidence-only documentation update:

- Focused Node regression suite: 30 passed, 0 failed.
- Full Node suite: 346 passed, 0 failed.
- Exact-head GitHub Actions validation run `33808961347`: passed.
- Full Deno suite in that run: 118 passed, 0 failed, including all 11 `ai-chat` tests and the five canonical context paths.
- Full Deno type-check in that run: passed for every listed edge-function source and test file.
- ESLint: 0 errors; 284 pre-existing warnings.
- Production build: passed (343 modules transformed).
- `git diff --check`: passed.
- Supabase CLI `2.115.0` linked migration dry-run: passed and reported only `20260903050747_canonical_ownership_convergence.sql` pending; no database push was performed.

The final pull-request head must also pass CI after this documentation-only evidence commit. Runtime SQL behavior remains a post-apply approval gate because this branch host has neither a local database runtime nor authority to mutate the linked database.

## Rollout order after approval

1. Apply the database migration through the Admin/Testing-controlled release process.
2. Run the verifier against the target database and retain its output.
3. Deploy the `ai-chat` edge function.
4. Deploy the frontend application.
5. Run the approved live smoke and consistency checks.

If rollback is needed after a production apply, create and review a forward rollback migration. Do not edit or delete the applied migration, and do not attempt an ad-hoc destructive rollback.
