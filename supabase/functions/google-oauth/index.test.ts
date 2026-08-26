import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from 'jsr:@std/assert@1.0.14'

import {
  decryptSecret,
  encryptSecret,
  handleRequest,
  pkceChallenge,
  randomToken,
  safeDepartmentIds,
  sha256,
} from './index.ts'

Deno.test('Google connector departments are restricted by provider', () => {
  assertEquals(safeDepartmentIds('google_analytics', ['development', 'marketing']), ['development', 'marketing'])
  assertEquals(safeDepartmentIds('google_search_console', ['content']), ['content'])
  assertThrows(
    () => safeDepartmentIds('google_ads', ['content']),
    Error,
    'Select valid departments',
  )
})

Deno.test('OAuth state and PKCE verifier use high-entropy URL-safe values', async () => {
  const state = randomToken(32)
  const verifier = randomToken(64)
  assertMatch(state, /^[A-Za-z0-9_-]{43}$/)
  assertMatch(verifier, /^[A-Za-z0-9_-]{86}$/)
  assertMatch(await pkceChallenge(verifier), /^[A-Za-z0-9_-]{43}$/)
  assertEquals((await sha256(state)).length, 64)
})

Deno.test('OAuth secrets round-trip through AES-GCM without deterministic ciphertext', async () => {
  const material = 'a-secure-test-key-that-is-longer-than-thirty-two-characters'
  const first = await encryptSecret('refresh-token', material)
  const second = await encryptSecret('refresh-token', material)
  assertNotEquals(first.iv, second.iv)
  assertNotEquals(first.ciphertext, second.ciphertext)
  assertEquals(await decryptSecret(first.ciphertext, first.iv, material), 'refresh-token')
})

Deno.test('POST actions reject missing Supabase authentication before reading configuration', async () => {
  const response = await handleRequest(new Request('https://example.com/google-oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start' }),
  }))
  assertEquals(response.status, 401)
  assertEquals(await response.json(), { error: 'Authentication required' })
})
