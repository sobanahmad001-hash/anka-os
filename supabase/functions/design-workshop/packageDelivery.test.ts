import { normalizeDeliveryPackage, saveDeliveryPackage, validateDeliveryPackage } from './packageDelivery.ts'

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

Deno.test('B06a normalizes a website package without carrying social placement', () => {
  const value = normalizeDeliveryPackage({
    destination_type: 'website', placement_label: ' Hero ', website_page_section: ' Home / Hero ',
    social_platform: 'must clear', width: '1440', height: 900, usage_instructions: ' Exact export ',
  })
  assert(value.destination_type === 'website')
  assert(value.website_page_section === 'Home / Hero')
  assert(value.social_platform === '')
  assert(value.width === 1440 && value.height === 900)
})

Deno.test('B06a validates a complete social package and rejects empty versions', () => {
  const social = validateDeliveryPackage({
    destination_type: 'social', placement_label: 'Launch post', social_platform: 'LinkedIn',
    width: 1080, height: 1080, usage_instructions: 'Use unchanged',
  }, ['version-1', 'version-1'])
  assert(social.valid)
  assert(social.selected_version_ids.length === 1)
  const empty = validateDeliveryPackage({
    destination_type: 'social', placement_label: 'Launch post', social_platform: 'LinkedIn',
    width: 1080, height: 1080, usage_instructions: 'Use unchanged',
  }, [])
  assert(!empty.valid && empty.missing.includes('at least one exact asset version'))
})

Deno.test('B06a save rechecks a missing private object before its database mutation', async () => {
  const calls = { storage: 0, rpc: 0 }
  const rows: Record<string, unknown> = {
    engagements: { id: 'eng', project_id: 'project' }, tasks: { id: 'task' },
    design_asset_versions: [{ id: 'asset-v1', asset_id: 'asset', storage_bucket: 'design-generated-media',
      storage_path: 'org/private/missing.png', design_assets: { engagement_id: 'eng', brand_id: 'brand', archived_at: null } }],
  }
  const from = (table: string) => {
    const query: any = { select: () => query, eq: () => query, is: () => query, in: () => query,
      maybeSingle: async () => ({ data: rows[table], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve) }
    return query
  }
  const admin: any = { organizationId: 'org', from,
    storage: { from: () => ({ createSignedUrls: async () => {
      calls.storage += 1; return { data: null, error: new Error('missing') }
    } }) },
    rpc: async () => { calls.rpc += 1; return { data: {}, error: null } } }
  const body = { engagement_id: 'eng', brand_id: 'brand', source_engagement_service_id: 'design-service',
    project_task_id: 'task', operation_key: 'stable-operation', title: 'Hero', asset_version_ids: ['asset-v1'],
    content: { destination_type: 'website', placement_label: 'Hero', website_page_section: 'Home',
      width: 1440, height: 900, usage_instructions: 'Exact' } }
  let rejected = false
  try { await saveDeliveryPackage(admin, { from }, body, 'actor') } catch (error) {
    rejected = String(error).includes('unavailable in private storage')
  }
  assert(rejected)
  assert(calls.storage === 1 && calls.rpc === 0)
})
