import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildContentHandoffPreview, contentHandoffDestinations, contentHandoffReadiness,
  contentHandoffTargetKey, contentHandoffWorkOptions, contentHandoffWorkstreams, isCurrentContentHandoffPreview,
} from './contentHandoffs.js'

const artifact = { id: 'artifact-1', title: 'Launch copy', artifact_type: 'campaign_messaging' }
const version = { id: 'version-1', artifact_id: 'artifact-1', version_number: 3,
  content_checksum: 'sha256-exact', content: { approved_text: 'Launch today', intent: 'Awareness' } }
const destination = { id: 'service-design', engagementId: 'eng-1', departmentId: 'design', label: 'Design · design' }

test('B07 exposes only current active Design and Marketing services for the selected engagement', () => {
  const services = [
    { id: 'design', engagement_id: 'eng-1', status: 'active', service_catalog: { name: 'Design', department_id: 'design', is_active: true } },
    { id: 'marketing', engagement_id: 'eng-1', status: 'active', service_catalog: [{ name: 'Marketing', department_id: 'marketing', is_active: true }] },
    { id: 'other-engagement', engagement_id: 'eng-2', status: 'active', service_catalog: { name: 'Design', department_id: 'design', is_active: true } },
    { id: 'inactive', engagement_id: 'eng-1', status: 'planned', service_catalog: { name: 'Marketing', department_id: 'marketing', is_active: true } },
    { id: 'retired-catalog', engagement_id: 'eng-1', status: 'active', service_catalog: { name: 'Design', department_id: 'design', is_active: false } },
    { id: 'development', engagement_id: 'eng-1', status: 'active', service_catalog: { name: 'Build', department_id: 'development', is_active: true } },
  ]
  assert.deepEqual(contentHandoffDestinations(services, 'eng-1').map(item => item.id), ['design', 'marketing'])
})

test('B07 offers only active existing work in the destination department and context', () => {
  const options = contentHandoffWorkOptions({ destination, projectId: 'project-1', engagementId: 'eng-1',
    tasks: [
      { id: 'task-1', project_id: 'project-1', department_id: 'design', title: 'Hero', status: 'open', archived_at: null },
      { id: 'task-wrong', project_id: 'project-1', department_id: 'marketing', title: 'Social', archived_at: null },
      { id: 'task-archived', project_id: 'project-1', department_id: 'design', title: 'Old', archived_at: 'now' },
    ],
    workItems: [
      { id: 'work-1', engagement_id: 'eng-1', department_id: 'design', title: 'Design item', status: 'todo', deleted_at: null },
      { id: 'work-deleted', engagement_id: 'eng-1', department_id: 'design', title: 'Deleted', deleted_at: 'now' },
    ] })
  assert.deepEqual(options.map(item => `${item.kind}:${item.id}`), ['project_task:task-1', 'engagement_work_item:work-1'])
})

test('B07 readiness fails closed for stale, mismatched, and inactive destination state', () => {
  assert.deepEqual(contentHandoffReadiness({ organizationId: 'org-1', artifact, version, destination }),
    { previewReady: true, officialActionAvailable: false, missing: [],
      officialMissing: ['approval for the selected exact version', 'active matching recipient workstream'] })
  assert.match(contentHandoffReadiness({ organizationId: 'org-1', artifact, version, destination, stale: true }).missing.join(' '), /fresh authorized/)
  assert.match(contentHandoffReadiness({ organizationId: 'org-1', artifact, version: { ...version, artifact_id: 'other' }, destination }).missing.join(' '), /selected exact/)
  assert.match(contentHandoffReadiness({ organizationId: 'org-1', artifact, version, destination: null }).missing.join(' '), /active Design or Marketing/)
})

test('B07 preview preserves exact identity, approval, sources, recipient, and optional existing work', () => {
  const work = { kind: 'project_task', id: 'task-1', label: 'Hero', status: 'open' }
  const preview = buildContentHandoffPreview({ organizationId: 'org-1', artifact, version,
    approval: { id: 'approval-1' }, destination, work,
    sourceReferences: [{ id: 'source-v1', path: 'sources.0.version_id', accessible: true }], note: 'Use the approved headline.' })
  assert.equal(preview.source.versionId, 'version-1')
  assert.equal(preview.source.checksum, 'sha256-exact')
  assert.deepEqual(preview.source.content, { approved_text: 'Launch today', intent: 'Awareness' })
  assert.deepEqual(preview.review, { status: 'approved', approvalId: 'approval-1' })
  assert.equal(preview.sources[0].id, 'source-v1')
  assert.deepEqual(preview.work, { kind: 'project_task', id: 'task-1', label: 'Hero', status: 'open' })
  assert.equal(preview.effect, 'read_only_preview')
  assert.equal(preview.officialActionAvailable, false)
})

