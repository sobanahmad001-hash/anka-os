# DS6 Production Handoff — Review Gate

## Stack and dependency boundary

DS6 is intentionally stacked on DS2 PR #52 because production packages must include
design_direction_variants, which is not yet on main. Review this PR against the
DS2 branch. After DS2 merges, rebase DS6 onto current main and rerun every check
before changing the PR base.

DS5 is being built independently. At implementation start its worktree contained no
committed changes, and DS6 does not create a design-system library.

## Included

- One organization-scoped production_handoff_packages table.
- A composite foreign key to an immutable design_direction_releases row.
- Preparing, ready, and failed terminal status rules with an honest failure reason.
- A separate production-handoff Edge Function.
- ZIP packaging of exact release metadata, exact direction-version content, ready
  direction media, and ready DS2 variants.
- Reuse of the private design-generated-media bucket.
- Five-minute signed download URLs.
- A released-direction handoff panel in Design Workshop.

## Explicitly absent

- No draft or unreleased-direction packaging.
- No public Storage policy or public URL.
- No external delivery or publishing.
- No asset editing, regeneration, or transformation.
- No DS5 design-system functionality.
- No change to createSession, generateDirections, generateOne, or
  directionSchema in supabase/functions/design-workshop/index.ts.

## Review sequence

1. Review the migration in isolation.
2. Confirm the package table RLS and least-privilege grants.
3. Confirm non-release IDs are rejected by both the Edge Function and composite FK.
4. Inspect the archive test proving content, media, and variant files coexist.
5. Confirm missing objects record failed and never leave a partial ready package.
6. Confirm download access uses createSignedUrl with a 300-second expiry.
7. Confirm the diff contains no change to the Design Workshop Edge Function.
8. Run the rollback-safe verifier only after explicit approval.

No merge, production migration, Edge Function deployment, or frontend deployment is
authorized by this implementation PR.
