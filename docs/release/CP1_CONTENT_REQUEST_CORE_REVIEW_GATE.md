# CP1 Content Request Core — Review Gate

## Boundary migration: review first

Review `20260831165617_cp1_design_media_content_request_target.sql` independently before the rest of CP1.

It changes only the existing Design Media boundary needed for ad-hoc Content Production:

- makes `design_direction_version_id` nullable;
- adds the organization-consistent `content_request_id` composite foreign key;
- requires exactly one of the two targets in SQL;
- preserves the original direction-scoped storage path and adds a request-scoped path;
- widens the existing read policy to the second organization-scoped target;
- automatically attaches request-targeted Design Media rows to `content_request_assets`;
- prevents cross-request Design Media attachment and output-path mismatch.

The rollback-safe verifier explicitly inserts one original direction-targeted asset and one new request-targeted asset, then rejects both-target, neither-target, and cross-target rows.

## CP1 scope included

- `content_requests` and `content_request_assets` with composite tenant relationships, RLS, and read-only browser grants.
- Project-mode Content Studio request creation.
- Optional event selection and optional MK1 lead-time link creation.
- The seven evidence-backed production formats.
- Internal image generation and honest video placeholder through the existing Design Media registry, provider adapter, private bucket, and asset table.
- Figma-handoff destination only; CP3 still owns reference-page generation.
- General-mode schema and direct organization-scoped RLS; CP2 still owns its UI.
- Immutable request core fields with status reserved for later controlled workflow updates.

## Explicitly absent

- CP2 general-mode UI.
- CP3 Figma reference-page generation or automatic Figma file creation.
- CP4 recurring queue/calendar.
- Any client-type, engagement-type, or industry-based event behavior.
- A second media-generation table, provider adapter, or storage bucket.

## Local verification completed

- Node test suite.
- Content Studio and Design Workshop Deno tests.
- Explicit Deno type-check of both modified Edge Functions.
- ESLint with zero errors.
- Production Vite build.
- PostgreSQL parsing of both migrations and both rollback-safe verifiers.
- PL/pgSQL parsing of every migration function and verifier block.

## Live verification and release hold

Neither rollback-safe verifier has been run against `fhoxaogfjszftoqtnbav`.
No migration, Edge Function, frontend deploy, or merge is authorized by this PR.

When explicitly approved, run in this order and stop on the first false result or exception:

1. Apply or rehearse `20260831165601_cp1_content_request_core.sql`.
2. Run `verify_20260831165601_cp1_content_request_core.sql`.
3. Apply or rehearse `20260831165617_cp1_design_media_content_request_target.sql`.
4. Run `verify_20260831165617_cp1_design_media_content_request_target.sql`.
5. Report every named check individually.
