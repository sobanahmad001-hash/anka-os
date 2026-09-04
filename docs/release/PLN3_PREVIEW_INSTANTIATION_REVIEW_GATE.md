# PLN3 — Pipeline Preview and Instantiation Review Gate

Status: implemented and verified locally for review; not pushed, merged, deployed, or applied to any shared/live database.

## Review basis

- Canonical base: `origin/main` at `2047cb6546a4a174e2bb7874f96da1aae814fe09` after the released PLN2 merge.
- Branch: `feat/pln3-preview-instantiation` in the isolated `anka-os-pln` worktree.
- PLN2 remains the persistence authority for immutable service presets, publications, composition provenance, and request idempotency.
- The existing `compose_engagement(...)` function remains the only graph-instantiation authority.
- Current `service_stage_rules`, `blueprint_stage_catalog`, and `blueprint_stage_dependencies` remain authoritative. A published rule snapshot is informational drift evidence, never execution authority.

## Delivered scope

Migration `20260904000717_pln3_preview_instantiation.sql` adds no tables. It adds:

- one private deterministic planner shared by preview and creation;
- one zero-write preview action for a visible immutable template version and a proposed ordered service selection;
- one atomic template-backed wrapper around the unchanged canonical composer;
- server-owned normalization of service owners and existing assets;
- a preview hash bound to organization, immutable template version, ordered service selection, current canonical-rule hash, and the planned graph;
- stale-preview rejection before canonical composition writes;
- organization-scoped advisory locking and exact-payload replay through PLN2's request ledger;
- append-only origin provenance through PLN2's existing engagement origin boundary;
- authenticated-only execution with a fixed empty search path and active team membership checks.

The existing Operating Spine composer now offers an optional published template preset. Direct service composition remains available and continues to use the unchanged path. Template-backed creation requires a current preview, displays rule drift and historical-version context, and invalidates an in-flight or completed preview whenever plan inputs change.

## Architectural invariants

1. Templates own only an immutable ordered service preset; no template-owned stage, prerequisite, dependency, workflow, or owner graph exists.
2. Preview performs no inserts, updates, or deletes.
3. Preview and creation call the same database planner.
4. Creation re-plans inside the write transaction and rejects a changed rule or graph hash before calling the canonical composer.
5. Canonical context-gate dependencies win the same pair conflict that the existing composer resolves by insertion order; preview therefore matches the instantiated dependency graph exactly.
6. Draft preview is available only through PLN2's existing visible-version authority. Composition requires a published version.
7. Exact request replay returns the same engagement. Reuse of a request ID with different normalized input is rejected.
8. Existing engagements and the canonical composer are not rewritten.

## Rollback verifier

`supabase/verify_20260904000717_pln3_preview_instantiation.sql` starts a transaction and always rolls it back. Its 20 named checks cover:

- exact RPC privileges, security-definer configuration, volatility, and private planner execution;
- preservation of the canonical composer and use of canonical rules/dependencies;
- deterministic and zero-write preview behavior;
- Department Manager draft preview and Contributor published-version visibility boundaries;
- rejection of Contributor draft preview, unpublished composition, anonymous execution, and cross-organization preview;
- named versus unnamed prerequisite assets;
- same-set reorder provenance;
- preview/instantiation stage and dependency parity, including a duplicate canonical/context dependency pair;
- append-only origin persistence;
- exact replay, changed-payload rejection, and stale-preview rejection with no residual writes.

The verifier passed against a fresh disposable PostgreSQL 17.11 cluster restored from the schema-only snapshot, seeded only with synthetic reference rows, and upgraded locally through PLN2 and PLN3. The transaction rolled back and the disposable cluster was removed. No shared database was contacted.

## Local evidence

- Focused PLN3 contracts: 6 passed, 0 failed.
- Full Node suite: 519 passed, 0 failed.
- Exact CI-configured frozen Deno suite: 153 passed, 0 failed on checksum-verified Deno 2.9.5.
- Exact CI-configured frozen Deno check: passed.
- Production build: passed.
- Lint: 0 errors and 359 pre-existing warnings; PLN3 adds no warning.
- Fresh disposable PostgreSQL migration chain: PLN2 then PLN3 applied successfully.
- Rollback SQL verifier: all 20 named checks passed and rolled back.

## Migration ordering

The migration was generated with the repository-pinned Supabase CLI and is ordered after WCH3 migration `20260903235243_department_chat_proposals.sql`:

`20260904000717_pln3_preview_instantiation.sql`

If another migration lands at or beyond this timestamp before merge, the source Admin should coordinate a filename-only reorder before any database application.

## Explicitly out of scope

- PLN4 post-creation add, pause, replace, or remove behavior.
- Any mutation of existing engagement graphs.
- Any change to canonical `compose_engagement(...)` behavior or privileges.
- Template-owned workflow graphs or ownership models.
- Shared Supabase migration application, push, merge, deployment, or production configuration.

## Review hold

Source Admin review remains required before push, shared database application, merge, or deployment.
