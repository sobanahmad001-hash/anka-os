import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createPipelineAiTextRouteSettingsRepository } from './pipelineAiTextRouteSettingsRepository.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260922040000_n6_text_route_settings_read.sql', import.meta.url), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'
const MODEL = '22222222-2222-4222-8222-222222222222'
const REQUEST = '33333333-3333-4333-8333-333333333333'

test('N6 route settings read keeps private rows behind current team authority', () => {
  assert.match(migration, /membership\.user_id = actor and membership\.member_kind = 'team'/)
  assert.match(migration, /membership\.status = 'active'/)
  assert.match(migration, /grant execute on function public\.list_pipeline_ai_text_route_settings\(uuid\) to authenticated/)
  assert.doesNotMatch(migration, /grant (?:select|all) on private\.pipeline_ai_text_route/)
})

test('N6 route settings use the exact ordered model IDs and stable caller request ID', async () => {
  const calls = []
  const client = {
    rpc(name, payload) {
      calls.push([name, payload])
      return Promise.resolve({ data: [], error: null })
    },
  }
  const repository = createPipelineAiTextRouteSettingsRepository(client)
  await repository.list(ORG)
  await repository.save({
    organizationId: ORG, departmentId: 'design', requestId: REQUEST,
    modelConfigurationIds: [MODEL],
  })
  assert.deepEqual(calls, [
    ['list_pipeline_ai_text_route_settings', { p_organization_id: ORG }],
    ['configure_pipeline_ai_text_routes', {
      p_organization_id: ORG, p_department_id: 'design',
      p_request_id: REQUEST, p_model_configuration_ids: [MODEL],
    }],
  ])
  assert.throws(() => repository.save({
    organizationId: ORG, departmentId: 'design', requestId: REQUEST,
    modelConfigurationIds: [MODEL, MODEL],
  }), /unique/)
  assert.throws(() => repository.save({
    organizationId: ORG, departmentId: 'development', requestId: REQUEST,
    modelConfigurationIds: [],
  }), /department/)
})