import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  PIPELINE_TEMPLATE_DRAFT_ROLES,
  PIPELINE_TEMPLATE_PUBLISH_ROLES,
  createPipelineTemplatesRepository,
  normalizePipelineTemplateVersion,
} from './pipelineTemplatesRepository.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260903201500_pln2_versioned_pipeline_templates.sql', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../../supabase/verify_20260903201500_pln2_versioned_pipeline_templates.sql', import.meta.url), 'utf8')
const reviewGate = readFileSync(new URL('../../docs/release/PLN2_VERSIONED_PIPELINE_TEMPLATES_REVIEW_GATE.md', import.meta.url), 'utf8')

test('PLN2 maps approved drafting and publication authority to established roles', () => {
  assert.deepEqual(PIPELINE_TEMPLATE_DRAFT_ROLES, ['system_owner', 'operations_admin', 'department_manager'])
  assert.deepEqual(PIPELINE_TEMPLATE_PUBLISH_ROLES, ['system_owner', 'operations_admin'])
  assert.match(migration, /array\['system_owner', 'operations_admin', 'department_manager'\]/)
  assert.match(migration, /array\['system_owner', 'operations_admin'\]/)
  assert.doesNotMatch(migration, /array\['system_owner', 'operations_admin', 'executive'\]/)
})

test('PLN2 requires an active team member in an active organization', () => {
  assert.match(migration, /create or replace function private\.is_active_pipeline_team_member/)
  assert.match(migration, /create or replace function private\.has_active_pipeline_template_role/)
  for (const required of [
    /organization\.status = 'active'/,
    /membership\.member_kind = 'team'/,
    /membership\.status = 'active'/,
    /membership\.user_id = \(select auth\.uid\(\)\)/,
  ]) assert.match(migration, required)

  const privateVisibility = migration.match(
    /create or replace function private\.can_read_pipeline_template_version[\s\S]*?revoke all on function private\.can_read_pipeline_template_version/,
  )?.[0] || ''
  assert.match(privateVisibility, /private\.is_active_pipeline_team_member/)
  assert.match(privateVisibility, /private\.has_active_pipeline_template_role/)
  assert.doesNotMatch(privateVisibility, /public\.(?:is_team_organization_member|has_organization_role)/)

  for (const rpc of ['create_pipeline_template_version', 'publish_pipeline_template_version']) {
    const definition = migration.match(new RegExp(
      `create or replace function public\\.${rpc}[\\s\\S]*?\\n\\$\\$;`,
    ))?.[0] || ''
    assert.match(definition, /private\.has_active_pipeline_template_role/)
    assert.doesNotMatch(definition, /public\.has_organization_role/)
  }
})

test('PLN2 normalizes one ordered unique service selection', () => {
  assert.deepEqual(normalizePipelineTemplateVersion({
    slug: ' Website_Delivery ', name: ' Website delivery ',
    serviceIds: ['service-a', 'service-b'], description: ' Connected delivery ',
  }), {
    pipelineTemplateId: null,
    slug: 'website_delivery',
    name: 'Website delivery',
    description: 'Connected delivery',
    serviceIds: ['service-a', 'service-b'],
    sourceVersionId: null,
    changeSummary: '',
  })
  assert.throws(() => normalizePipelineTemplateVersion({ slug: 'bad slug', name: 'Bad', serviceIds: ['a'] }), /snake_case/)
  assert.throws(() => normalizePipelineTemplateVersion({ slug: 'valid', name: 'Bad', serviceIds: ['a', 'a'] }), /unique/)
  assert.throws(() => normalizePipelineTemplateVersion({ slug: 'valid', name: 'Bad', serviceIds: [] }), /At least one/)
})

function mockClient() {
  const calls = []
  const query = table => {
    const chain = {
      select(columns) { calls.push({ type: 'select', table, columns }); return chain },
      eq(column, value) { calls.push({ type: 'eq', table, column, value }); return chain },
      order(column, options) { calls.push({ type: 'order', table, column, options }); return chain },
      abortSignal() { return chain },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) },
    }
    return chain
  }
  return {
    calls,
    client: {
      from(table) { return query(table) },
      rpc(name, input) { calls.push({ type: 'rpc', name, input }); return Promise.resolve({ data: { ok: true }, error: null }) },
    },
  }
}

test('PLN2 repository scopes every read to the selected organization', async () => {
  const { client, calls } = mockClient()
  await createPipelineTemplatesRepository(client).list('org-a')
  for (const table of [
    'pipeline_templates', 'pipeline_template_versions',
    'pipeline_template_version_services', 'pipeline_template_publications',
  ]) {
    assert.ok(calls.some(call => call.type === 'eq' && call.table === table
      && call.column === 'organization_id' && call.value === 'org-a'))
  }
})

