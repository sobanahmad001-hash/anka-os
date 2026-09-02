# DS3 Multi-page Flows — Review Gate

## Release boundary

- Built on the current main merge point (`1a7a44d`) in an isolated rebase worktree.
- Do not merge, apply the migration, run the live verifier, or deploy before explicit approval.
- This delivery is design-domain only. It does not touch RP5 or WordPress export artifacts (`supabase/migrations/20260831151956_rp5_native_wordpress_export.sql`, `supabase/verify_20260831151956_rp5_native_wordpress_export.sql`, or `wordpress-export` code paths).
- Does not alter any Marketing Studio domain tables, functions, or flows.
- Existing Design Workshop session model remains backward-compatible: page flow membership is optional and added as nullable columns.

## Intended change

- Add optional `design_page_flows` table for grouping independent sessions under a website sitemap page.
- Add nullable `page_flow_id` and `page_slug` columns to `design_workshop_sessions` with an organization-scoped optional FK.
- Enforce `page_flow_id`/`page_slug` coupling so grouped sessions always carry a slug.
- Require slug validation when a flow is selected: a flow with a linked architecture artifact must use an approved sitemap slug from that artifact.
- Expose flow-aware UI in Design Workshop:
  - list and switch by session group in the workshop tab,
  - optional session creation with either freeform slug or architecture-backed dropdown,
  - optional flow creation with optional architecture linkage,
  - preserve existing direction generation flow, release, variant generation, and page-design behavior.
- Extend repository queries to load page flows and pass new flow actions through existing Edge function action names.

## Required review checks

- [ ] `design_page_flows` exists, is organization-scoped in primary PK and FK constraints, is RLS-enabled, and browser-role reads are read-only.
- [ ] `design_workshop_sessions` adds `page_flow_id` and `page_slug` as nullable fields with nullable coupling check.
- [ ] Session create rejects grouped sessions unless `page_flow_id`, `page_slug`, and architecture relation are valid for that engagement.
- [ ] Session create leaves independent sessions unchanged (`page_flow_id` / `page_slug` remain null).
- [ ] Design Workshop page flow UI renders only existing flows and allows session selection by page-slug/service pair.
- [ ] Flow creation supports optional architecture linking; architecture selection is validated against approved content.
- [ ] Existing direction and model-selection behavior is unchanged when flow is absent.
- [ ] Node/Deno + repo checks show DS3-only surface and no accidental edits in W-series, RP-series, or production-release flows.

## Verification

```powershell
npm test
npm run lint
npm run build
npx deno test --cached-only --no-config supabase/functions/*/index.test.ts
npx deno test --cached-only --no-config supabase/functions
npx deno check --cached-only --no-config supabase/functions/*/index.ts
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
```

## Recorded verification evidence

- Node suite: 297 passed, 0 failed.
- Full Edge Function Deno suite: 96 passed, 0 failed.
- Focused Design Workshop Deno suite: 21 passed, 0 failed.
- Lint: 0 errors; 274 existing repository warnings.
- Production build completed successfully.
- All 20 Edge Function type checks completed successfully.

After applying the DS3 migration to review DB, run:

```sql
\i supabase/verify_20260901000000_ds3_multi_page_flows.sql
```

All JSON keys in verifier output must return `true`, especially `design_page_flows_rls_enabled`, `flow_fk_is_organization_scoped`, `flow_requires_slug`, and `session_columns_nullable`.
