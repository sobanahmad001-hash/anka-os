import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { moveApprover } from './multiApproverPolicies.js'

test('D4 keeps the selected sequential approver order explicit', () => {
  assert.deepEqual(moveApprover(['alpha', 'beta', 'gamma'], 'gamma', -1), ['alpha', 'gamma', 'beta'])
  assert.deepEqual(moveApprover(['alpha', 'beta'], 'alpha', -1), ['alpha', 'beta'])
})

const migration = readFileSync(new URL('../../supabase/migrations/20260829095245_multi_approver_policies.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260829095245_multi_approver_policies.sql', import.meta.url), 'utf8')
const edgeFunction = readFileSync(new URL('../../supabase/functions/artifact-approvals/index.ts', import.meta.url), 'utf8')
const approvalPanel = readFileSync(new URL('../components/ArtifactApprovalPanel.jsx', import.meta.url), 'utf8')

test('D4 leaves the accepted artifact_approvals schema and W-series tables untouched', () => {
  assert.doesNotMatch(migration, /alter\s+table\s+public\.artifact_approvals/i)
  assert.doesNotMatch(migration, /\bwork_items\b|\bwork_item_dependencies\b/i)
  assert.match(migration, /before insert on public\.artifact_approvals/)
})

test('D4 uses tenant-safe exact-version requests with read-only browser access', () => {
  assert.match(migration, /foreign key \(artifact_version_id, organization_id\)[\s\S]*references public\.artifact_versions\(id, organization_id\)/)
  assert.match(migration, /unique \(artifact_version_id\)/)
  assert.match(migration, /grant select on public\.artifact_approval_requests, public\.artifact_approval_signoffs to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete).*to authenticated/i)
})

test('D4 enforces named, ordered sign-off and creates one final exact approval', () => {
  assert.match(migration, /Only a named approver can sign this request/)
  assert.match(migration, /Earlier sequential approvers must sign first/)
  assert.match(migration, /for update/)
  assert.match(migration, /insert into public\.artifact_approvals/)
  assert.match(migration, /approved_by[\s\S]*p_actor_id/)
  assert.match(edgeFunction, /p_actor_id: actorId/)
})

test('D4 panel is generic and preserves the no-request single approval path', () => {
  assert.match(approvalPanel, /Sequential — sign in supplied order/)
  assert.match(approvalPanel, /Parallel — sign in any order/)
  assert.match(approvalPanel, /onSingleApprove/)
  assert.match(approvalPanel, /Only a named required approver can sign/)
})

test('D4 rollback verifier exercises all five required runtime outcomes', () => {
  for (const check of [
    'sequential_out_of_order_rejected',
    'unnamed_user_rejected',
    'sequential_completed_with_one_final_approval',
    'parallel_completed_in_reverse_order',
    'final_approvals_attributed_to_final_signers',
  ]) assert.match(verifier, new RegExp(check))
  assert.match(verifier, /rollback;/)
})
