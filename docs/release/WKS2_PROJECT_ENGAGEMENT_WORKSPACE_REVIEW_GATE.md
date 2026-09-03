# WKS2 Project/Engagement Workspace — Review Gate

## Roadmap reconciliation

The merged WKS1 release combined the original navigation-shell and Portfolio slices as **WKS1 Workspace Shell + Portfolio**. The remaining implementation sequence is:

- WKS2: Project/Engagement Workspace (this release)
- WKS3: Client Workspace
- WKS4: Internal Work Workspace
- WKS5: Department visibility and My Work refinement

WKS3–WKS5 are not renumbered.

## Scope

WKS2 adds a read-only project-root workspace at `/sphere/workspace/projects/:projectId`. Every Portfolio project can open it. An `engagements` row is treated as an optional one-to-one operating extension of the canonical project.

The workspace provides:

- canonical project identity, ownership, scope, dates, status, health, workstreams, and milestones;
- optional engagement services, instantiated journey, dependencies, prerequisites, and Workshop links;
- separately labelled Project Tasks (`tasks`) and Engagement Work Items (`work_items`);
- canonical deliverables and version review states;
- engagement Workshop artifacts and approved-version counts;
- separately sourced project activity and engagement audit activity;
- evidence-based attention signals derived from existing dates and statuses.

## Security and read-only boundary

- The repository performs explicit Supabase `select` queries only.
- Every project child is queried with project and organization scope where available, then validated again in the read model.
- Engagement children must match the validated engagement extension and organization.
- Profile display requires an active team membership in the project organization.
- Artifact-version reads are limited to artifact IDs already validated for this project and engagement.
- No mutation, RPC, Edge Function call, migration, schema change, seed, or live database access is included.

## Independence and omissions

WKS2 does not query, import, or depend on RET1 recurring-plan records/functions or QTS1 Quick Task/private-sandbox records/functions. It does not implement Client Workspace, Internal Work owner-level detail, Department visibility, meeting policy, persisted risk records, recurring planning, Quick Task promotion, or action mutations.

## Reviewer checks

1. Confirm the branch merge-base is the approved current `origin/main`.
2. Confirm every Portfolio row opens `/sphere/workspace/projects/:projectId`.
3. Confirm a project without an engagement extension still renders its project data without fabricated engagement content.
4. Confirm Project Tasks and Engagement Work Items remain separate in summary, tabs, and empty states.
5. Confirm cross-organization and mismatched engagement children are rejected by model tests.
6. Confirm the repository contains no mutation/RPC/function call and no RET1/QTS1 dependency.
7. Run full Node tests, lint, production build, and `git diff --check`.

## Rollback

Revert the WKS2 commit. No database rollback or data repair is required because WKS2 is migration-free and read-only.
