import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildContentHandoffPreview, contentHandoffDestinations, contentHandoffReadiness,
  contentHandoffTargetKey, contentHandoffWorkOptions, isCurrentContentHandoffPreview,
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
    { previewReady: true, officialActionAvailable: false, missing: [] })
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

test('B07 UI remains a read-only preview with no mutation or substitute-latest route', () => {
  const ui = readFileSync(new URL('../components/ContentHandoffPanel.jsx', import.meta.url), 'utf8')
  assert.match(ui, /Prepare handoff preview/)
  assert.match(ui, /Unapproved collaboration preview/)
  assert.match(ui, /Confirm handoff unavailable/)
  assert.match(ui, /disabled/)
  assert.match(ui, /No handoff, task, work item, service activation, publication, or approval/)
  assert.match(ui, /approval, source access, or refresh state changed/)
  assert.doesNotMatch(ui, /supabase|functions\.invoke|repository\.|approveArtifact|latest/i)
  const parent = readFileSync(new URL('../components/ContentLibraryPanel.jsx', import.meta.url), 'utf8')
  assert.match(parent, /stale=\{loading \|\| Boolean\(error\) \|\| stale\}/)
})

test('B07 repository additions are organization-scoped reads and add no handoff writer', () => {
  const repository = readFileSync(new URL('./contentStudioRepository.js', import.meta.url), 'utf8')
  assert.match(repository, /from\('engagement_services'\)[\s\S]*eq\('organization_id', organizationId\)[\s\S]*in\('engagement_id', engagementIds\)/)
  assert.match(repository, /from\('tasks'\)[\s\S]*eq\('organization_id', organizationId\)[\s\S]*in\('project_id', projectIds\)/)
  assert.match(repository, /from\('work_items'\)[\s\S]*eq\('organization_id', organizationId\)[\s\S]*in\('engagement_id', engagementIds\)/)
  assert.doesNotMatch(repository, /confirm_content_handoff|save_content_handoff|create_content_handoff/i)
})
