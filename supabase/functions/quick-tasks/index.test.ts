import {
  hasSandboxDepartmentAuthority,
  normalizeQuickTaskChatInput,
  normalizeQuickTaskInput,
  normalizeSandboxContent,
  quickTaskChatExternalEndpoint,
  quickTaskChatResponseFormat,
  selectSingleSandboxOpenAiModel,
  SANDBOX_DEPARTMENTS,
  sandboxChat,
} from './index.ts'

function equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`) }
function throws(run: () => unknown, pattern: RegExp) { try { run() } catch (error) { if (pattern.test(error instanceof Error ? error.message : String(error))) return; throw error } throw new Error(`Expected error matching ${pattern}`) }

Deno.test('normalizes create and append inputs', () => {
  const create = normalizeQuickTaskInput('create', { organizationId: 'org', title: ' Note ', content: { notes: 'x' } })
  equal(create.p_title, 'Note'); equal(create.p_organization_id, 'org')
  const append = normalizeQuickTaskInput('append', { quickTaskId: 'task', expectedRevisionId: 'rev', title: 'Next', content: {} })
  equal(append.p_quick_task_id, 'task'); equal(append.p_expected_revision_id, 'rev')
})
Deno.test('requires object content and explicit revision concurrency', () => {
  throws(() => normalizeQuickTaskInput('create', { organizationId: 'org', title: 'x', content: [] }), /Content/)
  throws(() => normalizeQuickTaskInput('append', { quickTaskId: 'task', title: 'x', content: {} }), /expected revision/)
})
Deno.test('fork requires an exact source revision', () => {
  throws(() => normalizeQuickTaskInput('fork', { quickTaskId: 'task' }), /source revision/)
})

Deno.test('sandbox chat requires exact revision, department, prompt, and AI-safe confirmation', () => {
  const input = normalizeQuickTaskChatInput({
    quickTaskId: 'task', expectedRevisionId: 'revision', departmentId: 'content',
    prompt: 'Refine this note', promptSafeForAi: true,
  })
  equal(input.expectedRevisionId, 'revision')
  equal(input.departmentId, 'content')
  throws(() => normalizeQuickTaskChatInput({
    quickTaskId: 'task', expectedRevisionId: 'revision', departmentId: 'content', prompt: 'x',
  }), /Confirm the prompt/)
  throws(() => normalizeQuickTaskChatInput({
    quickTaskId: 'task', expectedRevisionId: 'revision', departmentId: 'sales', prompt: 'x', promptSafeForAi: true,
  }), /Unsupported sandbox department/)
})

Deno.test('sandbox authority follows active membership department or organization leadership', () => {
  equal(SANDBOX_DEPARTMENTS.size, 4)
  equal(hasSandboxDepartmentAuthority({ role: 'contributor', department_id: 'design' }, 'design'), true)
  equal(hasSandboxDepartmentAuthority({ role: 'contributor', department_id: 'design' }, 'content'), false)
  equal(hasSandboxDepartmentAuthority({ role: 'system_owner', department_id: null }, 'development'), true)
})

Deno.test('sandbox output is a strict bounded Quick Task revision', () => {
  const format = quickTaskChatResponseFormat()
  equal(format.strict, true)
  const content = normalizeSandboxContent({ notes: 'Draft', checklist: [{ text: ' Review ', done: false }] })
  equal(content.notes, 'Draft')
  equal(content.checklist[0].text, 'Review')
  throws(() => normalizeSandboxContent({ notes: 'Draft', checklist: [], action: 'publish' }), /unsupported fields/)
  throws(() => normalizeSandboxContent({ notes: 'Draft', checklist: [{ text: '', done: false }] }), /checklist/)
})

Deno.test('sandbox chat uses only the approved model endpoint', () => {
  equal(quickTaskChatExternalEndpoint(), 'https://api.openai.com/v1/responses')
})

Deno.test('sandbox chat rejects zero, multiple, and model-less connectors before any provider call', async () => {
  const cases = [
    { connections: [], message: /No verified OpenAI connector/ },
    { connections: [{ id: 'one' }, { id: 'two' }], message: /Exactly one verified OpenAI connector/ },
    {
      connections: [{ id: 'one', secret_name: 'OPENAI_KEY', public_config: {} }],
      message: /requires an explicit model_id/,
    },
  ]
  let providerCalls = 0
  for (const scenario of cases) {
    let rejected = false
    try {
      await sandboxChat({} as never, 'owner', {
        action: 'chat', quickTaskId: 'task', expectedRevisionId: 'revision',
        departmentId: 'content', prompt: 'Refine', promptSafeForAi: true,
      }, (() => {
        providerCalls += 1
        return Promise.resolve(new Response('{}', { status: 200 }))
      }) as typeof fetch, {
        loadSandboxContext: async () => {
          selectSingleSandboxOpenAiModel(scenario.connections, 'content', () => 'test-key')
          throw new Error('unreachable')
        },
      })
    } catch (error) {
      rejected = error instanceof Error && scenario.message.test(error.message)
    }
    equal(rejected, true)
  }
  equal(providerCalls, 0)
})

Deno.test('sandbox chat disables provider retention and records one atomic sandbox revision', async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = []
  let requestBody: Record<string, unknown> = {}
  const admin = {
    rpc(name: string, input: Record<string, unknown>) {
      calls.push({ name, input })
      return Promise.resolve({
        data: name === 'record_quick_task_chat_success'
          ? { task: { id: 'task' }, revision: { id: 'generated', content: input.p_content }, ai_run_id: 'run' }
          : 'failure-run',
        error: null,
      })
    },
  }
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({
      output_text: '{"notes":"refined","checklist":[]}',
      usage: { input_tokens: 4, output_tokens: 3 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const result = await sandboxChat(admin as never, 'owner', {
    action: 'chat', quickTaskId: 'task', expectedRevisionId: 'revision',
    departmentId: 'content', prompt: 'Refine', promptSafeForAi: true,
  }, fetcher as typeof fetch, {
    loadSandboxContext: async () => ({
      task: { id: 'task', organization_id: 'org', title: 'Private', current_revision_id: 'revision' },
      revision: { id: 'revision', content: { notes: 'draft', checklist: [] } },
      messages: [], provider: { connectorId: 'connector', model: 'model', credential: 'secret' },
    }) as never,
    enforceUsageLimits: async () => {},
    estimatedCost: () => 7,
  })
  equal(requestBody.store, false)
  equal('tools' in requestBody, false)
  equal(calls.length, 1)
  equal(calls[0].name, 'record_quick_task_chat_success')
  equal(calls[0].input.p_expected_revision_id, 'revision')
  equal(calls[0].input.p_estimated_cost_microusd, 7)
  equal((result.revision as { id: string }).id, 'generated')
})

Deno.test('failed provider calls route only to the no-activity failure audit', async () => {
  const calls: string[] = []
  const admin = {
    rpc(name: string) { calls.push(name); return Promise.resolve({ data: 'failure-run', error: null }) },
  }
  let failed = false
  try {
    await sandboxChat(admin as never, 'owner', {
      action: 'chat', quickTaskId: 'task', expectedRevisionId: 'revision',
      departmentId: 'content', prompt: 'Refine', promptSafeForAi: true,
    }, (() => Promise.resolve(new Response(JSON.stringify({ error: { message: 'provider down' } }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    }))) as typeof fetch, {
      loadSandboxContext: async () => ({
        task: { id: 'task', organization_id: 'org', title: 'Private', current_revision_id: 'revision' },
        revision: { id: 'revision', content: { notes: 'draft', checklist: [] } },
        messages: [], provider: { connectorId: 'connector', model: 'model', credential: 'secret' },
      }) as never,
      enforceUsageLimits: async () => {},
    })
  } catch (error) { failed = error instanceof Error && /provider down/.test(error.message) }
  equal(failed, true)
  equal(calls.length, 1)
  equal(calls[0], 'record_quick_task_chat_failure')
})
