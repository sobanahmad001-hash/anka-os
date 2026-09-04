import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createPipelineTemplatesRepository,
  normalizePipelinePreviewInput,
  pipelineCustomization,
} from './pipelineTemplatesRepository.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260904000717_pln3_preview_instantiation.sql', import.meta.url), 'utf8')
const operatingSpine = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')
const previewComponent = readFileSync(new URL('../components/PipelineTemplateJourneyPreview.jsx', import.meta.url), 'utf8')

const IDS = Object.freeze({
  templateVersion: '11111111-1111-4111-8111-111111111111',
  serviceA: '22222222-2222-4222-8222-222222222222',
  serviceB: '33333333-3333-4333-8333-333333333333',
  serviceC: '44444444-4444-4444-8444-444444444444',
  request: '55555555-5555-4555-8555-555555555555',
  client: '66666666-6666-4666-8666-666666666666',
  brand: '77777777-7777-4777-8777-777777777777',
})

test('PLN3 normalizes preview inputs and deterministic net customization', () => {
  assert.deepEqual(pipelineCustomization(
    [IDS.serviceA, IDS.serviceB],
    [IDS.serviceB, IDS.serviceC],
  ), [
    { action: 'removed', service_id: IDS.serviceA, original_position: 0 },
    { action: 'added', service_id: IDS.serviceC, final_position: 1 },
  ])
  assert.deepEqual(pipelineCustomization(
    [IDS.serviceA, IDS.serviceB],
    [IDS.serviceB, IDS.serviceA],
  ), [
    { action: 'moved', service_id: IDS.serviceB, original_position: 1, final_position: 0 },
    { action: 'moved', service_id: IDS.serviceA, original_position: 0, final_position: 1 },
  ])
  assert.deepEqual(normalizePipelinePreviewInput({
    pipelineTemplateVersionId: IDS.templateVersion,
    originalServiceIds: [IDS.serviceA, IDS.serviceB],
    serviceIds: [IDS.serviceB, IDS.serviceC],
    existingAssets: [{ asset_kind: ' brand_context ', name: ' Context ', source_url: '', notes: ' ok ' }],
  }), {
    pipelineTemplateVersionId: IDS.templateVersion,
    originalServiceIds: [IDS.serviceA, IDS.serviceB],
    serviceIds: [IDS.serviceB, IDS.serviceC],
    existingAssets: [{ asset_kind: 'brand_context', name: 'Context', source_url: null, notes: 'ok' }],
    customizationProvenance: [
      { action: 'removed', service_id: IDS.serviceA, original_position: 0 },
      { action: 'added', service_id: IDS.serviceC, final_position: 1 },
    ],
  })
  assert.throws(() => normalizePipelinePreviewInput({
    pipelineTemplateVersionId: IDS.templateVersion,
    originalServiceIds: [IDS.serviceA],
    serviceIds: [IDS.serviceA, IDS.serviceA],
  }), /unique/)
})

function mockClient() {
  const calls = []
  return {
    calls,
    client: {
      from() { throw new Error('PLN3 preview and composition must use database-owned RPCs') },
      rpc(name, input) {
        calls.push({ name, input })
        return Promise.resolve({ data: name.startsWith('preview_')
          ? { preview_rule_sha256: 'a'.repeat(64) }
          : { engagement_id: 'engagement-a', idempotent_replay: false }, error: null })
      },
    },
  }
}

test('PLN3 repository scopes preview and composition to the selected organization', async () => {
  const { client, calls } = mockClient()
  const repository = createPipelineTemplatesRepository(client)
  const base = {
    pipelineTemplateVersionId: IDS.templateVersion,
    originalServiceIds: [IDS.serviceA],
    serviceIds: [IDS.serviceA],
    existingAssets: [],
  }
  await repository.preview(base, 'org-a')
  await repository.compose({
    ...base,
    requestId: IDS.request,
    previewRuleSha256: 'a'.repeat(64),
    clientId: IDS.client,
    brandId: IDS.brand,
    name: ' Campaign ',
  }, 'org-a')

  assert.deepEqual(calls.map(call => call.name), [
    'preview_pipeline_engagement',
    'compose_engagement_from_pipeline_template',
  ])
  assert.equal(calls[0].input.p_organization_id, 'org-a')
  assert.equal(calls[1].input.p_organization_id, 'org-a')
  assert.equal(calls[1].input.p_request_id, IDS.request)
  assert.equal(calls[1].input.p_name, 'Campaign')
  assert.equal(calls[1].input.p_preview_rule_sha256, 'a'.repeat(64))
  assert.ok(!('p_normalized_payload_sha256' in calls[1].input), 'payload hash must be server-computed')
})

