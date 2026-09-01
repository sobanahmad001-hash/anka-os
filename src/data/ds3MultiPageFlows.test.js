import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const migration = read('supabase/migrations/20260901000000_ds3_multi_page_flows.sql')
const edge = read('supabase/functions/design-workshop/index.ts')
const repository = read('src/data/designWorkshopRepository.js')
const ui = read('src/apps/DesignWorkshop.jsx')

test('DS3 keeps page flows optional, tenant-scoped, and browser read-only', () => {
  assert.match(migration, /create table public\.design_page_flows/)
  assert.match(migration, /website_architecture_artifact_id uuid/)
  assert.match(migration, /foreign key \(engagement_id, organization_id\)[\s\S]*references public\.engagements\(id, organization_id\)/)
  assert.match(migration, /on delete set null \(website_architecture_artifact_id\)/)
  assert.match(migration, /alter table public\.design_page_flows enable row level security/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /revoke all on public\.design_page_flows from anon, authenticated/)
  assert.match(migration, /grant select on public\.design_page_flows to authenticated/)
})

test('DS3 adds nullable flow membership without changing the existing session model', () => {
  assert.match(migration, /add column page_flow_id uuid,[\s\S]*add column page_slug text/)
  assert.match(migration, /check \(page_flow_id is null or page_slug is not null\)/)
  assert.match(migration, /foreign key \(page_flow_id, organization_id\)[\s\S]*references public\.design_page_flows\(id, organization_id\)/)
  assert.match(migration, /on delete set null \(page_flow_id\)/)
  assert.doesNotMatch(migration, /alter table public\.(artifacts|artifact_versions|artifact_approvals|design_directions|design_direction_versions)/)
})

test('DS3 validates real architecture slugs and rejects a flow outside the session engagement', () => {
  assert.match(edge, /text\(\(item as Json\)\.slug, 200\)/)
  assert.doesNotMatch(edge, /record\.page_slug|record\.path|record\.page_path/)
  assert.match(edge, /eq\('id', flowId\)\.eq\('organization_id', ORGANIZATION_ID\)\.eq\('engagement_id', engagementId\)/)
  assert.match(edge, /if \(pageFlowId\) await resolvePageFlow\(admin, engagementId, pageFlowId, pageSlug\)/)
  assert.match(edge, /sessionValues\.page_flow_id = pageFlowId; sessionValues\.page_slug = pageSlug/)
  assert.match(edge, /create_page_flow: \(\) => createPageFlow/)
})

test('DS3 loads and groups flow sessions in the Design Workshop', () => {
  assert.match(repository, /from\('design_page_flows'\)/)
  assert.match(repository, /createPageFlow: input => invoke\('create_page_flow', input\)/)
  assert.match(ui, /workspace\.pageFlows\.map/)
  assert.match(ui, /item\.page_flow_id === flow\.id/)
  assert.match(ui, /item\.page_slug/)
  assert.match(ui, /approvedArchitectureOptions/)
  assert.match(ui, /page\?\.slug/)
})

test('DS3 leaves direction generation, per-direction generation, and direction schema untouched', () => {
  const scoped = edge.slice(edge.indexOf('async function generateOne'), edge.indexOf('async function createDirectionRevision'))
  assert.match(scoped, /async function generateOne/)
  assert.match(scoped, /async function generateDirections/)
  assert.doesNotMatch(scoped, /page_flow_id|page_slug|design_page_flows/)
  assert.match(edge, /export function directionSchema\(\)/)
})