test('PLN2 repository uses only the two role-checking database actions', async () => {
  const { client, calls } = mockClient()
  const repository = createPipelineTemplatesRepository(client)
  await repository.createVersion({
    pipelineTemplateId: 'template-a', slug: 'campaign', name: 'Campaign',
    serviceIds: ['service-a'], sourceVersionId: 'version-a', changeSummary: 'Narrower scope',
  }, 'org-a')
  await repository.publishVersion('version-b')
  assert.deepEqual(calls.filter(call => call.type === 'rpc').map(call => call.name), [
    'create_pipeline_template_version', 'publish_pipeline_template_version',
  ])
  assert.deepEqual(calls.find(call => call.name === 'create_pipeline_template_version').input, {
    p_organization_id: 'org-a', p_pipeline_template_id: 'template-a',
    p_slug: 'campaign', p_name: 'Campaign', p_description: '',
    p_service_ids: ['service-a'], p_source_version_id: 'version-a',
    p_change_summary: 'Narrower scope',
  })
})

test('PLN2 stores immutable presets without creating a template-owned graph', () => {
  for (const table of [
    'pipeline_templates', 'pipeline_template_versions',
    'pipeline_template_version_services', 'pipeline_template_publications',
    'engagement_pipeline_origins', 'engagement_composition_requests',
  ]) assert.match(migration, new RegExp(`create table public\\.${table}`))
  assert.doesNotMatch(migration, /create table public\.pipeline_template_(stages|dependencies|prerequisites)/)
  assert.match(migration, /public\.service_stage_rules/)
  assert.match(migration, /public\.blueprint_stage_dependencies/)
  assert.match(migration, /Canonical service rules remain the only journey graph authority/)
})

test('PLN2 keeps only real foreign-key coverage and non-redundant publication constraints', () => {
  assert.match(migration, /create index idx_pipeline_templates_created_by/)
  assert.doesNotMatch(migration, /create index idx_engagement_composition_requests_engagement_org_fk/)
  const publications = migration.match(
    /create table public\.pipeline_template_publications[\s\S]*?\n\);/,
  )?.[0] || ''
  assert.doesNotMatch(publications, /unique \(id, organization_id\)/)
  assert.match(verifier, /from pg_index index_record/)
  assert.match(verifier, /index_record\.indisvalid/)
  assert.match(verifier, /foreign_keys\.conkey/)
})

test('PLN2 publication freezes selection and current-rule hashes for later drift notice', () => {
  assert.match(migration, /service_selection_sha256/)
  assert.match(migration, /published_rule_manifest/)
  assert.match(migration, /published_rule_sha256/)
  assert.match(migration, /private\.pipeline_rule_manifest/)
  assert.match(migration, /extensions\.digest/)
  assert.match(migration, /idempotent_replay/)
})

test('PLN2 reserves append-only provenance and server-side idempotency for PLN3', () => {
  assert.match(migration, /primary key \(organization_id, request_id\)/)
  assert.match(migration, /normalized_payload_sha256/)
  assert.match(migration, /preview_rule_sha256/)
  assert.match(migration, /customization_provenance/)
  assert.match(migration, /original_selection_sha256/)
  assert.match(migration, /final_selection_sha256/)
  assert.match(migration, /protect_engagement_pipeline_origins/)
  assert.match(migration, /protect_engagement_composition_requests/)
})

test('PLN2 keeps browser writes closed and preserves compose_engagement', () => {
  assert.match(migration, /revoke all on[\s\S]*from public, anon, authenticated, service_role/)
  assert.match(migration, /grant select on[\s\S]*to authenticated/)
  assert.doesNotMatch(migration, /create or replace function public\.compose_engagement/)
  assert.match(reviewGate, /PLN3 must rebase after PLN2/)
})

test('PLN2 verifier covers catalog ACL RLS role immutability tenant and negative gates', () => {
  for (const gate of [
    'all_tables_have_rls', 'rls_policy_matrix_is_exact', 'table_acl_matrix_is_exact',
    'rpc_acl_matrix_is_exact', 'rpc_security_is_exact', 'authorization_helpers_are_exact',
    'append_only_guards_are_exact',
    'tenant_foreign_keys_are_exact', 'foreign_key_indexes_exist', 'no_template_owned_graph',
    'department_manager_can_draft', 'department_manager_cannot_publish',
    'operations_admin_can_publish', 'contributor_cannot_draft',
    'published_version_visible_to_contributor', 'unpublished_version_hidden_from_contributor',
    'version_update_is_rejected', 'publication_delete_is_rejected',
    'privileged_client_membership_is_rejected', 'suspended_organization_is_rejected',
    'archived_organization_is_rejected', 'suspended_membership_is_rejected',
    'revoked_membership_is_rejected', 'cross_organization_service_is_rejected',
    'cross_organization_write_is_rejected', 'cross_organization_reads_are_empty',
    'anonymous_calls_are_rejected', 'rejected_calls_leave_no_rows',
    'publish_replay_rechecks_authorization', 'inactive_context_reads_are_empty',
  ]) assert.match(verifier, new RegExp(`'${gate}'`))
  assert.match(verifier, /pg_get_expr\(policy\.polqual/)
  assert.match(verifier, /trigger_record\.tgtype = 27/)
  assert.match(verifier, /rollback;/)
  assert.doesNotMatch(verifier, /commit;/)
})
