import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { dispatchWorkshopAnswer } from './workshopAnswerTransport.ts'
import type { WorkshopAnswerInput } from './workshopAnswerTransport.ts'

const source = {
  openai: 'https://developers.openai.com/api/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  google_gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
}
const pricing = {
  openai: 'N6_OPENAI_MODEL_PRICING_JSON',
  anthropic: 'N7_ANTHROPIC_MODEL_PRICING_JSON',
  google_gemini: 'N7_GEMINI_MODEL_PRICING_JSON',
}
function input(provider: WorkshopAnswerInput['route']['provider']): WorkshopAnswerInput {
  return {
    organizationId: 'org', conversationId: 'conversation', messageId: 'message',
    projectId: 'project', engagementId: 'engagement', departmentId: 'content',
    actorId: 'actor', dispatchRequestId: 'request', prompt: 'A bounded working question',
    contextManifest: { department_id: 'content', context_checksum: 'a'.repeat(64),
      connector_connection_id: 'connector', model_configuration_id: 'configuration', model_id: 'verified' },
    startedAt: Date.now(),
    route: { provider, connectorId: 'connector', configurationId: 'configuration',
      model: 'verified', credential: 'synthetic-test-only' },
  }
}
function environment(provider: WorkshopAnswerInput['route']['provider'], enabled = true) {
  return { get: (name: string) => name === 'WORKSHOP_CHAT_PAID_EXECUTION_ENABLED'
    ? enabled ? 'true' : undefined
    : name === pricing[provider] ? JSON.stringify([{
      provider, model_id: 'verified', verified_at: new Date().toISOString(),
      source_url: source[provider], input_usd_per_million: 1,
      cached_input_usd_per_million: 1, cache_write_usd_per_million: provider === 'anthropic' ? 1 : null,
      output_usd_per_million: 1,
    }]) : undefined }
}
function providerBody(provider: WorkshopAnswerInput['route']['provider']) {
  if (provider === 'openai') return { id: 'response-1', status: 'completed', model: 'verified',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'A safe answer' }] }],
    usage: { input_tokens: 7, output_tokens: 3 } }
  if (provider === 'anthropic') return { id: 'response-1', type: 'message', model: 'verified',
    stop_reason: 'end_turn', content: [{ type: 'text', text: 'A safe answer' }],
    usage: { input_tokens: 7, output_tokens: 3 } }
  return { responseId: 'response-1', modelVersion: 'verified',
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'A safe answer' }] } }],
    usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 } }
}
const keepAlive = (_task: Promise<void>) => { /* The test awaits each response body. */ }

for (const provider of ['openai', 'anthropic', 'google_gemini'] as const) {
  Deno.test('Workshop ' + provider + ' submits only after a claim and settles normalized usage', async () => {
    const calls: string[] = []
    const admin = { async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'get_workshop_execution_readiness') return { data: {schema_version: 1, enabled: true, organization_id: 'org', project_id: 'project', engagement_id: 'engagement', department_id: 'content'}, error: null }
      calls.push(name)
      if (name === 'reserve_workshop_chat_budget') return { data: { status: 'reserved' }, error: null }
      if (name === 'claim_workshop_chat_dispatch') return { data: {
        status: 'claimed', must_not_submit: false, claim_id: 'claim-1',
        provider, connector_connection_id: 'connector',
        model_configuration_id: 'configuration', model_id: 'verified',
      }, error: null }
      if (name === 'complete_workshop_chat_answer_with_budget') {
        assertEquals(args.p_output_text, 'A safe answer')
        assertEquals(args.p_input_tokens, 7)
        assertEquals(args.p_output_tokens, 3)
        assertEquals((args.p_context_manifest as Record<string, unknown>).prompt_sha256?.toString().length, 64)
        return { data: { ai_run_id: 'run-1' }, error: null }
      }
      throw new Error('Unexpected RPC ' + name)
    } }
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push('provider')
      assertEquals(String(url).includes(provider === 'openai' ? 'api.openai.com'
        : provider === 'anthropic' ? 'api.anthropic.com' : 'generativelanguage.googleapis.com'), true)
      assertEquals(JSON.stringify(init?.body).includes('synthetic-test-only'), false)
      return new Response(JSON.stringify(providerBody(provider)))
    }) as typeof fetch
    const response = await dispatchWorkshopAnswer(admin, input(provider), fetcher, environment(provider), keepAlive)
    assertEquals((await response.text()).includes('"type":"completed"'), true)
    assertEquals(calls, ['reserve_workshop_chat_budget', 'claim_workshop_chat_dispatch',
      'provider', 'complete_workshop_chat_answer_with_budget'])
  })
}

