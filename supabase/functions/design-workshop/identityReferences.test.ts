import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { validateIdentityReferenceRows } from './creativeBriefs.ts'

const row = (id: string, organizationId = 'org-1', brandId = 'brand-1', artifactType = 'design_system') => ({
  id, organization_id: organizationId,
  artifacts: { artifact_type: artifactType, organization_id: organizationId, brand_id: brandId },
})

Deno.test('B05 accepts only approved same-brand Design System versions', () => {
  assertEquals(validateIdentityReferenceRows(
    [row('identity-v1'), row('ordinary-v1', 'org-1', 'brand-2', 'vision')],
    [{ artifact_version_id: 'identity-v1', organization_id: 'org-1' }], 'org-1', 'brand-1',
  ), ['identity-v1'])
  assertThrows(() => validateIdentityReferenceRows([row('identity-v1')], [], 'org-1', 'brand-1'), Error, 'approved')
  assertThrows(() => validateIdentityReferenceRows(
    [row('identity-v1', 'org-1', 'brand-2')],
    [{ artifact_version_id: 'identity-v1', organization_id: 'org-1' }], 'org-1', 'brand-1',
  ), Error, 'this brand')
  assertThrows(() => validateIdentityReferenceRows(
    [row('identity-v1', 'org-2', 'brand-1')],
    [{ artifact_version_id: 'identity-v1', organization_id: 'org-2' }], 'org-1', 'brand-1',
  ), Error, 'this brand')
})

Deno.test('B05 requires official brand scope only when an identity system is pinned', () => {
  assertEquals(validateIdentityReferenceRows([row('ordinary-v1', 'org-1', 'brand-2', 'vision')], [], 'org-1', null), [])
  assertThrows(() => validateIdentityReferenceRows(
    [row('identity-v1')], [{ artifact_version_id: 'identity-v1', organization_id: 'org-1' }], 'org-1', null,
  ), Error, 'official brand context')
})
