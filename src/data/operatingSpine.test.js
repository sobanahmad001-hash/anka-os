import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createOperatingSpineRepository, pipelineDepartmentFlags } from './operatingSpineRepository.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260827150000_operating_spine_core.sql', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./operatingSpineRepository.js', import.meta.url), 'utf8')
const remediation = readFileSync(new URL('../../supabase/migrations/20260827140000_operating_spine_security_remediation.sql', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const operatingSpineView = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')
const assistantFunction = readFileSync(new URL('../../supabase/functions/ai-chat/index.ts', import.meta.url), 'utf8')

test('Operating Spine keeps Client, Brand, Engagement, and Service as separate relational entities', () => {
  for (const table of ['agency_clients', 'brands', 'engagements', 'service_catalog']) {
    assert.match(migration, new RegExp(`create table public\\.${table} \\(`))
  }
  assert.match(migration, /foreign key \(client_id, organization_id\)[\s\S]*references public\.agency_clients/)
  assert.match(migration, /foreign key \(brand_id, client_id, organization_id\)[\s\S]*references public\.brands/)
  assert.match(migration, /legacy_client_id uuid unique[\s\S]*references public\.clients/)
  assert.match(migration, /legacy_project_id uuid unique[\s\S]*references public\.projects/)
})

test('the service catalogue contains the agreed four department lists', () => {
  const seededServices = [...migration.matchAll(/\('(content|design|development|marketing)', '[a-z0-9_]+'[,] /g)]
  const counts = seededServices.reduce((result, match) => ({ ...result, [match[1]]: (result[match[1]] || 0) + 1 }), {})
  assert.deepEqual(counts, { content: 8, design: 8, development: 9, marketing: 9 })
})

test('blueprint instantiation is driven by selected services and short prerequisites', () => {
  assert.match(migration, /where engagement_service\.engagement_id = v_engagement_id/)
  assert.match(migration, /rule\.rule_kind = 'primary'/)
  assert.match(migration, /not exists \([\s\S]*public\.engagement_assets/)
  assert.match(migration, /satisfied_by_stage_slugs/)
  assert.match(migration, /satisfaction_method in \('existing_asset', 'selected_stage', 'short_stage', 'waived'\)/)
  assert.doesNotMatch(migration, /insert into public\.engagement_stage_instances[\s\S]{0,300}cross join public\.blueprint_stage_catalog/)
})

test('all new client-owned Operating Spine tables are protected by organization RLS', () => {
  const scopedTables = [
    'agency_clients', 'brands', 'engagements', 'service_catalog',
    'engagement_assets', 'engagement_services', 'engagement_stage_instances',
    'engagement_stage_services', 'engagement_prerequisites',
    'engagement_stage_dependencies', 'engagement_events',
    'integration_connection_engagements',
  ]
  for (const table of scopedTables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(migration, /public\.is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all on[\s\S]*from anon, authenticated/)
})

test('engagement creation, service activation, and blueprint instantiation are audited', () => {
  for (const eventType of ['engagement_created', 'service_activated', 'blueprint_instantiated']) {
    assert.match(migration, new RegExp(`'${eventType}'`))
  }
  assert.match(migration, /create trigger trg_audit_engagement_created/)
  assert.match(migration, /create trigger trg_audit_engagement_service_activated/)
})

test('connectors and AI runs are scoped to engagement plus department', () => {
  assert.match(migration, /create table public\.integration_connection_engagements/)
  assert.match(migration, /add column engagement_id uuid[\s\S]*references public\.engagements/)
  assert.match(assistantFunction, /integration_connection_engagements!inner\(engagement_id, department_id\)/)
  assert.match(assistantFunction, /No verified OpenAI connector is assigned to this engagement and department/)
  assert.match(assistantFunction, /engagement_id: engagementId/)
})

test('security remediation keeps legacy organization-less tables server-only', () => {
  for (const table of ['deployments', 'design_reviews', 'review_checks', 'review_comments', 'sprint_tasks', 'system_health_logs', 'user_activity_logs', 'department_metrics', 'as_crm_signals', 'as_project_phases', 'issue_labels', 'environment_variables']) {
    assert.ok(remediation.includes(`public.${table}`), `${table} must be classified in remediation SQL`)
  }
  assert.match(remediation, /revoke execute on function graphql\.resolve/)
  assert.match(remediation, /public\.is_team_organization_member\(task\.organization_id\)/)
})

test('the active product route is Engagements while the old projects URL remains a redirect', () => {
  assert.match(app, /path="sphere\/engagements" element={<OperatingSpine initialView="engagements" \/>}/)
  assert.match(app, /path="sphere\/projects" element={<Navigate to="\/sphere\/engagements" replace \/>}/)
})

test('engagement composition rejects an empty service selection before calling Supabase', async () => {
  const repository = createOperatingSpineRepository({ from() {}, rpc() { throw new Error('must not be called') } })
  await assert.rejects(
    () => repository.composeEngagement({ clientId: 'client', brandId: 'brand', name: 'Test', serviceIds: [] }),
    /At least one service is required/
  )
})

test('EPV1 adds pipeline aggregates to getEngagement', () => {
  const expectedReadTables = [
    'content_requests',
    'content_queue_entries',
    'work_items',
    'design_workshop_sessions',
    'design_directions',
    'design_direction_versions',
    'website_page_designs',
    'wordpress_export_jobs',
  ]

  for (const table of expectedReadTables) {
    assert.ok(repository.includes(`from('${table}')`), `Expected ${table} read in repository`)
  }

  assert.match(repository, /pipeline:\s*\{[\s\S]*contentRequests/)
  assert.match(repository, /contentQueueEntries/)
  assert.match(repository, /workItems/)
  assert.match(repository, /design:\s*\{[\s\S]*pageDesigns/)
  assert.match(repository, /wordpressExportJobs/)
})

test('Engagement workspace renders a pipeline tab and read-only entry points', () => {
  assert.match(operatingSpineView, /pipeline/i)
  assert.match(operatingSpineView, /Pipeline snapshot/)
  assert.match(operatingSpineView, /Open content studio with engagement context/)
  assert.match(operatingSpineView, /Open design workshop with engagement context/)
  assert.match(operatingSpineView, /Open marketing studio with engagement context/)
  assert.match(operatingSpineView, /\/sphere\/content\/studio\?engagement=\$\{engagementId\}/)
  assert.match(operatingSpineView, /\/sphere\/design\/workshop\?engagement=\$\{engagementId\}/)
  assert.match(operatingSpineView, /\/sphere\/marketing\/studio\?engagement=\$\{engagementId\}/)
  assert.match(operatingSpineView, /\/sphere\/engagements\?engagement=\$\{engagementId\}&tab=work/)
  assert.match(operatingSpineView, /Journey stage status/)
  assert.match(operatingSpineView, /pipelineDepartmentFlags\(workspace\.services\)/)
assert.ok(operatingSpineView.includes('to={`/sphere/content/studio?engagement=${engagementId}`}'))
assert.ok(operatingSpineView.includes('to={`/sphere/design/workshop?engagement=${engagementId}`}'))
assert.ok(operatingSpineView.includes('to={`/sphere/engagements?engagement=${engagementId}&tab=work`}'))
  assert.match(operatingSpineView, /function PipelineWorkspace\(\{ workspace \}\)/)
  const marketingStudioView = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
  assert.match(marketingStudioView, /useSearchParams/)
  assert.match(marketingStudioView, /requestedEngagementId/)
})
function readOnlyPipelineClient(visibleRows) {
  const calls = []
  const client = {
    from(table) {
      const query = {
        select() { return query },
        eq(column, value) { calls.push({ table, operator: 'eq', column, value }); return query },
        in(column, values) { calls.push({ table, operator: 'in', column, values }); return query },
        is(column, value) { calls.push({ table, operator: 'is', column, value }); return query },
        order() { return query },
        limit() { return query },
        single() { return Promise.resolve({ data: visibleRows[table]?.[0] || null, error: null }) },
        then(resolve, reject) { return Promise.resolve({ data: visibleRows[table] || [], error: null }).then(resolve, reject) },
      }
      return query
    },
    rpc() { throw new Error('EPV1 must not call RPC') },
  }
  return { client, calls }
}

test('EPV1 keeps pipeline reads within caller-visible organisation rows and engagement-linked queue entries', async () => {
  const visibleRows = {
    engagements: [{ id: 'engagement-a', organization_id: 'org-a', brand_id: 'brand-a' }],
    content_requests: [{ id: 'request-a', organization_id: 'org-a', engagement_id: 'engagement-a', queue_entry_id: 'queue-a', status: 'in_progress' }],
    content_queue_entries: [{ id: 'queue-a', organization_id: 'org-a', status: 'planned' }],
  }
  const hiddenCrossOrganizationRows = [{ id: 'request-b', organization_id: 'org-b', engagement_id: 'engagement-b', queue_entry_id: 'queue-b' }]
  const { client, calls } = readOnlyPipelineClient(visibleRows)
  const result = await createOperatingSpineRepository(client).getEngagement('engagement-a')

  assert.deepEqual(result.pipeline.contentRequests, visibleRows.content_requests)
  assert.equal(result.pipeline.contentRequests.some(row => row.organization_id === 'org-b'), false)
  assert.equal(hiddenCrossOrganizationRows.some(row => result.pipeline.contentRequests.includes(row)), false)
  assert.deepEqual(result.pipeline.contentQueueEntries, visibleRows.content_queue_entries)
  assert.deepEqual(calls.find(call => call.table === 'content_queue_entries' && call.operator === 'in'), {
    table: 'content_queue_entries', operator: 'in', column: 'id', values: ['queue-a'],
  })
})

test('EPV1 pipeline flags only the active department sections for an isolated service', () => {
  assert.deepEqual(
    pipelineDepartmentFlags([{ status: 'active', service_catalog: { department_id: 'marketing' } }]),
    { content: false, design: false, marketing: true }
  )
  assert.deepEqual(
    pipelineDepartmentFlags([
      { status: 'active', service_catalog: { department_id: 'content' } },
      { status: 'active', service_catalog: { department_id: 'design' } },
      { status: 'active', service_catalog: { department_id: 'marketing' } },
    ]),
    { content: true, design: true, marketing: true }
  )
})
