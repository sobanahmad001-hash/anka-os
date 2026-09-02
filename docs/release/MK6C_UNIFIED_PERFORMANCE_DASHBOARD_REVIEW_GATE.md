# MK6c Unified Performance Dashboard review gate

## Scope delivered

- Replaces the Marketing Studio's Google-only analytics panel with one fixed, per-brand performance dashboard.
- Computes every summary live in memory from authenticated source reads for the selected reporting period.
- Shows four sections: organic visibility, technical health, paid performance, and social performance.
- Includes GA4 site-activity totals and a dated Search Console clicks/impressions series in Organic.
- Includes current keyword-rank distribution from MK6a, current page health from MK2, dated Ads snapshots from MK3, and dated Meta organic snapshots from MK6b.
- Changes the existing read-only Search Console report from query rows to daily rows so its clicks/impressions trend is truthful.

## Data and security boundary

- Browser reads use the signed-in Supabase client, so the existing organization-scoped RLS policies remain the primary access boundary.
- The in-memory rollup additionally rejects every row whose `organization_id` does not match the visible brand and rejects child snapshots whose parent is not in the brand-scoped parent result.
- Live Google reports continue through the existing `analytics_dashboard` Edge Function action, which authenticates the caller, requires an active team membership, checks Marketing access, and resolves an organization-scoped Marketing engagement before reading mapped connectors.
- `tracked_page_current_health` and `ad_campaign_performance_metrics` remain existing `security_invoker = true` views. MK6c reads the underlying Ads snapshot table directly and adds no view.
- No credential column is selected from `meta_connections`; only the existing browser-safe metadata fields are requested.

## Missing-source behavior

- Each section has its own availability state.
- A brand can render with any combination of missing Google, technical SEO, Ads, keyword, or Meta data.
- Connector failures are surfaced per source without replacing successful sections with placeholder values.
- A missing keyword position remains an honest no-rank-data state and is not converted to position zero.

## Fixed views and trends

- Organic: GSC clicks/impressions, GA4 sessions/active users, keyword tracking/top-10/average/improvement summary, and the GSC daily series.
- Technical: tracked pages, pages with open issues, open issue count, needs-attention count, and a short affected-page list.
- Paid: spend, impressions, clicks, conversions, CTR, active campaign count, and a dated spend/conversion series.
- Social: reach, impressions, engagement, engagement rate, connected platforms, and a dated reach/engagement series.
- The optional combined cross-source line is deliberately omitted. Its sources use unlike units, and normalizing them would add complexity and risk implying a comparison that the stored data does not support.

## Schema and deployment boundary

- No migration, table, column, index, policy, view, function, trigger, or SQL verifier is added.
- No cached rollup, browser cache, dashboard preference, configurable widget, or new provider is added.
- No product insert, update, upsert, delete, RPC, sync, import, publish, or provider mutation is added.
- This PR requires the already-merged MK2, MK3, MK6a, and MK6b schemas and the existing GA4/GSC reporting connector.
- Review only. Do not merge, deploy functions, apply migrations, or change the live project before explicit sign-off.

## Review checks

- [ ] A brand with all supported sources shows correct totals and dated series in all four sections.
- [ ] A brand missing one or more connectors still renders every other section without an error.
- [ ] Foreign-organization parent rows and child snapshots cannot enter the rollup.
- [ ] Search Console requests use the existing reporting-only endpoint with `dimensions: ['date']`.
- [ ] Meta remains organic read-only and never surfaces encrypted tokens or ad-management fields.
- [ ] The PR contains no migration or verifier and introduces no write call.
- [ ] The dashboard remains a fixed view with no widget configuration or persistence.
- [ ] No combined trend line is present.
- [ ] No merge, deployment, or live database action occurs before approval.
