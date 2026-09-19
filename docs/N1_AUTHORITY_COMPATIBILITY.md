# N1 authority compatibility

Status: bounded local additive implementation complete and focused checks passed. Not deployed; no enforcement cutover.

Baseline: `dfd1e35cc5be6b5fe0945649a5baf4a0ddf77174`.

## Approved decisions

- Support multiple project-manager bindings per project. Seed only verified existing project-owner assignments, never role titles or first-profile ranking.
- Preserve legacy elevated Executive access during compatibility. Contributor Intern/Executive designations grant no authority.
- Department-head approval requires both department scope and permitted project access.
- Specialist review, project-bound cross-department PM confirmation, release, and execution completion are separate capabilities.
- Contributors may create unassigned tasks but cannot assign, self-assign, reassign, or approve under the target rules.
- Preserve IDs and history. Unverified mappings remain unresolved without changing current access.

## This slice

Migration: `supabase/migrations/20260919135700_n1_authority_compatibility.sql`, created using pinned Supabase CLI 2.115.0.

| New contract | Meaning |
| --- | --- |
| `organization_department_memberships` | Multiple department affiliations per member, one active row per department. Tenant-composite foreign keys prevent cross-organization scope. |
| `organization_contributor_designations` | Explicit `intern` / `executive` labels for contributors only. One active designation per member; never read as a role. No inferred designation backfill. |
| `project_manager_bindings` | Multiple active managers per project and multiple projects per manager. Uniqueness is per member/project, not per project. |
| `private.n1_authority_backfill_issues` | Private durable record of unverified departments/projects and legacy elevated roles not reinterpreted. Existing access is not changed by an issue. |
| `get_my_authority_compatibility(uuid)` | Caller-only, SECURITY INVOKER read of current legacy role/department and new record histories, explicitly marked `compatibility_only: true`. Not capabilities or effective permissions. |

New record history is immutable except active-to-revoked transitions with a timestamp. Re-adding a scope creates a new row. Hard deletion is denied, including restrictive parent FKs: a later account/organization purge needs a separately reviewed retention plan. No existing role value, ownership field, policy, grant or authorization helper was changed. New tables have RLS; authenticated access is self-read only for active team members of active organizations. Service-role insert/update is available for future controlled administration, but no browser mutation endpoint or management UI is added here. No SECURITY DEFINER function is introduced.

### Verified backfill definition

- Department: active team membership and active organization, with the existing department's organization matching the membership. A missing department is not guessed. Invalid/inactive non-null mappings are recorded as `legacy_department_unverified`.
- PM: non-archived canonical project with a non-null owner who has active team membership in that same active organization. Any linked engagement must agree on organization and lead owner. No engagement is required for an internal project. Title alone never qualifies. Unseeded projects are recorded as `project_owner_unverified_or_absent`.
- Stable seed IDs derive from source membership/project/department IDs. Source role and identity facts are stored as provenance. Source tables are locked during the bounded migration transaction for consistent derivation; no ongoing synchronization is installed.
- Elevated `executive` / `project_owner` roles are recorded as not reinterpreted, even where a separately verified ownership fact produces a PM record. No first-profile ranking or profile title is consulted.

### Compatibility readers

`src/data/organizationScope.js` adds only an opt-in `readAuthorityCompatibility` method; existing list/selection normalization and legacy result shape are unchanged. `supabase/functions/_shared/serverOrganizationContext.ts` exports an opt-in `readServerAuthorityCompatibility` helper that uses the caller's RLS client, not the privileged admin client; existing resolution is unchanged.

Both use `supabase/functions/_shared/authorityCompatibility.js`: validates organization/actor/history envelopes, projects known top-level fields, preserves revoked history, and propagates missing-migration/access failures. There is no fallback from absent new records to legacy role titles and no generated permission boolean. Existing callers never invoke the new RPC implicitly, so this slice does not depend on live deployment to preserve their behavior.

