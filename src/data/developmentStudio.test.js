import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  DEVELOPMENT_ARTIFACT_TYPES,
  DEVELOPMENT_STAGE_STATUSES,
  artifactContent,
  developmentStatus,
  latestArtifactVersion,
} from './developmentStudio.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260828153231_development_studio_minimal.sql', import.meta.url), 'utf8')
const functionSource = readFileSync(new URL('../../supabase/functions/development-studio/index.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../apps/OperatingSpine.jsx', import.meta.url), 'utf8')

test('Development Studio exposes only the agreed tracking statuses and artifact types', () => {
  assert.deepEqual(DEVELOPMENT_STAGE_STATUSES.map(item => item.id), ['not_started', 'in_progress', 'blocked', 'complete'])
  assert.deepEqual(DEVELOPMENT_ARTIFACT_TYPES, ['technical_brief', 'launch_checklist'])
  assert.equal(developmentStatus('planned'), 'not_started')
  assert.equal(developmentStatus('completed'), 'complete')
})

test('Development artifact content remains a concise notes and checklist record', () => {
  assert.deepEqual(artifactContent('  Release notes  ', 'Backup\n\nSmoke test '), {
    notes: 'Release notes', checklist: ['Backup', 'Smoke test'],
  })
  assert.equal(latestArtifactVersion([
    { artifact_id: 'a', version_number: 1 },
    { artifact_id: 'a', version_number: 3 },
    { artifact_id: 'b', version_number: 9 },
  ], 'a').version_number, 3)
})

test('the migration reuses shared stage and immutable artifact tables', () => {
  assert.match(migration, /alter table public\.engagement_stage_instances[\s\S]*add column team_notes/)
  assert.match(migration, /'technical_brief'[\s\S]*'launch_checklist'/)
  assert.match(migration, /'stage_status_changed'/)
  assert.match(migration, /insert into public\.artifact_versions/)
  assert.match(migration, /insert into public\.engagement_events/)
  assert.match(migration, /security invoker/g)
  assert.doesNotMatch(migration, /create table public\.development_/)
})

test('the Development tab is engagement-scoped and the endpoint has no external code-system integration', () => {
  assert.match(appSource, />Development<\/button>/)
  assert.match(appSource, /hasDevelopment/)
  assert.match(functionSource, /development-studio|Development Studio/)
  assert.doesNotMatch(functionSource, /github\.com|api\.github|gitlab|bitbucket|commit_sha|pull_request/)
  assert.doesNotMatch(functionSource, /openai|anthropic|code_generation|coding_agent/)
})
