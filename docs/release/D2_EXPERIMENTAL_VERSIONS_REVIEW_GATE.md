# D2 Experimental Versions — Review Gate

## Release boundary

- Built on the merged D3/W4 `main` line in an isolated D2 branch.
- Do not merge, apply the migration, or deploy `design-workshop` or the frontend before explicit sign-off.
- D2 changes only Design direction-version concerns. It does not change `work_items`, `work_item_dependencies`, or W-series files.

## Intended change

- Extend immutable `design_direction_versions` with `is_experimental` and an optional invited-user list.
- Keep ordinary versions visible to active team organization members as before.
- Restrict an experiment to its creator and invited active team members.
- Show visible experiments separately from main history and comparison candidates.
- Promote by inserting a non-experimental child whose parent is the experiment; never update or delete the experiment.
- Reject experimental rows at both selection and release boundaries.

## Required review checks

- [ ] An uninvited active organization member receives zero rows for a real experimental-version query.
- [ ] The creator and an invited active member can read that exact experiment.
- [ ] Existing non-experimental visibility is unchanged.
- [ ] Default main history and comparison queries explicitly require `is_experimental = false`.
- [ ] The experiment list is separate and remains protected by table RLS.
- [ ] D1 proofing comments inherit experiment visibility and do not leak hidden comment text or target IDs.
- [ ] Promotion inserts a new non-experimental row with `parent_version_id` equal to the experiment.
- [ ] Promotion copies content without updating, deleting, or reclassifying the experimental row.
- [ ] Experimental versions cannot be selected or released, including through a service-role write.
- [ ] Invitees are validated as active team members in the same organization.
- [ ] No W-series surface, approval gate, release authority, timer, or generalized artifact experiment model is changed.

## Verification

```powershell
npm test
npm run lint
npm run build
npx deno test --no-config supabase/functions/design-workshop/index.test.ts
npx deno check --no-config supabase/functions/design-workshop/index.ts
npx supabase db push --dry-run
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
```

After applying the D2 migration to an isolated review database, run:

```sql
\i supabase/verify_20260829092128_experimental_design_versions.sql
```

Every JSON result must be `true`, especially `uninvited_experiment_hidden`, `nonexperimental_visibility_unchanged`, and `promotion_created_immutable_child`.
