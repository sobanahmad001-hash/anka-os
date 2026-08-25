# Canonical Delivery Model

Status: approved implementation model for Phase 1
Migration: `20260825040000_canonical_delivery_core.sql`

## Authority decisions

1. `projects` is the canonical engagement table. `engagement_type` distinguishes a project, retainer, or internal initiative.
2. `tasks` is the only canonical task table.
3. `workstreams` activates Content, Design, Marketing, or Delivery & Development inside an engagement.
4. Research is a shared record owned by a project and optionally by a workstream. It is not a department.
5. Branding and website delivery are workflow templates composed from shared workstreams.
6. `as_*` tables are legacy migration sources. No canonical table has a foreign key to an `as_*` table.
7. Every new project automatically gets one `living_project_documents` row.
8. Client-visible progress is released into sanitized projection tables. Clients do not read internal projects, tasks, deliverables, versions, files, approvals, research, or audit rows.
9. Formal client approval remains disabled in the database until the organization setting and a later client-approval policy are deliberately activated after UAT.

## Source-to-target decisions

| Concern | Canonical target | Legacy source/status |
|---|---|---|
| Engagement | `projects` | `as_projects` is retired after test reset |
| Workstream | `workstreams` | Legacy phase labels are template references only |
| Task | `tasks` | `as_tasks` is retired after test reset |
| Workflow | `workflow_templates`, `workflow_stages`, `project_workflow_templates` | Five-stage Angular flow becomes a website template |
| Dependency | `task_dependencies` | Earlier untyped dependency concept is replaced |
| Milestone | `milestones` | `as_project_milestones` is legacy |
| Deliverable | `deliverables` | `as_deliverables` is retired after test reset |
| Version | `deliverable_versions` | New immutable review target |
| File metadata | `files` | Storage objects remain in the private bucket |
| Request/revision | `requests` with `request_type` | `as_handoff_requests` and signoff loops are legacy |
| Research | `research_records` | `project_research` is legacy |
| Approval | `approvals` | `as_client_signoffs` stays disabled and is retired |
| Comment | strengthened `comments` | Broad authenticated access is removed |
| Audit | `activity_events` | Earlier activity tables remain legacy telemetry |
| Living record | `living_project_documents` plus snapshots | Manually edited project documents are not the source of truth |
| Client dashboard | `client_project_projections` | Safe read model |
| Client progress/review | `client_portal_items` | Safe released-item read model |

## Canonical lifecycle controls

Task transitions are enforced by a database trigger:

`backlog -> ready -> in_progress -> ready_for_review -> done`

`blocked`, `changes_required`, `cancelled`, and explicit reopen transitions are allowed only where defined in the migration.

Deliverable version transitions are also enforced by a database trigger:

`in_production -> ready_for_internal_review -> ready_for_client_review -> client_reviewing`

A reviewer can return `changes_required`; a client can generate `revision_requested`; approved or published versions can become `superseded`. Once a version enters review, its content/file identity is frozen. New work creates a new version.

## Client projection boundary

Team members release sanitized copies into:

- `client_project_projections` for dashboard identity and status.
- `client_portal_items` for released milestones, workstream summaries, exact deliverable versions, reports, and living-record snapshots.

Client users can directly create only controlled collaboration rows:

- A `requests` row for a revision or client work request against a version already present in `client_portal_items`.
- A `comments` row with `visibility = 'client_shared'` on a project they can access.

Internal notes, AI prompts, costs, unreleased versions, file storage paths, internal approvals, tasks, and research remain outside this boundary.

## Deletion and history

Material canonical records are archived or withdrawn. Authenticated users receive no `DELETE` grant for projects, tasks, milestones, deliverables, files, versions, requests, research, comments, living records, or portal projections. Dependency links may be deleted. Approvals, activity events, living-record snapshots, and reviewed versions are append-only or transition-only.

## Deployment order

1. Run and verify Migration 3 to remove the owner-approved test data.
2. Run Migration 4.
3. Run `verify_20260825040000_canonical_delivery_core.sql`.
4. Seed one internal test project and exercise database policy tests before wiring active screens to the new repository.
5. Do not activate client approval.
