# W7 Portfolio Dashboard review gate

## Scope delivered

- Upgrades the canonical Engagements directory into a fixed cross-engagement portfolio dashboard.
- Batch-loads engagements, active work items, and journey stages through their existing authenticated RLS policies.
- Computes all rows, risk flags, and summary counts live in memory from the latest read response.
- Reuses `openEngagement()` for navigation to the existing engagement workspace.
- Adds no migration, table, view, RPC, Edge Function action, cache, or product write path.

## Fixed portfolio view

- One row per visible engagement: engagement, client/brand, status, target date, lead owner, open work, blocked work, and stages not complete.
- Status, target-date, and lead-owner filters are fixed and shared for every user.
- Target date sorts soonest first by default; name, status, target, and lead are also sortable.
- Summary strip contains exactly: active engagements, blocked stages, and unacknowledged automation flags.

## Fixed risk rules

- Target date is today through seven days from today, inclusive, and engagement status is not `completed`.
- Any non-deleted W5 work item has a non-null `automation_flagged_at` value.
- Any engagement stage has status `blocked`.
- No configurable rules, historical trend series, or per-user dashboard preferences exist.

## Security verification

- The repository makes three batch reads rather than one query per engagement.
- Each source table already has organization-scoped RLS for authenticated team members.
- The client rollup accepts child rows only when both `engagement_id` and `organization_id` match a visible engagement.
- `supabase/verify_w7_portfolio_dashboard.sql` creates two rollback-only organizations, switches to the organization-A user under the `authenticated` role, and checks that organization-B engagements, work, and stages are all invisible.
- The same rollback verifier creates two immutable versions of one artifact and proves that selecting the second version by its exact ID returns only the second version's field values, never the first version's values.

## Review checks

- [ ] One portfolio row appears per engagement visible to the requesting team member.
- [ ] Organization-B fixtures are absent from all three W7 reads when authenticated as organization A.
- [ ] A new version of the same artifact cannot surface the previous version's field values against the new version ID.
- [ ] Open, blocked, incomplete-stage, automation, and summary counts are correct.
- [ ] All three risk badges follow the fixed definitions above.
- [ ] Clicking or keyboard-opening a row uses the existing engagement workspace.
- [ ] No migration filename contains `portfolio` or `dashboard`.
- [ ] No product insert, update, upsert, delete, RPC, or Edge Function call was added.
- [ ] No widget builder, historical trend, personalization, or write action exists.

## Publish boundary

Review PR only. Do not merge to `main` or deploy production before explicit sign-off. W7 has no database or Edge Function deployment.
