# PLN1 Pipeline Composition Audit and PLN2 PLN3 Decision Gate

## Review status

PLN2 and PLN3 are not safe to implement until the template authority decision in this gate is answered. The current canonical Operating Spine already composes full, partial, and isolated-service journeys from selected services. The older versioned workflow-template implementation belongs to the legacy `projects` and `tasks` model and must not be extended into the canonical engagement path by assumption.

This audit is based on fetched `origin/main` commit `762de0477f5cbbed7a5ec9bc65cd651fee494274`. The audit branch and merge-base both start at that exact commit.

## Authority reconciliation

The applicable decisions, in descending authority, are:

1. The later Product Design approval and its Operating Architecture record: ownership is independent from delivery shape; external and internal work share one spine; full, partial, isolated, and quick modes are supported; a smaller connected pipeline remains a real pipeline; only stages applicable to selected services are instantiated; unrelated upstream artifacts cannot be mandatory for isolated work; the Workspace coordinates and Workshops execute.
2. No later PLN-specific handoff or brief exists in the workspace or current `origin/main`.
3. The 2 September Unified Master Architecture: the canonical chain is agency client to brand to engagement to activated services to blueprint stages; `service_stage_rules` instantiate only selected-service stages; all canonical public tables require organization-scoped RLS plus explicit Data API grants; human approval remains mandatory.
4. The older Release 1 workflow-template plan is historical evidence only where it does not conflict with the later canonical Operating Spine.

The later Operating Architecture explicitly says it is an architecture baseline, not an implementation brief. It settles product invariants but does not settle template persistence or graph-authority semantics.

## PLN1 current implementation audit

### Canonical implementation that must be preserved

- `supabase/migrations/20260827150000_operating_spine_core.sql` defines `service_catalog`, `blueprint_stage_catalog`, `blueprint_stage_dependencies`, `service_stage_rules`, `engagement_services`, `engagement_stage_instances`, `engagement_stage_services`, `engagement_prerequisites`, and `engagement_stage_dependencies`.
- `public.compose_engagement(...)` is a `SECURITY INVOKER` transaction. It validates the real client and brand, activates a non-empty selected-service set, instantiates distinct primary stages, adds only unresolved short prerequisite stages, creates context and finish-to-start dependencies only when their stages exist, maps verified department connectors, records audit events, and returns the engagement id.
- The current composer already supports full composition by selecting the relevant complete service set, partial composition by selecting a connected subset, and isolated-service composition by selecting one service and resolving only its context through supplied assets, a selected stage, or a short prerequisite stage.
- `src/data/operatingSpineRepository.js` performs active-organization and brand validation before calling `compose_engagement`.
- `src/apps/OperatingSpine.jsx` owns the current engagement intake and calls `operatingSpine.composeEngagement(...)`.
- `src/data/operatingSpine.test.js`, `src/data/w7ActiveOrganization.test.js`, and `src/data/canonicalOwnershipConvergence.test.js` protect service-driven composition, organization isolation, and atomic graph creation.
- `supabase/verify_20260827150000_operating_spine_core.sql` verifies the canonical tables, RLS, service coverage, and composer security posture. `supabase/verify_20260903050747_canonical_ownership_convergence.sql` verifies exact graph creation and atomic rollback.

### Historical implementation that must not become the canonical path

- `workflow_templates`, `workflow_stages`, and `project_workflow_templates` were introduced in `20260825040000_canonical_delivery_core.sql` before the Operating Spine.
- `20260825070000_release1_workflow_templates.sql` seeds version 1 Custom, Branding, Website Delivery, and Campaign templates.
- `src/data/deliveryRepository.js#activateWorkflowTemplate` binds those templates to legacy `projects`, `workstreams`, `tasks`, and `task_dependencies`.
- `src/apps/CanonicalProjects.jsx` is the legacy activation UI.
- `src/data/workflowTemplates.test.js` validates that historical path.

These tables are version-labelled but are not a canonical PLN2 foundation: they use legacy ownership and create legacy tasks instead of `engagements`, `engagement_services`, `engagement_stage_instances`, and `work_items`. Reusing their names or activation method would create a second delivery authority and violate the approved convergence boundary.