The histories are snapshot facts, not effective current authority: ownership or membership changes do not synchronize these shadow rows, and revocation of a department record does not rewrite legacy `department_id`. The read RPC checks current organization membership before returning history. Enforcement must revalidate appropriate live scopes at its eventual write boundary.

## Focused verification — 2026-09-19

- Node: `node --test src/data/authorityCompatibility.test.js src/data/organizationScope.test.js` — **19 passed**.
- Deno: `deno test --cached-only --frozen --allow-env supabase/functions/_shared/serverOrganizationContext.test.ts` — **22 passed**, including type checking and unchanged root/organization isolation cases. Initial attempts stopped before tests for missing node_modules and alternate cached-mode lock mismatch; final run reused the existing exact Supabase 2.112.4 dependency directory via an ignored local junction. No packages or lockfiles were changed.
- PostgreSQL **17.11**: `supabase/tests/run-n1-local.ps1 -PostgresBin <existing-local-pg-bin>` — migration applied successfully to a fresh localhost-only synthetic fixture; **41 assertions passed**. Covers existing grants/policies/rows unchanged, deterministic eligibility, title-only rejection, multi-PM/multi-department records, cross-tenant FK rejection, designation without elevation, immutable/re-added history, self-only RLS, RPC ACL, and revoked organization memberships using an existing caller identity, plus client/inactive/no-identity rejection. Initial expected department count omitted a valid second-tenant row; only the fixture expectation was corrected, then SQL validation rerun. This does not test Supabase Auth session revocation or `auth.sessions`.
- Focused ESLint on the three changed/new JavaScript files — **passed**.
- `vite build` — **passed**, 470 modules; chunk-size warning only.
- Diff whitespace check — **passed** before final commit.

The local runner creates a fresh temporary cluster, never reads linked database credentials, runs the fixture/migration/behavior SQL in one session, and stops its server in `finally`. Successful retained cluster: `C:/Users/Soban/AppData/Local/Temp/anka-n1-684f7056e70a43da9740570a1d362216`. It is synthetic evidence, not a full historical schema replay, hosted advisor run, live backfill result, deployment receipt, or signed-in acceptance. No broad test suite or unchanged historical release checks were rerun.

The failed file-edit wrapper was replaced by the verified installed apply_patch engine through scoped elevated execution. All source edits still used standard apply_patch patches. Existing user work and the navigation checkout were preserved. CLI-generated cache changes in this isolated checkout were restored; dependencies were reused, not reinstalled.

