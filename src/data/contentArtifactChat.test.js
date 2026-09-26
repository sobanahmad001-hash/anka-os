import test from 'node:test'
import assert from 'node:assert/strict'
import { contentArtifactChatTargets } from './contentArtifactChat.js'
import { CONTENT_ARTIFACT_TYPES } from './contentStudio.js'
import { departmentChatProfile } from './departmentChatProfiles.js'
const scope = { organizationId: 'org', projectId: 'project', engagementId: 'engagement', brandId: 'brand' }
export const workspace = () => ({ engagement: { id: 'engagement', organization_id: 'org', project_id: 'project', brand_id: 'brand' },
  contentServices: [{ id: 'service', organization_id: 'org', engagement_id: 'engagement', status: 'active', service_catalog: { department_id: 'content', is_active: true } }],
  artifacts: [{ id: 'artifact', organization_id: 'org', engagement_id: 'engagement', artifact_type: 'content' }],
  versions: [{ id: 'version', organization_id: 'org', artifact_id: 'artifact', version_number: 1, content: {} }],
  stages: [{ id: 'stage', organization_id: 'org', engagement_id: 'engagement', accountable_department_id: 'content', name: 'Content' }],
})
test('inline Content targets use existing forms and exact canonical artifact and stage', () => {
  assert.deepEqual(departmentChatProfile('content').artifactTypes, CONTENT_ARTIFACT_TYPES)
  const targets = contentArtifactChatTargets(workspace(), scope)
  assert.equal(targets.artifactForType('content').id, 'artifact'); assert.equal(targets.stageForType('content').id, 'stage')
  assert.equal(targets.artifactForType('unsupported'), null); assert.equal(targets.stageForType('unsupported'), null)
})
test('inline Content target validation rejects foreign roots, stages, artifacts, versions and inactive services', () => {
  for (const mutate of [w => { w.engagement.project_id = 'foreign' }, w => { w.engagement.organization_id = 'foreign' },
    w => { w.engagement.id = 'foreign' }, w => { w.engagement.brand_id = 'foreign' }, w => { w.stages[0].project_id = 'foreign' }, w => { w.artifacts[0].engagement_id = 'foreign' }, w => { w.stages[0].organization_id = 'foreign' },
    w => { w.versions[0].artifact_id = 'foreign' }, w => { w.versions[0].organization_id = 'foreign' },
    w => { w.contentServices[0].status = 'planned' }, w => { w.contentServices[0].service_catalog.is_active = false }]) {
    const input = workspace(); mutate(input); assert.equal(contentArtifactChatTargets(input, scope), null)
  }
})
