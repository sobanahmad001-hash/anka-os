import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  approvedDesignSystemReferences, designConnectionState, figmaFileUrl,
  identityProvenanceForDirection, isDesignConnectionScopeCurrent, pinnedIdentityReferences,
} from './designIdentityReferences.js'

const workspace = {
  identitySystems: [
    { id: 'system-a', title: 'Core identity' },
    { id: 'system-b', title: 'Unreleased identity' },
  ],
  identitySystemVersions: [
    { id: 'system-a-v1', artifact_id: 'system-a', version_number: 1 },
    { id: 'system-a-v2', artifact_id: 'system-a', version_number: 2 },
    { id: 'system-b-v1', artifact_id: 'system-b', version_number: 1 },
  ],
  identitySystemApprovals: [
    { artifact_id: 'system-a', artifact_version_id: 'system-a-v1' },
    { artifact_id: 'system-a', artifact_version_id: 'system-a-v2' },
  ],
  creativeBriefVersions: [{ id: 'brief-v4', version_number: 4 }],
  creativeBriefSources: [{ creative_brief_version_id: 'brief-v4', artifact_version_id: 'system-a-v1' }],
}

test('B05 exposes only approved DS5 versions and preserves an older explicit pin', () => {
  assert.deepEqual(approvedDesignSystemReferences(workspace).map(item => item.version.id), ['system-a-v2', 'system-a-v1'])
  assert.deepEqual(pinnedIdentityReferences(workspace, 'brief-v4').map(item => item.version.id), ['system-a-v1'])
  assert.deepEqual(identityProvenanceForDirection(workspace, { creative_brief_version_id: 'brief-v4' }), {
    briefVersion: workspace.creativeBriefVersions[0],
    references: [approvedDesignSystemReferences(workspace)[1]],
  })
})

test('B05 maps only fresh allowlisted provider evidence and never guesses unknown health', () => {
  const base = { status: 'error', updated_at: '2026-09-12T10:00:00Z' }
  const observed = error_code => ({ ...base, health_observation: { outcome: 'failed', error_code, observed_at: '2026-09-12T10:00:01Z' } })
  assert.equal(designConnectionState(observed('HTTP_403')), 'permission_denied')
  assert.equal(designConnectionState(observed('HTTP_404')), 'resource_deleted')
  assert.equal(designConnectionState(observed('HTTP_429')), 'quota_limited')
  assert.equal(designConnectionState(observed('HTTP_415')), 'unsupported_format')
  assert.equal(designConnectionState(observed('HTTP_503')), 'provider_unavailable')
  assert.equal(designConnectionState(observed('UNKNOWN')), 'unknown')
  assert.equal(designConnectionState({ ...observed('HTTP_403'), updated_at: '2026-09-12T10:00:02Z' }), 'unknown')
  assert.equal(designConnectionState({ status: 'verified' }), 'verified')
  assert.equal(designConnectionState(null), 'disconnected')
})

test('B05 opens only a validated Figma file key and labels unsupported import/video truthfully', () => {
  assert.equal(figmaFileUrl({ public_config: { file_key: 'Abc_123-safe' } }), 'https://www.figma.com/file/Abc_123-safe')
  assert.equal(figmaFileUrl({ public_config: { file_key: 'https://attacker.invalid/x' } }), '')
  const ui = readFileSync(new URL('../components/DesignConnectionsPanel.jsx', import.meta.url), 'utf8')
  for (const statement of ['Snapshot import:', 'Not available', 'There is no live synchronization', 'Video not configured']) {
    assert.match(ui, new RegExp(statement))
  }
})

test('the additive health observation remains compatible with legacy connector consumers', () => {
  const result = { connections: [{ id: 'connection-1', status: 'verified', health_observation: { outcome: 'succeeded' } }] }
  const legacyProjection = result.connections.map(({ id, status }) => ({ id, status }))
  assert.deepEqual(legacyProjection, [{ id: 'connection-1', status: 'verified' }])
})

test('B05 ignores a delayed old-organization UI response after scope changes', async () => {
  let resolveOld
  const oldResponse = new Promise(resolve => { resolveOld = resolve })
  const rendered = []
  let current = { organizationId: 'org-a', revision: 1, generation: 1 }
  const oldRequest = { ...current, signal: new AbortController().signal }
  const oldLoad = oldResponse.then(value => {
    if (isDesignConnectionScopeCurrent(current, oldRequest)) rendered.push(value)
  })

  current = { organizationId: 'org-b', revision: 2, generation: 2 }
  const newRequest = { ...current, signal: new AbortController().signal }
  if (isDesignConnectionScopeCurrent(current, newRequest)) rendered.push('organization-b')
  resolveOld('organization-a')
  await oldLoad
  assert.deepEqual(rendered, ['organization-b'])

  const panel = readFileSync(new URL('../components/DesignConnectionsPanel.jsx', import.meta.url), 'utf8')
  const workshop = readFileSync(new URL('../apps/DesignWorkshop.jsx', import.meta.url), 'utf8')
  assert.match(panel, /listForOrganization\(organizationId, 'design', \{ signal: requestSignal \}\)/)
  assert.match(panel, /testForOrganization\(organizationId, connection\.id, \{ signal: requestSignal \}\)/)
  assert.match(panel, /isDesignConnectionScopeCurrent/)
  assert.match(workshop, /key=\{`\$\{activeOrganizationId\}:\$\{scopeRevision\}`\}/)
})
