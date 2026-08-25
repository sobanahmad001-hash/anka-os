# Migration 2 Runbook

Migration: `20260825020000_security_boundary_hardening.sql`

Target project: `fhoxaogfjszftoqtnbav`

## Purpose

This migration closes security boundaries revealed by the post-Migration 1 inventory. It removes anonymous public-table grants, removes unnecessary elevated privileges from authenticated users, hardens legacy security-definer functions, and replaces open deliverable-storage policies with internal team membership checks.

It preserves all database rows and all seven existing `sphere-deliverables` objects.

## Before running

1. Confirm the target project reference is `fhoxaogfjszftoqtnbav`.
2. Confirm Migration 1 verification remains passed.
3. Do not modify or delete the seven stored deliverable objects.
4. Run the entire migration in one SQL Editor execution.

## Execution

1. Open Supabase SQL Editor.
2. Paste all of `supabase/migrations/20260825020000_security_boundary_hardening.sql`.
3. Select **Run** once.
4. If Supabase reports an error, do not rerun. Return the complete error for a corrective migration.

Expected response: `Success. No rows returned`.

## Verification

Run `supabase/verify_20260825020000_security_boundary_hardening.sql` and return its JSON result.

Expected conditions:

- anonymous public-table grants: zero;
- authenticated `TRUNCATE`, `REFERENCES`, and `TRIGGER` grants: zero;
- anonymous execution is false for all seven reviewed functions;
- authenticated execution remains true only for `can_access_task` and the three organization authorization helpers;
- all functions have an explicit safe `search_path`;
- the old public read and open upload storage policies are absent;
- four internal-team deliverable policies exist;
- `sphere-deliverables` remains private;
- stored object count remains seven.

## Rollback and compatibility

The migration is transaction-wrapped, so any SQL error rolls back the complete execution. It does not remove authenticated application DML grants; existing RLS policies continue controlling row access.

After success, do not restore anonymous grants or public storage policies. If an internal application operation fails, return the exact operation and error so access can be corrected with a least-privilege forward migration.