## Settled PLN2 and PLN3 invariants

Any accepted implementation must satisfy all of the following:

- A template is organization-scoped and reusable without creating a parallel client, brand, engagement, task, artifact, approval, or audit model.
- Published template history is immutable and versioned; editing creates a new version.
- Instantiation always produces the existing canonical engagement graph.
- A template cannot force unselected services or unrelated upstream stages into partial or isolated work.
- Supplied assets and the existing prerequisite resolution modes remain valid.
- Journey preview is read-only, uses the same deterministic rules as instantiation, and returns only caller-authorized organization data.
- Preview and instantiation cannot drift: both must share one database-owned planning primitive or be proven equivalent by exact-graph tests.
- Final creation is atomic and retry behaviour must not duplicate an engagement or graph.
- Browser code cannot write canonical graph tables directly.
- New public tables require RLS, explicit grants, cross-organization foreign-key protection, indexes for foreign keys and ordered reads, and verifier coverage for ACLs as well as policies.
- Existing direct service selection must continue to support full, partial, and isolated composition even when no reusable template is selected.
- No change may depend on WCH, RET, QTS, OAI, shared navigation, or unrelated ownership/engagement-schema changes.

## Genuine architecture decision required before PLN2

The approved documents do not choose which object owns the reusable journey definition.

### Option A Service selection preset

A template version stores an ordered default set of `service_catalog` entries plus display metadata. Preview and instantiation continue to derive all stages, prerequisites, and dependencies from the existing `service_stage_rules` and `blueprint_stage_dependencies`.

This keeps one graph authority and naturally preserves isolated-service behaviour. A published template can nevertheless preview differently later if global service rules change, unless publication also pins the applicable rule revision.

### Option B Versioned graph snapshot

A template version stores its service set and a frozen stage, prerequisite, and dependency graph. Instantiation uses that snapshot while mapping results into canonical engagement-stage tables.

This gives historical reproducibility but creates a second graph authority. The design must define how template stages relate to `blueprint_stage_catalog`, how changed services are reconciled, and which prerequisite rules remain global.

### Option C Versioned rule set

A template version owns versioned service-to-stage and dependency rules, and engagements record the exact rule-set version used.

This provides reproducibility and composability but is the largest schema and governance change. It requires an explicit decision about whether the current organization-level blueprint tables become authoring catalogs, defaults, or legacy compatibility data.

The decision must also answer:

1. Can a user add or remove services after selecting a template, and if so does the result still retain template provenance?
2. Does publishing a new template version affect previews of old versions?
3. Must an engagement record the selected template version even when the service selection was modified?
4. Is template publication restricted to organization roles such as system owner and operations admin, or may department managers publish department-scoped templates?
5. Is instantiation idempotency keyed by a client-generated request id, or is duplicate submission handled only by UI locking?

These are persistence, authorization, and historical-reproducibility choices. They cannot be inferred from the existing architecture without creating product policy.

## Collision-aware PLN2 file boundary after the decision

The safest additive PLN2 unit should be limited to:

- one new timestamped migration after the then-current `origin/main` migration head;
- one matching SQL verifier;
- `src/data/pipelineTemplatesRepository.js`;
- `src/data/pipelineTemplates.test.js`;
- one PLN2 review gate under `docs/release`.

PLN2 should not edit the historical workflow migrations, `deliveryRepository.js`, `CanonicalProjects.jsx`, or `workflowTemplates.test.js`. It should not edit `compose_engagement` until the chosen authority model explicitly requires a compatible new entry point; an additive function is preferable to changing the live signature.

## Collision-aware PLN3 file boundary after PLN2

PLN3 should add journey preview and template-backed instantiation through:

- a new additive migration only if the preview and instantiation functions are not delivered in PLN2;
- a matching verifier update or new verifier;
- `src/data/pipelineTemplatesRepository.js` and its focused tests;
- a new isolated preview component and model test;
- the smallest possible integration change in `src/apps/OperatingSpine.jsx`;
- narrowly scoped regression assertions in `src/data/operatingSpine.test.js` and `src/data/w7ActiveOrganization.test.js`;
- one PLN3 review gate under `docs/release`.

