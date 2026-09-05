# PLN2 security correction evidence

Status: local correction ready for independent Admin review. No push, pull request, shared/live database access, migration application, merge, deployment, or PLN3 work was performed.

## Source and scope

- Branch: `feat/pln-pipeline-composition-audit`.
- Refreshed base and merge-base: `c30b4fab1cf95ed2eec88f7c211e05a2d9cd3607`.
- Reviewed incoming PLN2 head: `6c524681a1611e68786b787bdfa00e564879c059`.
- The final correction commit and exact final HEAD are supplied in the Admin handoff after commit; a tracked evidence file cannot embed the hash of the commit that contains itself.
- Corrected files are limited to the PLN2 migration, rollback verifier, Node contract test, this evidence packet, and the existing PLN2 review gate.
- The shared organization foundation helpers, canonical composer, RET/WCH/QTS files, shared navigation, and all PLN3 functionality remain unchanged.

## Corrections made

1. Added PLN-private SECURITY DEFINER authorization helpers with fixed empty search paths and explicit `auth.uid()` checks.
2. Drafting, publication, and publication replay now require all of:
   - active organization;
   - active organization membership;
   - `member_kind = 'team'`;
   - the approved existing role for the action.
3. Every PLN-owned browser-readable policy now requires active team membership in an active organization. Draft/version visibility retains creator, authorized manager, or published-version semantics inside that boundary.
4. The verifier inspects real policy expressions, RPC definitions, helper security/ACLs, enabled row-level BEFORE UPDATE/DELETE triggers, trigger function type/security, tenant foreign keys, and usable index prefixes.
5. Runtime rollback cases now cover privileged client-kind memberships, suspended and archived organizations, suspended and revoked memberships, cross-organization services/writes/reads, anonymous calls/reads, and replay after authorization revocation. Rejected calls are also proven to leave template/version/publication row counts unchanged.
6. Removed the duplicate `engagement_composition_requests(engagement_id, organization_id)` index because the existing UNIQUE constraint already provides that exact index.
7. Removed unreferenced `pipeline_template_publications UNIQUE(id, organization_id)` while retaining its UUID primary key and all referenced uniqueness contracts.
8. Added the genuinely missing `pipeline_templates(created_by)` foreign-key support index. The verifier proves usable coverage for all 15 PLN foreign keys, including the semantically complete non-null partial source-version index.

## Local SQL verification

A separate loopback-only PostgreSQL 17.11 cluster was initialized under a task-specific system temporary directory on port 55439. It used the existing portable PostgreSQL binaries read-only, restored a schema-only snapshot into a new `pln2_local` database, and inserted synthetic reference rows only.

- PLN2 migration applied successfully.
- Initial strengthened verifier run: 37/38 passed; the new index checker correctly identified the intentionally partial `source_version_id IS NOT NULL` index as the sole false negative.
- Catalog inspection confirmed all 15 foreign keys had usable index coverage and isolated the checker mismatch.
- The checker was corrected to accept only that explicit semantically complete partial predicate.
- Final verifier run: 38/38 named checks passed, followed by `ROLLBACK`.
- Supabase CLI 2.115.0 `db lint` reached only the disposable database but could not enable the absent `plpgsql_check` extension. No extension was installed and no shared/remote database fallback was attempted.

## Full local gates

- `node --test src/data/pipelineTemplates.test.js`: 11 passed, 0 failed.
- `npm test`: 464 passed, 0 failed.
- CI-configured `deno test --frozen`: 143 passed, 0 failed.
- CI-configured `deno check --frozen`: passed.
- `npm run build`: passed.
- `npm run lint`: exit 0, 0 errors, 347 pre-existing warnings.
- Deno runtime: official 2.9.5 Windows x86_64 archive, verified against its matching published SHA-256 asset before extraction.

## Release boundary

PLN2 still requires Admin review and release. PLN3 must not begin until PLN2 is reviewed, merged, released as applicable, and the PLN branch is rebased on the resulting main. Admin retains sole ownership of production access, database application, push, PR, merge, and deployment.
