# Marketing Studio review gate

This phase stays on `feat/marketing-studio` until an accountable reviewer gives
separate approval to merge and to publish. Building the branch or opening its PR
is not release approval.

## Accepted foundation

- The nine seeded Marketing services and their Operating Spine blueprint rules
  are reused unchanged.
- Marketing artifacts use the canonical `artifacts`, `artifact_versions`, and
  `artifact_approvals` tables. No parallel marketing document model exists.
- Google OAuth continues to use the existing PKCE flow and encrypted
  `integration_oauth_credentials` store.
- Connector selection remains engagement plus department scoped through
  `integration_connection_engagements`.

## Isolated migration review

Review `20260827190000_marketing_shared_type_extensions.sql` separately. It may
only widen the existing artifact and engagement-event CHECK constraints. It must
not change columns, RLS, grants, policies, or the actor insert rule.

Then review `20260827200000_marketing_campaigns.sql`. It creates only:

- `marketing_campaigns`, an internal planning record whose budget cannot spend
  money; and
- `marketing_campaign_artifacts`, a link to canonical artifact identities.

Both tables must use organization-membership RLS and remain read-only to browser
roles. All foreign-key and engagement/brand lookup paths must be indexed.

## External read boundary

The Marketing Studio reporting adapter is limited to these provider reporting
methods:

- GA4 Data API `properties.runReport`;
- Search Console `searchAnalytics.query`; and
- Google Ads `GoogleAdsService.SearchStream` using GAQL.

These APIs use POST for report queries, but none is a mutate endpoint. Review
must search the complete new code for Google Ads mutate services, Search Console
sitemap writes, Analytics administration writes, social publishing, and any
other provider write path. The absence of a UI button alone is not evidence.

The current Supabase changelog was checked before implementation. The relevant
Data API change means new public tables may not be auto-exposed, so the schema
uses explicit grants plus RLS. The project-level `pg_graphql` extension remains
disabled; this branch must not enable it.

## Verification checklist

- [ ] Shared vocabulary verification returns only `true` results.
- [ ] Campaign schema verification returns only `true` results.
- [ ] Application unit tests, lint, and production build pass.
- [ ] Google OAuth, Design Workshop, and Marketing Studio Deno tests and checks
      pass together.
- [ ] Static security review confirms no external write-capable Google endpoint.
- [ ] A disposable or explicitly approved database target accepts both
      migrations in order.
- [ ] Preview uses a real Marketing-enabled engagement and a verified,
      engagement-mapped Google connector; no mock analytics are accepted.
- [ ] Campaign detail shows linked immutable artifacts and exact approvals.
- [ ] No Client Portal, social publishing, spend execution, or Development
      Studio functionality appears in the diff.
- [ ] PR remains unmerged and nothing is deployed until explicit sign-off.

## Future release order after approval

1. Apply `20260827190000_marketing_shared_type_extensions` and run its verifier.
2. Apply `20260827200000_marketing_campaigns` and run its verifier.
3. Deploy the updated `google-oauth` function, then `marketing-studio`.
4. Deploy a frontend preview and complete the real connector workflow test.
5. Merge and promote only after a separate explicit production approval.
