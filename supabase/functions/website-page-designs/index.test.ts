import { applySeoMetadata, generateOpenAiPage, hasPageDesignAuthority, normalizePagePath,
  pageDesignSchema, SEO_DESCRIPTION_PLACEHOLDER, SEO_TITLE_PLACEHOLDER, seoMetadata,
  validatePageOutput } from './index.ts'

function assert(value: unknown, message = 'Expected value to be truthy') {
  if (!value) throw new Error(message)
}

assert.equal = (actual: unknown, expected: unknown) => {
  if (!Object.is(actual, expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}

assert.throws = (callback: () => unknown) => {
  try { callback() } catch { return }
  throw new Error('Expected callback to throw')
}

Deno.test('RP4 uses architecture slug and normalizes the content page_path only for matching', () => {
  assert.equal(normalizePagePath('/about/?ref=test'), 'about')
  assert.equal(normalizePagePath('https://raahbaan.example/'), 'home')
})

Deno.test('missing website content produces explicit SEO placeholders', () => {
  assert.equal(seoMetadata(null).title, SEO_TITLE_PLACEHOLDER)
  assert.equal(seoMetadata({}).description, SEO_DESCRIPTION_PLACEHOLDER)
})

Deno.test('approved content SEO is injected exactly into the complete document', () => {
  const html = applySeoMetadata('<!doctype html><html><head></head><body><h1>Raahbaan</h1></body></html>', 'Find a home', 'Trusted property guidance')
  assert(html.includes('<title>Find a home</title>'))
  assert(html.includes('content="Trusted property guidance"'))
  assert.equal(validatePageOutput(html, 'body { color: #111; }').css, 'body { color: #111; }')
})

Deno.test('page validation rejects executable content and missing heading structure', () => {
  const base = '<!doctype html><html><head><title>Home</title><meta content="Page" name="description"></head><body><h1>Home</h1></body></html>'
  assert.equal(validatePageOutput(base, 'body{}').html, base)
  assert.throws(() => validatePageOutput(base.replace('</body>', '<script>alert(1)</script></body>'), 'body{}'))
  assert.throws(() => validatePageOutput(base.replace('<h1>Home</h1>', ''), 'body{}'))
})

Deno.test('only accountable Design management or organization leadership can approve', () => {
  assert.equal(hasPageDesignAuthority({ role: 'contributor', department_id: 'design' }, 'generate'), true)
  assert.equal(hasPageDesignAuthority({ role: 'contributor', department_id: 'design' }, 'approve'), false)
  assert.equal(hasPageDesignAuthority({ role: 'department_manager', department_id: 'design' }, 'approve'), true)
  assert.equal(hasPageDesignAuthority({ role: 'executive', department_id: 'operations' }, 'approve'), true)
})

Deno.test('OpenAI page adapter routes through the selected registered model and strict schema', async () => {
  let requestBody: Record<string, unknown> = {}
  const generated = await generateOpenAiPage('secret', 'registered-model', 'Page context', async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'))
    return new Response(JSON.stringify({ output_text: JSON.stringify({ html_content: '<!doctype html>', css_content: 'body{}' }) }), { status: 200 })
  })
  assert.equal(requestBody.model, 'registered-model')
  assert.equal((requestBody.text as Record<string, unknown>).format !== undefined, true)
  assert.equal(pageDesignSchema().strict, true)
  assert.equal(generated.css_content, 'body{}')
})
