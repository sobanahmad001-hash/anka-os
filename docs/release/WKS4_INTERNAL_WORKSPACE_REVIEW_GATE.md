# WKS4 Internal Work Workspace — Review Gate

## Roadmap position

WKS1 combined the Workspace shell and Portfolio, WKS2 delivered Project/Engagement Workspace, and WKS3 delivered Client Workspace. This release is WKS4 Internal Work Workspace. WKS5 Department visibility/My Work remains a future phase.

## Scope

WKS4 replaces the `/sphere/internal` filtered Portfolio view with a dedicated read-only Internal Work workspace.

Membership is exactly `projects.engagement_type = 'internal'`. A null `client_id` alone never qualifies a project. WKS4 reads and validates:

- canonical internal projects, workstreams and Project Tasks (`tasks`);
- milestones, requests, deliverables and project activity;
- existing generated Living Records;
- Engagement Work Items (`work_items`) only when a legitimate same-project, same-organization engagement extension already exists.

The screen provides Overview, Project Tasks, Engagement Work Items, Milestones & Requests, Deliverables, and Activity & Records sections. Project links reuse the canonical WKS2 project route.

## Security and read-only boundary

- The repository filters canonical projects by the stored `internal` classification before loading children.
- Child records are constrained to returned project IDs and revalidated against both project and organization in the projection model.
- Engagement Work Items require a validated optional engagement extension; orphan or mismatched items are rejected.
- Team profile display requires an active membership in the project organization.
- Existing RLS remains authoritative.
- The repository performs `select` operations only. No mutation, RPC, Edge Function call, schema change, migration, seed or live database access is included.

## Explicitly out of scope

WKS4 does not create an “Anka Sphere” client or any synthetic `clients`, `agency_clients`, `brands`, or `engagements` row. Internal taxonomy, budgeting, HR/performance tracking, recurrence, Quick Tasks, meetings, Department visibility, My Work changes and schema convergence are excluded.

## Reviewer checks

1. Confirm the merge-base is the approved current `origin/main`.
2. Confirm `/sphere/internal` lazy-loads the dedicated Internal Workspace.
3. Confirm a clientless non-internal project is excluded by model tests.
4. Confirm Project Tasks and Engagement Work Items remain separately labelled and counted.
5. Confirm Work Items appear only behind a validated optional engagement extension.
6. Confirm cross-organization children and owners without active organization membership are rejected.
7. Confirm Living Records are read as existing generated records and are not regenerated or mutated.
8. Confirm the repository has no client-extension, RET, QTS, mutation, RPC or function dependency.
9. Run the full Node and Deno test/type-check suite, lint, production build and `git diff --check`.

## Rollback

Revert the WKS4 commit. No database rollback or data repair is required because WKS4 is migration-free and read-only.
