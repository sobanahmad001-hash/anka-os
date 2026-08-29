# W3 Dependencies and Subtasks — Review Gate

## Release boundary

- Branch from merged W2 on `main`.
- Do not merge, migrate production, or deploy the `work-items` function before sign-off.
- W1 production migration/function deployment remains a prerequisite for any W3 publish.

## Intended change

- Add optional `parent_work_item_id` with exactly one subtask level.
- Add organization-scoped directed work-item dependencies.
- Reject self references, nested subtasks, making an existing parent into a subtask, and multi-hop dependency cycles.
- Show Subtasks, Blocked by, and Blocks lists in work-item detail.
- Show open-subtask and unresolved-blocker indicators on W2 board cards.
- Preserve W2 drag-and-drop and never change status automatically.

## Approved architecture correction

- The composite parent foreign key uses `ON DELETE SET NULL (parent_work_item_id)` so `organization_id` is never nulled.
- Because normal removal is a soft-delete `UPDATE`, `soft_delete_work_item` explicitly detaches direct children before marking their parent deleted.

## Required review checks

- [ ] `parent_work_item_id` has the organization-consistent FK and self-parent check.
- [ ] A proposed parent must be active, in the same organization and engagement, and top-level.
- [ ] A work item with active subtasks cannot itself become a subtask.
- [ ] `work_item_dependencies` has organization RLS and browser roles are read-only.
- [ ] Dependency writes are service-role-only and repeat the active-team-membership check.
- [ ] The recursive query rejects A → B, B → C, C → A.
- [ ] Dependency insertion serializes graph mutations per engagement before cycle detection, preventing concurrent cycle races.
- [ ] Soft-deleting a parent leaves its child active with `parent_work_item_id IS NULL`.
- [ ] No graph, multi-level nesting, automatic status change, Calendar, or Timeline work is present.

## Verification

```powershell
npm test
npm run lint
npm run build
npx deno test --no-config supabase/functions/work-items/index.test.ts
npx deno check --no-config supabase/functions/work-items/index.ts
supabase db push --dry-run
```

After applying W1 and W3 to a review database, run:

```sql
\i supabase/verify_20260829081243_work_item_dependencies_subtasks.sql
```

All six JSON checks must be `true`, including `three_hop_dependency_cycle_rejected` and `soft_delete_unparents_direct_child`.
