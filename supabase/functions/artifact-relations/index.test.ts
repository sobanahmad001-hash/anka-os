import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { loadReadablePair, relationInput, requireReleasedDesignSystemTarget } from './index.ts'

Deno.test('D3 relation input accepts descriptive links and RP2 page targeting', () => {
  assertEquals(relationInput({
    source_artifact_id: 'source', target_artifact_id: 'target', relation_type: 'feeds_into',
  }), { sourceArtifactId: 'source', targetArtifactId: 'target', relationType: 'feeds_into' })
  assertEquals(relationInput({
    source_artifact_id: 'keywords', target_artifact_id: 'architecture', relation_type: 'targets_page',
  }).relationType, 'targets_page')
  assertThrows(() => relationInput({
    source_artifact_id: 'source', target_artifact_id: 'target', relation_type: 'blocks',
  }), Error, 'Unsupported')
  assertThrows(() => relationInput({
    source_artifact_id: 'same', target_artifact_id: 'same', relation_type: 'derived_from',
  }), Error, 'cannot relate to itself')
})

Deno.test('D3 refuses a relation when either endpoint is hidden by artifact RLS', async () => {
  const sourceOnlyClient = {
    from: () => ({
      select: () => ({
        in: async () => ({ data: [{
          id: 'source', organization_id: 'organization', title: 'Visible',
          artifact_type: 'discovery', engagement_id: 'engagement',
        }], error: null }),
      }),
    }),
  }
  await assertRejects(
    () => loadReadablePair(sourceOnlyClient as never, 'source', 'hidden-target'),
    Error,
    'Both artifacts must be visible',
  )
})

Deno.test('D3 permits cross-type endpoints in one organization', async () => {
  const client = {
    from: () => ({
      select: () => ({
        in: async () => ({ data: [
          { id: 'content', organization_id: 'organization', artifact_type: 'discovery' },
          { id: 'marketing', organization_id: 'organization', artifact_type: 'campaign_brief' },
        ], error: null }),
      }),
    }),
  }
  const pair = await loadReadablePair(client as never, 'content', 'marketing')
  assertEquals(pair.organizationId, 'organization')
  assertEquals(pair.source.artifact_type, 'discovery')
  assertEquals(pair.target.artifact_type, 'campaign_brief')
})

Deno.test('DS5 permits only released design systems as D3 targets', async () => {
  class Query {
    constructor(private row: Record<string, unknown> | null) {}
    select() { return this }
    eq() { return this }
    limit() { return this }
    async maybeSingle() { return { data: this.row, error: null } }
  }
  await requireReleasedDesignSystemTarget(
    { from: () => new Query({ id: 'approval' }) } as never,
    { id: 'system', artifact_type: 'design_system' },
  )
  await assertRejects(
    () => requireReleasedDesignSystemTarget(
      { from: () => new Query(null) } as never,
      { id: 'draft-system', artifact_type: 'design_system' },
    ),
    Error,
    'Only a released Design System can be linked',
  )
})