Deno.test('Workshop paid execution stays off without the explicit switch', async () => {
  let calls = 0
  const admin = { async rpc() { calls++; return { data: null, error: null } } }
  const fetcher = (async () => { calls++; return new Response('{}') }) as typeof fetch
  await assertRejects(() => dispatchWorkshopAnswer(admin, input('openai'), fetcher,
    environment('openai', false)), Error, 'not enabled')
  assertEquals(calls, 0)
})

Deno.test('Workshop refuses paid dispatch without durable background settlement', async () => {
  let calls = 0
  const admin = { async rpc() { calls++; return { data: null, error: null } } }
  const fetcher = (async () => { calls++; return new Response('{}') }) as typeof fetch
  await assertRejects(() => dispatchWorkshopAnswer(admin, input('openai'), fetcher,
    environment('openai')), Error, 'background settlement is unavailable')
  assertEquals(calls, 0)
})

Deno.test('Workshop rejects an oversized pinned prompt before budget reservation', async () => {
  let calls = 0
  const admin = { async rpc() { calls++; return { data: null, error: null } } }
  const fetcher = (async () => { calls++; return new Response('{}') }) as typeof fetch
  await assertRejects(() => dispatchWorkshopAnswer(admin,
    { ...input('openai'), prompt: 'x'.repeat(24001) }, fetcher,
    environment('openai'), keepAlive), Error, 'Pinned N7 text route is incomplete')
  assertEquals(calls, 0)
})

Deno.test('Workshop claim replay never submits a second provider request', async () => {
  const calls: string[] = []
  const admin = { async rpc(name: string) {
    if (name === 'get_workshop_execution_readiness') return { data: {schema_version: 1, enabled: true, organization_id: 'org', project_id: 'project', engagement_id: 'engagement', department_id: 'content'}, error: null }
    calls.push(name)
    return { data: name === 'reserve_workshop_chat_budget'
      ? { status: 'reserved' } : { status: 'already_claimed', must_not_submit: true }, error: null }
  } }
  const fetcher = (async () => { calls.push('provider'); return new Response('{}') }) as typeof fetch
  const response = await dispatchWorkshopAnswer(admin, input('anthropic'), fetcher,
    environment('anthropic'), keepAlive)
  assertEquals((await response.text()).includes('"type":"unknown"'), true)
  assertEquals(calls, ['reserve_workshop_chat_budget', 'claim_workshop_chat_dispatch'])
})

Deno.test('Workshop claim refusal releases only an unclaimed reservation before any provider call', async () => {
  const calls: string[] = []
  const admin = { async rpc(name: string) {
    if (name === 'get_workshop_execution_readiness') return { data: {schema_version: 1, enabled: true, organization_id: 'org', project_id: 'project', engagement_id: 'engagement', department_id: 'content'}, error: null }
    calls.push(name)
    if (name === 'claim_workshop_chat_dispatch') return {
      data: null, error: new Error('Current contribution was revoked'),
    }
    return { data: name === 'reserve_workshop_chat_budget'
      ? { status: 'reserved' } : { status: 'released' }, error: null }
  } }
  const fetcher = (async () => { calls.push('provider'); return new Response('{}') }) as typeof fetch
  const response = await dispatchWorkshopAnswer(admin, input('openai'), fetcher,
    environment('openai'), keepAlive)
  assertEquals((await response.text()).includes('"type":"unknown"'), true)
  assertEquals(calls, ['reserve_workshop_chat_budget', 'claim_workshop_chat_dispatch',
    'reconcile_workshop_chat_budget'])
})

