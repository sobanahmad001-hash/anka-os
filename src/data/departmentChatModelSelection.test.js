import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  runCurrentModelAllowlistRequest,
  selectDepartmentChatModelConfiguration,
} from './departmentChatModelSelection.js'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const edge = read('supabase/functions/department-chat/index.ts')
const gateway = read('supabase/functions/integration-gateway/index.ts')
const repository = read('src/data/integrationRepository.js')
const migration = read('supabase/migrations/20260911130000_p9_department_chat_model_selection.sql')
const verifier = read('supabase/verify_20260911130000_p9_department_chat_model_selection.sql')
const component = read('src/components/DepartmentChat.jsx')
const settings = read('src/apps/Settings.jsx')

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

test('P9 model allowlist drops delayed and failed organization A loads after switching to B', async () => {
  let resolveA
  let state = { organizationId: 'org-a', connections: ['initial-a'] }
  let error = ''
  let current = { organizationId: 'org-a', revision: 1 }
  let generation = 1
  const requestA = { ...current, signal: new AbortController().signal }
  const pendingA = runCurrentModelAllowlistRequest({
    request: requestA, generation: 1,
    currentScope: () => current,
    currentGeneration: () => generation,
    load: () => new Promise(resolve => { resolveA = resolve }),
    onSuccess: result => { state = result },
    onError: reason => { error = reason.message },
  })

  current = { organizationId: 'org-b', revision: 2 }
  generation = 2
  await runCurrentModelAllowlistRequest({
    request: { ...current, signal: new AbortController().signal }, generation: 2,
    currentScope: () => current,
    currentGeneration: () => generation,
    load: async () => ({ organizationId: 'org-b', connections: ['current-b'] }),
    onSuccess: result => { state = result },
    onError: reason => { error = reason.message },
  })
  assert.deepEqual(state, { organizationId: 'org-b', connections: ['current-b'] })
  assert.equal(error, '')

  resolveA({ organizationId: 'org-a', connections: ['delayed-a'] })
  await pendingA
  assert.deepEqual(state, { organizationId: 'org-b', connections: ['current-b'] })
  assert.equal(error, '')

  await runCurrentModelAllowlistRequest({
    request: requestA, generation: 1,
    currentScope: () => current,
    currentGeneration: () => generation,
    load: async () => { throw new Error('stale A failure') },
    onSuccess: result => { state = result },
    onError: reason => { error = reason.message },
  })
  assert.deepEqual(state, { organizationId: 'org-b', connections: ['current-b'] })
  assert.equal(error, '')

  const aborted = new AbortController()
  aborted.abort()
  await runCurrentModelAllowlistRequest({
    request: { organizationId: 'org-a', revision: 1, signal: aborted.signal }, generation: 1,
    currentScope: () => current,
    currentGeneration: () => generation,
    load: async () => { const reason = new Error('aborted A failure'); reason.name = 'AbortError'; throw reason },
    onSuccess: result => { state = result },
    onError: reason => { error = reason.message },
  })
  assert.deepEqual(state, { organizationId: 'org-b', connections: ['current-b'] })
  assert.equal(error, '')
  assert.match(settings, /runCurrentModelAllowlistRequest/)
  assert.match(settings, /key=\{`\$\{activeOrganizationId\}:\$\{scopeRevision\}`\}/)
  assert.match(repository, /listModelAllowlist: \(organizationId, options = \{\}\)/)
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

test('P9 proposal lifecycle accepts connector-verified secondary models without substituting the primary model', () => {
  const verifiedModelGuards = migration.match(
    /connection\.public_config -> 'verified_model_ids'[\s\S]{0,80}\? p_model_id/g,
  ) || []

  assert.ok(verifiedModelGuards.length >= 2)
  assert.match(migration, /save_department_chat_proposal_with_model[\s\S]*p_model_id/)
  assert.match(migration, /confirm_department_chat_proposal[\s\S]*p_model_id/)
  assert.match(migration, /idempotency key was reused with different proposal input/)
  assert.doesNotMatch(migration, /save_department_chat_proposal_with_model[\s\S]{0,500}'model_id'\s*:\s*'gpt-default'/)
  assert.match(verifier, /'\{"model_id":"gpt-default","verified_model_ids":\["gpt-default","gpt-other"\]\}'/)
  assert.match(verifier, /configure_department_chat_model_allowlist\([\s\S]{0,180}'\{"content":\["gpt-other"\]\}'/)
  assert.match(verifier, /save_department_chat_proposal_with_model\([\s\S]{0,1200}f\.connector_id,'gpt-other'/)
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
    'dispatch_current_runtime', 'dispatch_suspended_actor_runtime',
    'dispatch_revoked_actor_runtime', 'dispatch_fabricated_runtime',
    'proposal_run_binding_replay_runtime', 'proposal_binding_immutable_runtime',
    'ai_run_binding_immutable_runtime', 'configuration_immutable_runtime',
    'dispatch_stale_connector_runtime', 'confirmation_stale_no_side_effect_runtime',
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
