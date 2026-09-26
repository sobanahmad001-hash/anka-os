import test from 'node:test'
import assert from 'node:assert/strict'
import { eligibleDesignVersions, requireDesignVersion } from './designChatTools.js'

export const scope = { organizationId: 'org-a', projectId: 'project-a', engagementId: 'engagement-a' }
export const workspace = () => ({
  engagement: { id: 'engagement-a', organization_id: 'org-a', project_id: 'project-a' },
  designServices: [{ id: 'service-a', engagement_id: 'engagement-a', status: 'active', service_catalog: { department_id: 'design', is_active: true } }],
  sessions: [{ id: 'session-a', organization_id: 'org-a', engagement_id: 'engagement-a', engagement_service_id: 'service-a' }],
  directions: [{ id: 'direction-a', organization_id: 'org-a', session_id: 'session-a' }],
  directionVersions: [{ id: 'version-a', organization_id: 'org-a', direction_id: 'direction-a', is_experimental: false, version_number: 1, content: { imagery_direction: 'Exact original prompt' } }],
  models: [{ id: 'model-a', is_active: true, display_name: 'Offline image', supported_output_types: ['image'] }], mediaAssets: [], imageGenerationJobs: [],
})
test('Design chat requires the whole exact active project direction chain and excludes experiments', () => {
  assert.equal(requireDesignVersion(workspace(), scope, 'version-a').id, 'version-a')
  for (const change of [
    data => { data.engagement.project_id = 'other' }, data => { data.engagement.organization_id = 'other' },
    data => { data.designServices[0].status = 'inactive' }, data => { data.designServices[0].service_catalog.is_active = false },
    data => { data.sessions[0].engagement_id = 'other' }, data => { data.sessions[0].engagement_service_id = 'other' },
    data => { data.directions[0].organization_id = 'other' }, data => { data.directions[0].session_id = 'other' },
    data => { data.directionVersions[0].is_experimental = true }, data => { data.directionVersions[0].direction_id = 'other' },
  ]) { const data = workspace(); change(data); assert.deepEqual(eligibleDesignVersions(data, scope), []); assert.throws(() => requireDesignVersion(data, scope, 'version-a')) }
  assert.deepEqual(eligibleDesignVersions(workspace(), { ...scope, projectId: null }), [])
  assert.throws(() => requireDesignVersion(workspace(), scope, 'missing'))
})
