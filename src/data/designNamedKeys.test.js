import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('../../supabase/functions/_shared/googleOAuthTokens.ts', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code
function keyReader(values) {
  const context = { exports: {}, module: { exports: {} }, Deno: { env: { get: name => values[name] } } }
  vm.runInNewContext(compiled, context)
  return context.module.exports.namedKey
}
for (const [label, primary, legacy, expected] of [
  ['named default wins', '{"other":"alternate","default":"public-key"}', 'legacy', 'public-key'],
  ['named custom key', '{"custom":"public-key"}', 'legacy', 'public-key'],
  ['legacy environment', undefined, 'legacy', 'legacy'],
  ['malformed map uses legacy', '{bad', 'legacy', 'legacy'],
  ['empty map uses legacy', '{}', 'legacy', 'legacy'],
  ['missing keys remain empty', undefined, undefined, ''],
]) test(`Design API key selection: ${label}`, () => {
  const namedKey = keyReader({ PRIMARY: primary, LEGACY: legacy })
  assert.equal(namedKey('PRIMARY', 'LEGACY'), expected)
})
for (const endpoint of ['design-workshop', 'design-systems', 'website-page-designs', 'wordpress-export', 'production-handoff']) {
  test(`${endpoint} caller uses decoded public key without changing bearer checks`, () => {
    const text = readFileSync(new URL(`../../supabase/functions/${endpoint}/index.ts`, import.meta.url), 'utf8')
    assert.match(text, /import \{ namedKey \} from '\.\.\/_shared\/googleOAuthTokens.ts'/)
    const body = text.match(/function publicApiKey\(\) \{([\s\S]*?)\n\}/)?.[1]
    assert.ok(body)
    const namedKey = keyReader({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"public-key"}', SUPABASE_ANON_KEY: 'legacy' })
    assert.equal(vm.runInNewContext(`(function(){${body}})()`, { namedKey }), 'public-key')
    assert.match(text, /Authorization: authorization/)
    assert.match(text, /\.auth\.getUser\(\)/)
  })
}
test('shared organization authority uses the same decoder for both client keys', () => {
  const text = readFileSync(new URL('../../supabase/functions/_shared/serverOrganizationContext.ts', import.meta.url), 'utf8')
  assert.match(text, /import \{ namedKey \} from "\.\/googleOAuthTokens.ts"/)
  assert.doesNotMatch(text, /function namedKey/)
  assert.match(text, /namedKey\("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"\)/)
  assert.match(text, /namedKey\("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"\)/)
})