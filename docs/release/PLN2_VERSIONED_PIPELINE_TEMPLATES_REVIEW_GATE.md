# PLN2 — Versioned Pipeline Templates Review Gate

Status: corrected and verified locally for review; not pushed, merged, deployed, or applied to any shared/live database.

## Review basis

- Canonical base: `origin/main` at `c30b4fab1cf95ed2eec88f7c211e05a2d9cd3607` (RET3 merge).
- PLN branch: `feat/pln-pipeline-composition-audit` in the isolated `anka-os-pln` worktree.
- This implementation follows the approved Product Design decision: a pipeline template is an immutable, versioned preset of selected services. It does not own a stage, dependency, or prerequisite graph.
- Existing canonical delivery rules remain authoritative: `service_stage_rules`, `blueprint_stage_catalog`, and `blueprint_stage_dependencies` determine the journey at planning time.
- Publishing authority uses existing role labels only: System Owner and Operations Admin publish; Department Managers may draft and preview. No role or privilege escalation was invented.

## Delivered scope

Migration `20260903201500_pln2_versioned_pipeline_templates.sql` adds:

- `pipeline_templates`: stable organization-scoped template identities.
- `pipeline_template_versions`: immutable version metadata and ordered-selection hash.
- `pipeline_template_version_services`: the ordered, immutable service preset.
- `pipeline_template_publications`: append-only publication records with a snapshot hash and manifest of the canonical rules at publication time.
- `engagement_pipeline_origins`: an append-only PLN3 integration boundary for original template/version, customized selection, and rule-preview provenance.
- `engagement_composition_requests`: a server-only PLN3 integration boundary for organization-scoped request IDs, normalized-payload hashes, and exact-replay idempotency.
- `create_pipeline_template_version(...)`: a role-checking draft/version action.
- `publish_pipeline_template_version(...)`: a role-checking, replay-safe publication action.
- RLS, grants, composite tenant foreign keys, foreign-key indexes, and append-only guards.
- PLN-private authorization helpers that require an authenticated caller, active team-kind membership, active membership status, and an active organization. The shared foundation helpers remain unchanged.

The repository adapter exposes organization-scoped reads and only those two database-owned mutations. It does not reproduce authorization in the browser.

## Architectural invariants

1. A template version freezes only an ordered service selection plus descriptive metadata.
2. No template-owned stage, dependency, prerequisite, or workflow graph is introduced.
3. Publishing records the current canonical rule manifest and hash only to support future drift information. The snapshot never becomes execution authority.
4. Old versions retain their original service selection. A future preview will use current canonical rules and report drift without modifying existing engagements.
5. Pre-creation customization is reserved in append-only provenance: the original template/version, original and final selection hashes, and a JSON array of changes remain attributable.
6. The existing `compose_engagement(...)` signature, privileges, and implementation are unchanged.
7. Preview and creation do not yet exist in PLN2. PLN3 must provide one database-owned planner, then re-plan and revalidate during creation rather than trusting a browser preview.
8. PLN3 idempotency must use the reserved organization-scoped request ID and normalized-payload hash: an exact replay returns the same engagement; reuse with a different payload fails.

## Security and verification matrix

The rollback-only SQL verifier checks:

- exact RLS enablement and the intended policy set;
- exact table and RPC ACL matrices, including no browser insert/update/delete privileges;
- security-definer and fixed-search-path requirements on both public actions;
- append-only protection on all six PLN tables;
- organization-consistent composite foreign keys and supporting indexes;
- absence of any template-owned graph tables;
- preservation of the canonical composer;
- canonical-rule manifest inputs and required hashes;
- runtime role behavior for Department Manager, Operations Admin, and Contributor;
- draft visibility, publication visibility, ordered service retention, idempotent publication replay, and rejected mutation/deletion.
- actual policy expressions and enabled trigger type/function behavior, rather than catalog names alone;
- privileged client-kind role denial, suspended and archived organization denial, suspended and revoked membership denial, cross-organization service/write/read denial, anonymous denial, and zero-row side effects;
- authorization being re-evaluated before an existing publication is returned on replay;
- actual valid index-prefix coverage for every PLN foreign key, including constraint-backed coverage, with no duplicate composition-request index or unreferenced publication identity constraint.

The verifier starts a transaction and always rolls it back. All 38 named checks passed against a separate disposable PostgreSQL 17.11 database restored from a schema-only snapshot and populated only with synthetic reference rows. No shared task database or production system was contacted. Live verification and application remain with the source Admin.

## Migration ordering

The PLN2 filename is ordered after the committed RET3 migration `20260903185206_ret3_monthly_planning_preview.sql`:

`20260903201500_pln2_versioned_pipeline_templates.sql`

If another migration lands at or beyond this timestamp before merge, the source Admin should coordinate a filename-only reorder before database application.

## Explicitly out of scope

- PLN3 planner, drift-preview query, stale-preview rejection, template-backed engagement creation, and product UI.
- Any change to `compose_engagement(...)` or existing engagement rows.
- PLN4 add/pause/replace/remove behavior after engagement creation.
- Legacy `workflow_templates`, `workflow_stages`, and `project_workflow_templates`; they are not the canonical pipeline-template foundation.
- RET-owned engagement workspace and retainer planning files.
- WCH-owned chat and department-chat files.
- Shared navigation, unrelated schemas, QTS, OAI, deployment, live database work, and production configuration.

## Local review commands

```text
node --test src/data/pipelineTemplates.test.js
npm test
npm run build
npm run lint
```

Database reviewers should inspect and, in an authorized disposable/local database, run:

```text
supabase/verify_20260903201500_pln2_versioned_pipeline_templates.sql
```

## Corrected local evidence

- Focused PLN2 contracts: 11 passed, 0 failed.
- Full Node suite: 464 passed, 0 failed.
- Exact CI-configured frozen Deno suite: 143 passed, 0 failed on checksum-verified Deno 2.9.5.
- Exact CI-configured Deno check: passed.
- Production build: passed.
- Lint: 0 errors and 347 pre-existing warnings.
- Disposable PostgreSQL migration: applied successfully.
- Rollback SQL verifier: all 38 named checks passed and rolled back.
- Supabase CLI database lint could not run because the portable PostgreSQL distribution does not include `plpgsql_check`; no extension was installed and the direct PostgreSQL verifier result is reported separately.

## Decision gate for PLN3

PLN2 should be reviewed and merged before planner or UI integration begins. PLN3 must rebase after PLN2 and consume these reviewed catalog, publication, provenance, and idempotency contracts rather than duplicating them.
