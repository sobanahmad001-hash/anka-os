# Migration 1 Runbook

Migration: `20260825010000_organization_access_foundation.sql`

Target project: `fhoxaogfjszftoqtnbav`

## Purpose

This migration establishes the Anka Sphere organization and membership boundary, adds the approved Content environment, introduces canonical client-contact/project-access/workstream records, and prevents unreleased legacy work from appearing in the client portal.

It does not merge, rename, archive, or delete the generic and `as_*` project systems. All 128 inventoried public rows remain in their current tables.

## Before running

1. Confirm the target project reference is `fhoxaogfjszftoqtnbav`.
2. Keep the exact-count inventory result as the pre-migration checkpoint.
3. Do not run any older `phase*.sql` file.
4. Run the entire migration in one SQL Editor execution. It is transaction-wrapped; a SQL error rolls back the migration.

## Execution

1. Open Supabase SQL Editor.
2. Paste all of `supabase/migrations/20260825010000_organization_access_foundation.sql`.
3. Select **Run** once.
4. Do not rerun manually if Supabase reports an error. Copy the complete error back for correction.

Expected successful response: `Success. No rows returned`.

## Verification

After success, run `supabase/verify_20260825010000_organization_access_foundation.sql` and return its JSON result.

Expected conditions:

- organization slug is `anka-sphere`;
- membership count equals the five existing profiles/auth users;
- departments include Content, Design, Delivery & Development, and Marketing;
- null organization-link counts are zero;
- all five new foundation tables exist;
- every legacy client-visibility count is zero;
- the client signoff update policy does not exist;
- `sphere-deliverables` is private.

## Rollback and compatibility

The migration is additive and current generic/`as_*` records remain available to the team. If execution fails, the transaction automatically restores the pre-migration database state.

After a successful execution, do not drop the new tables or reopen client policies as an emergency response. The current React application can continue using its existing tables while the new foundation remains unused. If an application regression appears, disable the affected new UI path and return the error for a corrective forward migration. This preserves both data and the security boundary.