`OperatingSpine.jsx`, `operatingSpineRepository.js`, and the Operating Spine tests are shared collision surfaces. Rebase PLN3 after PLN2 and after any concurrently landing Workspace or retainer intake changes, then run a merge simulation before review. `ProjectEngagementWorkspace.jsx` remains RET3-owned and is out of scope for PLN.

## PLN4 prerequisites and unresolved scope

PLN4's specified user outcome is pipeline management after engagement creation: safely add, pause, replace, or remove services without corrupting completed history. Its detailed policies remain unbriefed. Before PLN4 implementation, Product Design must define authorized roles, lifecycle transitions, the meaning and constraints of service replacement, effects on active and completed stage instances, dependency and prerequisite recalculation, work-item and artifact preservation, template provenance, audit requirements, and rollback or compensation behaviour. PLN4 must remain separate from PLN2 schema foundation and PLN3 preview and instantiation.

## Current collision report

- Current `origin/main` migration head: `20260903170702_w7_active_organization_client_rpc_post_qts4.sql`.
- The active RET3 worktree currently contains an untracked `20260903185206_ret3_monthly_planning_preview.sql`. A PLN timestamp must be allocated only after the landing order is known; do not reserve an earlier timestamp now.
- RET3 owns `ProjectEngagementWorkspace.jsx` until its phase lands. PLN must not edit that file.
- WCH owns Department Chat and the `department-chat` function. PLN must not edit either surface.
- The active WCH3 worktree currently has no tracked or untracked source change beyond the shared local Supabase CLI marker.
- QTS4 and OAI1 are already represented in current main; their old worktrees are not implementation bases.
- No current sibling-worktree diff overlaps a PLN source file because no PLN source file exists yet. The known future integration collision is `src/apps/OperatingSpine.jsx`; the migration ledger is the immediate coordination collision.
- The modified `supabase/.temp/cli-latest` files are local CLI state and must remain outside every PLN commit.

## Required SQL RLS ACL and verifier scrutiny

After the architecture decision, reviewers must verify at minimum:

- composite organization foreign keys prevent cross-tenant template, version, service, stage, and dependency references;
- published versions and their child rows are append-only, including protection from direct authenticated updates or deletes;
- authoring and publishing roles are enforced in database operations, not only in the UI;
- authenticated users receive only the minimum table privileges needed for reads and permitted drafts;
- privileged mutation functions revoke `PUBLIC`, `anon`, and `authenticated` execution when a service-role Edge Function boundary is chosen;
- every `SECURITY DEFINER` function, if any is approved, fixes `search_path`, verifies JWT-derived identity and organization membership, and cannot accept browser-supplied actor scope as authority;
- preview exposes no unauthorized template or organization rows and performs no writes or audit side effects;
- instantiation is atomic and either idempotent or explicitly protected from double submission by the approved mechanism;
- selected services, instantiated stages, prerequisite satisfaction, dependency edges, and template provenance match exactly;
- an isolated Marketing service does not acquire Content, Design, discovery, brand-statement, or website-architecture requirements unless an approved rule for that selected service requires a short context stage;
- Data API table privileges, function EXECUTE privileges, RLS enablement, policy commands and roles, foreign-key indexes, and negative unauthorized cases are all asserted by the verifier.

## Verification matrix for the eventual implementation

1. Focused Node tests for template normalization, version immutability, preview shape, repository organization scoping, and UI behaviour.
2. Existing Operating Spine, active-organization, canonical-ownership, Workspace, RET, QTS, WCH, and OAI regressions.
3. Full `npm test`, `npm run build`, and `npm run lint`.
4. All Supabase Edge Function tests and type checks only if an Edge Function is added or changed.
5. Static SQL inspection plus the new verifier against an authorized disposable or local database; never against live production without separate approval.
6. Exact merge-base check against freshly fetched `origin/main` immediately before review.
7. Merge simulation for `OperatingSpine.jsx`, `operatingSpineRepository.js`, focused tests, and migration ordering.

## Stop condition

Do not implement PLN2 or PLN3 until the template graph-authority option, modification and provenance rules, publication roles, and idempotency contract are explicitly approved. Once decided, PLN2 must land and be reviewed before PLN3 is implemented because preview and instantiation depend on the finalized version schema.
