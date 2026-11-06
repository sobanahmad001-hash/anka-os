import assert from 'node:assert/strict'
import test from 'node:test'
import { createContextChatRunnerRepository } from './contextChatRunnerTransport.js'

test('private AI request pins selected organization, source turn, model, and dispatch identity', async () => {
  const calls = []
  const controller = new AbortController()
  const repo = createContextChatRunnerRepository({ functions: { invoke: async (name, options) => {
    calls.push({ name, ...options })
    return { data: { status: 'completed', message: { id: 'reply' } } }
  } } })
  await repo.run({ organization_id: 'old', message_id: 'source', model_configuration_id: 'model',
    dispatch_request_id: 'dispatch' }, { organizationId: 'selected', signal: controller.signal })
  await repo.recover('source', { organizationId: 'selected', signal: controller.signal })
  assert.deepEqual(calls.map(call => call.name), ['context-chat-runner', 'context-chat-runner'])
  assert.deepEqual(calls.map(call => call.body.organization_id), ['selected', 'selected'])
  assert.equal(calls[0].body.message_id, 'source')
  assert.equal(calls[0].body.model_configuration_id, 'model')
  assert.equal(calls[0].body.dispatch_request_id, 'dispatch')
  assert.equal(calls[1].body.recover_only, true)
  assert.equal(calls[1].body.model_configuration_id, undefined)
  assert.equal(calls[0].signal, controller.signal)
})

test('uncertain provider outcomes preserve must-not-submit for the UI', async () => {
  const repo = createContextChatRunnerRepository({ functions: { invoke: async () => ({
    data: { status: 'outcome_unknown', must_not_submit: true },
    error: { message: 'Function failed', context: { status: 503, json: async () => ({
      status: 'outcome_unknown', must_not_submit: true,
    }) } },
  }) } })
  await assert.rejects(repo.run({ message_id: 'source' }, { organizationId: 'selected' }),
    error => error.mustNotSubmit === true && error.outcome === 'outcome_unknown')
})

test('point-in-time original recovery explains reconciliation without exposing private detail or calling run',async()=>{
 const calls=[]
 const detail={status:'no_submission_recorded',must_not_submit:true,spend_readiness_status:'prior_cycle_reconciliation_required',reservation_id:'private-reservation',cost:123}
 const repo=createContextChatRunnerRepository({functions:{invoke:async(name,input)=>{calls.push(input.body);return {data:detail,status:409}}}})
 await assert.rejects(repo.recover('original-message',{organizationId:'selected'}),error=>{
  assert.equal(error.mustNotSubmit,true);assert.equal(error.outcome,'no_submission_recorded');assert.equal(error.spendReadinessStatus,'prior_cycle_reconciliation_required')
  assert.match(error.message,/message is saved/);assert.match(error.message,/recorded at this check/);assert.match(error.message,/may still be in progress/);assert.match(error.message,/reconciliation/);assert.doesNotMatch(error.message,/private-reservation|123/)
  return true
 })
 assert.deepEqual(calls,[{message_id:'original-message',recover_only:true,organization_id:'selected'}])
})

test('contradictory recovery never gains not-submitted semantics',async()=>{
 const repo=createContextChatRunnerRepository({functions:{invoke:async()=>({data:{status:'not_settled',must_not_submit:true},status:409})}})
 await assert.rejects(repo.recover('original-message',{organizationId:'selected'}),error=>error.outcome==='not_settled'&&error.mustNotSubmit===true&&error.spendReadinessStatus===undefined)
})

test('recovery workflow labels are allowlisted and other private diagnostics are discarded',async()=>{
 const repo=createContextChatRunnerRepository({functions:{invoke:async()=>({data:{status:'no_submission_recorded',must_not_submit:true,spend_readiness_status:'prior_cycle_reconciliation_required',reconciliation_sources:['context_chat','private-job-id','design_media'],private_cost:123},status:409})}})
 await assert.rejects(repo.recover('original-message',{organizationId:'selected'}),error=>{assert.deepEqual(error.reconciliationSources,['context_chat','design_media']);assert.equal(error.private_cost,undefined);return true})
})

