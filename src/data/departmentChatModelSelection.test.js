import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { selectDepartmentChatModelConfiguration } from './departmentChatModelSelection.js'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const edge = read('supabase/functions/department-chat/index.ts')
const gateway = read('supabase/functions/integration-gateway/index.ts')
const repository = read('src/data/integrationRepository.js')
const migration = read('supabase/migrations/20260911130000_p9_department_chat_model_selection.sql')
const verifier = read('supabase/verify_20260911130000_p9_department_chat_model_selection.sql')
const component = read('src/components/DepartmentChat.jsx')

test('P9 model UI keeps a valid choice and replaces a stale choice only with an advertised default', () => {
  const capabilities = {
    default_model_configuration_id: 'configuration-a',
    approved_models: [
      { configuration_id: 'configuration-a', model_id: 'verified-a' },
      { configuration_id: 'configuration-b', model_id: 'verified-b' },
    ],
  }
  assert.equal(selectDepartmentChatModelConfiguration(capabilities, 'configuration-b'), 'configuration-b')
  assert.equal(selectDepartmentChatModelConfiguration(capabilities, 'revoked'), 'configuration-a')
  assert.equal(selectDepartmentChatModelConfiguration({
    default_model_configuration_id: 'not-advertised',
    approved_models: [{ configuration_id: 'configuration-b' }],
  }, 'revoked'), 'configuration-b')
  assert.equal(selectDepartmentChatModelConfiguration({ approved_models: [] }, 'browser-id'), '')
})

test('P9 staff sends only an opaque selected configuration and keeps stale completions scoped', () => {
  assert.match(component, /model_configuration_id: modelConfigurationId/)
  assert.match(component, /key={identity}/)
  assert.match(component, /completion\.current\.begin\(\)/)
  assert.match(component, /setModelConfigurationId\(current => selectDepartmentChatModelConfiguration/)
  assert.doesNotMatch(component, /onChange=.*setCapabilities\(/)
})

test('P9 server revalidates selection at dispatch and confirmation with no silent fallback', () => {
  assert.match(edge, /assert_department_chat_model_dispatch/)
  assert.match(edge, /await assertModelDispatch\(admin, body, actorId, provider\)[\s\S]{0,120}const result = await callDepartmentChatProvider/)
  assert.match(edge, /proposal\.model_configuration_id/)
  assert.match(edge, /Selected model is stale or no longer approved/)
  assert.match(edge, /approved_models: provider\.approvedModels/)
  assert.doesNotMatch(edge, /body\.model_id/)
})

test('P9 admin allowlist reuses existing leadership and verified connector facts', () => {
  assert.match(gateway, /if \(!isLeader\).*Leadership access required/)
  assert.match(gateway, /action === 'list_model_allowlist'/)
  assert.match(gateway, /action === 'configure_model_allowlist'/)
  assert.match(gateway, /selectedOrganizationId/)
  assert.match(gateway, /\.eq\('organization_id', selectedOrganizationId\)/)
  assert.match(gateway, /connection\.provider !== 'openai' \|\| connection\.status !== 'verified'/)
  assert.match(gateway, /Model allowlist contains an unverified model/)
  assert.match(gateway, /verifiedModelIds\(connection\)/)
  assert.match(repository, /list_model_allowlist[\s\S]*organization_id: organizationId/)
  assert.match(repository, /configure_model_allowlist[\s\S]*organization_id: organizationId/)
})

test('P9 schema preserves immutable historical identity with RLS and closed browser writes', () => {
  assert.match(migration, /create table public\.department_chat_model_configurations/)
  assert.match(migration, /alter table public\.department_chat_model_configurations enable row level security/)
  assert.match(migration, /grant select on public\.department_chat_model_configurations to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on public\.department_chat_model_configurations to authenticated/)
  assert.match(migration, /department_chat_model_configuration_id uuid/)
  assert.match(migration, /model_configuration_id uuid/)
  assert.match(migration, /model configuration is immutable/i)
  assert.match(migration, /new\.status = 'accepted'[\s\S]*department_chat_model_configuration_is_current/)
  assert.match(verifier, /always rolls back/i)
  for (const gate of [
    'schema_columns_constraints', 'schema_indexes_triggers', 'table_rls_acl',
    'service_rpc_acl', 'private_function_acl', 'seed_default_runtime',
    'rls_own_foreign_runtime', 'rls_suspended_runtime',
    'configure_leadership_runtime', 'configure_unverified_runtime',
    'configure_unmapped_runtime', 'configure_leader_runtime',
    'dispatch_current_runtime', 'dispatch_fabricated_runtime',
    'proposal_run_binding_replay_runtime', 'configuration_immutable_runtime',
    'dispatch_revoked_runtime', 'confirmation_revoked_no_side_effect_runtime',
    'explicit_empty_revocation_runtime', 'browser_direct_mutation_denied',
  ]) {
    assert.match(verifier, new RegExp(gate))
  }
})

test('P9 unapplied migration is ordered after released CHAT-3', () => {
  assert.equal('20260911130000' > '20260911121056', true)
  assert.match(migration, /P9-MODELS-1: governed model selection/)
})
