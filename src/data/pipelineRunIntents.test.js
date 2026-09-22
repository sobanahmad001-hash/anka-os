import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createPipelineRunIntentsRepository } from './pipelineRunIntentsRepository.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260921180000_n6_manual_pipeline_run_intents.sql', import.meta.url), 'utf8')
const reviewMigration = readFileSync(new URL('../../supabase/migrations/20260921183000_n6_run_intent_review.sql', import.meta.url), 'utf8')
const planMigration = readFileSync(new URL('../../supabase/migrations/20260921190000_n6_linked_run_plan.sql', import.meta.url), 'utf8')
const jobMigration = readFileSync(new URL('../../supabase/migrations/20260922020000_n6_blocked_execution_jobs.sql', import.meta.url), 'utf8')
const stepsMigration = readFileSync(new URL('../../supabase/migrations/20260922050000_n6_execution_job_steps.sql', import.meta.url), 'utf8')
const inputApprovalMigration = readFileSync(new URL('../../supabase/migrations/20260922060000_n6_input_approval.sql', import.meta.url), 'utf8')
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

test('N6 linked plan pins bounded same-engagement work without mutating tasks', () => {
  assert.match(planMigration, /unique \(run_intent_id\)/)
  assert.match(planMigration, /before update or delete/)
  assert.match(planMigration, /not between 1 and 50/)
  assert.match(planMigration, /review\.decision = 'accepted_for_planning'/)
  assert.match(planMigration, /intent\.requested_by <> actor/)
  assert.match(planMigration, /item\.engagement_id = intent\.engagement_id/)
  assert.match(planMigration, /item\.row_version/)
  assert.match(planMigration, /request_sha256 <> request_sha/)
  assert.doesNotMatch(planMigration, /update public\.work_items|insert into public\.work_items/)
})

test('N6 linked plan client sends one bounded ordered selection', async () => {
  let sent
  const client = {
    from() { throw new Error('Unexpected read') },
    rpc(name, payload) {
      sent = [name, payload]
      return Promise.resolve({ data: { run_plan_id: ID }, error: null })
    },
  }
  const repository = createPipelineRunIntentsRepository(client)
  assert.throws(() => repository.plan({
    organizationId: ID, runIntentId: OTHER, requestId: ID, workItemIds: [],
  }), /1 to 50/)
  assert.throws(() => repository.plan({
    organizationId: ID, runIntentId: OTHER, requestId: ID, workItemIds: [OTHER, OTHER],
  }), /unique/)
  await repository.plan({
    organizationId: ID, runIntentId: OTHER, requestId: ID, workItemIds: [OTHER],
  })
  assert.deepEqual(sent, ['plan_manual_pipeline_run', {
    p_organization_id: ID, p_run_intent_id: OTHER, p_request_id: ID,
    p_work_item_ids: [OTHER],
  }])
})

test('N6 durable job is created once from the pinned plan and remains blocked', () => {
  assert.match(jobMigration, /run_plan_id uuid not null unique references public\.pipeline_run_plans/)
  assert.match(jobMigration, /unique \(run_intent_id\)/)
  assert.match(jobMigration, /after insert on public\.pipeline_run_plans/)
  assert.match(jobMigration, /before update or delete/)
  assert.match(jobMigration, /status = 'blocked_configuration'/)
  assert.match(jobMigration, /provider is null and model_id is null and provider_request_id is null/)
  assert.match(jobMigration, /grant select on public\.ai_execution_jobs to authenticated, service_role/)
  assert.doesNotMatch(jobMigration, /grant (?:insert|update|delete|all) on public\.ai_execution_jobs to authenticated/)
})

test('N6 request list attaches the blocked job to its matching intent', async () => {
  const names = []
  const fixtures = {
    pipeline_run_intents: [{ id: ID, input_sha256: 'a'.repeat(64) }],
    pipeline_run_intent_reviews: [],
    pipeline_run_plans: [{ id: OTHER, run_intent_id: ID, work_manifest: [], work_sha256: 'b'.repeat(64) }],
    ai_execution_jobs: [{ id: ID, run_intent_id: ID, run_plan_id: OTHER, status: 'blocked_configuration', blocked_reason: 'Configuration required.', steps: [{ ordinal: 1, work_item_id: OTHER }] }],
  }
  const client = {
    from(name) {
      names.push(name)
      return {
        select() { return this },
        eq() { return this },
        in() { return this },
        order() { return this },
        limit() { return this },
        then(resolve, reject) { return Promise.resolve({ data: fixtures[name], error: null }).then(resolve, reject) },
      }
    },
    rpc() { throw new Error('Unexpected write') },
  }
  const [row] = await createPipelineRunIntentsRepository(client).list(ID, OTHER)
  assert.equal(row.job.run_plan_id, row.plan.id)
  assert.equal(row.job.status, 'blocked_configuration')
  assert.equal(row.job.steps[0].work_item_id, OTHER)
  assert.deepEqual(names, ['pipeline_run_intents', 'pipeline_run_intent_reviews', 'pipeline_run_plans', 'ai_execution_jobs'])
})

