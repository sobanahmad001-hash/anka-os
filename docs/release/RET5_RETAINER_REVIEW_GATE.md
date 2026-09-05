# RET5 retainer review gate

## Approved scope

Read-only review within the existing RET-owned planning panel. Selected month membership uses occurrence.period_start in the immutable version timezone. Currently completed means selected-month work whose current status is done; no work completion timestamp is inferred. Carryover means earlier-period work still open now (not_started, in_progress, blocked), with deleted_at absent. Dates and records are never mutated.

Upcoming includes canonical starts on or after today in each applicable approved version timezone, through the selected month end. Weekly effective_start anchors and month-end clamping match RET2/RET3. Generated occurrences retain their recorded version and actual linked work; ungenerated commitments display applicable templates. Inactive contexts are labeled inactive/not executable. Active is a lifecycle fact, not generation eligibility. All generation remains in the existing owner preview/confirm path.

Blockers are explicit blocked status and visible unfinished work_item_dependencies targets. Both endpoints must be visible, undeleted records in the selected organization/project/engagement. Canonical record links target read-only records in this review, not an invented application route.

## Data and ownership

No migration, RPC, Edge Function, new table, RLS or permission change. Browser reads retain caller RLS plus explicit organization filters, including service_catalog (which is organization scoped). Root project and engagement are checked before child queries. Pagination uses exact counts and deterministic ordering. Multi-query results reflect current reads, not a historical or transactionally frozen snapshot; refresh time and that limitation are visible.

New model, repository, panel and tests. Only existing source modified: RetainerPlanningPanel.jsx, to host planning/review navigation. ProjectEngagementWorkspace, existing repositories, WCH, QTS and PLN files remain untouched. Local worktree begins at c30b4fab1cf95ed2eec88f7c211e05a2d9cd3607; refresh base before release.

## Acceptance matrix

- Current completion uses done and period provenance, not generation timestamps.
- Carryover excludes done/deleted and foreign/orphan/nonrecurring records; no mutations.
- Visible unfinished dependency endpoints and explicit blocked state only.
- Historical, transition and empty approval windows; generated recorded version distinct from current applicable version.
- Weekly anchors, short-month clamp without drift, leap days, per-version timezone today boundaries.
- Generated vs ungenerated commitments; inactive contexts cannot imply executable actions.
- Selected-organization, actor, project, engagement and scope-revision guards; missing selection issues no query.
- Pagination beyond response cap, deterministic order, deduplication, access-error status preservation.
- Delayed responses, context transitions, unmount cancellation, initial/context error and retry.
- Canonical record anchors resolve within the read-only review.
- Full configured Node/Deno tests and Deno checks, lint, build, diff hygiene.

Admin independently verifies exact-head CI and signed-in owner/reader behavior before release. No live verification or production action is claimed here.

## Exclusions

No RET4, scheduler reporting or activation, export, notification, acceptance workflow, client-visibility expansion, historical month-end claims, automatic/bulk catch-up, or carryover mutation. Live database, push, merge and deployment remain Admin owned.
