# RP3 Content-Per-Page Tracking - Review Gate

## Scope

- Adds only `work_items.linked_page_path text` as a nullable page address.
- Reuses the existing `content` artifact identity and existing work-item statuses.
- Adds one explicit action: `Generate content tasks from sitemap`.
- Does not add a table, artifact type, status system, automatic sync, merge, or deployment path.

## Dependency note

RP2 was not merged into the branch base when RP3 was built. The accepted Content Studio model already stores Website architecture pages as `content.pages[]` records with `path`; RP3 accepts both `path` and `page_path` at the database boundary so the parallel RP2 work can land without guessing by slug or array position. Review must still re-check the final RP2 shape before merging RP3.

## Required code and schema review

- [ ] The migration adds exactly one column to an existing table and no new table.
- [ ] The partial unique index allows at most one generated task for each content artifact and page path, including after soft deletion.
- [ ] The page-link guard keeps generated tasks attached to their original Content artifact and exact page path while ordinary status, assignment, and scheduling edits remain available.
- [ ] The generator is `SECURITY INVOKER`, has an empty `search_path`, is revoked from `public`, `anon`, and `authenticated`, and is granted only to `service_role`.
- [ ] The generator repeats W1's active-team-membership check.
- [ ] An exact approved Website architecture version is required.
- [ ] The latest Content draft supplies page records when present; otherwise the approved Website architecture supplies them.
- [ ] Content page paths must map exactly to the approved architecture, with no slug matching or array-position matching.
- [ ] A transaction advisory lock and the uniqueness rule prevent double-click duplication.
- [ ] Every generated work item uses `not_started`, department `content`, the one real Content artifact ID, and its exact `linked_page_path`.
- [ ] One normal `work_item_created` audit event is written for every generated task.
- [ ] Repeating the action fails instead of silently creating, deleting, or synchronizing work.

## UI review

- [ ] The action is visible only as an explicit human-triggered button in Content Studio.
- [ ] It is disabled until an exact Website architecture version is approved.
- [ ] The status table uses only `not_started`, `in_progress`, `blocked`, and `done` from existing work items.
- [ ] The existing Work List/Board filter includes `Content page` based on `linked_page_path`.
- [ ] A later added, removed, or renamed page produces a visible manual-reconciliation warning.
- [ ] No task is automatically added or removed after initial generation.

## Local verification completed

```text
npm test
npm run build
npx eslint <RP3 changed source files>
git diff --check
```

Expected: all unit tests pass, production build succeeds, changed-source lint has zero errors, and the diff has no whitespace errors. Existing repository lint warnings are not introduced by RP3.

## Database verification - approval required before execution

`supabase/verify_20260831101608_rp3_content_page_tracking.sql` is rollback-only and exercises a three-page sitemap, exact artifact/path linkage, preserved ordering, immutable page identity, and duplicate-generation rejection. Do not run it against project `fhoxaogfjszftoqtnbav` until explicit approval is given.

## Release hold

- [ ] PR reviewed against actual code, migration, and rollback verification script.
- [ ] RP2 final page shape re-checked.
- [ ] No live database verification without explicit approval.
- [ ] No merge or production deployment before sign-off.
