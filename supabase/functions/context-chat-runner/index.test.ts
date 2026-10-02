import { GoTrueClient } from 'npm:@supabase/auth-js@2.112.4'
import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { handleRequest, requireOpenAiCanonicalContextChoice, requirePrivateChatPaidExecution, requirePrivateConversationAccess } from './index.ts'
import { buildPrivateConversationPrompt, canonicalOpenAiContext } from '../_shared/contextChatPrompt.js'

Deno.test('paid switch denies new submissions while the handler never calls a provider without auth', async () => {
  let calls = 0
  const result = await handleRequest(new Request('https://example.test/run', { method: 'POST' }),
    () => { calls += 1; throw new Error('provider must not run') },
    { get: () => undefined })
  assertEquals(result.status, 401)
  assertEquals(calls, 0)
  assertEquals((await result.json()).error, 'Authentication required')
  assertThrows(() => requirePrivateChatPaidExecution({ get: () => undefined }))
})

const organizationId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

Deno.test('canonical records enter only an explicit OpenAI prompt with allowlisted fields and no IDs', () => {
  assertEquals(requireOpenAiCanonicalContextChoice(undefined, 'openai'), false)
  assertEquals(requireOpenAiCanonicalContextChoice(true, 'openai'), true)
  assertThrows(() => requireOpenAiCanonicalContextChoice(true, 'anthropic'))
  assertThrows(() => requireOpenAiCanonicalContextChoice(true, 'google_gemini'))
  const snapshot = canonicalOpenAiContext(
    { id: organizationId, name: 'Anka', settings: { secret: 'never-send' } },
    { id: projectId, name: 'Website', description: 'Current brief',
      status: 'active', health: 'at_risk', scope_statement: 'Launch scope',
      exclusions: 'No paid media', private_notes: 'never-send' })
  const prompt = JSON.parse(buildPrivateConversationPrompt([
    { id: userId, role: 'user', status: 'completed', body: 'What next?' },
  ], userId, { context_kind: 'project_team', project_id: projectId,
    department_id: null }, snapshot))
  assertEquals(prompt.canonical_context, { organization_name: 'Anka', project: {
    name: 'Website', description: 'Current brief', status: 'active',
    health: 'at_risk', scope: 'Launch scope', exclusions: 'No paid media',
  } })
  assertEquals(JSON.stringify(prompt).includes(projectId), false)
  assertEquals(JSON.stringify(prompt).includes(organizationId), false)
  assertEquals(JSON.stringify(prompt).includes('never-send'), false)
})

Deno.test('bounded work summary stays opt-in and respects organization versus selected-project scope', () => {
  const summary = { scope: 'selected_project', as_of: '2026-09-25T00:00:00Z',
    coverage: { visible_projects_scanned: 1, projects_included: 1,
      counts_describe_recent_visible_samples_only: true },
    projects: [{ id: projectId, name: 'Website', status: 'active', health: 'at_risk',
      sample: { project_tasks: 1, engagement_work_items: 0,
        project_task_statuses: { blocked: 1 } },
      project_tasks: [{ id: userId, title: 'Fix launch', status: 'blocked',
        due: '2026-09-28', assignee: 'Jamie Example' }],
      engagement_work_items: [],
      review_states_in_recent_visible_version_sample: {} }],
  }
  const rows = [{ id: userId, role: 'user', status: 'completed', body: 'What is blocked?' }]
  const projectScope = { context_kind: 'project_team', project_id: projectId,
    department_id: null }
  const withoutOptIn = JSON.parse(buildPrivateConversationPrompt(rows, userId, projectScope))
  assertEquals(withoutOptIn.canonical_context, undefined)
  const projectContext = canonicalOpenAiContext({ name: 'Anka' },
    { name: 'Website', status: 'active' }, summary)
  const withOptIn = JSON.parse(buildPrivateConversationPrompt(rows, userId,
    projectScope, projectContext))
  assertEquals(withOptIn.canonical_context.work_summary.scope, 'selected_project')
  assertEquals(withOptIn.canonical_context.work_summary.projects[0].project_tasks[0].title,
    'Fix launch')
  assertEquals(JSON.stringify(withOptIn).includes(projectId), false)
  assertEquals(JSON.stringify(withOptIn).includes(userId), false)
  const orgContext = canonicalOpenAiContext({ name: 'Anka' }, null,
    { ...summary, scope: 'current_organization_visible_project_sample' })
  const orgPrompt = JSON.parse(buildPrivateConversationPrompt(rows, userId,
    { context_kind: 'organization', project_id: null, department_id: null }, orgContext))
  assertEquals(orgPrompt.canonical_context.project, undefined)
  assertEquals(orgPrompt.canonical_context.work_summary.scope,
    'current_organization_visible_project_sample')
  assertThrows(() => requireOpenAiCanonicalContextChoice(true, 'anthropic'))
  assertThrows(() => requireOpenAiCanonicalContextChoice(true, 'google_gemini'))
})

function accessAdmin(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const query = {
        select(_columns: string) { return query },
        eq(column: string, value: unknown) {
          filters.push(row => row[column] === value)
          return query
        },
        is(column: string, value: unknown) {
          filters.push(row => row[column] === value)
          return query
        },
        async maybeSingle() {
          return { data: (tables[table] || []).find(row => filters.every(match => match(row))) || null,
            error: null }
        },
      }
      return query
    },
  }
}