test('PLN3 uses one database planner for preview and creation without replacing canonical composition', () => {
  assert.match(migration, /create or replace function private\.plan_pipeline_engagement/)
  const preview = migration.match(/create or replace function public\.preview_pipeline_engagement[\s\S]*?\n\$\$;/)?.[0] || ''
  const compose = migration.match(/create or replace function public\.compose_engagement_from_pipeline_template[\s\S]*?\n\$\$;/)?.[0] || ''
  assert.match(preview, /private\.plan_pipeline_engagement/)
  assert.match(compose, /private\.plan_pipeline_engagement/)
  assert.match(compose, /public\.compose_engagement\(/)
  assert.doesNotMatch(migration, /create or replace function public\.compose_engagement\(/)
  assert.match(preview, /stable[\s\S]*security definer[\s\S]*set search_path = ''/)
  assert.match(compose, /volatile[\s\S]*security definer[\s\S]*set search_path = ''/)
})

test('PLN3 preview is read-only and creation is stale-safe atomic and replay-safe', () => {
  const preview = migration.match(/create or replace function public\.preview_pipeline_engagement[\s\S]*?\n\$\$;/)?.[0] || ''
  const compose = migration.match(/create or replace function public\.compose_engagement_from_pipeline_template[\s\S]*?\n\$\$;/)?.[0] || ''
  assert.doesNotMatch(preview, /\b(insert|update|delete)\b/i)
  assert.match(compose, /pg_advisory_xact_lock/)
  assert.match(compose, /normalized_payload_sha256 <> v_payload_sha256/)
  assert.match(compose, /Pipeline preview is stale/)
  assert.match(migration, /'current_rule_sha256'/)
  assert.match(migration, /'pipeline_template_version_id'/)
  assert.match(migration, /'organization_id'/)
  assert.match(migration, /nullif\(trim\(asset ->> 'name'\), ''\) is not null/)
  assert.match(compose, /insert into public\.engagement_pipeline_origins/)
  assert.match(compose, /insert into public\.engagement_composition_requests/)
  assert.match(migration, /begin;[\s\S]*commit;/)
})

test('PLN3 denies public and anonymous execution and adds no graph or ownership table', () => {
  assert.match(migration, /revoke all on function public\.preview_pipeline_engagement[\s\S]*from public, anon, authenticated, service_role/)
  assert.match(migration, /revoke all on function public\.compose_engagement_from_pipeline_template[\s\S]*from public, anon, authenticated, service_role/)
  assert.doesNotMatch(migration, /create table public\./)
  assert.doesNotMatch(migration, /pipeline_template_(stages|dependencies|prerequisites)/)
})

test('PLN3 UI keeps direct composition and gates template creation on a current preview', () => {
  assert.match(operatingSpine, /Pipeline template \(optional\)/)
  assert.match(operatingSpine, /Direct service selection/)
  assert.match(operatingSpine, /pipelineTemplates\.preview/)
  assert.match(operatingSpine, /pipelineTemplates\.compose/)
  assert.match(operatingSpine, /operatingSpine\.composeEngagement/)
  assert.match(operatingSpine, /form\.pipelineTemplateVersionId && !journeyPreview/)
  assert.match(operatingSpine, /generation === previewGeneration\.current/)
  assert.match(previewComponent, /Historical preset/)
  assert.match(previewComponent, /Canonical rules have changed/)
  assert.match(previewComponent, /Read-only/)
})
