# Marketing MB05 Calendar Completion Review Gate

## Candidate identity

- Approved brief: Anka Sphere Marketing Workshop Micro Build Brief version 1.0 proposed specification
- Package: MARKETING MB05 after MB04 and Workspace scheduling
- Production base: e0b7bc78036467907c1557348704d5abf7c79a39
- Branch: feat/marketing-mb05-calendar-completion-20260913
- Worktree: C:\Users\Soban\Documents\ChatGPT\Anka Sphere\anka-os-marketing-mb05-20260913
- State: local candidate only
- Production impact: none

## Current state retained

Released main already provides a read-only Marketing Calendar projection over canonical Project Tasks, Engagement Work Items, and latest campaign-plan drafts. It keeps the two work record types distinct, limits reads to the selected organization, project, engagement, and Marketing department, links cards back to their original records, exposes the existing recurring planner for generated occurrences, and creates no calendar or recurrence store.

The released repository is SELECT-only. Existing month and list views, channel, owner, status, and engagement filters, organization timezone display, current campaign linkage, canonical work status, dependency counts, owner access scrubbing, refresh handling, abort handling, and foreign-organization rejection are retained.

## Completed local delta

- Valid IANA project or client timezones continue to control the current planning month.
- Missing or invalid configured timezones fall back visibly and deterministically to UTC.
- Month cards now show the same required date, owner, channel, linked campaign, dependency blocker, unknown dependency, and external-publication evidence states as list cards.
- Month view now presents an explicit no-scheduled-work state when the selected month and filters have no dated records.
- The boundary notice now names the actual server gap without claiming a nonexistent project-manager role or scheduling capability.
- No scheduling, drag, provider, publication, approval, recurring generation, or canonical record mutation path was added.

## Scheduling mutation intentionally not built

The brief requires scheduling an existing unscheduled item, confirming a date move, canceling without mutation, rechecking permissions, dependencies, and concurrent edits, and reflecting the confirmed date in Workspace. The existing server contracts cannot safely provide that behavior.

### Project Task gap

public.update_p5_project_task is a full task-edit command. It changes status, assignee, due date, and completion evidence together. It locks the task and enforces expected row version, but it is not date-only, has no request replay identity, and does not lock or revalidate task_dependencies and their current prerequisite statuses before changing the date. Its deployed authorization is organization leadership, task creator, current assignee, or the legacy matching department-head profile; it does not implement an agreed Calendar scheduling capability.

### Engagement Work Item gap

public.save_p5_work_item is a full-record save. The caller must resend title, description, type, priority, status, assignee, department, artifact links, stage link, dates, position, parent, and provenance. The P5 wrapper enforces selected organization, engagement, row lock, and expected row version, but the underlying save accepts any active team member and does not provide a dedicated scheduling permission, request replay identity, or same-transaction dependency-status revalidation. Calling it from Calendar would risk overwriting unrelated fields from a stale read and would broaden mutation access.

### Event, service, approval, and recurrence boundaries

The external_events and content_event_links contracts are separate event-planning records. They cannot replace the dates on canonical work or become a second Calendar authority. Marketing entry already requires the selected engagement and an active Marketing service. Approval and release records do not grant scheduling rights. Existing recurring occurrences link back to the canonical retainer planner; MB05 must not create recurrence rules or occurrences.

## Bounded contract proposal for a later authorized change

Add one service-role-only date command behind the existing work-items function. It should accept the selected organization, exact record kind and ID, exact project and engagement where applicable, proposed start and due dates, expected row version, stable request ID, and authenticated actor.

In one transaction it must:

1. authorize the actor before revealing record existence or version;
2. lock the canonical Project Task or Engagement Work Item;
3. verify the record still belongs to the selected organization, project, engagement, and Marketing department;
4. use an explicitly approved mapping of existing deployed roles and ownership facts for scheduling;
5. lock and re-read dependency edges and visible prerequisite records, rejecting unfinished or unavailable prerequisites with a non-leaking blocker result;
6. reject stale row versions and invalid date ranges;
7. update only the supported date columns;
8. record one existing-form audit event and return the refreshed canonical row;
9. make same-request retries return the same successful result and reject request-key reuse with changed intent.

Decisions required before implementation:

- exact existing role and ownership facts permitted to schedule each record kind;
- whether Project Tasks remain due-date-only while Engagement Work Items allow start and due dates;
- whether unresolved dependencies block every date change or only movement to an earlier date;
- the approved idempotency and audit contract for a lost-response retry.

After that contract is accepted, both Schedule work and drag can use the same preview and confirmation dialog. Cancel must remain local and write nothing. A failed permission, dependency, stale-version, or replay check must restore the original card and show the server result.

## Verification

- Focused Marketing Calendar tests: 9 passed, 0 failed.
- Full application suite: 944 passed, 0 failed.
- Full backend Deno tests: 346 passed, 0 failed.
- Full backend Deno checks: passed.
- Production build: passed.
- Lint: 0 errors, 500 current-main warnings. Focused changed-file lint has 0 errors and 5 pre-existing component warnings.
- Diff integrity: passed.

Covered locally: organization and engagement scope, foreign-row fail-closed behavior, current active-owner projection, month and list filters, organization-timezone month boundary, invalid timezone fallback, scheduled and unscheduled states, full month-card metadata, dependency blocker and unknown states, current campaign linkage, recurring planner link, completed-versus-published honesty, refresh, late-response suppression, and explicit empty month.

Blocked for independent signed-in testing: date confirmation, cancel after drag intent, permission-denied scheduling, dependency conflict save, stale concurrent save, and Workspace persistence. Those require the accepted transactional scheduling contract above. No customer fixtures, real permission changes, provider calls, external calendar writes, paid actions, or production writes were used.