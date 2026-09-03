# QTS1 private core review gate

## Scope

This change adds owner-private Quick Tasks, immutable content revisions, metadata-only lifecycle events, atomic create/append/fork operations, a repository, and a standalone screen. It deliberately does not register navigation; WKS owns `App.jsx`, `environmentNav.js`, `Sidebar.jsx`, and `Header.jsx`.

## Required evidence

- Migration `20260903071848` is later than RET1 reservation `20260903071706`.
- `origin/main`, branch base, and merge-base are the same exact commit at implementation start.
- Authenticated users can select only their own task and revision content.
- Leadership audit access is limited to lifecycle-event columns, which contain no title, body, content, or payload.
- Revision and lifecycle tables reject update and delete.
- Create, append, and fork run through JWT-verified `quick-tasks` and service-role-only SQL operations.
- The append operation uses `current_revision_id` as an optimistic-concurrency token.
- No canonical record writes, promotion, AI/chat, expiry job, purge, cron, or live database action exists.
- Node tests, lint, build, affected/full Deno checks, SQL review, linked migration dry-run, and exact-head CI pass before merge.
- The rollback verifier emits every ordered result and raises if any structural or runtime check is false, including when no suitable active owner/leader fixture exists.

## Human review

Reject if any content becomes visible through lifecycle audit, browser clients receive write grants, canonical tables are mutated, or a WKS-owned shell/navigation file changes.
