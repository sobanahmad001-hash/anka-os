import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createPipelineRunIntentsRepository } from './pipelineRunIntentsRepository.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260921180000_n6_manual_pipeline_run_intents.sql', import.meta.url), 'utf8')
const reviewMigration = readFileSync(new URL('../../supabase/migrations/20260921183000_n6_run_intent_review.sql', import.meta.url), 'utf8')
const ID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

test('N6 manual run intent pins scope and never grants direct writes or provider submission', () => {
  assert.match(migration, /create table public\.pipeline_run_intents/)
  assert.match(migration, /before update or delete/)
  assert.match(migration, /grant select on public\.pipeline_run_intents to authenticated, service_role/)
  assert.match(migration, /private\.has_active_pipeline_template_role\(p_organization_id, array\['system_owner', 'operations_admin'\]\)/)
  assert.match(migration, /engagement\.status not in \('planning', 'active'\)/)
  assert.match(migration, /published pipeline version is unavailable/i)
  assert.match(migration, /request_sha256 <> request_sha/)
  assert.match(migration, /assets.*services|services.*assets/s)
  assert.doesNotMatch(migration, /https?:\/\//)
})

test('N6 repository scopes reads and sends one stable request ID and chosen assets', async () => {
  const calls = []
  const query = {
    select() { return this },
    eq(column, value) { calls.push([column, value]); return this },
    order() { return this },
    limit() { return this },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) },
  }
  const client = {
    from(name) { assert.equal(name, 'pipeline_run_intents'); return query },
    rpc(name, payload) {
      calls.push([name, payload])
      return Promise.resolve({ data: { run_intent_id: ID }, error: null })
    },
  }
  const repository = createPipelineRunIntentsRepository(client)
  await repository.list(ID, OTHER)
  assert.deepEqual(calls.slice(0, 2), [['organization_id', ID], ['engagement_id', OTHER]])
  await repository.start({ organizationId: ID, engagementId: OTHER, requestId: ID, assetIds: [OTHER] })
  assert.deepEqual(calls.at(-1), ['start_pipeline_run_intent', {
    p_organization_id: ID, p_engagement_id: OTHER, p_request_id: ID, p_asset_ids: [OTHER],
  }])
  assert.throws(() => repository.start({ organizationId: ID, engagementId: OTHER, requestId: ID, assetIds: [OTHER, OTHER] }), /unique/)
})

test('N6 review remains separate, immutable, and requester-independent', () => {
  assert.match(reviewMigration, /unique \(run_intent_id\)/)
  assert.match(reviewMigration, /before update or delete/)
  assert.match(reviewMigration, /if intent.requested_by = actor/)
  assert.match(reviewMigration, /existing.request_sha256 <> request_sha/)
  assert.match(reviewMigration, /membership.role in \('system_owner', 'operations_admin'\)/)
  assert.match(reviewMigration, /status in \('planning', 'active'\)/)
  assert.doesNotMatch(reviewMigration, /insert into public\.(?:work_items|ai_runs)|fetch\(/)
})

test('N6 review client rejects invalid decisions and sends normalized exact request', async () => {
  let sent
  const client = {
    from() { throw new Error('Unexpected read') },
    rpc(name, payload) {
      sent = [name, payload]
      return Promise.resolve({ data: { decision: payload.p_decision }, error: null })
    },
  }
  const repository = createPipelineRunIntentsRepository(client)
  assert.throws(() => repository.review({
    organizationId: ID, runIntentId: OTHER, requestId: ID, decision: 'approved',
  }), /valid review/)
  assert.throws(() => repository.review({
    organizationId: ID, runIntentId: OTHER, requestId: ID, decision: 'rejected', reason: ' ',
  }), /rejection reason/)
  await repository.review({
    organizationId: ID, runIntentId: OTHER, requestId: ID,
    decision: 'rejected', reason: ' Scope changed ',
  })
  assert.deepEqual(sent, ['review_pipeline_run_intent', {
    p_organization_id: ID, p_run_intent_id: OTHER, p_request_id: ID,
    p_decision: 'rejected', p_reason: 'Scope changed',
  }])
})
