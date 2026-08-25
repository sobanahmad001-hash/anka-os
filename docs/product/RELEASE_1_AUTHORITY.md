# Anka Sphere OS - Release 1 Product Authority

Status: approved product direction

Effective: 2026-08-25

This file is the repository-level authority for Release 1. The detailed product and execution specification remains the primary planning document. When older phase folders, status notes, or legacy code conflict with this file, this file wins.

## Product outcome

Release 1 is one Anka Sphere delivery-operations system with two controlled experiences:

1. Team OS for planning, executing, reviewing, documenting, and delivering client work.
2. Client Portal for transparent progress, reviewed deliverables, feedback, revision requests, communication, and later approval.

## Included now

- Client, project, phase, task, dependency, handoff, deliverable, review, revision, communication, notification, timeline, and document workflows.
- Department workspaces for Content, Design, Marketing, and Delivery & Development.
- Research as a shared capability used inside any department or project template.
- Branding as a cross-department template joining Research, Content/Marketing, and Design.
- An automatically maintained Living Project Record for every project.
- Internal quality review before any work becomes client-visible.
- AI assistance for summaries, drafts, retrieval, recommendations, and workflow support, with humans retaining authority.

## Explicitly excluded

- Payroll, accounting, finance operations, and full HR.
- Anka Diversify and software-product-development operations.
- Autonomous AI decisions, silent approvals, or unreviewed client-facing AI output.

## Implementation authority

- React/Vite and Supabase are the production foundation.
- The uploaded Angular application is feature reference material only.
- Client approval actions default to disabled and may be enabled only after internal UAT and private-client validation.
- Every client-visible deliverable must pass an internal quality gate.
- Database changes require reviewed migrations, least-privilege RLS, and a rollback path.

## Core workflow

`Intake -> Plan -> Department execution -> Internal review -> Client-visible review -> Revision or acceptance -> Delivery -> Record closure`

The client-visible review step may collect feedback and revisions during early testing. Formal client approval remains behind the `clientApprovals` feature flag.
