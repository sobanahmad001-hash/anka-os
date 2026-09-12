import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { saveCreativeBrief, validateIdentityReferenceRows } from './creativeBriefs.ts'

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

Deno.test('B05 rejected identity source stops before the creative-brief saving RPC', async () => {
  let rpcCalls = 0
  const query = (data: unknown[]) => {
    const result = { data, error: null }
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in']) chain[method] = () => chain
    chain.maybeSingle = async () => ({ data: data[0] || null, error: null })
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return chain
  }
  const admin = {
    organizationId: 'org-1',
    from(table: string) {
      if (table === 'engagements') return query([{ id: 'engagement-1' }])
      if (table === 'engagement_services') return query([{
        id: 'service-1', service_catalog: { department_id: 'design', is_active: true },
      }])
      return query([])
    },
    async rpc() { rpcCalls += 1; return { data: {}, error: null } },
  }
  const userClient = {
    from(table: string) {
      if (table === 'artifact_versions') return query([row('identity-v1', 'org-1', 'brand-1')])
      if (table === 'artifact_approvals') return query([])
      return query([])
    },
  }
  await assertRejects(() => saveCreativeBrief(admin, userClient, {
    visibility: 'official', engagement_id: 'engagement-1', brand_id: 'brand-1',
    engagement_service_id: 'service-1', source_version_ids: ['identity-v1'],
    expected_revision: 0, operation_key: 'operation-1',
    content: { title: 'Identity brief', output_type: 'brand_identity' },
  }, 'actor-1'), Error, 'approved')
  assertEquals(rpcCalls, 0)
})
