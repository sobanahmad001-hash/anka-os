import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const repositories = [
  'src/data/contentStudioRepository.js',
  'src/data/contentRequestsRepository.js',
  'src/data/contentQueueRepository.js',
  'src/data/contentCustomFieldsRepository.js',
]

test('Content repositories require a validated active organization before any operation', () => {
  for (const file of repositories) {
    const source = read(file)
    assert.match(source, /if \(!organizationId\) throw new TypeError\('Active organization is required'\)/, file)
    assert.match(source, /forOrganization:/, file)
    assert.match(source, /organization_id: organizationId/, file)
    assert.match(source, /\.eq\('organization_id', organizationId\)/, file)
  }
})

test('Content components derive repository authority from OrganizationContext, never URL context', () => {
  const studio = read('src/apps/ContentStudio.jsx')
  const settings = read('src/components/ContentCustomFieldSettings.jsx')
  for (const source of [studio, settings]) {
    assert.match(source, /useOrganization\(\)/)
    assert.match(source, /activeOrganizationId/)
    assert.match(source, /\.forOrganization\(activeOrganizationId/)
    assert.doesNotMatch(source, /ctxOrg/)
  }
  assert.match(studio, /requestSignal/)
  assert.match(studio, /scopeRevision/)
  assert.match(studio, /Content workspace organization mismatch/)
  assert.match(studio, /Content catalogue organization mismatch/)
  assert.match(settings, /scopeRevision/)
  assert.match(settings, /requestSignal/)
  assert.match(settings, /currentScope\(request\)/)
  assert.match(settings, /loadGeneration\.current/)
})

test('Content scoped invokes preserve action names and send organization only as an equality selector', () => {
  const combined = repositories.map(read).join('\n')
  for (const action of [
    'save_artifact', 'create_content_request', 'create_queue_entry', 'action_queue_entry',
    'skip_queue_entry', 'ensure_figma_handoff', 'save_brand_brief', 'generate_brand_statement',
    'approve_artifact', 'create_custom_field_definition', 'save_custom_field_value',
  ]) assert.match(combined, new RegExp(`'${action}'`), action)
  assert.match(combined, /body: \{ \.\.\.input, action, organization_id: organizationId \}/)
  assert.doesNotMatch(combined, /const\s+ORGANIZATION_ID|ctxOrg|first.*membership/i)
})
