import { assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1.0.14'
import { decryptSecret, encryptSecret, handleRequest, META_OAUTH_SCOPES, pkceChallenge, randomToken, sha256 } from './index.ts'

Deno.test('Meta scopes are organic read and insights scopes only', () => {
  assertEquals(META_OAUTH_SCOPES, ['pages_show_list', 'pages_read_engagement', 'read_insights', 'instagram_basic', 'instagram_manage_insights'])
  assertEquals(META_OAUTH_SCOPES.some(scope => scope.includes('ads') || scope.includes('publish')), false)
})
Deno.test('Meta state and PKCE use the shared high-entropy implementation', async () => {
  const state = randomToken(32); const verifier = randomToken(64)
  assertMatch(state, /^[A-Za-z0-9_-]{43}$/); assertMatch(await pkceChallenge(verifier), /^[A-Za-z0-9_-]{43}$/); assertEquals((await sha256(state)).length, 64)
})
Deno.test('Meta token ciphertext and IV remain separate AES-GCM values', async () => {
  const material = 'a-secure-test-key-that-is-longer-than-thirty-two-characters'; const first = await encryptSecret('token', material); const second = await encryptSecret('token', material)
  assertNotEquals(first.iv, second.iv); assertNotEquals(first.ciphertext, second.ciphertext); assertEquals(await decryptSecret(first.ciphertext, first.iv, material), 'token')
})
Deno.test('Meta POST actions require authentication before configuration', async () => {
  const response = await handleRequest(new Request('https://example.com/meta-oauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) }))
  assertEquals(response.status, 401)
})
