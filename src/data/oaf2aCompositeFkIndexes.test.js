import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../../supabase/migrations/20260903060726_oaf2a_cover_composite_fks.sql', import.meta.url),
  'utf8',
)
const verifier = readFileSync(
  new URL('../../supabase/verify_20260903060726_oaf2a_cover_composite_fks.sql', import.meta.url),
  'utf8',
)

const exactCoveringIndexes = [
  ['artifacts', 'idx_artifacts_engagement_project_organization'],
  ['work_items', 'idx_work_items_engagement_project_organization'],
  ['ai_runs', 'idx_ai_runs_engagement_project_organization'],
]

test('OAF2a covers every OAF2 composite foreign key in exact child-column order', () => {
  for (const [table, index] of exactCoveringIndexes) {
    assert.match(
      migration,
      new RegExp(`create index ${index}\\s+on public\\.${table}\\(engagement_id, project_id, organization_id\\)`),
    )
  }
})

test('OAF2a removes only the provably superseded AI partial index', () => {
  assert.match(migration, /drop index public\.idx_ai_runs_engagement_project;/)
  for (const index of [
    'idx_artifacts_project',
    'idx_work_items_project_active',
    'idx_work_items_engagement_fk',
    'idx_ai_runs_engagement_created',
  ]) {
    assert.doesNotMatch(migration, new RegExp(`drop index(?: if exists)? public\\.${index}`))
  }
})

test('OAF2a verifier proves exact indexes, retained paths, constraints, and rollback', () => {
  for (const check of [
    'artifacts_composite_fk_has_exact_covering_index',
    'work_items_composite_fk_has_exact_covering_index',
    'ai_runs_composite_fk_has_exact_covering_index',
    'superseded_ai_partial_index_is_removed',
    'complementary_oaf2_indexes_are_preserved',
    'oaf2_composite_foreign_keys_are_preserved',
  ]) {
    assert.match(verifier, new RegExp(check))
  }
  assert.match(verifier, /indpred is null/)
  assert.match(verifier, /indisvalid[\s\S]*indisready/)
  assert.match(verifier, /\nrollback;\s*$/)
})
