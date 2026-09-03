# WKS3 Client Workspace — Review Gate

## Roadmap position

WKS1 combined the Workspace shell and Portfolio. WKS2 delivered the Project/Engagement Workspace. This release is WKS3 Client Workspace; WKS4 Internal Work and WKS5 Department visibility/My Work remain future phases.

## Scope

WKS3 adds a read-only client-root workspace at `/sphere/clients/:clientId`, keyed only by canonical `clients.id`. The existing Clients & Brands registry remains the list and creation surface and now links to this workspace.

The workspace batch-reads and validates:

- the canonical client plus its optional one-to-one `agency_clients` extension and brands;
- canonical projects plus valid optional engagement extensions;
- client contacts and explicit project-access grants;
- separately labelled Project Tasks (`tasks`) and Engagement Work Items (`work_items`);
- dated milestones, requests and deliverables;
- deliverable versions and existing sanitized client-portal release records.

One-time projects and retainers appear together. No recurring commitment, allocation or future service period is inferred from a retainer label.

## Security and read-only boundary

- The repository performs explicit Supabase `select` queries only.
- The canonical client establishes the organization boundary.
- Every child is scoped by organization and client/project IDs and validated again in the projection model.
- Engagement Work Items require a valid same-organization engagement extension for their canonical project.
- Contact access grants require both a validated contact and validated project.
- Team profile display requires active organization membership.
- Existing RLS remains authoritative. No portal-permission mutation is added.
- No RPC, Edge Function call, migration, schema change, seed or live database access is included.

## Explicitly out of scope

CRM replacement, new communication storage, recurring-plan authoring or projection, meeting minutes, connector management, portal permission changes, Client Workspace mutations, WKS4 Internal Work, and WKS5 Department/My Work changes are excluded. WKS3 does not query or depend on RET recurring-plan or QTS private-sandbox records.

## Reviewer checks

1. Confirm the merge-base is the approved current `origin/main`.
2. Confirm Clients & Brands opens canonical `/sphere/clients/:clientId` routes.
3. Confirm a canonical client without an agency extension still renders without fabricated extension data.
4. Confirm one-time projects and retainers render together without recurring-plan claims.
5. Confirm Project Tasks and Engagement Work Items remain separately labelled and counted.
6. Confirm cross-organization children, invalid access grants and orphan Work Items are rejected by model tests.
7. Confirm the repository contains no mutation, RPC, function call, RET or QTS dependency.
8. Run full Node tests, lint, production build and `git diff --check`.

## Rollback

Revert the WKS3 commit. No database rollback or data repair is required because WKS3 is migration-free and read-only.
