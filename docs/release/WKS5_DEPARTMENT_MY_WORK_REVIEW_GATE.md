# WKS5 Department Workspace and My Work — Review Gate

## Ownership boundary

Production changes are limited to `DepartmentWorkshop.jsx`, `MyWork.jsx`, and `deliveryRepository.js`. WKS5 does not modify Portfolio, Client, Internal, Project/Engagement, shared navigation, authentication, the OAF provider, specialist Studios/Workshops, migrations, or Edge Functions.

## Active-organization contract

- Both views wait until organization loading and selection are resolved.
- Every Department Workspace and My Work tenant-root query includes the selected `organization_id` and the OAF request signal.
- Organization-bound state resets when the active organization or scope revision changes.
- A delayed response is accepted only when its organization and revision still match the current scope and its signal was not aborted.
- Returned records carrying another organization ID are rejected as a membership mismatch.
- Deep links retain the current OAF selection; neither view derives or changes organization from returned records.

## Functional scope

Department Workspace keeps Project Tasks and Engagement Work Items distinct, displays existing service commitments and accountable stages, and preserves requests, research, milestones, deliverables, and specialist links. My Work preserves assigned tasks, handoffs, owned deliverables, exact-version internal review, and controlled client release while keeping Engagement Work Items separately labelled.

## Regression checks

1. Every individual WKS5 tenant query chain has `eq('organization_id', activeOrganizationId)`.
2. Organization A and B repository results remain isolated.
3. Missing or unresolved organization state produces zero tenant queries.
4. Department and My Work reset organization-bound state on scope change.
5. A delayed A response cannot update state after switching to B.
6. Cross-organization results are rejected and deep links never switch organization.
7. Run focused WKS5 tests, the full Node suite, frozen Deno tests/checks, lint, production build, and `git diff --check`.

## Exclusions and rollback

No new role, ownership mapping, schema, migration, write authority, recurring behavior, Cron configuration, deployment, or live Supabase action is included. Revert the WKS5 commit to roll back; no database repair is required.
