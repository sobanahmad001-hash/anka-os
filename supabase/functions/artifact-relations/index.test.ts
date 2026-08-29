import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { loadReadablePair, relationInput } from './index.ts'

Deno.test('D3 accepts only the three descriptive relation types', () => {
  assertEquals(relationInput({
    source_artifact_id: 'source', target_artifact_id: 'target', relation_type: 'feeds_into',
  }), { sourceArtifactId: 'source', targetArtifactId: 'target', relationType: 'feeds_into' })
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
