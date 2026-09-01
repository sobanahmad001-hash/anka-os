import {
  designSystemContent,
  hasDesignSystemsAuthority,
  requireActiveDesignSystemsService,
} from './index.ts'

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown) {
  if (!Object.is(actual, expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}

async function assertRejects(callback: () => Promise<unknown>, expected: string) {
  try { await callback() } catch (error) {
    assert(error instanceof Error && error.message.includes(expected), `Expected error containing ${expected}`)
    return
  }
  throw new Error('Expected callback to reject')
}

const validContent = {
  color_tokens: [{ name: 'Brand blue', value: '#2563eb' }],
  typography_scale: [{ name: 'Display', font: 'Inter', size: '48px', weight: '700' }],
  components: [{ name: 'Button', description: 'Primary action', usage_notes: 'One primary action per view' }],
  usage_rules: 'Use approved tokens and document exceptions.',
}

Deno.test('DS5 accepts only the exact manual design-system content shape', () => {
  assertEquals(designSystemContent(validContent).color_tokens.length, 1)
  let rejected = false
  try { designSystemContent({ ...validContent, live_preview: true }) } catch { rejected = true }
  assert(rejected, 'Unexpected renderer fields must be rejected')
})

Deno.test('DS5 authoring is Design/leadership scoped and release requires Design management', () => {
  assertEquals(hasDesignSystemsAuthority({ role: 'contributor', department_id: 'design' }, 'save_design_system'), true)
  assertEquals(hasDesignSystemsAuthority({ role: 'contributor', department_id: 'content' }, 'save_design_system'), false)
  assertEquals(hasDesignSystemsAuthority({ role: 'contributor', department_id: 'design' }, 'release_design_system'), false)
  assertEquals(hasDesignSystemsAuthority({ role: 'department_manager', department_id: 'design' }, 'release_design_system'), true)
  assertEquals(hasDesignSystemsAuthority({ role: 'executive', department_id: null }, 'release_design_system'), true)
})

Deno.test('DS5 reuses active Design service validation and requires the design_systems slug', async () => {
  class Query {
    constructor(private row: Record<string, unknown> | null) {}
    select() { return this }
    eq() { return this }
    async maybeSingle() { return { data: this.row, error: null } }
  }
  const active = {
    id: 'service-1', engagement_id: 'engagement-1', status: 'active',
    service_catalog: { slug: 'design_systems', department_id: 'design', is_active: true },
  }
  const result = await requireActiveDesignSystemsService(
    { from: () => new Query(active) } as never,
    'engagement-1',
    'service-1',
  )
  assertEquals(result.catalog.slug, 'design_systems')
  await assertRejects(() => requireActiveDesignSystemsService(
    { from: () => new Query({ ...active, service_catalog: { ...active.service_catalog, slug: 'campaign_creative' } }) } as never,
    'engagement-1',
    'service-1',
  ), 'Design Systems service')
  await assertRejects(() => requireActiveDesignSystemsService(
    { from: () => new Query({ ...active, status: 'planned' }) } as never,
    'engagement-1',
    'service-1',
  ), 'not active')
})
