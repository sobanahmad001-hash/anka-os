# QTS4 deliberate promotion review gate

QTS4 adds one human-confirmed, copy-only promotion from an exact Quick Task revision into exactly one canonical project, work item, or artifact. Promotion is atomic, idempotent, and terminal for the source.

## Destination rules

- Project: inserts only projects; planning; portal-hidden; promoter defaults as owner. No client means internal, while a validated same-organization client means project. Retainer is never inferred.
- Work item: inserts through save_work_item into work_items only; not_started; created_via is quick_task_promotion. An assignee requires explicit confirmation.
- Artifact: requires an eligible engagement, matching project and brand, active department service, supported type, and the existing department validator. It creates a new identity or append-only version that is internal and disallows AI use.

No destination creates an approval, release, client projection, workflow, workstream, engagement, or executable task.

## Safety contract

The service-role-only operation locks the source, verifies active membership and ownership, requires the exact current revision and checksum, and accepts only active or preserved sources. A per-organization idempotency key returns the original result only for an identical request; conflicting reuse fails. The append-only ledger stores content-free provenance and typed tenant-safe foreign keys. Any destination or ledger failure rolls back the whole call.

The UI shows the immutable source revision and checksum beside the proposed destination mapping and requires explicit final confirmation.

## Validation

Run the full Node tests, lint, production build, focused Deno test/check, and a linked Supabase migration dry-run only. The QTS4 SQL verifier is rollback-only, fails closed, and is for a disposable local database.

No migration apply, function deployment, Cron creation, or live database mutation is part of this gate.