import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createOperatingSpineRepository } from './operatingSpineRepository.js'

const migration = readFileSync(
  new URL('../../supabase/migrations/20260903050747_canonical_ownership_convergence.sql', import.meta.url),
  'utf8',
)
const verifier = readFileSync(
  new URL('../../supabase/verify_20260903050747_canonical_ownership_convergence.sql', import.meta.url),
  'utf8',
)
const repository = readFileSync(new URL('./operatingSpineRepository.js', import.meta.url), 'utf8')
const assistant = readFileSync(new URL('../apps/AnkaAssistant.jsx', import.meta.url), 'utf8')
const aiChat = readFileSync(new URL('../../supabase/functions/ai-chat/index.ts', import.meta.url), 'utf8')

test('OAF2 keeps clients and projects as canonical roots without re-keying extensions', () => {
  assert.match(migration, /alter table public\.agency_clients[\s\S]*add column canonical_client_id uuid/)
  assert.match(migration, /alter table public\.engagements[\s\S]*add column project_id uuid/)
  assert.match(migration, /agency_clients_canonical_client_id_key[\s\S]*unique \(canonical_client_id\)/)
  assert.match(migration, /engagements_project_id_key[\s\S]*unique \(project_id\)/)
  assert.match(migration, /references public\.clients\(id, organization_id\) on delete restrict/)
  assert.match(migration, /references public\.projects\(id, organization_id\) on delete restrict/)
  assert.match(migration, /create or replace function private\.protect_engaged_project_client\(\)/)
  assert.match(migration, /new\.client_id is distinct from old\.client_id[\s\S]*from public\.engagements/)
  assert.match(migration, /before update of client_id on public\.projects/)
  assert.match(migration, /A project with an engagement cannot change client ownership/)
  assert.doesNotMatch(migration, /drop table public\.(agency_clients|engagements)/)
  assert.doesNotMatch(migration, /delete from public\.(agency_clients|engagements|clients|projects)/)
})

test('OAF2 preserves and materializes extension-only data', () => {
  assert.match(migration, /where canonical_client_id is null[\s\S]*insert into public\.clients/)
  assert.match(migration, /where project_id is null[\s\S]*insert into public\.projects/)
  assert.match(migration, /legacy_client_id = v_client_id/)
  assert.match(migration, /legacy_project_id = v_project_id/)
  assert.match(migration, /Canonical root materialized by OAF2/)
})

test('artifact and work-item project ownership is derived and constrained', () => {
  assert.match(migration, /alter table public\.artifacts[\s\S]*add column project_id uuid/)
  assert.match(migration, /alter table public\.work_items[\s\S]*add column project_id uuid/)
  assert.match(migration, /artifacts_engagement_project_organization_fkey/)
  assert.match(migration, /work_items_engagement_project_organization_fkey/)
  assert.match(migration, /create trigger trg_oaf2_derive_artifact_project/)
  assert.match(migration, /create trigger trg_oaf2_derive_work_item_project/)
  assert.doesNotMatch(migration, /alter table public\.tasks/)
  assert.doesNotMatch(migration, /task_id uuid/)
})

test('old callers remain compatible while new client creation is atomic', () => {
  assert.match(migration, /create trigger trg_oaf2_ensure_agency_client_root/)
  assert.match(migration, /create trigger trg_oaf2_ensure_engagement_project/)
  assert.match(migration, /create or replace function public\.create_commercial_client/)
  assert.match(migration, /security invoker/)
  assert.match(migration, /grant execute on function public\.create_commercial_client[\s\S]*to authenticated, service_role/)
  assert.match(repository, /client\.rpc\('create_commercial_client'/)
  assert.doesNotMatch(repository, /await client\.from\('agency_clients'\)\.delete/)
})

test('Operating Spine client creation makes exactly one transactional RPC call', async () => {
  const calls = []
  const client = {
    from() { throw new Error('client creation must not issue direct table writes') },
    rpc(name, params) {
      calls.push({ name, params })
      return Promise.resolve({
        data: { client: { id: 'agency-client' }, canonical_client: { id: 'client' }, brand: { id: 'brand' } },
        error: null,
      })
    },
  }
  const result = await createOperatingSpineRepository(client).createClient({
    name: 'Acme',
    brandName: 'Acme Brand',
    primaryEmail: 'owner@example.com',
  }, 'actor-id')

  assert.equal(result.canonical_client.id, 'client')
  assert.deepEqual(calls.map(call => call.name), ['create_commercial_client'])
  assert.equal(calls[0].params.p_name, 'Acme')
  assert.equal(calls[0].params.p_brand_name, 'Acme Brand')
})

test('AI stores one canonical project with an optional consistent engagement extension', () => {
  assert.match(migration, /drop constraint ai_runs_single_commercial_context_check/)
  assert.match(migration, /ai_runs_engagement_project_organization_fkey/)
  assert.match(aiChat, /select\('id, project_id'\)/)
  assert.match(aiChat, /projectId !== engagementRoot\.project_id/)
  assert.match(aiChat, /projectId = engagementRoot\.project_id/)
  assert.match(aiChat, /context = \{[\s\S]*engagement: engagement\.data/)
  assert.match(aiChat, /context = \{[\s\S]*project: project\.data[\s\S]*\.\.\.context/)
  assert.doesNotMatch(aiChat, /Select a project or an engagement, not both/)
})

test('Assistant presents one project context and derives its engagement extension', () => {
  assert.match(assistant, /engagement\.project_id === projectId/)
  assert.match(assistant, /Field label="Project context"/)
  assert.match(assistant, /Operating Spine services and artifacts are included automatically/)
  assert.doesNotMatch(assistant, /Field label="Operating Spine engagement"/)
  assert.doesNotMatch(assistant, /Field label="Legacy project context"/)
})

test('OAF2 verifier checks invariants and rolls all representative writes back', () => {
  for (const check of [
    'all_agency_clients_have_canonical_roots',
    'all_engagements_have_canonical_projects',
    'engagement_clients_match_project_clients',
    'one_living_record_per_project',
    'artifact_ownership_is_consistent',
    'work_item_ownership_is_consistent',
    'portal_client_matches_commercial_client',
    'engaged_project_client_change_is_rejected',
    'engaged_project_unrelated_update_is_allowed',
    'standalone_project_client_change_retains_existing_behavior',
    'engaged_project_cross_organization_change_is_rejected',
  ]) {
    assert.match(verifier, new RegExp(check))
  }
  assert.match(verifier, /old_client_insert_creates_canonical_root/)
  assert.match(verifier, /old_engagement_insert_creates_project_and_living_record/)
  assert.match(verifier, /\nrollback;\s*$/)
})