test('B07 repeated preparation is deterministic and any exact target change invalidates the preview', () => {
  const input = { organizationId: 'org-1', artifact, version, destination, note: 'Same note',
    sourceReferences: [{ id: 'source-v1', path: 'source.version_id', accessible: true }] }
  const preview = buildContentHandoffPreview(input)
  assert.equal(preview.key, buildContentHandoffPreview(input).key)
  assert.equal(isCurrentContentHandoffPreview(preview, contentHandoffTargetKey(input)), true)
  assert.equal(isCurrentContentHandoffPreview(preview, contentHandoffTargetKey({ ...input, version: { ...version, id: 'version-2' } })), false)
  assert.equal(isCurrentContentHandoffPreview(preview, contentHandoffTargetKey({ ...input, destination: { ...destination, id: 'service-marketing' } })), false)
  assert.equal(isCurrentContentHandoffPreview(preview, contentHandoffTargetKey({ ...input, note: 'Changed' })), false)
  assert.equal(isCurrentContentHandoffPreview(preview, contentHandoffTargetKey({
    ...input, sourceReferences: [{ id: 'source-v1', path: 'source.version_id', accessible: false }],
  })), false)
  assert.equal(isCurrentContentHandoffPreview(preview, contentHandoffTargetKey({
    ...input, approval: { id: 'approval-v2', approved_by: 'reviewer', approved_at: '2026-09-13T14:00:00Z' },
  })), false)
  assert.equal(isCurrentContentHandoffPreview(preview, contentHandoffTargetKey({ ...input, stale: true })), false)
})

test('C06 UI requires current preview and exact approval before canonical handoff', () => {
  const ui = readFileSync(new URL('../components/ContentHandoffPanel.jsx', import.meta.url), 'utf8')
  assert.match(ui, /Prepare handoff preview/)
  assert.match(ui, /Unapproved collaboration preview/)
  assert.match(ui, /Confirm internal N3 handoff/)
  assert.match(ui, /!currentPreview \|\| !readiness\.officialActionAvailable/)
  assert.match(ui, /approval, source access, or refresh state changed/)
  assert.match(ui, /p_request_id: operation\.current\.id/)
  assert.doesNotMatch(ui, /functions\.invoke|approveArtifact/i)
  const parent = readFileSync(new URL('../components/ContentLibraryPanel.jsx', import.meta.url), 'utf8')
  assert.match(parent, /stale=\{loading \|\| Boolean\(error\) \|\| stale\}/)
})

test('C06 repository uses organization-scoped reads and one canonical handoff RPC', () => {
  const repository = readFileSync(new URL('./contentStudioRepository.js', import.meta.url), 'utf8')
  assert.match(repository, /from\('engagement_services'\)[\s\S]*eq\('organization_id', organizationId\)[\s\S]*in\('engagement_id', engagementIds\)/)
  assert.match(repository, /from\('tasks'\)[\s\S]*eq\('organization_id', organizationId\)[\s\S]*in\('project_id', projectIds\)/)
  assert.match(repository, /from\('work_items'\)[\s\S]*eq\('organization_id', organizationId\)[\s\S]*in\('engagement_id', engagementIds\)/)
  assert.match(repository, /supabase\.rpc\('confirm_content_n3_handoff'/)
  assert.match(repository, /from\('workstreams'\)[\s\S]*eq\('organization_id', organizationId\)/)
})

test('C06 official action requires approval, active workstream, and accessible source refs', () => {
  const workstream = { id: 'ws-design', label: 'Design' }
  const approval = { id: 'approval-1', artifact_version_id: version.id }
  const input = { organizationId: 'org-1', artifact, version, approval, destination, workstream,
    sourceReferences: [{ id: 'source-1', accessible: true }] }
  assert.equal(contentHandoffReadiness(input).officialActionAvailable, true)
  assert.equal(contentHandoffReadiness({ ...input, approval: null }).officialActionAvailable, false)
  assert.equal(contentHandoffReadiness({ ...input, approval: { ...approval, artifact_version_id: 'other' } }).officialActionAvailable, false)
  assert.equal(contentHandoffReadiness({ ...input, sourceReferences: [{ id: 'source-1', accessible: false }] }).officialActionAvailable, false)
  assert.equal(contentHandoffReadiness({ ...input, workstream: null }).officialActionAvailable, false)
  assert.equal(contentHandoffWorkstreams([
    { id: 'ws-design', project_id: 'project-1', department_id: 'design', status: 'active', name: 'Design' },
    { id: 'ws-other', project_id: 'project-2', department_id: 'design', status: 'active', name: 'Other' },
  ], destination, 'project-1')[0].id, 'ws-design')
  const preview = buildContentHandoffPreview(input)
  assert.equal(isCurrentContentHandoffPreview(preview, contentHandoffTargetKey({ ...input, workstream: { id: 'different' } })), false)
})
