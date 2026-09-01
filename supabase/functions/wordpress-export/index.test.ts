import { hasWordPressExportAuthority } from './index.ts'
import { buildWordPressTheme, createStoredZip, referencedMediaPaths, wordpressSlug } from './theme.ts'

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

assert.equal = (actual: unknown, expected: unknown) => {
  if (!Object.is(actual, expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}

assert.rejects = async (callback: () => Promise<unknown>) => {
  try { await callback() } catch { return }
  throw new Error('Expected promise to reject')
}

const html = '<!doctype html><html><head><title>Raahbaan Homes</title><meta name="description" content="Trusted homes"></head><body><main><h1>Find a home</h1><h2>Featured</h2><img src="https://project.supabase.co/storage/v1/object/sign/design-generated-media/org/version/hero.png?token=temporary" alt="Raahbaan property adviser"></main></body></html>'

Deno.test('native exporter builds the minimum valid classic theme without a paid provider', async () => {
  const theme = await buildWordPressTheme('Home', html, 'body { color: #111; }', [{
    storagePath: 'org/version/hero.png', contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]),
  }])
  const archive = new TextDecoder().decode(theme.bytes)
  for (const filename of ['style.css', 'index.php', 'header.php', 'footer.php', 'functions.php', 'readme.txt', 'assets/media-01.png']) {
    assert(archive.includes(`anka-home/${filename}`), `${filename} missing from theme ZIP`)
  }
  assert(archive.includes('get_template_directory_uri'))
  assert(!archive.includes('token=temporary'))
  assert.equal(theme.seoVerification.all_checks_passed, true)
  assert.equal(theme.sha256.length, 64)
})

Deno.test('SEO preservation blocks export when an image has no alternative text', async () => {
  await assert.rejects(() => buildWordPressTheme('home', html.replace(' alt="Raahbaan property adviser"', ''), 'body{}', [{
    storagePath: 'org/version/hero.png', contentType: 'image/png', bytes: new Uint8Array([1]),
  }]))
})

Deno.test('private signed images must be bundled instead of exported with expiring links', async () => {
  assert.equal(referencedMediaPaths(html)[0], 'org/version/hero.png')
  await assert.rejects(() => buildWordPressTheme('home', html, 'body{}'))
})

Deno.test('theme naming and ZIP output are deterministic for controlled inputs', async () => {
  assert.equal(wordpressSlug('/Luxury Homes/'), 'luxury-homes')
  const first = createStoredZip([{ name: 'theme/index.php', bytes: new TextEncoder().encode('hello') }])
  const second = createStoredZip([{ name: 'theme/index.php', bytes: new TextEncoder().encode('hello') }])
  assert.equal([...first].join(','), [...second].join(','))
})

Deno.test('Design contributors and accountable leaders can export, other departments cannot', () => {
  assert.equal(hasWordPressExportAuthority({ role: 'contributor', department_id: 'design' }), true)
  assert.equal(hasWordPressExportAuthority({ role: 'department_manager', department_id: 'design' }), true)
  assert.equal(hasWordPressExportAuthority({ role: 'executive', department_id: 'operations' }), true)
  assert.equal(hasWordPressExportAuthority({ role: 'contributor', department_id: 'marketing' }), false)
})
