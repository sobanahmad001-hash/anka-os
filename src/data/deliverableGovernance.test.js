import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createDeliverableGovernance } from './deliverableGovernance.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260904130000_p7_governed_deliverable_release.sql', import.meta.url), 'utf8')

function fakeClient() {
  const calls = []
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args })
      return Promise.resolve({ data: { ok: true }, error: null, status: 200 })
    },
  }
}

test('P7 adapter sends exact organization/version/state to separate governed RPCs', async () => {
  const client = fakeClient()
  const governed = createDeliverableGovernance(client)
  await governed.submit({ organizationId: 'org-a', deliverableVersionId: 'version-a', expectedStateVersion: 4, reviewerId: 'reviewer-a', requestId: 'request-a' })
  await governed.review({ organizationId: 'org-a', deliverableVersionId: 'version-a', expectedStateVersion: 5, decision: 'approved', requestId: 'request-b' })
  await governed.release({ organizationId: 'org-a', deliverableVersionId: 'version-a', expectedStateVersion: 6, clientApprovalRequired: true, requestId: 'request-c' })
  await governed.clientDecision({ organizationId: 'org-a', deliverableVersionId: 'version-a', expectedStateVersion: 7, decision: 'approved', requestId: 'request-d' })
  await governed.delivered({ organizationId: 'org-a', deliverableVersionId: 'version-a', expectedStateVersion: 8, requestId: 'request-e' })
  await governed.published({ organizationId: 'org-a', deliverableVersionId: 'version-a', expectedStateVersion: 9, requestId: 'request-f' })
  assert.deepEqual(client.calls.map(call => call.name), [
    'submit_governed_deliverable_version', 'review_governed_deliverable_version',
    'release_governed_deliverable_version', 'decide_governed_deliverable_version',
    'mark_governed_deliverable_delivered', 'mark_governed_deliverable_published',
  ])
  assert.equal(client.calls[0].args.p_organization_id, 'org-a')
  assert.equal(client.calls[0].args.p_expected_state_version, 4)
  assert.equal(client.calls[0].args.p_nominated_reviewer_id, 'reviewer-a')
  assert.equal(client.calls[2].args.p_client_approval_required, true)
})

test('P7 adapter preserves response-envelope status on governed failures', async () => {
  const governed = createDeliverableGovernance({ rpc: async () => ({ data: null, error: { message: 'stale', code: '40001' }, status: 409 }) })
  await assert.rejects(
    governed.capabilities('org-a', 'version-a'),
    error => error.message === 'stale' && error.status === 409 && error.code === '40001',
  )
})

test('P7 schema is tenant-safe, append-only, RLS-enabled, and browser-write closed', () => {
  for (const table of ['deliverable_review_assignments', 'deliverable_lifecycle_events', 'deliverable_action_requests']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(migration, /foreign key\(deliverable_version_id,deliverable_id,project_id,organization_id\)/)
  assert.match(migration, /foreign key\(client_id,organization_id\) references public\.clients\(id,organization_id\)/)
  assert.match(migration, /revoke all on public\.deliverable_review_assignments,public\.deliverable_lifecycle_events,public\.deliverable_action_requests from public,anon,authenticated/)
  assert.match(migration, /revoke insert,update,delete on public\.deliverable_versions from authenticated/)
  assert.match(migration, /trg_deliverable_lifecycle_events_append_only/)
  assert.match(migration, /trg_approvals_append_only/)
})

test('P7 rejects open claims, self-review, and stale mutations', () => {
  assert.match(migration, /p_reviewer is distinct from p_creator and p_reviewer is distinct from p_owner/)
  assert.match(migration, /assignment\.reviewer_id<>actor/)
  assert.match(migration, /state_version<>p_expected_state_version/)
  assert.match(migration, /using errcode='40001'/)
  assert.match(migration, /membership\.role in \('client_admin','client_approver'\)/)
  assert.match(migration, /contact\.portal_role in \('admin','approver'\)/)
  assert.match(migration, /access\.access_role in \('admin','approver'\)/)
})

test('P7 uses separate atomic actions and independent delivered/published facts', () => {
  for (const name of [
    'create_governed_deliverable_version', 'submit_governed_deliverable_version',
    'assign_governed_deliverable_reviewer', 'review_governed_deliverable_version',
    'release_governed_deliverable_version', 'decide_governed_deliverable_version',
    'mark_governed_deliverable_delivered', 'mark_governed_deliverable_published',
  ]) assert.match(migration, new RegExp(`create function public\\.${name}`))
  assert.match(migration, /p_event_type not in \('delivered','published'\)/)
  assert.match(migration, /cross join\(values\('delivered'::text\),\('legacy_status_marker'::text\)\)/)
  assert.doesNotMatch(migration, /cross join\(values\([^\n]*'published'::text/)
  assert.match(migration, /client_approval_required boolean not null default false/)
  assert.match(migration, /Client approval requirement is immutable after first release/)
})