test('N6 job steps pin every ordered work item without provider or task writes', () => {
  assert.match(stepsMigration, /unique \(job_id, ordinal\)/)
  assert.match(stepsMigration, /unique \(job_id, work_item_id\)/)
  assert.match(stepsMigration, /after insert on public\.ai_execution_jobs/)
  assert.match(stepsMigration, /jsonb_array_length\(plan\.work_manifest\) not between 1 and 50/)
  assert.match(stepsMigration, /foreign key \(work_item_id, organization_id\)/)
  assert.match(stepsMigration, /job_input_sha256/)
  assert.match(stepsMigration, /before update or delete/)
  assert.match(stepsMigration, /grant select on public\.ai_execution_job_steps to authenticated, service_role/)
  assert.doesNotMatch(stepsMigration, /grant (?:insert|update|delete|all) on public\.ai_execution_job_steps to authenticated/)
  assert.doesNotMatch(stepsMigration, /update public\.work_items|insert into public\.ai_runs|https?:\/\//)
})
test('N6 text input acknowledgement requires independent review and unchanged, asset-free scope', () => {
  assert.match(inputApprovalMigration, /unique \(job_id\)/)
  assert.match(inputApprovalMigration, /review\.decision <> 'accepted_for_planning' or review\.reviewed_by = actor/)
  assert.match(inputApprovalMigration, /Selected assets need separate AI-use classification/)
  assert.match(inputApprovalMigration, /item\.row_version <> step\.source_row_version/)
  assert.match(inputApprovalMigration, /job\.input_manifest ->> 'work_sha256' is distinct from plan\.work_sha256/)
  assert.match(inputApprovalMigration, /request_sha256 <> request_sha/)
  assert.match(inputApprovalMigration, /before update or delete/)
  assert.doesNotMatch(inputApprovalMigration, /insert into public\.ai_runs|reserve_pipeline_ai_budget|https?:\/\//)
})

test('N6 input acknowledgement sends one exact job and stable request', async () => {
  let sent
  const repository = createPipelineRunIntentsRepository({
    from() { throw new Error('Unexpected read') },
    rpc(name, payload) {
      sent = [name, payload]
      return Promise.resolve({ data: { approval_id: ID }, error: null })
    },
  })
  assert.throws(() => repository.approveInputs({
    organizationId: ID, jobId: OTHER, requestId: ID, acknowledged: false,
  }), /acknowledgement/)
  await repository.approveInputs({
    organizationId: ID, jobId: OTHER, requestId: ID, acknowledged: true,
  })
  assert.deepEqual(sent, ['approve_pipeline_ai_job_inputs', {
    p_organization_id: ID, p_job_id: OTHER, p_request_id: ID, p_acknowledged: true,
  }])
})
test('N6 manual controls require exact version and evidence before one scoped action', async () => {
  let sent
  const repository = createPipelineRunIntentsRepository({
    from() { throw new Error('Unexpected read') },
    rpc(name, payload) {
      sent = [name, payload]
      return Promise.resolve({ data: { status: 'completed' }, error: null })
    },
  })
  const base = {
    organizationId: ID, jobId: OTHER, stepId: ID, requestId: OTHER,
    expectedVersion: 2, action: 'complete', evidence: ' Versioned human output ',
  }
  assert.throws(() => repository.advanceManualStep({ ...base, action: 'dispatch' }), /valid manual step action/)
  assert.throws(() => repository.advanceManualStep({ ...base, expectedVersion: 0 }), /current step version/)
  assert.throws(() => repository.advanceManualStep({ ...base, evidence: ' ' }), /requires evidence/)
  await repository.advanceManualStep(base)
  assert.deepEqual(sent, ['advance_pipeline_manual_step', {
    p_organization_id: ID, p_job_id: OTHER, p_step_id: ID, p_request_id: OTHER,
    p_expected_version: 2, p_action: 'complete', p_evidence: 'Versioned human output',
  }])
})