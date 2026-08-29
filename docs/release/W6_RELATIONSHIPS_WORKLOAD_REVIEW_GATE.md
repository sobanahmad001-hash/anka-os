# W6 Relationships + Workload review gate

## Scope delivered

- Adds `Workload` to the existing engagement Work view toggle.
- Groups only the work items already returned by the engagement-scoped W1 read path.
- Uses a fixed over-allocation threshold of more than eight open, non-done items.
- Adds a read-only connection picture to work-item detail: parent, subtasks, blocked-by, blocks, linked artifact, and that artifact's visible D3 relations.
- Adds no migration, table, view, function, Edge Function action, or write path.

## Workload behavior

- Status totals use the existing four-state vocabulary: `not_started`, `in_progress`, `blocked`, and `done`.
- Unassigned work remains visible as an operational row but is not described as a person or flagged as over-allocated.
- Selecting a person opens either List or Board and sets the existing assignee filter; all other active filters remain intact.
- The aggregation is calculated from `visibleItems`, so it cannot broaden the existing engagement or RLS result set.

## Relationship visibility boundary

- Work-item relationships are derived from the already-loaded engagement work items and W3 dependency rows.
- Linked artifact relations use the existing `artifactRelations.list()` query.
- D3's RLS policy requires both endpoint artifacts to remain readable. The presentation helper also refuses to display a relation whose nested source or target record is absent.
- The W6 test suite repeats the inaccessible-endpoint case and references D3's rollback verification proof (`inaccessible_target_hidden_from_rollup`).

## Review checks

- [ ] Workload shows one row per represented assignee plus an unassigned operational row.
- [ ] The fixed threshold is stated in the UI and flags only people with more than eight open items.
- [ ] List and Board drill-down reuse the existing `filters.assignee` state and `visibleItems` query path.
- [ ] Work item detail shows parent, subtasks, both dependency directions, the linked artifact, and only visible artifact relations.
- [ ] A relation with an inaccessible endpoint is absent from the connection picture.
- [ ] No migration filename contains `workload` or `relationship`.
- [ ] The W6 components contain no database mutation or Edge Function invocation.
- [ ] Cross-engagement aggregation, configurable capacity, and new relationship types are absent.

## Publish boundary

Review PR only. Do not merge to `main` or deploy the frontend before explicit sign-off. There is no W6 migration or Edge Function deployment.
