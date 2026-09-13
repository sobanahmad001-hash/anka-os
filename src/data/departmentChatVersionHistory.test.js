import assert from 'node:assert/strict'
import test from 'node:test'

import { departmentChatVersionHistoryPath, linkedDepartmentChatVersions } from './departmentChatVersionHistory.js'

const engagement = {
  id: 'engagement-1', organization_id: 'organization-1', project_id: 'project-1',
  agency_client_id: 'client-1', brand_id: 'brand-1',
}

test('Department Chat version-history paths preserve exact canonical artifact and version identity', () => {
  const content = new URL(departmentChatVersionHistoryPath(engagement, {
    artifact_id: 'artifact-content', artifact_version_id: 'version-content', artifact_type: 'content',
  }), 'https://anka.invalid')
  assert.equal(content.pathname, '/sphere/content/studio')
  assert.equal(content.searchParams.get('tab'), 'library')
  assert.equal(content.searchParams.get('artifact'), 'artifact-content')
  assert.equal(content.searchParams.get('version'), 'version-content')
  assert.equal(content.searchParams.get('ctxVersionId'), 'version-content')

  const design = new URL(departmentChatVersionHistoryPath(engagement, {
    artifact_id: 'artifact-design', artifact_version_id: 'version-design', artifact_type: 'design_system',
  }), 'https://anka.invalid')
  assert.equal(design.pathname, '/sphere/design/systems')
  assert.equal(design.searchParams.get('artifact'), 'artifact-design')
  assert.equal(design.searchParams.get('version'), 'version-design')

  const marketing = new URL(departmentChatVersionHistoryPath(engagement, {
    artifact_id: 'artifact-marketing', artifact_version_id: 'version-marketing', artifact_type: 'campaign_brief',
  }), 'https://anka.invalid')
  assert.equal(marketing.pathname, '/sphere/marketing/studio')
  assert.equal(marketing.searchParams.get('tab'), 'artifacts')
  assert.equal(marketing.searchParams.get('ctxOutputId'), 'artifact-marketing')
  assert.equal(marketing.searchParams.get('ctxVersionId'), 'version-marketing')
})

test('version-history links fail closed for incomplete or unsupported identities and deduplicate exact versions', () => {
  assert.equal(departmentChatVersionHistoryPath(engagement, { artifact_id: 'artifact' }), '')
  assert.equal(departmentChatVersionHistoryPath(engagement, {
    artifact_id: 'artifact', artifact_version_id: 'version', artifact_type: 'unknown',
  }), '')
  const version = { artifact_id: 'artifact', artifact_version_id: 'version', artifact_type: 'content' }
  assert.deepEqual(linkedDepartmentChatVersions([
    { run: { source_versions: [version] } },
    { proposal: { accepted_version: { ...version, title: 'Exact title' } } },
  ]), [{ ...version, title: 'Exact title' }])
})
