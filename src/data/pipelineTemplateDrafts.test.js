import assert from 'node:assert/strict'
import test from 'node:test'

import { canDraftPipelineTemplate, seedPipelineDraft } from './pipelineTemplateDrafts.js'

test('N4 draft copies the latest immutable version and preserves ordered service identity', () => {
  const catalog = {
    templates: [{ id: 'template-a', slug: 'website_delivery' }],
    versions: [
      { id: 'version-1', pipeline_template_id: 'template-a', version_number: 1, name: 'Original', description: 'First' },
      { id: 'version-3', pipeline_template_id: 'template-a', version_number: 3, name: 'Current', description: 'Third' },
      { id: 'version-2', pipeline_template_id: 'template-a', version_number: 2, name: 'Intermediate', description: 'Second' },
    ],
    selections: [
      { pipeline_template_version_id: 'version-3', service_id: 'service-b', position: 1 },
      { pipeline_template_version_id: 'version-1', service_id: 'legacy', position: 0 },
      { pipeline_template_version_id: 'version-3', service_id: 'service-a', position: 0 },
    ],
  }
  const original = structuredClone(catalog)
  assert.deepEqual(seedPipelineDraft(catalog, 'template-a'), {
    slug: 'website_delivery', name: 'Current', description: 'Third',
    changeSummary: '', sourceVersionId: 'version-3', serviceIds: ['service-a', 'service-b'],
  })
  assert.deepEqual(catalog, original)
})

test('N4 new or unknown template starts blank without claiming an existing version', () => {
  const catalog = { templates: [], versions: [], selections: [] }
  assert.deepEqual(seedPipelineDraft(catalog, ''), {
    slug: '', name: '', description: '', changeSummary: '', sourceVersionId: null, serviceIds: [],
  })
  assert.deepEqual(seedPipelineDraft(catalog, 'foreign-template'), seedPipelineDraft(catalog, ''))
})

test('N4 draft visibility follows the normalized active organization membership', () => {
  const membership = { organizationId: 'org-a', organization: { status: 'active' }, role: 'department_manager' }
  assert.equal(canDraftPipelineTemplate(membership), true)
  assert.equal(canDraftPipelineTemplate({ ...membership, role: 'executive' }), false)
  assert.equal(canDraftPipelineTemplate({ ...membership, organization: { status: 'suspended' } }), false)
  assert.equal(canDraftPipelineTemplate(null), false)
})