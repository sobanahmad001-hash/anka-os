import test from 'node:test'
import assert from 'node:assert/strict'
import { websiteNativeFixture } from '../../tools/website-native-fixture.js'
import { prepareWebsiteNativeManifest, verifyWebsiteNativeManifest, websiteNativeLayout } from '../../supabase/functions/_shared/websiteNativeDraft.js'
import { compileWebsiteNativeDesign, validateWebsiteNativeDesign, websiteNativeSnapshotChecksum } from '../../supabase/functions/_shared/websiteNativeDesign.js'
async function context(body = '  Exact approved copy\nwith preserved whitespace.  ') {
  const f = await websiteNativeFixture()
  return { scope: f.scope, architecture: { artifact_version_id: f.sources.architecture.version_id, content_checksum: f.sources.architecture.checksum },
    page: { title: 'Home' }, content_version: { id: f.sources.content.version_id, content_checksum: f.sources.content.checksum },
    brief_version: { id: f.sources.brief.version_id, content_checksum: f.sources.brief.checksum },
    site_version: { id: f.sources.site_system.version_id, request_sha256: f.sources.site_system.checksum, site: { ...f.site, navigation: [{ label: 'Home', path: '/home' }] } },
    content_page: { source_format: 'writer_v2', page_brief: 'CONTEXT_ONLY_OBJECTIVE_DO_NOT_PUBLISH', draft_copy: body, meta_title: 'Exact Writer title', meta_description: '', primary_cta: null } }
}
const numbered = '## 1. Hero\n### Exact heading\n\nIntro before features.\n\n#### Feature one\nExact feature copy.\n\n**Primary CTA:** [Contact](https://ankasphere.com/contact/)\n**Secondary CTA:** [Next](#contact)\n\n## 2. Contact\n### Talk with us\n\nExact contact copy.\n\n**CTA:** [Read more](/about)'

