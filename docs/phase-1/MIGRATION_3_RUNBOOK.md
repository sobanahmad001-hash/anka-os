# Migration 3 Runbook

Migration: `20260825030000_guarded_test_data_reset.sql`

Target project: `fhoxaogfjszftoqtnbav`

## Purpose and authorization

The owner classified all 128 inventoried application rows as test data on 2026-08-25. This migration clears that disposable application data so canonical Release 1 records can start cleanly.

Authentication identities are protected by default and are not deleted. Profiles, organization memberships, the Anka Sphere organization, the four approved departments, and stored objects are preserved.

## Guard behavior

The migration compares all 25 inventoried non-empty table counts, the five authentication users, and the five organization memberships against the approved checkpoint. If anything changed, the complete migration aborts before truncation.

This protects work created after the test-data classification from being removed silently.

## Deployment route

Do not apply this migration manually through SQL Editor after GitHub deployment is enabled. Deploy it through the connected Supabase GitHub integration so the migration ledger remains synchronized.

The repository migration order is:

1. `20260319124658_anka_sphere.sql` — matches the existing remote ledger record.
2. `20260825010000_organization_access_foundation.sql` — manually applied and idempotent.
3. `20260825020000_security_boundary_hardening.sql` — manually applied and idempotent.
4. `20260825030000_guarded_test_data_reset.sql` — pending deployment.

## Expected result

- disposable application-table rows become zero;
- five auth users remain;
- five profiles remain;
- five organization memberships remain;
- one Anka Sphere organization remains;
- four approved departments remain;
- seven existing storage objects remain pending separate Storage API cleanup.

## Verification

After the GitHub/Supabase deployment succeeds, run `supabase/verify_20260825030000_guarded_test_data_reset.sql` and return its JSON result.

If the guard aborts, do not bypass it. Run the exact-count inventory again and review the changed records first.
