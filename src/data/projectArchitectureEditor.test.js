import test from 'node:test'
import assert from 'node:assert/strict'
import { architectureReviewLink, matchesArchitectureEditor } from './projectArchitectureEditor.js'
import { parseWorkshopNavigation } from './workshopNavigation.js'

test('Chat opens the current architecture and checks approval for its exact version', () => {
  const versions = [1, 2].map(number => ({ id: 'v' + number, artifact_id: 'architecture', version_number: number, first_page_title: 'Homepage' }))
  const artifact = { id: 'architecture', artifact_type: 'website_architecture', versions }
  const studio = { artifacts: [artifact], versions }
  const workspace = { project: { id: 'project' }, workshopArtifacts: [artifact], workshopLinks: [
    { department: 'content', path: '/sphere/content/studio?ctxOrg=org&ctxProject=project&ctxEngagement=engagement&ctxService=copy' },
  ], artifactReviews: [{ artifact_id: artifact.id, artifact_version_id: 'v1', decision: 'approved' }] }
  const link = architectureReviewLink(workspace)
  const params = new URL(link.path, 'https://anka.invalid').searchParams
  const context = parseWorkshopNavigation(params)
  assert.equal(context.status, 'parsed')
  assert.equal(context.workshopTab, 'artifacts')
  assert.deepEqual([context.organizationId, context.projectId, context.engagementId, context.activeServiceId], ['org', 'project', 'engagement', 'copy'])
  assert.equal(context.originTab, 'discussion')
  assert.deepEqual([link.title, link.number, link.approved], ['Homepage', 2, false])
  assert.equal(matchesArchitectureEditor(studio, params.get('architecture'), params.get('version')), true)
  assert.equal(matchesArchitectureEditor(studio, artifact.id, 'v1'), false)
  assert.equal(matchesArchitectureEditor(studio, 'other', 'v2'), false)
  workspace.artifactReviews[0].artifact_version_id = 'v2'
  assert.equal(architectureReviewLink(workspace).approved, true)
  studio.versions = [...versions, { ...versions[1], id: 'v3', version_number: 3 }]
  assert.equal(matchesArchitectureEditor(studio, artifact.id, 'v2'), false)
  assert.equal(architectureReviewLink({ ...workspace, workshopArtifacts: [artifact, artifact] }), null)
})

