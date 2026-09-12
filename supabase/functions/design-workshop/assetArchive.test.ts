import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { archiveDesignAsset } from './assetVersions.ts'

Deno.test('archive delegates only to the soft-archive RPC with exact optimistic identity', async () => {
  let called: { name: string; args: Record<string, unknown> } | null = null
  const admin = {
    organizationId: 'org-a',
    rpc(name: string, args: Record<string, unknown>) {
      called = { name, args }
      return Promise.resolve({ data: { storage_objects_deleted: 0 }, error: null })
    },
  }
  const result = await archiveDesignAsset(admin, {
    asset_id: 'asset-a', expected_latest_version_id: 'version-a',
    operation_key: 'archive-request-a', reason: 'Explicit human confirmation',
  }, 'user-a')
  assertEquals(result, { storage_objects_deleted: 0 })
  assertEquals(called, {
    name: 'archive_design_asset',
    args: {
      p_organization_id: 'org-a', p_asset_id: 'asset-a',
      p_expected_latest_version_id: 'version-a', p_operation_key: 'archive-request-a',
      p_reason: 'Explicit human confirmation', p_actor_id: 'user-a',
    },
  })
})

Deno.test('archive rejects incomplete evidence before calling the database', async () => {
  let calls = 0
  const admin = { organizationId: 'org-a', rpc() { calls++; return Promise.resolve({ data: null, error: null }) } }
  await assertRejects(() => archiveDesignAsset(admin, { asset_id: 'asset-a' }, 'user-a'), Error, 'expected latest version')
  assertEquals(calls, 0)
})
