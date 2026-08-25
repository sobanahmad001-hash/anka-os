import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260825070000_release1_workflow_templates.sql', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./deliveryRepository.js', import.meta.url), 'utf8')
const projectScreen = readFileSync(new URL('../apps/CanonicalProjects.jsx', import.meta.url), 'utf8')

test('Release 1 templates cover custom, branding, website, and campaign delivery', () => {
  for (const slug of ['custom', 'branding', 'website-delivery', 'campaign']) {
    assert.match(migration, new RegExp(`'${slug}'`))
  }
  assert.match(migration, /Research & discovery/)
  assert.match(migration, /Brand strategy & verbal identity/)
  assert.match(migration, /Visual identity system/)
  assert.match(migration, /QA & launch/)
  assert.match(migration, /Reporting & learning/)
})

test('workflow stages contain explicit human quality criteria', () => {
  assert.match(migration, /entry_criteria/)
  assert.match(migration, /exit_criteria/)
  assert.match(migration, /requires_internal_review/)
  assert.match(migration, /Launch authorized by a human/)
  assert.match(migration, /Spend changes human-approved/)
})

test('project intake activates the selected workflow and generated tasks', () => {
  assert.match(projectScreen, /delivery\.activateWorkflowTemplate/)
  assert.match(repository, /async activateWorkflowTemplate/)
  assert.match(repository, /workflow_stage_id: stage\.id/)
  assert.match(repository, /acceptance_criteria: \(stage\.exit_criteria/)
  assert.match(repository, /status: index === 0 \? 'ready' : 'backlog'/)
})

test('generated dependencies are sequential, project-scoped, and approval-aware', () => {
  assert.match(repository, /from\('task_dependencies'\)\.insert/)
  assert.match(repository, /dependency_type: stages\[index\]\.requires_internal_review \? 'approval' : 'finish_to_start'/)
  assert.match(migration, /enforce_task_dependency_scope/)
  assert.match(migration, /Task dependencies must remain inside one project/)
})
