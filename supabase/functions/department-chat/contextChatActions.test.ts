import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { contextChatAction } from './contextChatActions.ts'

const org = 'a0000000-0000-4000-8000-000000000001'
const project = 'a0000000-0000-4000-8000-000000000002'
const thread = 'a0000000-0000-4000-8000-000000000003'
const owner = 'a0000000-0000-4000-8000-000000000004'
const recipient = 'a0000000-0000-4000-8000-000000000005'
const unnamed = 'a0000000-0000-4000-8000-000000000006'

function fixture() {
  const rows: Record<string, any[]> = {
    department_chat_conversations: [{
      id: thread, organization_id: org, project_id: project, context_kind: 'project_team',
      owner_id: owner, state: 'active', title: 'Shared direction',
    }],
    project_context_chat_shares: [{
      conversation_id: thread, organization_id: org, project_id: project,
      recipient_id: recipient, revoked_at: null,
    }],
    projects: [{ id: project, organization_id: org, archived_at: null }],
    organization_memberships: [
      { user_id: recipient, organization_id: org, member_kind: 'team', status: 'active', role: 'contributor' },
      { user_id: unnamed, organization_id: org, member_kind: 'team', status: 'active', role: 'contributor' },
    ],
    profiles: [{ id: recipient, full_name: 'Recipient Name' }],
    department_chat_messages: [{ id: 'message', conversation_id: thread,
      organization_id: org, author_id: owner, sequence: 1, body: 'Direction' }],
  }
  const calls: Array<[string, unknown]> = []
  const admin = {
    from(table: string) {
      calls.push(['from', table])
      let selected = [...(rows[table] || [])]
      const query: any = {
        select(columns: string) { calls.push(['select', [table, columns]]); return query },
        eq(key: string, value: unknown) { selected = selected.filter(row => row[key] === value); return query },
        neq(key: string, value: unknown) { selected = selected.filter(row => row[key] !== value); return query },
        is(key: string, value: unknown) { selected = selected.filter(row => row[key] === value); return query },
        in(key: string, values: unknown[]) { selected = selected.filter(row => values.includes(row[key])); return query },
        lt(key: string, value: number) { selected = selected.filter(row => row[key] < value); return query },
        order(key: string, options: { ascending: boolean }) {
          selected.sort((a, b) => options.ascending ? a[key] - b[key] : b[key] - a[key])
          return query
        },
        limit(count: number) { selected = selected.slice(0, count); return query },
        async maybeSingle() { return { data: selected[0] || null, error: null } },
        then(resolve: (value: unknown) => void) {
          return Promise.resolve({ data: selected, error: null }).then(resolve)
        },
      }
      return query
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push(['rpc', name])
      if (name === 'list_project_context_chat_conversations') {
        assertEquals(args.p_project_id, project)
        assertEquals(args.p_actor_id, recipient)
        return { data: rows.department_chat_conversations, error: null }
      }
      return { data: null, error: null }
    },
  }
  return { admin, rows, calls }
}

Deno.test('project recipient sees only an active explicitly shared conversation and loses subsequent read on revocation', async () => {
  const { admin, rows } = fixture()
  const body = { conversation_id: thread }
  const membership = { user_id: recipient, role: 'contributor' }
  const result: any = await contextChatAction('get_context_conversation',
    admin as any, body, recipient, org, membership)
  assertEquals(result.messages[0].body, 'Direction')
  rows.project_context_chat_shares[0].revoked_at = new Date().toISOString()
  await assertRejects(() => contextChatAction('get_context_conversation',
    admin as any, body, recipient, org, membership))
  rows.department_chat_conversations[0].context_kind = 'organization'
  rows.project_context_chat_shares[0].revoked_at = null
  await assertRejects(() => contextChatAction('get_context_conversation',
    admin as any, body, recipient, org, membership))
})

Deno.test('project conversation listing uses the guarded shared-reader RPC', async () => {
  const { admin, calls } = fixture()
  const result: any = await contextChatAction('list_context_conversations',
    admin as any, { context_kind: 'project_team', project_id: project, offset: 0 },
    recipient, org, { user_id: recipient, role: 'contributor' })
  assertEquals(result.length, 1)
  assertEquals(calls.some(([kind, value]) => kind === 'rpc'
    && value === 'list_project_context_chat_conversations'), true)
})

Deno.test('project sharing candidates use installed profile columns and name or ID fallback', async () => {
  const { admin, calls } = fixture()
  const result: any = await contextChatAction('get_project_context_sharing', admin as any,
    { conversation_id: thread }, owner, org, { role: 'contributor' })
  assertEquals(calls.some(([kind, value]) => kind === 'select'
    && Array.isArray(value) && value[0] === 'profiles' && value[1] === 'id,full_name'), true)
  assertEquals(result.candidates.length, 2)
  assertEquals(result.candidates.find((candidate: any) => candidate.id === recipient)?.full_name,
    'Recipient Name')
  assertEquals(result.candidates.find((candidate: any) => candidate.id === unnamed)?.full_name, '')
  assertEquals(result.candidates.some((candidate: any) => 'email' in candidate), false)
  assertEquals(result.recipients[0].recipient_id, recipient)
})
