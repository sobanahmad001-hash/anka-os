import test from 'node:test'
import assert from 'node:assert/strict'
import { marketingArtifactChatTargets, loadMarketingArtifactChatWorkspace, MARKETING_CHAT_ARTIFACT_TYPES } from './marketingArtifactChat.js'

const scope = { organizationId: 'org', projectId: 'project', engagementId: 'eng', brandId: 'brand', activeServiceId: 'service' }
const fixture = () => ({
  engagement: { id: 'eng', organization_id: 'org', project_id: 'project', brand_id: 'brand' },
  marketingServices: [{ id: 'service', organization_id: 'org', engagement_id: 'eng', status: 'active', service_catalog: { department_id: 'marketing', is_active: true } }],
  artifacts: [{ id: 'artifact', organization_id: 'org', engagement_id: 'eng', artifact_type: 'channel_strategy', title: 'Strategy' }],
  stages: [], versions: [{ id: 'version', organization_id: 'org', artifact_id: 'artifact' }],
})

test('only the three approved Marketing targets are exposed; ambiguous briefs create a fresh draft', () => {
  const data = fixture(), targets = marketingArtifactChatTargets(data, scope)
  assert.deepEqual(Object.keys(targets.definitions), MARKETING_CHAT_ARTIFACT_TYPES)
  assert.equal(targets.artifactForType('channel_strategy').id, 'artifact')
  assert.equal(targets.artifactForType('marketing_report'), null)
  assert.equal(targets.stageForType('channel_strategy'), null)
  data.artifacts[0].title = 'mutated'
  assert.equal(targets.artifactForType('channel_strategy').title, 'Strategy')
  data.artifacts.push({ ...data.artifacts[0], id: 'second' })
  assert.equal(marketingArtifactChatTargets(data, scope).artifactForType('channel_strategy'), null)
})

test('foreign context, inactive service, mismatched rows and versions fail closed', () => {
  for (const mutate of [
    data => { data.engagement.organization_id = 'foreign' },
    data => { data.engagement.project_id = 'foreign' },
    data => { data.engagement.brand_id = 'foreign' },
    data => { data.marketingServices[0].id = 'other' },
    data => { data.marketingServices[0].status = 'inactive' },
    data => { data.marketingServices[0].service_catalog.is_active = false },
    data => { data.marketingServices[0].service_catalog.department_id = 'design' },
    data => { data.artifacts[0].organization_id = 'foreign' },
    data => { data.artifacts[0].artifact_type = 'marketing_report' },
    data => { data.versions[0].artifact_id = 'foreign' },
    data => { data.versions[0].organization_id = 'foreign' },
    data => { data.stages.push({ organization_id: 'org', engagement_id: 'foreign' }) },
  ]) {
    const data = fixture(); mutate(data)
    assert.equal(marketingArtifactChatTargets(data, scope), null)
  }
})

test('read loader scopes every table, paginates and propagates abort/error without provider calls', async () => {
  const calls = [], controller = new AbortController()
  let denied = false
  const client = { from(table) {
    const call = { table, filters: [], ranges: [] }; calls.push(call)
    return {
      select() { return this }, eq(...args) { call.filters.push(args); return this }, in(...args) { call.filters.push(args); return this },
      order() { return this }, range(start, end) { call.ranges.push([start, end]); return this },
      single() { return this }, abortSignal(signal) { assert.equal(signal, controller.signal); return this },
      then(resolve) { if (denied) return Promise.resolve(resolve({ status: 403, error: { message: 'Denied' } })); return Promise.resolve(resolve({ data: table === 'engagements' ? fixture().engagement
        : table === 'artifacts' && call.ranges.length === 1 ? Array.from({ length: 500 }, (_, id) => ({ id })) : [], error: null })) },
    }
  } }
  await loadMarketingArtifactChatWorkspace(client, 'org', 'eng', { signal: controller.signal })
  assert.equal(calls.length, 5)
  for (const call of calls) {
    assert.ok(call.filters.some(([key, value]) => key === 'organization_id' && value === 'org'))
    assert.ok(call.filters.some(([key, value]) => ['id', 'engagement_id', 'artifacts.engagement_id'].includes(key) && value === 'eng'))
  }
  assert.deepEqual(calls.find(call => call.table === 'artifacts').ranges, [[0, 499], [500, 999]])
  denied = true
  await assert.rejects(loadMarketingArtifactChatWorkspace(client, 'org', 'eng', { signal: controller.signal }), { status: 403 })
  controller.abort()
  await assert.rejects(loadMarketingArtifactChatWorkspace(client, 'org', 'eng', { signal: controller.signal }), { name: 'AbortError' })
})
