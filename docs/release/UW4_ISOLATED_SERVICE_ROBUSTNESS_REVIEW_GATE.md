# UW4 Isolated-Service Robustness review gate

UW4 is a verification-and-fix track. A passing local test suite is not approval
to merge, deploy, apply migrations, or run a live database verification.

## Baseline and test setup

- Branch: `feat/uw4-isolated-service-robustness`, created from fresh
  `origin/main` at `c961904`.
- No migration, schema, RLS, frontend, Design Workshop, or deployment change is
  included.
- The Content request-level Edge Function test provisions an authenticated
  Content contributor, one active `website_content` service on its engagement,
  and no brand statement, website architecture, Content/Design artifacts, or
  other upstream artifacts. It executes `save_artifact` through
  `handleRequest` and verifies the canonical artifact/version and timeline
  event writes.
- The canonical persisted artifact type for the `website_content` service is
  `content`; the service slug and artifact vocabulary are intentionally
  distinct in the existing operating-spine catalog.
- The Marketing request-level Edge Function test provisions an authenticated
  Marketing contributor, one active `campaigns` service, and no Content,
  Design, or other upstream artifacts. It executes `create_campaign` through
  `handleRequest` and verifies the campaign and timeline event writes.

## Observed result and fix decision

- Content creation succeeded with the isolated `website_content` service. The
  real path requires only an active Content service and writes the canonical
  `content` artifact; it did not query `brand_briefs` or `artifact_approvals`.
- Marketing campaign creation succeeded with the isolated `campaigns` service.
  The real path did not query `artifacts` or `marketing_campaign_artifacts`.
- No implicit Content, Design, brand-statement, website, or other upstream
  pipeline dependency was found. Accordingly, no production pipeline behavior
  was changed or masked.
- Content Studio now accepts an optional test dependency seam at its existing
  request boundary, matching Marketing Studio's established test pattern. In
  normal operation it still creates clients exclusively from the existing
  environment values and has the same `Deno.serve` behavior. This permits the
  integration fixture to exercise authentication, authority, active-service
  validation, the core artifact write, and the audit event without any live
  database write.

## Regression evidence

- Focused Deno: `npx --yes deno test
  supabase/functions/content-studio/index.test.ts
  supabase/functions/marketing-studio/index.test.ts --allow-env` — 26 passed,
  0 failed.
- Full Deno: `npx --yes deno test supabase/functions --allow-env` — 97 passed,
  0 failed.
- Deno type-check: `npx --yes deno check` over all 20 Edge Function `index.ts`
  files — passed.
- Node: `npm test` — passed.
- Lint: `npm run lint` — passed with 268 warnings and 0 errors.
- Build: `npm run build` — passed.
- `git diff --check` — passed.

## Out of scope and release hold

- Design Workshop behavior is unchanged; its DS1 active-service regression
  tests remain in the full Deno suite and passed.
- No live database writes, migration application, database verifier, deploy,
  merge, or production invocation was performed.
- Do not merge or deploy this branch without separate review and approval.
