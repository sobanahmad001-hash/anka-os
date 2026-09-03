# P4 Work-item Experience + My Work — Review Gate

## Baseline and retained behavior

- Base and merge-base: production-verified `origin/main` at `ef17314cea7fa0af5d8613d3a25617df1eaa5959`.
- P4 retains W1–W3 Work Item core/dependencies, WKS1–WKS5 Workspace scoping, canonical Project Task transitions, immutable deliverable versions, human internal review, and controlled exact-version client release.
- Project Tasks (`tasks`) and Engagement Work Items (`work_items`) remain distinct record types. The shared detail presentation carries an explicit `project_task` or `engagement_work_item` discriminator and never translates between them.

## Scope and defaults

- My Work means records assigned to the signed-in user inside the active organization.
- “Next up” is overdue work plus work due from today through the next 14 calendar days, inclusive.
- Later-dated and undated work remain visible and separately counted; completed/closed records are excluded from the next-action plan but remain governed by their existing source views.
- The detail route covers description, owner, priority, dates, dependencies, discussion availability, outputs, source history, loading, empty/denied, error, and stale states.
- Project Task discussion uses existing exact task comments. Engagement Work Items do not gain a second discussion store; the UI states that no item-specific thread exists.
- Project Task output shows stored completion evidence when present. Engagement Work Item output shows only its existing linked artifact and versions.

## Security and navigation

- Every tenant read requires and filters the active `organization_id`, respects the current abort signal, and validates returned organization and canonical parent context.
- A missing/RLS-hidden record is reported as unavailable without claiming whether it was deleted or denied.
- Archived Project Tasks and soft-deleted Engagement Work Items render as stale, read-only records when readable.
- Workshop links reuse the approved P9 navigation contract with the exact typed work record, project/engagement context, and a safe return origin under `/sphere/workspace/items/...`.
- The detail repository is read-only. P4 adds no mutation, RPC, Edge Function, migration, table, policy, provider action, scheduler, or second work system.

## Exclusions

P5 planning/drag/calendar/workload, P6 retainers, P7 review/deliverable redesign, P8 collaboration/reporting acceptance, P9 Workshop rebuilding, Management/Meetings, Sales, Finance, People, scheduler activation, provider actions, schema convergence, and private Quick Task experiments are unchanged and excluded.

## Acceptance checks

1. My Work states its signed-in-user/active-organization scope and exact 14-day range.
2. Overdue, next-up, blocked, later, and undated outcomes remain honest, including empty and failed-load states.
3. Both canonical record types drill into `/sphere/workspace/items/:recordKind/:recordId` without merging identity.
4. Cross-organization records and invalid project/engagement parents fail closed.
5. Project Task comments and history remain task-specific; Work Item history remains engagement-event/payload-specific.
6. Workshop round-trip preserves the exact record kind/id and returns to the detail route.
7. Generation, approval, release, and completion remain separate existing actions; the new detail repository has no writes.
8. Run focused P4 tests, the full Node suite, frozen Deno tests/checks where applicable, lint, production build, `git diff --check`, ancestry/overlap/migration-order checks, browser journeys, and clean-status verification.

## Rollback and release boundary

Revert the P4 commit. No database repair, function rollback, configuration change, or external cleanup is required. Do not merge, push, deploy, or authorize release before Final Testing approval.
