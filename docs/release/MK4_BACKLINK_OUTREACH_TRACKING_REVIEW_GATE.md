# MK4 Backlink Outreach Tracking - Review Gate

## Scope

- Adds one canonical `backlink_targets` table scoped to organization and brand.
- Extends the existing Marketing Studio and its caller-validated Edge Function.
- Adds no scraper, SEO provider, contact database, email sender, reminder, sequence, work-item automation, or outreach-history table.

## Required schema and security review

- [ ] The migration creates only `public.backlink_targets`.
- [ ] The composite brand foreign key preserves organization consistency.
- [ ] Optional scores and traffic remain null when unknown; scores use the documented 0-100 scale.
- [ ] HTTP/HTTPS URL validation, non-negative traffic, enum checks, and normalized per-brand URL uniqueness are enforced in PostgreSQL.
- [ ] The brand/status, normalized URL, and `created_by` query paths are indexed.
- [ ] RLS allows authenticated active team members to read only their organization through `public.is_team_organization_member`.
- [ ] `anon` has no table privileges and `authenticated` has SELECT only.
- [ ] Service-role writes follow caller JWT validation and allow only active Marketing team members or organization leadership.

## Required experience review

- [ ] Targets are selected and queried by brand without requiring an engagement foreign key.
- [ ] Status, link type, cost type, minimum relevance, and minimum authority filters work together.
- [ ] Default ordering keeps actionable targets first, then sorts by known relevance and authority without treating unknown as zero.
- [ ] Create and edit preserve nullable URL and metric fields.
- [ ] Secured and declined targets remain visible and filterable.
- [ ] The UI contains no automated discovery, scraping, sending, sequencing, or backlink-verification action.

## Local verification

```text
npm test
npm run lint
npm run build
git diff --check
```

The rollback-safe verifier is `supabase/verify_20260831124451_mk4_backlink_outreach_tracking.sql`. It returns named boolean checks and finishes with `ROLLBACK`.

## Release hold

- [ ] Review the actual migration, verifier, Edge Function, repository, UI, and tests.
- [ ] Do not run the verifier against project `fhoxaogfjszftoqtnbav` without explicit approval.
- [ ] Do not merge, apply migrations, deploy functions, or release frontend changes before explicit approval.
