import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { contextChatAction } from './contextChatActions.ts'

const org = 'a0000000-0000-4000-8000-000000000001'
const project = 'a0000000-0000-4000-8000-000000000002'
const thread = 'a0000000-0000-4000-8000-000000000003'
const owner = 'a0000000-0000-4000-8000-000000000004'
const recipient = 'a0000000-0000-4000-8000-000000000005'

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
    department_chat_messages: [{ id: 'message', conversation_id: thread,
      organization_id: org, author_id: owner, sequence: 1, body: 'Direction' }],
  }
  const calls: Array<[string, unknown]> = []
  const admin = {
    from(table: string) {
      calls.push(['from', table])
      let selected = [...(rows[table] || [])]
      const query: any = {
        select() { return query },
        eq(key: string, value: unknown) { selected = selected.filter(row => row[key] === value); return query },
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

