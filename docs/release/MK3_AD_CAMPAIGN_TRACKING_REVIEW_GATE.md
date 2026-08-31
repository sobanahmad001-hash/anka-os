# MK3 Ad Campaign Tracking review gate

MK3 is a brand-scoped planning mirror for Google Ads structure and dated reporting history. It does not manage Google Ads.

## Review order

1. Review `20260831124544_mk3_ad_campaign_tracking.sql` first. It adds only the four MK3 tables, their read-only derived-metrics view, constraints, indexes, RLS policies, and least-privilege grants.
2. Confirm every parent relationship uses an organization-consistent composite foreign key.
3. Confirm authenticated browser access is `SELECT` only and `anon` has no access.
4. Review `marketing-studio/index.ts`. All writes must pass a validated caller JWT, active team membership, Marketing/leadership authority, and the service-role server boundary.
5. Search the complete diff for Google Ads management or mutate operations. The only provider URL allowed is `googleAds:searchStream`; the OAuth scope is unchanged from the existing read-only connector phase.
6. Confirm snapshot insertion uses `ignoreDuplicates: true` on `(ad_campaign_id, snapshot_date)` and never updates an existing snapshot.
7. Review the Marketing Studio UI copy. Local budget/status/keyword changes must be clearly described as planning records that still require execution in Google Ads.

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
