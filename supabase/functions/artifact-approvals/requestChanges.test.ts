import { assertEquals } from 'jsr:@std/assert@1.0.14'
import { handleRequest } from './index.ts'

const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_ID = '44444444-4444-4444-8444-444444444444'
const FIRST_KEY = '55555555-5555-4555-8555-555555555555'
const SECOND_KEY = '66666666-6666-4666-8666-666666666666'

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

async function withOfflineHandler(run: (invoke: (key: string, comment?: string) => Promise<Response>, state: {
  rpcCalls: Array<Record<string, unknown>>
  comments: Map<string, Record<string, unknown>>
}) => Promise<void>) {
  const previousFetch = globalThis.fetch
  const previousEnv = {
    url: Deno.env.get('SUPABASE_URL'),
    anon: Deno.env.get('SUPABASE_ANON_KEY'),
    service: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  }
  const rpcCalls: Array<Record<string, unknown>> = []
  const comments = new Map<string, Record<string, unknown>>()
  Deno.env.set('SUPABASE_URL', 'http://127.0.0.1')
  Deno.env.set('SUPABASE_ANON_KEY', 'offline-anon-key')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'offline-service-role-key')
  globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.hostname !== '127.0.0.1') throw new Error(`Unexpected network request: ${url}`)
    if (url.pathname === '/auth/v1/user') {
      return json({ id: ACTOR_ID, aud: 'authenticated', role: 'authenticated', email: 'local@example.test' })
    }
    if (url.pathname === '/rest/v1/artifact_approval_requests') {
      return json([{ id: REQUEST_ID }])
    }
    if (url.pathname === '/rest/v1/rpc/request_artifact_approval_changes') {
      const body = JSON.parse(await request.text()) as Record<string, string>
      rpcCalls.push(body)
      const prior = comments.get(body.p_idempotency_key)
      if (prior && prior.body !== body.p_comment) {
        return json({ code: '23505', message: 'Change request idempotency key was reused with different intent' }, 409)
      }
      if (prior) return json({ ...prior, idempotent_replay: true })
      const saved = { id: `comment-${comments.size + 1}`, body: body.p_comment, request_change_key: body.p_idempotency_key }
      comments.set(body.p_idempotency_key, saved)
      return json({ ...saved, idempotent_replay: false })
    }
    throw new Error(`Unexpected offline request: ${url.pathname}`)
  }
  const invoke = (key: string, comment = 'Correct exact version claim') => handleRequest(new Request('http://127.0.0.1/review', {
    method: 'POST',
    headers: { Authorization: 'Bearer offline-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'request_changes', request_id: REQUEST_ID, comment, idempotency_key: key }),
  }))
  try {
    await run(invoke, { rpcCalls, comments })
  } finally {
    globalThis.fetch = previousFetch
    for (const [name, value] of [['SUPABASE_URL', previousEnv.url], ['SUPABASE_ANON_KEY', previousEnv.anon], ['SUPABASE_SERVICE_ROLE_KEY', previousEnv.service]] as const) {
      if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value)
    }
  }
}

Deno.test('B06a handler delegates exact intent to one atomic RPC and never inserts comments directly', async () => {
  await withOfflineHandler(async (invoke, state) => {
    const first = await invoke(FIRST_KEY)
    const replay = await invoke(FIRST_KEY)
    const deliberate = await invoke(SECOND_KEY)
    assertEquals(first.status, 200)
    assertEquals(replay.status, 200)
    assertEquals(deliberate.status, 200)
    assertEquals(state.comments.size, 2)
    assertEquals(state.rpcCalls.length, 3)
    assertEquals(state.rpcCalls[0], {
      p_request_id: REQUEST_ID,
      p_actor_id: ACTOR_ID,
      p_comment: 'Correct exact version claim',
      p_idempotency_key: FIRST_KEY,
    })
  })
})

Deno.test('B06a handler rejects changed intent with the same replay key', async () => {
  await withOfflineHandler(async (invoke, state) => {
    assertEquals((await invoke(FIRST_KEY)).status, 200)
    const conflict = await invoke(FIRST_KEY, 'Different intent')
    assertEquals(conflict.status, 409)
    assertEquals(state.comments.size, 1)
  })
})

Deno.test('list_approvers resolves active team names using the supported profile columns', async () => {
  await withOfflineHandler(async () => {
    const authFetch = globalThis.fetch
    const org = '11111111-1111-4111-8111-111111111111'
    const members = [ACTOR_ID, SECOND_KEY].map(user_id => ({ user_id, role: 'member', department_id: 'content' }))
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const params = url.searchParams
      assertEquals(request.method, 'GET')
      switch (url.pathname) {
        case '/auth/v1/user':
          return authFetch(request)
        case '/rest/v1/artifact_versions':
          assertEquals(params.get('id'), 'eq.' + FIRST_KEY)
          return json([{ id: FIRST_KEY, organization_id: org, artifact_id: REQUEST_ID }])
        case '/rest/v1/organizations':
          assertEquals(params.get('id'), 'eq.' + org)
          return json([{ id: org }])
        case '/rest/v1/organization_memberships':
          assertEquals(params.get('organization_id'), 'eq.' + org)
          assertEquals(params.get('member_kind'), 'eq.team')
          assertEquals(params.get('status'), 'eq.active')
          if (params.get('user_id') === 'eq.' + ACTOR_ID) return json([{ id: FIRST_KEY }])
          return json(members)
        case '/rest/v1/profiles':
          assertEquals(params.get('id'), 'in.(' + members.map(row => row.user_id).join(',') + ')')
          if (params.get('select') !== 'id,full_name') return json({ code: '42703', message: 'Unknown profile column' }, 400)
          return json([{ id: ACTOR_ID, full_name: 'QA Reviewer' }])
        default:
          throw new Error('Unexpected approval read: ' + url.pathname)
      }
    }
    const res = await handleRequest(new Request('http://127.0.0.1/review', {
      method: 'POST', headers: { Authorization: 'Bearer offline-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_approvers', artifact_version_id: FIRST_KEY }),
    }))
    assertEquals(res.status, 200)
    const { data } = await res.json()
    assertEquals(data.map((row: {full_name: string}) => row.full_name), ['QA Reviewer', 'Team member'])
    assertEquals(data.map((row: {user_id: string}) => row.user_id), members.map(row => row.user_id))
  })
})
