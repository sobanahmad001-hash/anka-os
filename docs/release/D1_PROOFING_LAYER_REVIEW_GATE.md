# D1 Proofing Layer review gate

This phase is stacked on PR #24 because PRs #23 and #24 are still open. Keep
`feat/proofing-layer` unmerged until both dependency PRs land. A green preview
is not permission to migrate or deploy production functions.

## Approved target correction

The source brief specified one non-null `artifact_version_id`, but also required
proofing on `design_direction_versions`, which is a separate canonical table.
The approved correction keeps one comment table with two nullable target
columns and a database CHECK requiring exactly one target.

Organization consistency is enforced with composite foreign keys:

- `(artifact_version_id, organization_id)` references
  `artifact_versions(id, organization_id)`.
- `(design_direction_version_id, organization_id)` references
  `design_direction_versions(id, organization_id)`.

A cross-table CHECK cannot safely enforce referential organization consistency;
the composite foreign keys are the database-native enforcement mechanism.

## Proofing and approval remain independent

- No migration changes `artifact_approvals`.
- The proofing Edge Function never reads from or writes to
  `artifact_approvals` and exposes no approval action.
- Resolving every comment does not create an approval or change approval state.
- Approval buttons and department approval functions keep their existing role
  checks and exact-version behavior.

## Append-only and authorization boundary

- Browser roles can select comments but cannot insert, update, or delete them.
- The authenticated Edge Function first proves the caller can read the exact
  target through the caller's RLS-scoped client.
- Any active team member who can read the target may add a comment.
- Only the comment author, a manager in the target's accountable department,
  or organization leadership may resolve it.
- A database trigger rejects deletion and changes to body, author, target,
  position, organization, ID, or creation time.
- Resolution is a one-way `false` to `true` transition with a resolver and
  timestamp. Comments cannot be reopened, edited, or deleted in D1.

## Exact-version and positional behavior

- Every query is filtered by one exact version ID. New artifact or direction
  versions never receive comments from a parent version.
- All twelve canonical artifact types have general comment threads.
- Website Architecture adds page-region anchors.
- Design direction previews accept normalized x/y click coordinates.
- The panel displays resolved/unresolved state and provides an unresolved-only
  filter.

## Verification checklist

- [ ] `20260828145700_artifact_version_proofing_layer.sql` creates exactly one
      new table and does not alter `artifact_approvals`.
- [ ] The exact-one-target CHECK is present and rejects zero or two targets.
- [ ] Both target composite foreign keys include `organization_id`.
- [ ] RLS is enabled and browser roles are read-only.
- [ ] The append-only trigger rejects body, author, target, position, and delete
      mutations while allowing only one-way resolution.
- [ ] A Content contributor can comment but cannot resolve another author's
      Content comment.
- [ ] A Content manager can resolve a Content comment but not a Marketing or
      Design comment.
- [ ] The comment author and organization leaders can resolve.
- [ ] A comment on version N does not appear on version N+1.
- [ ] Website Architecture page anchors and Design x/y anchors round-trip.
- [ ] Resolving comments leaves `artifact_approvals` unchanged.
- [ ] Application tests, lint, full Deno checks, and production build pass.
- [ ] Nothing from D2-D5, notifications, comment editing, or deletion appears
      in the diff.
- [ ] Nothing is merged, migrated, or deployed without separate sign-off.

## Future release order after approval

1. Merge and publish PR #23 according to its release gate.
2. Retarget/rebase PR #24 to `main`, rerun checks, and publish it separately.
3. Retarget/rebase D1 to the resulting `main` and rerun every check.
4. Apply `20260828145700_artifact_version_proofing_layer` and run its verifier.
5. Deploy the `proofing-layer` Edge Function.
6. Deploy a frontend preview and execute the exact-version and role trace tests.
7. Promote only after explicit production sign-off.
