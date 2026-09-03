# PLN2 — Versioned Pipeline Templates Review Gate

Status: implemented locally for review; not pushed, merged, deployed, or applied to any database.

## Review basis

- Canonical base: `origin/main` at `762de0477f5cbbed7a5ec9bc65cd651fee494274`.
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

The verifier starts a transaction and always rolls it back. It must never be run against a live or production database as part of this task; database execution remains with the source Admin.

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

## Decision gate for PLN3

PLN2 should be reviewed and merged before planner or UI integration begins. PLN3 must rebase after PLN2 and consume these reviewed catalog, publication, provenance, and idempotency contracts rather than duplicating them.
