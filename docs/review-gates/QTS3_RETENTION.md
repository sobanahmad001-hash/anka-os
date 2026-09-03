# QTS3 retention review gate

## Scope

This change adds owner-controlled Quick Task lifecycle actions, 30-day inactivity expiry, a 30-day recovery window, content-free purge tombstones, and bounded service-role expiry and purge routines. It extends only the existing Quick Tasks database, repository, Edge Function, and screen.

## Required evidence

- The dedicated `qts3-retention` branch and worktree begin at exact integrated `origin/main` commit `fefe43c6cb76bfc204d140910bd1cf011a127d6b`, which includes merged QTS2.
- Migration `20260903113647` was generated with `supabase migration new` and follows applied QTS2 migration `20260903100732` without changing prior migrations.
- Active Quick Tasks expire 30 days after `last_activity_at`; only substantive owner revision/chat writes and deliberate activation transitions establish a new active expiry clock. Reads, searches, metadata audit, failed AI calls, and failed lifecycle calls do not extend it.
- Preserved and promoted tasks never auto-expire. Promoted tasks are terminal and cannot enter the purge path.
- Expired and discarded tasks remain owner-readable and recoverable for 30 days. Owner restore and preserve fail closed after that deadline.
- Manual preserve, unpreserve, discard, restore, due-expire, and due-purge actions are authenticated through the existing JWT-verified `quick-tasks` Edge Function and bind the signed-in user as the actor.
- Bounded service-role expiry and purge routines accept 1–500 rows, order candidates deterministically, lock with `FOR UPDATE SKIP LOCKED`, and are idempotent. QTS3 does not configure a scheduler or Cron job.
- Purge replaces the task title with `[purged]`, clears the current revision pointer, deletes every task revision and message through the narrowly guarded controlled-purge path, and redacts linked QTS AI input, output, revision pointer, and context before deleting the revision records.
- Purge retains only lifecycle/ownership/timing metadata, a fixed reason, and the final current-revision SHA-256 checksum. Leadership visibility remains limited to the content-free lifecycle event table; owners cannot read redacted QTS AI-run rows through browser RLS.
- Existing owner-only content RLS, read-only browser ACLs, exact composite foreign keys, supporting indexes, partial retention indexes, and append-only history outside controlled purge are checked from PostgreSQL catalogs.
- Static review and the rollback verifier prove cross-owner and cross-tenant rejection, transition idempotency, expiry/purge deadlines, AI redaction, payload removal, promoted-source preservation, metadata-only leadership visibility, and absence of canonical side effects.
- Focused/full Node, affected/full frozen Deno test and type-check, lint, production build, and `git diff --check` must pass at the exact PR head.
- The rollback verifier is ready for Admin/Testing execution. Container-backed migration/verifier execution is not claimed when Docker or Podman is unavailable, and no live Supabase fallback is permitted in this phase.

## Phase exclusions

- No scheduler, Cron configuration, automatic invocation, promotion implementation, adapter, canonical destination action, or Shared Department Chat change.
- No canonical artifact, work-item, task, engagement, project, request, approval, release, publishing, deployment, messaging, advertising, or spend behavior change.
- No live migration, verifier execution, Edge Function deployment, merge, or production smoke test. Admin and Testing retain those actions.

## Admin handoff

Admin should reject the PR if a read or failed call extends expiry; if preserved or promoted tasks enter expiry/purge; if recovery succeeds after its deadline; if purge leaves any recoverable title, revision, message, AI input/output, or QTS AI context; if lifecycle actions cross owner or organization boundaries; if browser writes become available; if leadership gains content access; or if any scheduler or canonical side effect appears.