for (const outcome of ['pending_append', 'charged_without_reply', 'not_settled', 'already_claimed', 'outcome_unknown']) {
  test('guarded ' + outcome + ' displays safe recovery wording from a cloned HTTP response', async () => {
    const calls = [], detail = { status: outcome, must_not_submit: true, ai_run_id: 'private-run', reservation_id: 'private-reservation', cost: 987654, error: 'private-provider-diagnostic' }
    const response = new Response(JSON.stringify(detail), { status: 503 })
    const repo = createContextChatRunnerRepository({ functions: { invoke: async (name, input) => {
      calls.push({ name, ...input }); return { error: { message: 'Edge Function returned a non-2xx status code', context: response } }
    } } })
    await assert.rejects(repo.recover('original-message', { organizationId: 'selected' }), error => {
      assert.equal(error.outcome, outcome); assert.equal(error.mustNotSubmit, true); assert.equal(error.status, 503)
      assert.match(error.message, /recovery/i)
      if (outcome === 'outcome_unknown') { assert.match(error.message, /could not be verified/); assert.match(error.message, /original request will not be sent again/) }
      assert.doesNotMatch(error.message, /non-2xx|private-|987654|no provider|not executed|retry|resend/i)
      assert.equal(error.ai_run_id, undefined)
      return true
    })
    assert.equal(response.bodyUsed, false)
    assert.deepEqual(await response.json(), detail)
    assert.deepEqual(calls.map(x => x.body), [{ message_id: 'original-message', recover_only: true, organization_id: 'selected' }])
  })
}

test('unknown or unguarded outcomes do not gain guarded display semantics', async () => {
  for (const detail of [{ status: 'outcome_unknown', must_not_submit: false }, { status: 'invented_future_status', must_not_submit: true }, { status: 'toString', must_not_submit: true }]) {
    const repo = createContextChatRunnerRepository({ functions: { invoke: async () => ({ status: 503, data: detail, error: { message: 'Private reply could not be verified' } }) } })
    await assert.rejects(repo.run({ message_id: 'original', dispatch_request_id: 'original-dispatch' }, { organizationId: 'selected' }), error => error.message === 'Private reply could not be verified' && error.outcome === detail.status && error.mustNotSubmit === detail.must_not_submit)
  }
})

test('non-JSON and consumed errors preserve fallback without inventing HTTP status from outcome', async () => {
  const consumed = new Response(JSON.stringify({ status: 'pending_append', must_not_submit: true }), { status: 409 }); await consumed.json()
  for (const error of [{ context: new Response('Not JSON', { status: 503 }) }, { context: consumed }, { statusCode: 403 }]) {
    const repo = createContextChatRunnerRepository({ functions: { invoke: async () => ({ data: null, error: { message: 'Original outcome unavailable', ...error } }) } })
    await assert.rejects(repo.recover('original', { organizationId: 'selected' }), reason => reason.message === 'Original outcome unavailable' && Number.isInteger(reason.status) && reason.mustNotSubmit === false)
  }
  const repo = createContextChatRunnerRepository({ functions: { invoke: async () => ({ data: { status: 'outcome_unknown', must_not_submit: true }, error: { message: 'Unknown' } }) } })
  await assert.rejects(repo.recover('original', { organizationId: 'selected' }), error => error.status === undefined && error.outcome === 'outcome_unknown' && error.mustNotSubmit === true)
})

test('run error preserves one original dispatch and never triggers recovery or resend', async () => {
  const calls = [], signal = new AbortController().signal
  const repo = createContextChatRunnerRepository({ functions: { invoke: async (name, input) => {
    calls.push({ name, ...input }); return { status: 503, data: { status: 'outcome_unknown', must_not_submit: true } }
  } } })
  const input = { message_id: 'original-message', dispatch_request_id: 'original-dispatch', model_configuration_id: 'selected-model' }
  await assert.rejects(repo.run(input, { organizationId: 'selected', signal }))
  assert.equal(calls.length, 1); assert.equal(calls[0].signal, signal)
  assert.deepEqual(calls[0].body, { ...input, organization_id: 'selected' })
})
