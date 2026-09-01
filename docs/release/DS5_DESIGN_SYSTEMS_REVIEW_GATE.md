# DS5 Design Systems Library review gate

## Scope

- Adds only `design_system` to the canonical artifact vocabulary.
- Reuses `artifacts`, immutable `artifact_versions`, `artifact_approvals`, D1 proofing, D3 relations, and D4 approval policies.
- Requires the active `design_systems` engagement service through DS1's exported `requireActiveDesignService` helper.
- Provides manual structured authoring and a persistent released-version library.

## Required review

- [ ] `git diff origin/main -- supabase/functions/design-workshop/index.ts` is empty.
- [ ] No changes exist to `createSession`, `generateDirections`, `generateOne`, or `directionSchema`.
- [ ] Migration changes only `artifacts_artifact_type_check` and retains every existing artifact type.
- [ ] Inactive, wrong-engagement, and non-`design_systems` services are rejected by the server boundary.
- [ ] Content contains exactly color tokens, typography scale, components, and usage rules.
- [ ] Released versions remain visible even when the service is no longer active.
- [ ] D3 relation creation rejects unreleased Design System targets and surfaces the released version in the UI.
- [ ] Browser access to canonical artifact tables remains SELECT-only under existing tenant RLS.
- [ ] No live preview, AI generation, component renderer, or Workshop comparison changes were introduced.

## Verification commands

```text
npm test
npm run lint
npm run build
deno test --frozen supabase/functions/design-systems/index.test.ts supabase/functions/artifact-relations/index.test.ts
deno check --frozen supabase/functions/design-systems/index.ts supabase/functions/design-systems/index.test.ts
```

The rollback verifier is `supabase/verify_20260831200435_ds5_design_systems_library.sql`. It must not be run against a live database without explicit approval for this phase.
