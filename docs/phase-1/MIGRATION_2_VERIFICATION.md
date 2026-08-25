# Migration 2 Live Verification

Date verified: 2026-08-25

Supabase project: `fhoxaogfjszftoqtnbav`

Migration: `20260825020000_security_boundary_hardening`

Result: passed every defined verification gate.

## Evidence

| Gate | Verified result |
|---|---:|
| Anonymous public-table grants | 0 |
| Elevated authenticated table grants | 0 |
| Reviewed functions | 7 |
| Reviewed functions executable by anonymous role | 0 |
| Internal deliverable policies | 4 |
| Old open upload policy | Absent |
| Old public read policy | Absent |
| Deliverable bucket public | False |
| Preserved deliverable objects | 7 |

## Function execution boundary

Authenticated execution remains enabled only for:

- `can_access_task(uuid)`
- `has_organization_role(uuid, text[])`
- `is_organization_member(uuid)`
- `is_team_organization_member(uuid)`

Trigger/event-trigger functions are not executable by anonymous or authenticated API roles:

- `handle_new_user()`
- `rls_auto_enable()`
- `update_project_progress()`

Every reviewed function has an explicit safe search path.

## Remaining ledger condition

The Supabase migration ledger still records only `20260319124658`. This is expected because Migration 1 and Migration 2 were executed through SQL Editor. The repository files are the current implementation authority; ledger repair remains required before CLI-driven deployment or environment cloning.

## Next gate

The owner subsequently classified the 128 existing application rows as test data. A reviewed reset may replace them, but authentication identities remain protected unless deletion is separately authorized.
