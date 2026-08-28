import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { latestByVersion } from './designWorkshop.js'
import { CONTENT_ARTIFACT_FORMS, blankContentArtifact } from './contentStudio.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const eventMigration = read('supabase/migrations/20260827160000_engagement_events_artifact_types.sql')
const migration = read('supabase/migrations/20260827170000_artifacts_design_workshop.sql')
const graphqlBoundaryMigration = read('supabase/migrations/20260827180000_reassert_graphql_boundary.sql')
const edge = read('supabase/functions/design-workshop/index.ts')
const ui = read('src/apps/DesignWorkshop.jsx')

test('audit vocabulary exception is an isolated additive CHECK change', () => {
  assert.match(eventMigration, /alter table public\.engagement_events[\s\S]*drop constraint engagement_events_event_type_check/)
  assert.match(eventMigration, /artifact_version_created[\s\S]*artifact_approved[\s\S]*design_direction_released/)
  assert.doesNotMatch(eventMigration, /create table|create policy|enable row level security|add column|actor_id\s/)
})

test('final GraphQL boundary migration changes only resolve execution privileges', () => {
  assert.match(graphqlBoundaryMigration, /revoke execute on function graphql\.resolve\(text,jsonb,text,jsonb\) from public, anon, authenticated/)
  assert.match(graphqlBoundaryMigration, /grant execute on function graphql\.resolve\(text,jsonb,text,jsonb\) to service_role/)
  assert.doesNotMatch(graphqlBoundaryMigration, /create table|alter table|create policy|row level security|grant all|grant select/)
})

test('artifact versions, approvals and direction versions are append-only exact records', () => {
  for (const trigger of ['trg_artifact_versions_immutable', 'trg_artifact_approvals_immutable',
    'trg_design_context_immutable', 'trg_design_direction_versions_immutable',
    'trg_design_selections_immutable', 'trg_design_releases_immutable']) assert.match(migration, new RegExp(trigger))
  assert.match(migration, /before update or delete on public\.artifact_versions/)
  assert.match(migration, /before update or delete on public\.design_direction_versions/)
  assert.match(migration, /unique \(artifact_id, version_number\)/)
  assert.match(migration, /unique \(direction_id, version_number\)/)
})

test('every new table has organization RLS and browser roles remain read-only', () => {
  const tables = [...migration.matchAll(/create table public\.([a-z_]+)/g)].map(match => match[1])
  assert.equal(tables.length, 12)
  for (const table of tables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), table)
    assert.match(migration, new RegExp(`public\\.${table}[\\s\\S]*to authenticated`), table)
  }
  assert.match(migration, /revoke all on[\s\S]*from anon, authenticated/)
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[\s\S]{0,500}to authenticated/)
})

test('Design inputs now use the structured Content Studio form definitions', () => {
  assert.deepEqual(Object.keys(CONTENT_ARTIFACT_FORMS).slice(0, 3), ['discovery', 'vision', 'audience'])
  for (const type of ['discovery', 'vision', 'audience']) {
    assert(CONTENT_ARTIFACT_FORMS[type].fields.length >= 5)
    assert.equal(Object.keys(blankContentArtifact(type)).length, CONTENT_ARTIFACT_FORMS[type].fields.length)
  }
  assert.equal(latestByVersion([{ version_number: 1 }, { version_number: 3 }]).version_number, 3)
})

test('workshop compiles exact approved artifact content and enforces AI safety', () => {
  assert.match(edge, /Approved \$\{type\} context is required/)
  assert.match(edge, /version\.ai_use_allowed/)
  assert.match(edge, /version\.data_classification === 'restricted'/)
  assert.match(edge, /artifact_version_id: version\.id[\s\S]*approval_id: approval\.id[\s\S]*content_checksum: version\.content_checksum[\s\S]*content: version\.content/)
  assert.match(migration, /primary key \(session_id, artifact_type\)/)
})

test('generation produces three attributed directions and rejects silent duplicates', () => {
  assert.match(edge, /const LANES = \[/)
  assert.match(edge, /model_registry_id: model\.id/)
  assert.match(edge, /provider: model\.provider, model_id: model\.model_id/)
  assert.match(edge, /direction_slot: slot/)
  assert.match(edge, /status: duplicate \? 'rejected_duplicate' : 'completed'/)
  assert.match(edge, /if \(!directionsAreDistinct/)
  assert.match(ui, /Generate three directions/)
})

test('selection and release are separate human actions with exact-version audit', () => {
  assert.match(edge, /select_direction:[\s\S]*release_direction:/)
  assert.match(edge, /A human-selected direction is required before release/)
  assert.match(edge, /'design_direction_released'[\s\S]*version\.id, 'released'/)
  assert.match(ui, /Selection does not equal release/)
  assert.match(ui, /Release selected exact version/)
})

test('out-of-scope product verticals are not imported into the workshop', () => {
  assert.doesNotMatch(ui, /AnkaSpherePortal|WordPress|campaign publishing|Marketing Studio/)
  assert.doesNotMatch(edge, /portal|wordpress|google_ads|publish/)
})
