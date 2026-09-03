# WKS1 Workspace Shell + Portfolio — Review Gate

## Release scope

WKS1 introduces a read-only, project-root Portfolio Workspace at `/sphere/workspace`, a filtered Internal Work route at `/sphere/internal`, and Coordination navigation in the shared shell.

The canonical ownership contract is unchanged:

- `projects` is the portfolio root.
- Client Work means every project whose `engagement_type` is not `internal`.
- Internal Work means exactly `projects.engagement_type = 'internal'`; it never requires or creates a synthetic client.
- `engagements` remains an optional operating extension and `/sphere/engagements` remains a compatibility/detail route.
- Project Tasks (`tasks`) and Engagement Work Items (`work_items`) are separately named, queried, counted, and displayed.

## Read-only and security gate

- The portfolio repository performs explicit Supabase selects only.
- No mutation, RPC, function invocation, schema change, migration, seed, or live database access is part of WKS1.
- Child records are accepted only when their `organization_id` matches the owning project.
- Engagement Work Items must also match the selected engagement extension.
- Archived/deleted records are excluded where the source schema exposes those fields.
- “Attention signals” are computed from existing due dates, health/status, blocked work, automation failures, and review queues. They are not a new risk model.

## Deliberate omissions

WKS1 does not add Client Workspace, Internal Workspace detail, Project Workspace, RET/MGT placeholders, meeting/risk schema, or action mutations. Undeveloped data is omitted rather than simulated.

## Reviewer checks

1. `/` and unknown routes resolve to `/sphere/workspace`.
2. `/sphere/projects` resolves to `/sphere/workspace`.
3. `/sphere/internal` shows only `engagement_type='internal'` projects.
4. Navigation groups read Coordination and Operations on desktop and mobile.
5. Portfolio filters cover work type, status, due date, owner, and sort order.
6. Summary/table copy never merges Project Tasks with Engagement Work Items.
7. Projects with no engagement extension still appear without fabricated journey data.
8. Full Node tests, lint, build, and `git diff --check` pass; exact-head CI is green before merge consideration.

## Rollback

Revert the WKS1 commit. No database rollback or data repair is required because this release is read-only and contains no schema changes.
