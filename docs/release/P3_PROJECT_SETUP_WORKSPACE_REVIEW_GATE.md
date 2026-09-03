# P3 Project Setup and Project Workspace Review Gate

## Review basis

- Canonical rebase target: `origin/main` at `43a7206de5f57282827fc6205d0621688870bd86`.
- Existing authorities are preserved: Projects owns canonical project creation; Operating Spine and PLN own engagement composition and pipeline preview/instantiation.
- Content B02 and Design B02 are contained by the canonical base. Design B02 changes only Design Workshop, creative-brief, Edge Function, and its own migration/verifier; P3 has no overlap.
- The approved operating architecture keeps Client Work and Internal Work on one canonical spine, preserves optional one-to-one engagement extensions, and requires official isolated service work to retain real client, brand, and engagement identity.

## Delivered scope

P3 extends the project workspace and adds the approved Internal Work setup transaction:

- project brief, engagement objective, scope, exclusions, client and brand context;
- project and engagement owners, active workstreams, milestones, progress and attention signals;
- active services, supplied existing assets, instantiated journey, prerequisites, and immutable pipeline-template provenance;
- honest delivery-shape presentation: official one-service work may be labelled isolated; multi-service work remains a connected selection because the schema does not record a full-versus-partial classification;
- separate Project Tasks and Engagement Work Items;
- separate generation, approval, client release, and completion evidence;
- explicit organization selection, loading, missing, denied, error, and stale-refresh states;
- responsive tab overflow plus Arrow, Home, and End keyboard navigation;
- unchanged Workshop links with original organization, client, project, engagement, brand, service, stage, record, and origin context.
- one confirmed Internal Work form that creates a canonical internal project and its explicitly selected initial workstreams in one database transaction;
- active-team project owners and department-specific active-team workstream owners, validated inside the selected active organization through a tenant-scoped directory and boolean membership bridge;
- organization/caller/request-scoped exact-replay idempotency with normalized payload hashing and transaction-level advisory locking;
- explicit setup-choice loading, denied, stale, generic error, double-submit, exact-effect confirmation, and successful-result states.

## Authority and exclusions

External and client project setup remains exclusively with the existing Operating Spine composer. Projects owns `public.create_internal_project_setup`, a `SECURITY INVOKER` write RPC granted to `authenticated` after explicit PUBLIC, anon, authenticated, and service-role revocation. Existing project/workstream grants and RLS remain the write boundary.

The inherited project INSERT policy authorizes any active team member, while inherited membership RLS lets ordinary contributors read only their own membership row. P3 therefore adds `public.get_internal_project_setup_options`, a read-only, tenant-scoped `SECURITY DEFINER` directory, and `private.can_select_internal_project_owner`, a boolean `SECURITY DEFINER` validator that locks only the selected active membership row. Both first require the caller's existing active-team project authority, expose no cross-organization rows, revoke PUBLIC/anon/service-role execution, and grant only `authenticated`. No new role or project-creation authority is introduced.

The transaction creates no client, engagement, engagement service, milestone, recurring plan, schedule, or active-service change. It reuses the established organization-scoped request UUID, normalized payload hash, exact replay, conflicting-reuse failure, and advisory-lock pattern. No service role is exposed to the browser.

P4 and later packages, Management, Meetings, Sales, Finance, People, Workshop production tools, recurring-plan behavior, Quick Tasks, and release/deployment work remain excluded.

## Reviewer checks

1. Confirm HEAD, base, and merge-base all derive from the exact approved canonical base.
2. Confirm the diff contains the five original P3 workspace files plus only the Internal Work setup UI/repository/tests, CLI-generated migration/rollback verifier, and disposable-local concurrency harness.
3. Confirm every new query is constrained by the active organization and validated again in the read model.
4. Confirm clientless non-internal projects are not labelled Client Work.
5. Confirm an isolated-service label requires one active service plus a valid client, brand, and engagement.
6. Confirm multi-service work is not guessed to be full or partial.
7. Confirm Project Tasks and Engagement Work Items remain distinct.
8. Confirm generation, approval, release, and completion remain separate.
9. Confirm Workshop navigation retains its original record and workspace context.
10. Confirm atomic rollback, exact replay, conflicting reuse, authenticated-only execution, organization/team/owner/department isolation, empty-workstream rejection, and external-composer non-regression.
11. Run focused tests during iteration, then one consolidated final Node, frozen Deno, lint, build, type-check, static rollback-safe SQL verification, diff, and clean-state gate.

The rollback verifier is executable only against a disposable/local database and rolls back its entire transaction. The two-session proof is also local-only: set `P3_LOCAL_TEMPLATE_URL` to a loopback PostgreSQL URL whose database name begins with `p3_template_`, then run:

```text
deno run --allow-env=P3_LOCAL_TEMPLATE_URL --allow-net=localhost,127.0.0.1,[::1] scripts/p3-internal-project-setup-concurrency.ts
```

The harness rejects non-loopback hosts and non-`p3_template_*` databases, clones the template into its own random `p3_verify_*` database, proves same-payload replay and conflicting-payload rejection with two real sessions, and drops only that random database in `finally`.

## Rollback

No migration is applied by this branch. Before deployment, rollback is removal of `public.create_internal_project_setup`, `public.get_internal_project_setup_options`, and `private.can_select_internal_project_owner`, followed by `private.internal_project_setup_requests`; the foreign key prevents removal while a retained setup record points at a canonical project. Reverting the P3 commits removes the application path and unapplied migration/verifier.
