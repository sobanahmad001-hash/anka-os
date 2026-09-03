# OAF2 Canonical Ownership Convergence — Review Gate

Status: branch-only implementation. Do not merge, deploy, or apply the migration to any shared or production database until the Admin/Testing task approves the release.

## Canonical decisions

- `clients` and `projects` are the canonical commercial ownership roots.
- `agency_clients` and `engagements` remain one-to-one operating extensions.
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

## Rollout order after approval

1. Apply the database migration through the Admin/Testing-controlled release process.
2. Run the verifier against the target database and retain its output.
3. Deploy the `ai-chat` edge function.
4. Deploy the frontend application.
5. Run the approved live smoke and consistency checks.

If rollback is needed after a production apply, create and review a forward rollback migration. Do not edit or delete the applied migration, and do not attempt an ad-hoc destructive rollback.
