# W1 Work Item Core review gate

W1 adds one mutable, engagement-level work list shared by every department. It does not add a Board, dependencies, subtasks, automation, custom fields, calendar/timeline rendering, or cross-engagement dashboards.

## Review scope

- Migration: `20260829071335_work_item_core.sql`
- Verification: `verify_20260829071335_work_item_core.sql`
- Edge Function: `work-items`
- UI: engagement-level **Work** tab with List/Table and detail panel

## Required checks

- [ ] `work_items` contains the fixed W1 columns, including `deleted_at`.
- [ ] Browser access is RLS-scoped and read-only; service-role-only functions own mutations.
- [ ] A non-member `assignee_id` is rejected by a real function call.
- [ ] Create, status changes, and assignment changes write the three approved engagement events.
- [ ] Removal sets `deleted_at`; the row and its existing event history remain queryable.
- [ ] Artifact, artifact-version, and stage references can be set or cleared without updating their targets.
- [ ] List/Table sorting and filters cover status, assignee, department, priority, and due date.
- [ ] No W2-W7 feature or schema has been introduced.
- [ ] No merge or production deployment occurs before approval.

## Publish order after approval

1. Merge the W1 PR to `main`.
2. Apply `20260829071335_work_item_core.sql` and run its verification file.
3. Deploy the `work-items` Edge Function.
4. Allow the `main` frontend deployment to complete, then smoke-test the Work tab.
