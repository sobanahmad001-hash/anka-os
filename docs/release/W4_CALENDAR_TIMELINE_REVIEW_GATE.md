# W4 Calendar + Timeline review gate

## Scope delivered

- Adds `Calendar` and `Timeline` to the existing Work view toggle.
- Reuses the single `visibleItems` collection already produced by the W1 filters and sort path.
- Reuses the W3 dependency read and the existing work-item detail editor.
- Adds no migration, database object, Edge Function action, or write path.

## Calendar behavior

- Supports month and week grids.
- Groups work by `due_date` and keeps items without a due date in a visible side list.
- Uses the full-range option from the brief: when both dates exist, a read-only bar fragment appears on every day from `start_date` through `due_date`.
- Clicking a day expands the items due that day; clicking any item opens the existing detail panel.

## Timeline behavior

- Full date ranges render as horizontal bars.
- Start-only and due-only work renders as a point on the real supplied date; no synthetic date is created.
- Items with neither date remain visible in the Unscheduled side list.
- Direct subtasks appear immediately below and indented under their visible parent.
- Dashed, arrowed SVG connectors visualize real W3 dependency rows. The overlay has no pointer interaction or mutation control.

## Review checks

- [ ] List and Board remain available and unchanged.
- [ ] Existing Status, Assignee, Department, Priority, and Due date filters affect all four views identically.
- [ ] `workItems.list()` remains the only item query and still requires `deleted_at is null`.
- [ ] W4 components receive `visibleItems`; they do not issue database requests.
- [ ] No migration filename contains `calendar` or `timeline`.
- [ ] No date drag/resize interaction exists.
- [ ] No dependency create/edit/delete interaction exists in Timeline.
- [ ] Workload/capacity, dashboards, automation, and dependency-engine changes are absent.

## Publish boundary

Review PR only. Do not merge to `main`, run a migration, deploy an Edge Function, or deploy production before explicit sign-off.