test('Writer2 plain projection preserves exact copy/source checksum, omits unauthored summary/CTA and context objective', async () => {
  const ctx = await context(), before = structuredClone(ctx), manifest = await prepareWebsiteNativeManifest(ctx, websiteNativeLayout(ctx)), result = await compileWebsiteNativeDesign(manifest)
  assert.equal(manifest.content.format, 'writer_v2_plain')
  assert.equal(manifest.content.sections[0].paragraphs.join(''), ctx.content_page.draft_copy)
  assert.equal(manifest.content.summary, '')
  assert.equal(manifest.content.sections[0].action, null)
  assert.equal(manifest.sources.content.checksum, ctx.content_version.content_checksum)
  assert.equal(result.compiler_version, 4)
  assert.doesNotMatch(result.preview, /name="description"|CONTEXT_ONLY_OBJECTIVE|<p><\/p>|wp-block-button__link wp-element-button/)
  assert.deepEqual(ctx, before)
  assert.deepEqual(await verifyWebsiteNativeManifest(ctx, manifest), manifest)
})
test('Writer2 plain CTA needs exact saved label and explicit safe reviewed destination', async () => {
  const ctx = await context(), layout = websiteNativeLayout(ctx)
  await assert.rejects(prepareWebsiteNativeManifest(ctx, { ...layout, cta_path: '/contact' }), /saved CTA label/)
  ctx.content_page.primary_cta = 'Contact our team'
  assert.equal((await prepareWebsiteNativeManifest(ctx, layout)).content.sections[0].action, null)
  const manifest = await prepareWebsiteNativeManifest(ctx, { ...layout, cta_path: '/contact' })
  assert.deepEqual(manifest.content.sections[0].action, { label: 'Contact our team', path: '/contact' })
  assert.deepEqual(await verifyWebsiteNativeManifest(ctx, manifest), manifest)
  await assert.rejects(prepareWebsiteNativeManifest(ctx, { ...layout, cta_path: 'javascript:alert(1)' }))
})
test('Writer2 numbered source retains feature introduction and both original CTA paths without top-level CTA fabrication', async () => {
  const ctx = await context(numbered), layout = websiteNativeLayout(ctx), manifest = await prepareWebsiteNativeManifest(ctx, layout), result = await compileWebsiteNativeDesign(manifest)
  assert.equal(manifest.content.format, 'writer_v2_numbered')
  assert.equal(manifest.content.sections[0].paragraphs[0], 'Intro before features.')
  assert.equal(manifest.content.sections[0].items[0].body, 'Exact feature copy.')
  assert.deepEqual(manifest.content.sections[0].action, { label: 'Contact', path: 'https://ankasphere.com/contact/' })
  assert.equal(manifest.content.sections[0].secondary_action.path, '#contact')
  assert.equal(manifest.content.sections[1].action.path, '/about')
  assert.match(result.blocks, /Intro before features\./)
  assert.equal((result.blocks.match(/<h1\b/g) || []).length, 1)
  assert.doesNotMatch(result.preview, /name="description"|CONTEXT_ONLY_OBJECTIVE/)
  assert.deepEqual(await verifyWebsiteNativeManifest(ctx, manifest), manifest)
  await assert.rejects(prepareWebsiteNativeManifest(ctx, { ...layout, cta_path: '/different' }), /exact saved Content/)
  await assert.rejects(prepareWebsiteNativeManifest(ctx, { ...layout, sections: [{ source_key: 'copy', component: 'prose', motion: 'none' }] }))
})
test('Writer2 exact whitespace and Unicode chunking do not truncate, trim or split surrogate pairs', async () => {
  const body = '  ' + '😀'.repeat(10000) + '\n\n  Tail  ', ctx = await context(body), manifest = await prepareWebsiteNativeManifest(ctx, websiteNativeLayout(ctx))
  const paragraphs = manifest.content.sections[0].paragraphs
  assert.equal(paragraphs.join(''), body)
  assert.ok(paragraphs.every(p => p.length <= 3000 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p)))
})
test('Writer2 rejects missing/oversized source fields and unsafe body instead of inventing or truncating', async () => {
  for (const change of [p => p.draft_copy = 'x'.repeat(96001), p => p.draft_copy = ' ', p => p.draft_copy = 'bad\u0000copy',
    p => p.meta_title = 'x'.repeat(241), p => p.meta_description = 'Invented summary', p => p.primary_cta = 'x'.repeat(81),
    p => delete p.primary_cta, p => p.source_format = 'guessed', p => p.page_brief = '']) {
    const ctx = await context(); change(ctx.content_page)
    await assert.rejects(prepareWebsiteNativeManifest(ctx, { template: 'home', sections: [{ source_key: 'copy', component: 'prose', motion: 'none' }], cta_path: '' }))
  }
})
test('Writer2 rehashed text, CTA and summary cannot replace canonical source through verification', async () => {
  for (const change of [m => m.content.sections[0].paragraphs[0] = 'Changed copy', m => m.content.summary = 'Objective as SEO',
    m => m.content.sections[0].action = { label: 'Invented', path: '/contact' }, m => m.sources.content.version_id = 'a0000000-0000-4000-8000-000000000999']) {
    const ctx = await context(), manifest = await prepareWebsiteNativeManifest(ctx, websiteNativeLayout(ctx)); change(manifest)
    manifest.snapshot_checksums.content = await websiteNativeSnapshotChecksum(manifest.content)
    await assert.rejects(verifyWebsiteNativeManifest(ctx, manifest))
  }
})
test('empty summaries remain invalid for legacy formats and invented Writer2 summaries fail validation', async () => {
  const legacy = await websiteNativeFixture(); legacy.content.summary = ''
  assert.throws(() => validateWebsiteNativeDesign(legacy), /page summary/)
  legacy.content.format = 'numbered_sections_v1'
  assert.throws(() => validateWebsiteNativeDesign(legacy), /page summary/)
  const ctx = await context(), writer = await prepareWebsiteNativeManifest(ctx, websiteNativeLayout(ctx)); writer.content.summary = 'Not authored'
  assert.throws(() => validateWebsiteNativeDesign(writer), /no authored SEO/)
})
test('legacy plain and numbered compiled outputs remain byte-identical to pre-change snapshots', async () => {
  const plain = await websiteNativeFixture()
  assert.equal(await websiteNativeSnapshotChecksum(await compileWebsiteNativeDesign(plain)), 'e27998548f540ac05554aee18e892f29631bc582d09440bcd6444e7e07fdc5a9')
  const structured = structuredClone(plain); structured.content.format = 'numbered_sections_v1'; structured.content.sections[0].key = 'hero'; structured.layout.sections[0].source_key = 'hero'
  structured.site.navigation[0].path = '#hero'; structured.content.sections[2].action.path = '#hero'
  structured.snapshot_checksums.content = await websiteNativeSnapshotChecksum(structured.content); structured.snapshot_checksums.site_system = await websiteNativeSnapshotChecksum(structured.site)
  assert.equal(await websiteNativeSnapshotChecksum(await compileWebsiteNativeDesign(structured)), '2bacf26c7ec61ad5b361e14953cb5255539595e75f02e6e82df372db2c48e28c')
})
