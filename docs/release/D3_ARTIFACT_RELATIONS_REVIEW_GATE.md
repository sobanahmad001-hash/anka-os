# D3 Artifact Relations — Review Gate

## Release boundary

- Branch from merged PR #28 on `main`.
- Do not merge, apply the migration, deploy `artifact-relations`, or deploy the frontend before explicit sign-off.
- D3 is isolated from W3. No `work_items`, `work_item_dependencies`, Work board file, or W3 migration/function file is part of this diff.

## Intended change

- Add one organization-scoped `artifact_relations` table with exactly `feeds_into`, `derived_from`, and `referenced_by`.
- Permit relations between any two readable canonical artifact types in the same organization.
- Compute incoming and outgoing relations at read time, joined to canonical artifacts for title, type, and detail links.
- Add the reusable relation panel to Content, Marketing, Design context, Development, and the canonical artifact detail route.
- Keep relation create/delete actions server-authorized and leave browser roles read-only.

## Required review checks

- [ ] Both composite foreign keys enforce the artifact organization boundary.
- [ ] Self-relations and exact duplicate typed relations are rejected.
- [ ] The authenticated role has `SELECT` only; `anon` has no access.
- [ ] The relation RLS policy requires both source and target artifacts to remain readable.
- [ ] The Edge Function re-reads both endpoints through the caller's RLS client before inserting.
- [ ] The review-database verification temporarily hides a target artifact and proves its relation/title/type disappear from the rollup.
- [ ] Content-to-Marketing cross-type relation creation succeeds.
- [ ] Incoming and outgoing lists are live queries; no rollup/count/cache column exists.
- [ ] Creating or deleting a relation writes only `artifact_relations`.
- [ ] No cycle/DAG logic, new relation type, approval change, proofing change, or W-series surface is present.

## Verification

```powershell
npm test
npm run lint
npm run build
npx deno test --no-config supabase/functions/artifact-relations/index.test.ts
npx deno check --no-config supabase/functions/artifact-relations/index.ts
npx supabase db push --dry-run
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
```

After applying the D3 migration to an isolated review database, run:

```sql
\i supabase/verify_20260829083706_artifact_relations.sql
```

Every JSON result must be `true`, especially `cross_type_relation_created` and `inaccessible_target_hidden_from_rollup`.
