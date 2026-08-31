# DS6 Production Handoff — Review Gate

## Stack and dependency boundary

DS2 PR #52, DS5 PR #56, and DS3 PR #65 are merged. DS6 was rebased onto main at
`46b55710a4aaf6403c2e22ab5fd63a4988f637f1` before review, so released variants,
the Design Systems Library, multi-page flows, repeated session creation, and the
WordPress export path are all part of the real base. Rebase conflicts were limited to
shared integration surfaces: `package.json`, `src/apps/DesignWorkshop.jsx`,
`src/data/designWorkshopRepository.js`, `supabase/config.toml`, and
`.github/workflows/ci.yml`. Each resolution preserves the complete main behavior and
adds only the DS6 package query, released-only panel, production-handoff function
registration, deployment entry, and CI coverage. DS6 still does not change the shared
Design Workshop Edge Function or Design Systems Library behavior.

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

## Recorded verification after DS3 rebase

- Merge-base: exact main `46b55710a4aaf6403c2e22ab5fd63a4988f637f1`.
- Node suite: 309 passed, 0 failed.
- Full Edge Function Deno suite: 99 passed, 0 failed.
- Deno frozen type-check: 32 function and test files passed.
- Lint: 0 errors; 279 existing repository warnings.
- Production build: 341 modules transformed successfully.
- `git diff --check origin/main...HEAD`: clean.
- `supabase/functions/design-workshop/index.ts`: no diff from main.

No merge, production migration, Edge Function deployment, or frontend deployment is
authorized by this implementation PR.