Supabase guidance consulted: [changelog](https://supabase.com/changelog) and [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security). This guided explicit new-table grants/RLS, current database membership checks, tenant keys, and avoiding new SECURITY DEFINER endpoints. No relevant listed breaking change required altering this additive contract.

## Bounded master-review follow-up — service-role verification

Master reviewed the source of `bc593feef6dcd5cb14924a7d0de44172f0e2cc28` and identified the missing positive service-role mutation coverage. This follow-up changes only fixture/behavior SQL, the local runner and this record; the N1 migration and application readers are unchanged. No production acceptance is claimed.

`n1_authority_compatibility.service-role.sql` now switches to the actual non-superuser `service_role` fixture role with no caller identity and checks:

- Insert/revoke/re-add across all three shadow tables, with one active and one revoked row retained for each round trip.
- Trigger schema/function access and reads of parent organization/membership tables. Temporarily revoking SELECT on either parent makes an insert fail; transaction savepoints restore fixture grants.
- Denied DELETE on all three shadow tables; allowed private issue-ledger SELECT and denied ledger DELETE; rejected binding for a revoked membership.
- All three mutation ACLs plus actual INSERT/UPDATE/DELETE attempts under each of `authenticated` and `anon`, across all three tables (18 denied write attempts).

### Parent-contract reconciliation and explicit assumptions

The source was checked only for relevant grants/policies at the frozen baseline, not by replaying historical migrations:

- `20260825010000_organization_access_foundation.sql:186` and `:219` define the organization/role read helpers; `:254` and `:269` define organization-member and own/elevated membership reads. The fixture now models those SELECT semantics instead of its narrower ad-hoc own-only policy. No later definitions of those helpers/read policies were found in this bounded search. The owner FOR ALL mutation policies are deliberately not modeled; these tests do not mutate parent rows as authenticated.
- `20260825040000_canonical_delivery_core.sql:29`–`:30` establishes private-schema USAGE for authenticated/service roles, denying PUBLIC/anon. The fixture mirrors that. `20260825020000_security_boundary_hardening.sql:36`–`:40` revokes default PUBLIC/anon execution on new public functions; the fixture now mirrors that before applying N1.
- No application migration in the bounded grant/role search explicitly establishes `service_role` BYPASSRLS or SELECT on `organizations`/`organization_memberships`. These are **platform assumptions**, not facts verified against the installed database. The fixture explicitly creates non-superuser BYPASSRLS and grants only parent SELECT, replacing its blanket service-role ALL-table grant. Authenticated parent SELECT and public/auth schema USAGE are also explicit fixture assumptions, not a live ACL receipt.
- Parent shapes remain a minimal synthetic subset. Project/department composite keys were reconciled previously; unrelated columns, constraints, policies and triggers are not replayed. `auth.uid()` remains a synthetic existing-caller-identity setting, not JWT verification, token expiry, sign-out or `auth.sessions` behavior. Before any release, verify installed parent grants, schema USAGE, helper privileges, role attributes and full-schema compatibility through an explicitly authorized acceptance step. Do not add production grants merely to make this fixture pass.

### Targeted result

One local SQL run passed **82 assertions total**: the original 41 plus 17 direct and 24 looped assertions in the service-role section. PostgreSQL 17.11 applied the unchanged migration successfully. Command: `supabase/tests/run-n1-local.ps1 -PostgresBin <existing-local-pg-bin> -ClusterParent G:/AnkaSphereN1LocalChecks`.

The runner validates an existing physical cluster-parent directory and creates a unique child. Evidence is retained in `G:/AnkaSphereN1LocalChecks/anka-n1-175d089ea2304a92a12b97a11a5cf43d` with its server stopped; no new C-drive cluster was created for this follow-up. No existing evidence was deleted. Node/Deno/lint/build evidence above was reused unchanged; no broad rerun. Full-schema, hosted/live and signed-in acceptance remain open.

## Deferred enforcement (unchanged)

Cutover must cover direct Project Task writes, task update/transition RPCs, shared Engagement Work Item saves and alternate callers, deliverable governance, artifact nomination/signoff, and corresponding UI capabilities. The additive slice alone does not close existing permission gaps.

Exact deferred surfaces from N0: task policies/lifecycle in `20260825040000_canonical_delivery_core.sql`; creator/assignee defaults in `src/data/deliveryRepository.js`; `update_p5_project_task`, `transition_p5_project_task`, `save_p5_work_item` in `20260904120000_p5_unified_planning.sql`; shared `save_work_item` in `20260902000000_uw3_work_item_chat_proposals.sql` plus AI/promotion/automation callers; P7 assignment/reviewer/release helpers and capability RPC in `20260904130000_p7_governed_deliverable_release.sql`; artifact nomination/signoff in `20260829095245_multi_approver_policies.sql` and `supabase/functions/artifact-approvals/index.ts`; `ProjectPlanningPanel`, `WorkItemsPanel`, `ArtifactApprovalPanel`, `MyWork`, UserManagement and invite-user integrations. No frozen migration was rewritten.

Next gate: master reviews this local commit, conservative mapping rules and unresolved-mapping ledger, then explicitly scopes any enforcement/admin-write implementation or release. Department-head project access and separate specialist review/PM confirmation/release must be enforced in that later slice; the approved distinctions are not new powers in this one.

No publication, live migration, deployment, provider use, or paid action is authorized by this local implementation slice.

## N1-B — controlled pre-cutover administration

Implemented on the N1 lineage after `a07191c6215f5c644129eceb2e97d57271123c59`. This is local implementation for master review, not release acceptance.

### Boundary and behavior

- New public invoker RPCs `get_authority_administration` and `change_authority_compatibility` call two private, fixed-empty-search-path definer entry points. This is an intentional narrow admin privilege boundary: each entry derives the actor from `auth.uid()` and verifies the current active organization and active team membership with existing `system_owner` or `operations_admin` role. Internal invoker helpers are not executable by API roles; anonymous and service-role execution of the new endpoints is denied. Browser table mutation grants remain unchanged/denied.
- Commands add/revoke department records, set/replace/clear Intern or Executive contributor designations, and add/revoke project-manager bindings. All targets are same-organization team members. Additions require active membership; non-null designation requires legacy `contributor`. Inactive targets can have old records revoked/cleared. New PM bindings require a same-tenant, non-archived project. Multiple PMs and multiple department memberships are retained.
- There is no role/title inference, legacy role change, project owner rewrite, profile update, invite/delete change or dual-write. The old UserManagement component body is unchanged, nested under its existing profile-admin gate. New owner/admin membership does not unlock those legacy controls.
- A per-organization transaction advisory lock serializes this low-volume administration lane; organization/caller/target and selected parent rows are locked while checked. The client submits the token of its exact target snapshot. A stale command fails with SQLSTATE `40001`; the UI reloads without retrying the write. This serializes these RPCs, not all legacy/service writers. Unique constraints and existing immutable-history triggers remain active.
- New records carry authenticated actor/request provenance. Revocations preserve the original row. A private immutable receipt records the command, target, actor and result, including revoke/clear actions. Same actor/org/request ID plus identical payload replays one result; conflicting reuse fails. Current caller authorization is checked before replay. The receipt is not a browser-readable audit API.
- The `/users` page now separates selected-organization compatibility controls from fixed-Anka legacy team controls. Eligible members get a scoped sidebar link. The compatibility panel states that records are not effective permissions, removal does not revoke all legacy access, and Contributor Executive is not the legacy elevated Executive authority role. Records and history load via the admin RPC, never broader profile queries. The read endpoint projects only same-organization member names and same-organization options.
- React organization/user/scope keys, request cancellation and late-response checks prevent old-scope reads or mutation completions from populating a new panel. Saves require explicit buttons, duplicate submissions are guarded, and load/access/missing-migration failures never fall back to legacy writers.

### Focused verification

- PostgreSQL 17.11: `supabase/tests/run-n1-local.ps1 -PostgresBin <existing-local-pg-bin> -ClusterParent G:/AnkaSphereN1LocalChecks -Administration` — passed the N1-B behavior suite and real two-session concurrency check. The new mode applies the synthetic parent fixture and N1 migration as prerequisites; it does not rerun the original N1 behavior/service-role suites.
- Behavior coverage: owner and operations-admin positives; multi-department/multi-project/multi-PM histories; designation replacement/clear without role elevation; inactive-target cleanup; current actor membership/org revalidation; same-tenant checks; contributor eligibility; executive/project-owner/department-head/contributor/client/foreign/revoked-admin/anonymous rejection; direct helper/receipt denial; unchanged legacy parent rows, policies and table ACLs; immutable receipts and restricted direct browser mutation grants.
- Concurrent sessions: first edit held its transaction while second submitted the same snapshot; second received `40001`, only the first designation committed, no failed-command receipt was written. Exact replay returned its receipt; replay after actor revocation received `42501`.
- `node --test src/data/authorityAdministration.test.js` — **8 passed**. Covers scoped RPC-only commands, no actor/role claims, fail-closed envelopes, explicit replay IDs, no implicit retries, and abort/late-response behavior.
- `node --test src/data/authorityAdministrationMount.test.js` — **5 passed** against an offline synthetic DOM and RPC client. Covers explicit submit, warnings, legacy Executive designation restrictions, duplicate clicks, stale reload with no retry, keyed organization switching, and missing-migration error/reload. The small synthetic DOM helper reuses the established workshop-harness approach; no unrelated workshop tests were reopened.
- Focused ESLint — **0 errors, 7 warnings** from the repository's JSX-unaware unused-variable rule for JSX-used component names in UserManagement/Sidebar. No warning suppression or lint config changes.
- Vite build — **passed**, 472 modules; existing large-chunk warning only. Diff whitespace check passed.
- Pinned CLI 2.115.0 security advisor against the exact synthetic localhost database reported **No issues found**. The initial advisor attempt required disabling TLS for this localhost-only server; corrected command uses `--db-url postgresql://postgres@127.0.0.1:<port>/postgres?sslmode=disable --type security --level warn`. No linked-project credentials or hosted advisor were used.

Successful final SQL cluster is retained, stopped, at `G:/AnkaSphereN1LocalChecks/anka-n1-41b8e6505b684c7db0242e2ace22db95`. The first behavior-only cluster is also stopped and retained. No previous evidence was deleted, no packages installed, and prior N1 Node/Deno/82-assertion evidence was reused.

The fixture adds only the parent display-name columns, a minimal profiles table and synthetic admin members required by N1-B. These name columns were reconciled with `supabase/schema.sql` and `supabase/phase2.sql`. Prior parent ACL/BYPASSRLS assumptions still apply; all fixture identity uses a synthetic claim setting. This does not prove JWT verification, token/session revocation, full installed schema compatibility, production default privileges, hosted grants, or signed-in browser/visual acceptance. Local advisor success is not hosted acceptance. N1 history's restrictive foreign keys may still affect existing legacy deletion behavior; do not treat legacy user deletion as verified by this slice.

The Supabase skills guided the private privilege boundary, explicit ACLs, current database membership checks, fixed search paths and local-only advisor verification. Current [database function documentation](https://supabase.com/docs/guides/database/functions) and [changelog](https://supabase.com/changelog) were consulted; no relevant listed breaking change alters this contract.

### Next gate / enforcement scope

Master reviews the local N1-B commit before publication. All records remain pre-cutover and inert in effective permission decisions. The next separately scoped enforcement slice must address the exact deferred task/work-item/direct-write/alternate-caller, deliverable-governance and artifact-approval surfaces already listed above, plus their UI capabilities. Preserve the legacy elevated Executive until an explicit migration decision; define department-head project access and separate specialist review, PM confirmation and release checks. Do not silently apply the new contributor designation as authority or equate a compatibility revoke with complete legacy-access removal.

No live migration, deployment, publication, production fixture, provider call or paid action occurred.

## N1-C1 — common assignment boundary (local, release blocked)

Dependency: N1-B `04ffe2a4ceaac15b8a4771d64cf493a4fee3e4d4`. Master accepted local continuation, not installed-schema or production acceptance. This first coherent sub-slice protects BOTH distinct Project Tasks and Engagement Work Items. It is not the full N1-C release bundle.

### Approved follow-on architecture, now recorded

Master relayed explicit user approval of (1) explicit canonical project–department participation, with current department heads restricted to their own department's work in a participating project; organization-wide read visibility is not management authority, and (2) immutable-version/assignment-payload-bound recurring delegation approved by a current same-project PM or authorized org admin. A registered scheduler may reproduce only approved assignments, must recheck current delegation/scope/eligibility, and gains no general authority. Modified assignments require fresh approval; unverifiable historical schedules fail closed. These follow-on controls are next in dependency order; this common slice does not infer/backfill them.

### Implemented common boundary

- Both table write paths are guarded, including service RPC/direct generator writes. Direct authenticated Project Task inserts derive the actor from `auth.uid()`, require matching creator and same-tenant current scope, and deny assignment absent explicit authority. Browser transaction settings cannot spoof actor identity. Direct browser updates are denied in favor of versioned service commands; this prevents an unversioned assignment overwrite bypass.
- Existing active organization System Owner, Operations Admin and legacy elevated Executive remain assignment authorities. Explicit active exact-project PM bindings give project-scoped assignment/execution, including cross-department work, not specialist approval/PM confirmation/release. Contributor designations and unbound legacy role/profile titles are never authority. Heads remain fail-closed for assignment until the explicit participation sub-slice.
- Parent org/member/project and PM facts are checked/locked. New assignees must be active same-organization team members. Record organization/project/engagement/creator identity is immutable; a contributor cannot change department/workstream to obtain a different scope. Existing creator/assignee execution edits remain available through governed paths.
- P5 task update/transition preserve expected-row-version checks and row locks; their profile-title gate is replaced by current canonical scope. P5's actor helper propagates the verified Edge actor to the guard. The unchanged complete shared save body is retained privately behind the checked `save_work_item` entry; P5, AI proposal, Quick Task promotion and automation calls retain the public signature and event logic. All underlying writes still pass the table guard, including direct content/recurrence generators.
- Service-only peer-position reindexing and automation-flag annotations are allowed only if every identity, assignment and execution field is unchanged. Real automated execution is checked under its actor; unrelated contributors cannot use event automation to edit others' work.
- Assignment changes append private immutable history with actor, prior/new assignee and row version. Failed writes roll back history. Existing proposal/promotion/recurrence identities and histories are not rewritten. A stale versioned retry fails rather than adding duplicate assignment history.
- Manual and workflow-generated Project Task defaults are now unassigned. Server-returned per-record assignment/execution capabilities drive the Planning and Work Items controls; missing, wrong-scope or stale-version capabilities disable controls. These capabilities contain no approval/release grant. Admin warnings distinguish absent cutover from an installed assignment-only guard without claiming full legacy-access revocation.

### Focused evidence

- N1-C SQL runner applies minimal N1/N1-B prerequisites and a synthetic assignment fixture, loads exact relevant P5/shared-save/OAF2/lifecycle/automation function bodies from their source migrations, then applies the new migration. This is a bounded parent contract, not full historical replay.
- SQL behavior passed: direct inserts/self-assignment/update bypass/identity forgery/cross-tenant denials; exact-project PM, current owner and unchanged elevated Executive positives; contributor designation non-authority; assigned execution; P5 stale writes; representative common-save calls for all alternate provenance values; direct generator/machine assigned-generation denials; immutable history and current membership/PM revocation. Real existing event automation was executed positively and rejected for an unrelated contributor.
- Two real sessions passed competing assignment: the stale loser and stale retry receive `40001`; one winner/one history event remain; a subsequently revoked PM receives `42501`.
- `assignmentCapabilities.test.js`: 6 passed; targeted `deliveryRepository.test.js` “new tasks” case: 1 passed; `assignmentCapabilitiesMount.test.js`: 3 passed for contributor execution-without-assignment, explicit PM and stale controls across both record kinds. Alternate top-level AI/promotion checks are source-contract checks plus real shared-save/trigger execution, not full top-level endpoint acceptance.
- Build passed, 474 modules, existing chunk warning. Scoped lint: 0 errors, 26 JSX-used-name warnings. Local synthetic security advisor: No issues found.
- Final SQL evidence retained/stopped: `G:/AnkaSphereN1LocalChecks/anka-n1-4553c4b805a944819971d462b4f612ce`. Earlier failed/partial clusters are stopped and retained. Prior N1/N1-B unrelated tests reused.

The first SQL attempt exposed missing synthetic parent lock privileges: PostgreSQL FOR SHARE needs SELECT and UPDATE privilege on at least one parent column. The fixture now grants minimal column UPDATE on organization/membership status, project archived_at and engagement lead_owner_id. These are **installed-ACL assumptions**, not production grants; no live ACL was changed. Initial JS/mounted fixture failures were wrong promotion parameter name, missing workspace context, and a selector also counting the timezone save button; final focused tests passed after correcting fixtures.

### Release blockers and next dependency

Still blocked for release: explicit head participation controls and recurring assignment delegation are not integrated by this sub-slice; assigned scheduler generation and contributor/service-owner assignment remain fail-closed rather than silently dropping assignees or elevating actors. Current installed parent lock ACLs, full-schema compatibility and signed-in acceptance remain unverified. No live migration, publish, provider or paid action occurred.

The precise purge conflict is unchanged: `invite-user/index.ts:76` calls `auth.admin.deleteUser(targetUserId)`; line 115 calls the same hard-delete operation to compensate failed invitation setup. Organization membership user_id cascades on auth-user deletion (`20260825010000_organization_access_foundation.sql:117`), but any N1 department/designation/PM history row restricts deletion of its referenced membership, including revoked history. Either auth hard-delete may therefore fail when such history exists. The compensation path also ignores the delete result. Do not erase history, silently alter purge semantics, or ship until a separately reviewed retention/deprovisioning reconciliation resolves both operations.

Next: integrate explicit project–department participation/admin controls, then immutable recurring assignment delegation and scheduler revalidation/retry tests. Specialist review, PM confirmation and release remain the next separately scoped enforcement slice.

## N1-C2 — explicit project–department participation (local, release blocked)

Dependency: common boundary `219ae257cc7c7091be5a92e300976fe60c9d18f9`. No inferred/backfilled participation is created. Only current System Owner/Operations Admin can include or revoke a same-organization department in a canonical project, through tokenized, idempotent commands. Immutable history survives revocation; direct browser table access and service insertion are denied.

A current active canonical `department_manager` can assign their own department's Project Tasks and Engagement Work Items only while explicit participation is active. Profile titles, contributor designations, arbitrary multi-department affiliations and organization-wide project visibility do not establish head authority. Cross-department handoff requires authority over both old and new scope; exact-project PM/org authorities remain cross-department. Server capabilities distinguish per-department assignment from cross-department handoff. Specialist review, confirmation and release remain separate/ungranted.

Participation administration is appended to the existing authority panel. Selection alone does not mutate; explicit include/revoke uses snapshot token and request identity, blocks duplicate submits, discards late wrong-scope responses and reloads stale outcomes without automatic mutation retries.

Focused verification:
- Real migration and both record paths passed in the synthetic local SQL runner: no backfill, head/PM self-enrollment denied, foreign project/department denied, request replay and conflict/stale token checks, head-only department assignment, cross-project/cross-department denial, handoff isolation, current role/membership revocation and participation revoke, retained immutable history, unchanged PM scope.
- Two real sessions: stale concurrent administration rejected; exact replay deduplicated; replay after admin revocation denied.
- Four new participation-specific JS/mounted UI tests passed. Previously completed nine assignment capability/UI checks reused rather than rerun.
- Build passed (475 modules; existing chunk warning). Scoped lint 0 errors, 27 JSX-used-name warnings. `git diff --check` passed. Local security advisor: No issues found.
- Retained stopped evidence cluster: `G:/AnkaSphereN1LocalChecks/anka-n1-6b45e22471c44fc99248955e73e187aa`. Synthetic parent/ACL and mounted-DOM limitations remain exactly as in C1; no hosted/signed-in acceptance claimed.

Next approved dependency is recurring assignment delegation. Installed parent ACL/full-schema acceptance and the recorded auth hard-delete/history conflict remain release blockers. No live migration, deployment, push, provider or paid action.

## N1-C3 — immutable recurring assignment delegation (local, release blocked)

Dependency: participation `cd169bab56bd2ca5fa1e7653cb23fc8ffa4b0849`. Both approved local follow-on dependencies are implemented; this is not production acceptance.

### Authority and reproduction contract

- Explicit authenticated read/approve/withdraw RPCs use private fixed-search-path definer entry points and current same-project PM or System Owner/Operations Admin authority. Legacy elevated Executive alone, head scope, service ownership and contributor designations cannot approve delegation. Existing plan-version approval remains separate and is required first.
- Each private delegation preserves the entire immutable version and ordered template payload, approver, time and authority basis. PM approval binds the exact PM-binding ID: revoking and creating a new binding does not revive old delegation. Tokenized request receipts reauthorize replay; records are immutable except one-way withdrawal. Browser/service table mutation is denied.
- Approval seals template additions as well as existing update/delete immutability. Template insertion and approval serialize on the version row. Changed versions require fresh explicit delegation. No historical enrollment/backfill is inferred.
- Scheduler admission/execution and manual generation require delegation. The shared table guard permits only exact initial recurring reproduction: canonical org/project/engagement/service/occurrence/version/period, original machine or manual service-owner identity, exact template/content/department/assignee/dates/position, initial status/version, and no extra artifact/page/parent/automation links. Ordinary machine writes/updates remain denied.
- Existing machine registration/auth checks, plan/service/catalog state, applicable approved version, deadlines, occurrence uniqueness, request receipts and immutable generation/execution history remain intact. Current approver membership/authority and assignee eligibility are checked/locked. Assignment audit records reference the delegation.
- Manual service owners reproduce approved assignments without acquiring general assignment rights. Delegation covers the entire recurring template payload, including unassigned entries; assignees are never silently stripped.
- Missing/withdrawn/stale delegation fails closed with actionable manual-review/rejection guidance. Scheduler Edge errors add safe recovery guidance while preserving verified getUser identity and hiding internal database details. No machine identity, enrollment, secret or Cron job is provisioned.

Retainer planning has a separate Assignment delegation view: exact immutable version/payload inspection, explicit confirmation, approval/withdrawal, history and server-derived controls. Recorded active history is not presented as guaranteed current execution eligibility. This grants no specialist review, PM confirmation or release.

### Focused evidence

- Selective localhost harness loads actual RET1/RET2/RET4 migrations on explicit minimal N1-C synthetic parents, then C3; not a full historical or installed-schema replay.
- SQL behavior passed: no backfill; contributor/other-project Executive denial; exact-PM approval; replay/conflict/stale receipts; sealed templates; actual scheduler admission/execution and manual generation; forged assignment denial; no general machine writes; original actor/delegation audit; no duplicate occurrence/request/work; withdrawal, PM revocation/rebinding, assignee revocation, machine disable, archived project and changed-version denial; manual/scheduler collision preserves occurrence.
- Two-session concurrency passed: retry replays winner; exactly one occurrence/request and two assignments; concurrent committed withdrawal is rechecked without extra work.
- Final changed-helper delta reused the retained cluster: valid next manual period succeeds; forged page link and malformed period fail. A bounded Project Task insertion/versioned assignment smoke passed after replacement of the polymorphic common guard.
- Four new mounted UI tests passed: exact-payload confirmation, duplicate/stale writes, unauthorized controls, withdrawal and delayed wrong-scope reads. Four targeted Deno scheduler tests passed with cached/frozen dependencies, including verified actor preservation and safe actionable rejection.
- Build passed (476 modules, existing chunk warning). Scoped UI lint: 0 errors, 9 JSX-used-name warnings. Whitespace check passed. Final localhost security advisor: No issues found.
- Final behavior/concurrency/delta evidence retained/stopped: `G:/AnkaSphereN1LocalChecks/anka-n1-7a79094bf9ee49d4ba4c46d751fae53f`. Earlier successful pre-binding pass retained/stopped: `G:/AnkaSphereN1LocalChecks/anka-n1-5779800ca88747b1acd1c409edfa5f2d`. Prior N1/C1/C2 evidence reused, no broad rerun.

### Handoff / unchanged release gates

C1 common assignment, C2 participation and C3 delegation are ready for master local review together. Sole implementation lane preserved. No publication, live migration, production fixture, provider, paid action or broad historical review occurred.

Still release-blocked: installed parent lock ACLs/full-schema compatibility, signed-in integrated acceptance, and the exact auth hard-delete/retained-history conflict documented above. Supabase security skills guided private definer boundaries, explicit ACLs and localhost advisor checks. Specialist review, PM confirmation and release enforcement remain separate later scope. Local receipts are not production readiness.
