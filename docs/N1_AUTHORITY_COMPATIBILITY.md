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
