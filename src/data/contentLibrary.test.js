import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildContentLibrary,
  contentReviewStage,
  filterContentLibrary,
  recordedSourceReferences,
  sourceReferenceDetails,
} from './contentLibrary.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const versions = [
  { id: 'v2', artifact_id: 'a1', version_number: 2, created_at: '2026-09-13T02:00:00Z', content: {} },
  { id: 'v1', artifact_id: 'a1', version_number: 1, created_at: '2026-09-12T02:00:00Z', content: {} },
  { id: 'v3', artifact_id: 'a2', version_number: 1, created_at: '2026-09-11T02:00:00Z', content: {} },
]
const artifacts = [
  { id: 'a1', artifact_type: 'content', title: 'Homepage copy', created_by: 'u1', created_at: '2026-09-12', engagements: { id: 'e1', name: 'Web build', project_id: 'p1', projects: { id: 'p1', name: 'Launch' } } },
  { id: 'a2', artifact_type: 'scripts', title: 'Launch reel', created_by: 'u2', created_at: '2026-09-11', engagements: { id: 'e2', name: 'Social', project_id: 'p2', projects: { id: 'p2', name: 'Campaign' } } },
]

test('B06a maps the canonical request, proofing, and approval records to display stages', () => {
  assert.equal(contentReviewStage('v1'), 'draft')
  assert.equal(contentReviewStage('v1', [], [{ artifact_version_id: 'v1', status: 'pending' }]), 'in_review')
  assert.equal(contentReviewStage('v1', [], [{ artifact_version_id: 'v1', status: 'pending' }],
    [{ artifact_version_id: 'v1', resolved: false }]), 'changes_requested')
  assert.equal(contentReviewStage('v1', [{ artifact_version_id: 'v1' }],
    [{ artifact_version_id: 'v1', status: 'pending' }], [{ artifact_version_id: 'v1', resolved: false }]), 'approved')
})

test('B06a filters latest artifact rows by type, project, factual creator, state, and search', () => {
  const entries = buildContentLibrary({
    artifacts, versions, profiles: [{ id: 'u1', full_name: 'Aisha' }, { id: 'u2', full_name: 'Bilal' }],
    requests: [{ artifact_version_id: 'v2', status: 'pending' }],
  })
  assert.equal(entries[0].latest.id, 'v2')
  assert.deepEqual(filterContentLibrary(entries, { type: 'content', projectId: 'p1', creatorId: 'u1', reviewStage: 'in_review' }).map(item => item.artifact.id), ['a1'])
  assert.deepEqual(filterContentLibrary(entries, { query: 'campaign bilal' }).map(item => item.artifact.id), ['a2'])
  assert.deepEqual(filterContentLibrary(entries, { reviewStage: 'changes_requested' }), [])
})

test('B06a keeps recorded source IDs exact and does not rebound inaccessible history', () => {
  const version = { content: {
    source_architecture_version_id: 'source-v1',
    source_manifest: [{ artifact_version_id: 'source-v2' }],
    target_version_id: 'not-a-source',
  } }
  assert.deepEqual(recordedSourceReferences(version.content), [
    { id: 'source-v1', path: 'source_architecture_version_id' },
    { id: 'source-v2', path: 'source_manifest.0.artifact_version_id' },
  ])
  const details = sourceReferenceDetails(version, [{
    id: 'source-v2', version_number: 4, artifacts: { id: 'source-a2', title: 'Vision', artifact_type: 'vision' },
  }])
  assert.equal(details[0].accessible, false)
  assert.equal(details[0].id, 'source-v1')
  assert.equal(details[1].artifact.title, 'Vision')
})

test('B06a UI and server reuse canonical exact-version review contracts', () => {
  const ui = read('src/components/ContentLibraryPanel.jsx')
  const approvalPanel = read('src/components/ArtifactApprovalPanel.jsx')
  const repository = read('src/data/contentStudioRepository.js')
  const server = read('supabase/functions/artifact-approvals/index.ts')
  assert.match(ui, /Submit exact version for review/)
  assert.match(ui, /Submission is not approval/)
  assert.match(ui, /Read-only exact snapshot/)
  assert.match(ui, /No newer source has been substituted/)
  assert.match(ui, /Owner filtering is unavailable/)
  assert.match(approvalPanel, /requestChanges/)
  assert.match(server, /Only a pending named approver can request changes/)
  assert.match(server, /A change request comment is required/)
  assert.match(server, /artifact_version_comments/)
  assert.doesNotMatch(server, /create table|alter table|review_status/)
  assert.match(repository, /eq\('organization_id', organizationId\)/)
  assert.doesNotMatch(repository, /service_role|SUPABASE_SERVICE_ROLE_KEY/)
})
