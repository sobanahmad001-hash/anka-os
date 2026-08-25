# Migration 4 Runbook

Migration 4 is prepared but not deployed. It must run only after Migration 3 has passed its exact-count guard and cleared the approved test records.

## Before running

1. Confirm the target project is `fhoxaogfjszftoqtnbav`.
2. Re-run the Migration 3 verification and confirm its expected reset result.
3. Confirm five `auth.users`, five `profiles`, five active organization memberships, one organization, and four departments remain.
4. Confirm client approvals are still disabled.
5. Open `supabase/migrations/20260825040000_canonical_delivery_core.sql` in the Supabase SQL Editor.

## Apply

Run the entire Migration 4 file as one statement batch. It is transactional and should either commit completely or leave the prior schema unchanged.

Do not edit the SQL in the dashboard. If it fails, copy the exact error, stop, and correct the repository migration first.

## Verify

Run `supabase/verify_20260825040000_canonical_delivery_core.sql` read-only.

The result must show:

- all canonical tables present;
- RLS enabled on every canonical public table;
- zero anonymous public-table grants;
- no elevated authenticated table grants;
- no foreign-key dependency from a canonical table to an `as_*` table;
- task and deliverable transition triggers present;
- one living project document per canonical project;
- no formal client-approval insert policy;
- legacy broad project/task/comment policies absent.

## Hold points

- Do not connect active screens to new tables until Migration 4 verification passes.
- Do not add a client approval policy or change `client_approvals_enabled`.
- Do not delete legacy tables in this migration; they are removed only after application cutover evidence exists.
- Do not make the storage bucket public.

## CLI note

The official migration generator could not run in this restricted workspace because its current package attempted to create global state under read-only `/root/.supabase`; a supported `SUPABASE_HOME` retry was then blocked by the environment's network approval boundary. The deterministic repository timestamp continues the existing Phase 1 sequence. Before CI deployment, run `supabase migration list` and repair the SQL Editor ledger entries deliberately.
