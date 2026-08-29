# W2 Work Item Board — Review Gate

## Stack and release boundary

- PR base: `feat/work-item-core` (PR #27), not `main`.
- Review W2 only after W1 is approved.
- Do not merge or deploy this branch before sign-off.

## Intended change

- Add a List/Board toggle inside the existing engagement Work tab.
- Render the existing `work_items` rows in four fixed columns: `not_started`, `in_progress`, `blocked`, and `done`.
- Reuse the W1 filter pipeline for both views.
- Move and reorder cards exclusively through `workItems.save`, which invokes the existing `save_work_item` backend path.
- Keep drag-and-drop optional: status selection and Up/Down controls provide keyboard-accessible equivalents.

## Required review checks

- [ ] The diff contains no migration, SQL function, RLS, grant, or Edge Function change.
- [ ] There is no direct `insert`, `update`, `upsert`, or `delete` call against `work_items`.
- [ ] Board columns use only the four W1 status values.
- [ ] Department and assignee filters produce the same item set in List and Board.
- [ ] The existing W1 query still filters `deleted_at is null`.
- [ ] Moving a card preserves all non-status work-item fields and uses `workItems.save`.
- [ ] Reordering writes the existing integer `position` field through the same save path.
- [ ] Cards show title, assignee, priority, optional due date, and an optional linked-artifact badge/link.
- [ ] No calendar, timeline, dependency, subtask, automation, configurable-column, or artifact-thumbnail feature is present.

## Verification commands

```powershell
npm test
npm run lint
npm run build
git diff --name-only feat/work-item-core...HEAD
git diff --check feat/work-item-core...HEAD
```

The name-only diff must contain frontend/test/review documentation only. Any `supabase/migrations` or `supabase/functions` entry fails this gate.
