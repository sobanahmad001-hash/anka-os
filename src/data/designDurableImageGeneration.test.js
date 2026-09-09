import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const migration = read('supabase/migrations/20260909202415_design_b03a_durable_generation_jobs.sql')
const edge = read('supabase/functions/design-workshop/index.ts')
const repository = read('src/data/designWorkshopRepository.js')
const ui = read('src/apps/DesignWorkshop.jsx')

test('B03A adds one tenant-exact durable request ledger with browser reads and server-only writes', () => {
  assert.match(migration, /create table public\.design_image_generation_jobs/)
  assert.match(migration, /unique \(organization_id, requested_by, operation_key\)/)
  assert.match(migration, /foreign key \(direction_version_id, organization_id\)[\s\S]*design_direction_versions \(id, organization_id\)/)
  assert.match(migration, /foreign key \(model_registry_id, organization_id\)[\s\S]*design_model_registry \(id, organization_id\)/)
  assert.match(migration, /foreign key \(media_asset_id, organization_id\)[\s\S]*design_media_assets \(id, organization_id\)/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all on table public\.design_image_generation_jobs from public, anon, authenticated/)
  assert.match(migration, /grant select on table public\.design_image_generation_jobs to authenticated/)
  assert.doesNotMatch(repository, /from\('design_image_generation_jobs'\)\.insert/)
})

test('duplicate submission reserves one identity and only the queued compare-and-set claimant calls the provider', () => {
  assert.match(edge, /operation_key: input\.operationKey/)
  assert.match(edge, /error\?\.code !== '23505'/)
  assert.match(edge, /eq\('requested_by', input\.actorId\)[\s\S]*eq\('operation_key', input\.operationKey\)/)
  assert.match(edge, /operation_key was already used for a different image request/)
  assert.match(edge, /eq\('status', 'queued'\)\.select\('\*'\)\.maybeSingle\(\)/)
  assert.match(edge, /if \(!claimed\) return loadImageGenerationJob/)
  assert.match(edge, /if \(job\.status !== 'queued'\) return job/)
})

test('provider ambiguity is terminal and cannot enter the confirmed-failure retry path', () => {
  assert.match(migration, /'outcome_unknown'/)
  assert.match(migration, /Only confirmed provider failures may be retried/)
  assert.match(edge, /error instanceof ConfirmedProviderFailure/)
  assert.match(edge, /status: error\.outcomeUnknown \? 'outcome_unknown' : 'failed'/)
  assert.match(edge, /source\.status !== 'failed' \|\| source\.failure_phase !== 'provider'/)
  assert.match(ui, /Paid retry is blocked; reconcile externally before any new request/)
  assert.match(ui, /Cancellation is not supported after submission/)
})

test('navigation reloads request history and exposes scoped reopen plus single-child retry', () => {
  assert.match(repository, /design_image_generation_jobs/)
  assert.match(repository, /imageGenerationJobs/)
  assert.match(repository, /get_image_generation_job/)
  assert.match(repository, /retry_image_generation/)
  assert.match(edge, /callerImageGenerationJobRoot/)
  assert.match(edge, /get_image_generation_job/)
  assert.match(edge, /retry_image_generation/)
  assert.match(migration, /unique \(retry_of_job_id, organization_id\)/)
  assert.match(ui, /Resume queued request/)
  assert.match(ui, /Check status/)
  assert.match(ui, /Retry confirmed provider failure/)
})

test('the same operation key is retained for interrupted submits and concurrent clicks are locally gated', () => {
  assert.match(ui, /pendingOperationKey \|\| crypto\.randomUUID\(\)/)
  assert.match(ui, /submissionInFlight\.current/)
  assert.match(ui, /Reconcile request/)
  assert.match(ui, /reuses the same request identity and cannot create a second paid call/)
  assert.match(repository, /operation_key: operationKey/)
})

test('B03A does not add cancellation, publication, deployment, or unrelated media ownership', () => {
  assert.doesNotMatch(edge, /cancel_image_generation/)
  assert.doesNotMatch(migration, /content_requests|figma|quota|budget/i)
  assert.doesNotMatch(migration, /storage\.buckets|storage\.objects/)
  assert.doesNotMatch(edge, /deploy|publish/)
})
