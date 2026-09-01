import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { loadReadablePair, relationInput, requireReleasedDesignSystemTarget } from './index.ts'

Deno.test('CP5 relation input accepts artifact, content request, and sitemap targets', () => {
  assertEquals(relationInput({
    source_artifact_id: 'source', target_artifact_id: 'target', relation_type: 'feeds_into',
  }), { sourceArtifactId: 'source', targetArtifactId: 'target', targetContentRequestId: null, relationType: 'feeds_into' })
  assertEquals(relationInput({
    source_artifact_id: 'keywords', target_content_request_id: 'request-1', relation_type: 'targets_page',
  }), {
    sourceArtifactId: 'keywords', targetArtifactId: null,
    targetContentRequestId: 'request-1', relationType: 'targets_page',
  })
  assertThrows(() => relationInput({
    source_artifact_id: 'source', target_artifact_id: 'target', relation_type: 'blocks',
  }), Error, 'Unsupported')
  assertThrows(() => relationInput({
    source_artifact_id: 'same', target_artifact_id: 'same', relation_type: 'derived_from',
  }), Error, 'cannot relate to itself')
})

Deno.test('D3 relation loading blocks hidden endpoints, including request targets', async () => {
  const source = { id: 'source', organization_id: 'org', title: 'Source', artifact_type: 'discovery', engagement_id: 'engagement' }
  const sourceOnlyClient = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'artifacts' ? source : null, error: null }) }),
        in: async () => ({ data: [source], error: null }),
      }),
    }),
  }
  await assertRejects(
    () => loadReadablePair(sourceOnlyClient as never, 'source', 'hidden-target'),
    Error,
    'Both artifacts must be visible',
  )

  const requestVisibleClient = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({
          data: table === 'artifacts'
            ? source
            : { id: 'request-1', organization_id: 'org', status: 'pending', format: 'reel' },
          error: null,
        }) }),
        in: async () => ({ data: [source], error: null }),
      }),
    }),
  }
  const requestPair = await loadReadablePair(requestVisibleClient as never, 'source', null, 'request-1')
  assertEquals(requestPair.source.id, 'source')
  assertEquals(requestPair.target.id, 'request-1')
  assertEquals(requestPair.targetKind, 'content_request')
  assertEquals(requestPair.organizationId, 'org')
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