Deno.test('Workshop uncertainty evidence excludes raw provider failures', async () => {
  let evidence = ''
  const admin = { async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'get_workshop_execution_readiness') return { data: {schema_version: 1, enabled: true, organization_id: 'org', project_id: 'project', engagement_id: 'engagement', department_id: 'content'}, error: null }
    if (name === 'reserve_workshop_chat_budget') return { data: { status: 'reserved' }, error: null }
    if (name === 'claim_workshop_chat_dispatch') return { data: {
      status: 'claimed', must_not_submit: false, claim_id: 'claim-1',
      provider: 'anthropic', connector_connection_id: 'connector',
      model_configuration_id: 'configuration', model_id: 'verified',
    }, error: null }
    evidence = String(args.p_evidence)
    return { data: { status: 'unknown' }, error: null }
  } }
  const fetcher = (async () => { throw new Error('SECRET_RAW_PROVIDER_TEXT') }) as typeof fetch
  const response = await dispatchWorkshopAnswer(admin, input('anthropic'), fetcher,
    environment('anthropic'), keepAlive)
  assertEquals((await response.text()).includes('"type":"unknown"'), true)
  assertEquals(evidence.includes('SECRET_RAW_PROVIDER_TEXT'), false)
  assertEquals(evidence.includes('claim-1'), true)
})

Deno.test('Workshop settlement continues after the client stops observing', async () => {
  const calls: string[] = []
  let releaseProvider!: () => void
  const providerPending = new Promise<void>(resolve => { releaseProvider = resolve })
  let durableTask!: Promise<void>
  const admin = { async rpc(name: string) {
    if (name === 'get_workshop_execution_readiness') return { data: {schema_version: 1, enabled: true, organization_id: 'org', project_id: 'project', engagement_id: 'engagement', department_id: 'content'}, error: null }
    calls.push(name)
    if (name === 'reserve_workshop_chat_budget') {
      return { data: { status: 'reserved' }, error: null }
    }
    if (name === 'claim_workshop_chat_dispatch') {
      return { data: {
        status: 'claimed', must_not_submit: false, claim_id: 'claim-1',
        provider: 'openai', connector_connection_id: 'connector',
        model_configuration_id: 'configuration', model_id: 'verified',
      }, error: null }
    }
    if (name === 'complete_workshop_chat_answer_with_budget') {
      return { data: { ai_run_id: 'run-1' }, error: null }
    }
    throw new Error('Unexpected RPC ' + name)
  } }
  const fetcher = (async () => {
    calls.push('provider')
    await providerPending
    return new Response(JSON.stringify(providerBody('openai')))
  }) as typeof fetch
  const response = await dispatchWorkshopAnswer(admin, input('openai'), fetcher,
    environment('openai'), task => { durableTask = task })
  await response.body?.cancel()
  releaseProvider()
  await durableTask
  assertEquals(calls, ['reserve_workshop_chat_budget', 'claim_workshop_chat_dispatch',
    'provider', 'complete_workshop_chat_answer_with_budget'])
})

Deno.test('Workshop preserves exact configured model identity and retains unknown cost on alias mismatch', async () => {
  const calls: string[] = []
  const admin = { async rpc(name: string) {
    if (name === 'get_workshop_execution_readiness') return { data: {schema_version: 1, enabled: true, organization_id: 'org', project_id: 'project', engagement_id: 'engagement', department_id: 'content'}, error: null }
    calls.push(name)
    if (name === 'reserve_workshop_chat_budget') return { data: { status: 'reserved' }, error: null }
    if (name === 'claim_workshop_chat_dispatch') return { data: {
      status: 'claimed', must_not_submit: false, claim_id: 'claim-1',
      provider: 'openai', connector_connection_id: 'connector',
      model_configuration_id: 'configuration', model_id: 'verified',
    }, error: null }
    if (name === 'mark_workshop_chat_outcome_unknown') return { data: { status: 'unknown' }, error: null }
    throw new Error('Unexpected RPC ' + name)
  } }
  const fetcher = (async () => new Response(JSON.stringify({
    ...providerBody('openai'), model: 'verified-snapshot',
  }))) as typeof fetch
  const response = await dispatchWorkshopAnswer(admin, input('openai'), fetcher,
    environment('openai'), keepAlive)
  assertEquals((await response.text()).includes('"type":"unknown"'), true)
  assertEquals(calls.includes('complete_workshop_chat_answer_with_budget'), false)
  assertEquals(calls.includes('mark_workshop_chat_outcome_unknown'), true)
})

