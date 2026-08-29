import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { experimentalDirectionVersions, mainDirectionVersions } from './designWorkshop.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')
const migration = read('supabase/migrations/20260829092128_experimental_design_versions.sql')
const edge = read('supabase/functions/design-workshop/index.ts')
const repository = read('src/data/designWorkshopRepository.js')
const ui = read('src/apps/DesignWorkshop.jsx')

test('D2 adds scoped experiment metadata without a second version model', () => {
  assert.match(migration, /add column is_experimental boolean not null default false/)
  assert.match(migration, /add column experiment_visibility uuid\[\]/)
  assert.doesNotMatch(migration, /create table public\./)
  assert.doesNotMatch(migration, /work_items|work_item_dependencies|engagement_events/)
})

test('experimental visibility is creator-or-invitee inside active team membership', () => {
  assert.match(migration, /public\.is_team_organization_member\(organization_id\)/)
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/)
  assert.match(migration, /experiment_visibility @> array\[\(select auth\.uid\(\)\)\]/)
  assert.match(migration, /using gin\(experiment_visibility\)[\s\S]*where is_experimental/)
  assert.match(migration, /organization_id, created_by\)[\s\S]*where is_experimental/)
  assert.match(migration, /Team can read permitted exact-version proofing comments/)
  assert.match(migration, /from public\.design_direction_versions version/)
  assert.match(edge, /Every experiment reviewer must be an active team member/)
  assert.match(edge, /\.eq\('member_kind', 'team'\)\.eq\('status', 'active'\)/)
  assert.match(edge, /department_id, 60\) !== 'design'[\s\S]*return \[\]/)
})

test('main comparison queries explicitly exclude experiments', () => {
  const rows = [{ id: 'main', is_experimental: false }, { id: 'experiment', is_experimental: true }]
  assert.deepEqual(mainDirectionVersions(rows).map(item => item.id), ['main'])
  assert.deepEqual(experimentalDirectionVersions(rows).map(item => item.id), ['experiment'])
  assert.match(repository, /\.eq\('is_experimental', false\)/)
  assert.match(edge, /\.eq\('is_experimental', false\)\.maybeSingle\(\)/)
  assert.match(migration, /reject_experimental_direction_decision/)
})

test('promotion inserts a non-experimental child and never rewrites the experiment', () => {
  assert.match(edge, /promoteDirectionExperiment/)
  assert.match(edge, /insertDirectionVersion\(admin, experiment\.direction_id, experiment, experiment\.content, actorId, false, null\)/)
  assert.doesNotMatch(edge, /design_direction_versions'\)\.update/)
  assert.match(edge, /parent_version_id: parent\.id/)
  assert.match(migration, /reject_experimental_direction_decision/)
})

test('UI separates experiments and supports invite and promotion actions', () => {
  assert.match(ui, /Private experiments/)
  assert.match(ui, /Mark as experimental/)
  assert.match(ui, /Invite reviewers/)
  assert.match(ui, /Promote to main version/)
  assert.match(repository, /promote_direction_experiment/)
})

test('D2 does not modify W-series surfaces', () => {
  for (const source of [migration, edge, repository, ui]) {
    assert.doesNotMatch(source, /work_items|work_item_dependencies/)
  }
})