Deno.test('private reply scope rechecks active project and current department authority', async () => {
  const organization = { context_kind: 'organization', project_id: null, department_id: null }
  const project = { context_kind: 'project_team', project_id: projectId, department_id: null }
  const department = { context_kind: 'department_private', project_id: null, department_id: 'design' }
  const membership = { role: 'contributor', department_id: 'content' }
  const admin = accessAdmin({
    projects: [{ id: projectId, organization_id: organizationId, archived_at: null }],
    organization_department_memberships: [
      { id: projectId, organization_id: organizationId, user_id: userId,
        department_id: 'design', status: 'active' },
    ],
  })
  await requirePrivateConversationAccess(admin as never, organization, membership, organizationId, userId)
  await requirePrivateConversationAccess(admin as never, project, membership, organizationId, userId)
  await requirePrivateConversationAccess(admin as never, department, membership, organizationId, userId)
  await assertRejects(() => requirePrivateConversationAccess(
    accessAdmin({ projects: [{ id: projectId, organization_id: organizationId,
      archived_at: '2026-09-23T00:00:00Z' }] }) as never,
    project, membership, organizationId, userId))
  await assertRejects(() => requirePrivateConversationAccess(
    accessAdmin({ organization_department_memberships: [
      { id: projectId, organization_id: organizationId, user_id: userId,
        department_id: 'design', status: 'revoked' },
    ] }) as never, department, membership, organizationId, userId))
  await requirePrivateConversationAccess(
    accessAdmin({}) as never, department,
    { role: 'operations_admin', department_id: null }, organizationId, userId)
  await requirePrivateConversationAccess(
    accessAdmin({}) as never, department,
    { role: 'contributor', department_id: 'design' }, organizationId, userId)
})

Deno.test('context handler uses supplemental pricing before reservation and replay never dispatches', async () => {
 const id = '11111111-1111-4111-8111-111111111111'
 const originalFetch = globalThis.fetch; const originalGet = Deno.env.get
 const originalRefresh = GoTrueClient.prototype.startAutoRefresh
 GoTrueClient.prototype.startAutoRefresh = async () => {}
 const row = { provider: 'openai', model_id: 'gpt-6-luna', verified_at: new Date().toISOString(), source_url: 'https://developers.openai.com/api/docs/pricing', input_usd_per_million: 1, cached_input_usd_per_million: 1, cache_write_usd_per_million: 1, output_usd_per_million: 1 }
 const config: Record<string,string> = { SUPABASE_URL:'http://127.0.0.1:54321', SUPABASE_ANON_KEY:'offline-public', SUPABASE_SERVICE_ROLE_KEY:'offline-service', CONTEXT_CHAT_PAID_EXECUTION_ENABLED:'true', ANKA_OPENAI_TEST:'offline-key', N6_OPENAI_MODEL_PRICING_JSON: JSON.stringify([{...row,model_id:'gpt-4.1'}]) }
 let reservations=0; let providers=0
 const message={id,conversation_id:id,organization_id:id,owner_id:id,author_id:id,role:'user',status:'completed',sequence:1,body:'Hello'}
 try {
  Deno.env.get = name => config[name]
  globalThis.fetch = async (input) => {
   const url = new URL(input instanceof Request ? input.url : String(input)); let data: unknown
   if(url.origin !== 'http://127.0.0.1:54321') throw new Error('Remote forbidden')
   const path=url.pathname
   if(path==='/auth/v1/user') data={id}
   else if(path.endsWith('/organization_memberships')) data={status:'active',member_kind:'team',role:'system_owner'}
   else if(path.endsWith('/department_chat_messages')) data=url.searchParams.has('limit')?[message]:message
   else if(path.endsWith('/department_chat_conversations')) data={id,organization_id:id,owner_id:id,context_kind:'organization',project_id:null,department_id:null,state:'active'}
   else if(path.endsWith('/context_chat_organization_models')) data={id,organization_id:id,connector_connection_id:id,model_id:row.model_id,revoked_at:null}
   else if(path.endsWith('/integration_connections')) data={id,organization_id:id,provider:'openai',status:'verified',archived_at:null,secret_name:'ANKA_OPENAI_TEST'}
   else if(path.endsWith('/append_context_chat_audited_reply')) return new Response(JSON.stringify({message:'No audit'}),{status:400,headers:{'content-type':'application/json'}})
   else if(path.endsWith('/recover_context_chat_completed_run')) data={status:'no_run'}
   else if(path.endsWith('/reserve_context_chat_budget')) { reservations++; data={status:'reserved'} }
   else if(path.endsWith('/claim_context_chat_dispatch')) data={must_not_submit:true}
   else throw new Error('Unexpected '+path)
   return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
  }
  for(const valid of [false,true]) {
   config.N6_OPENAI_APPROVED_MODELS_PRICING_JSON=valid?JSON.stringify([row]):'{'
   const response=await handleRequest(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer offline'},body:JSON.stringify({organization_id:id,message_id:id,model_configuration_id:id,dispatch_request_id:id})}), (async()=>{providers++;throw new Error('No provider')}) as typeof fetch, {get:name=>config[name]})
   const body=await response.json()
   if(valid) assertEquals(body.status,'already_claimed')
   else assertEquals(String(body.error).includes('supplemental pricing is invalid'),true)
  }
  assertEquals(reservations,1); assertEquals(providers,0)
 } finally { await new Promise(resolve => setTimeout(resolve, 20)); globalThis.fetch=originalFetch; Deno.env.get=originalGet; GoTrueClient.prototype.startAutoRefresh=originalRefresh }
})
