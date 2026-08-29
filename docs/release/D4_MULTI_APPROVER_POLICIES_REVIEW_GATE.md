# D4 Multi-Approver Policies — Review Gate

## Scope

- D4 adds multi-approver requests and sign-offs for exact immutable artifact versions.
- Content, Marketing, and Development use one generic approval panel.
- Versions without a D4 request retain their existing single-approval behavior.
- The accepted `artifact_approvals` columns, decision constraint, and exact-version unique constraint are unchanged.
- The diff does not modify `work_items`, `work_item_dependencies`, or W-series files.

## Database review

- `artifact_approval_requests` permits one sequential or parallel request per artifact version.
- `artifact_approval_signoffs` contains only explicitly selected active team members.
- Sequential positions preserve the submitted order; parallel rows have no position.
- Composite foreign keys keep both tables organization-consistent.
- Authenticated browser clients can read organization rows but cannot write them.
- Request and assignment details are immutable after creation.
- Sign-off is atomic and locks the request so concurrent final signers cannot create duplicate approvals.
- A pending request blocks the legacy direct approval path at the database boundary.
- Completion inserts exactly one existing-shape `artifact_approvals` row attributed to the final signer.

## Runtime verification

After applying the migration to an isolated review database, run:

```sh
supabase db execute --file supabase/verify_20260829095245_multi_approver_policies.sql
```

The rollback-safe result must report `true` for:

- `sequential_out_of_order_rejected`
- `unnamed_user_rejected`
- `sequential_completed_with_one_final_approval`
- `parallel_completed_in_reverse_order`
- `final_approvals_attributed_to_final_signers`

It must also report the exact new column sets, enabled RLS, read-only browser privileges, and `artifact_approvals_shape_preserved` as `true`.

## Release boundary

Review the actual migration, Edge Function, UI, tests, and rollback verifier. Do not merge, apply the migration, deploy functions, or deploy the web app until explicit approval is given.