Deno.test('Workshop supplemental rate is captured before claim and survives environment rotation', async () => {
  const request = input('openai'); request.route.model = 'gpt-6-luna'
  const rate = { provider: 'openai', model_id: request.route.model, verified_at: new Date().toISOString(),
    source_url: source.openai, input_usd_per_million: 2, cached_input_usd_per_million: 1,
    cache_write_usd_per_million: 3, output_usd_per_million: 4 }
  let supplement = JSON.stringify([rate]); let completed = false; let calls = 0
  const env = { get: (name: string) => name === 'N6_OPENAI_APPROVED_MODELS_PRICING_JSON'
    ? supplement : environment('openai').get(name) }
  const admin = { async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'get_workshop_execution_readiness') return { data: {schema_version: 1, enabled: true, organization_id: 'org', project_id: 'project', engagement_id: 'engagement', department_id: 'content'}, error: null }
    if (name === 'reserve_workshop_chat_budget') return { data: { status: 'reserved' }, error: null }
    if (name === 'claim_workshop_chat_dispatch') {
      supplement = '{invalid-after-capture'
      return { data: { status: 'claimed', claim_id: 'claim', provider: 'openai',
        connector_connection_id: 'connector', model_configuration_id: 'configuration', model_id: request.route.model }, error: null }
    }
    if (name === 'complete_workshop_chat_answer_with_budget') {
      assertEquals((args.p_context_manifest as Record<string, unknown>).pricing, rate)
      assertEquals(args.p_actual_cost_microusd, 26); completed = true
      return { data: { ai_run_id: 'run' }, error: null }
    }
    throw new Error('Unexpected ' + name)
  } }
  const fetcher = (async () => { calls++; return new Response(JSON.stringify({ ...providerBody('openai'),
    model: request.route.model, service_tier: 'default', usage: { input_tokens: 7, output_tokens: 3,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } })) }) as typeof fetch
  const response = await dispatchWorkshopAnswer(admin, request, fetcher, env, keepAlive)
  await response.text(); assertEquals(completed, true); assertEquals(calls, 1)
})
Deno.test('Workshop invalid supplemental evidence denies before any reservation or provider call', async () => {
  const request = input('openai'); request.route.model = 'gpt-6-luna'
  let calls = 0
  await assertRejects(() => dispatchWorkshopAnswer({ rpc() { calls++; throw new Error('Unexpected claim') } }, request,
    (async () => { calls++; throw new Error('Unexpected provider') }) as typeof fetch,
    { get: name => name === 'N6_OPENAI_APPROVED_MODELS_PRICING_JSON' ? '{' : environment('openai').get(name) }, keepAlive))
  assertEquals(calls, 0)
})

Deno.test('Workshop scope denial performs no reservation, claim or provider call', async () => {
  const calls: string[] = []
  const admin = { async rpc(name: string) { calls.push(name); return { data: {schema_version: 1, enabled: false, organization_id: 'org', project_id: 'project', engagement_id: 'engagement', department_id: 'content'}, error: null } } }
  await assertRejects(() => dispatchWorkshopAnswer(admin, input('openai'), (async () => { throw Error('Provider must not run') }) as typeof fetch, environment('openai'), keepAlive), Error, 'not enabled')
  assertEquals(calls, ['get_workshop_execution_readiness'])
})
