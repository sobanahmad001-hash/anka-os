# MK3 Ad Campaign Tracking review gate

MK3 is a brand-scoped planning mirror for Google Ads structure and dated reporting history. It does not manage Google Ads.

## Review order

1. Review `20260831124544_mk3_ad_campaign_tracking.sql` first. It adds only the four MK3 tables, their read-only derived-metrics view, constraints, indexes, RLS policies, and least-privilege grants.
2. Confirm every parent relationship uses an organization-consistent composite foreign key.
3. Confirm authenticated browser access is `SELECT` only and `anon` has no access.
4. Review `marketing-studio/index.ts`. All writes must pass a validated caller JWT, active team membership, Marketing/leadership authority, and the service-role server boundary.
5. Search the complete provider adapter for every mutation spelling and operation payload, not only named campaign services. Both Google Ads provider URLs must end in `googleAds:searchStream`; the OAuth scope is unchanged from the existing read-only connector phase.
6. Confirm snapshot insertion uses `ignoreDuplicates: true` on `(ad_campaign_id, snapshot_date)` and never updates an existing snapshot.
7. Review the Marketing Studio UI copy. Local budget/status/keyword changes must be clearly described as planning records that still require execution in Google Ads.
8. Confirm deleting a selected campaign moves the UI to a surviving campaign when one exists, and each campaign card includes status, type, both budgets, date range, goal, and its latest dated performance summary.
9. Confirm the rollback verifier returns separate `true` rows for campaign, ad-group, keyword, snapshot, and derived-view cross-organization isolation.
10. Confirm the Edge Function tests reject every MK3 write action for non-Marketing contributors and non-Marketing department managers while retaining leadership authority.

## Required checks

```powershell
npm run lint
npm test
deno test --frozen supabase/functions/marketing-studio/index.test.ts
deno check --frozen supabase/functions/marketing-studio/index.ts supabase/functions/marketing-studio/index.test.ts
npm run build
```

Run the migration against a disposable or review database, then execute `supabase/verify_20260831124544_mk3_ad_campaign_tracking.sql`. Every named row must return `true`; the script must finish with `ROLLBACK`.

## Release boundary

Opening this pull request does not authorize merging, production migration, Edge Function deployment, or frontend release. Those steps require explicit reviewer approval.
