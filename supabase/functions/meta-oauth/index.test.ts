import { assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1.0.14'
import {
  decryptSecret,
  encryptSecret,
  handleRequest,
  META_OAUTH_SCOPES,
  META_READ_METRICS,
  pkceChallenge,
  randomToken,
  sha256,
  snapshotDate,
} from './index.ts'

Deno.test('Meta scopes are a fixed organic insights allowlist', () => {
  assertEquals(META_OAUTH_SCOPES, [
    'pages_show_list',
    'pages_read_engagement',
    'read_insights',
    'instagram_basic',
    'instagram_manage_insights',
  ])
  assertEquals(
    META_OAUTH_SCOPES.some(scope => /ads|publish|content|messaging|comments/.test(scope)),
    false,
  )
})

Deno.test('Meta fetches only the approved organic daily metrics', () => {
  assertEquals(META_READ_METRICS.facebook, [
    'page_impressions',
    'page_impressions_unique',
    'page_post_engagements',
  ])
  assertEquals(META_READ_METRICS.instagram, ['reach', 'impressions', 'accounts_engaged'])
})

Deno.test('Meta state and PKCE use the shared high-entropy implementation', async () => {
  const state = randomToken(32)
  const verifier = randomToken(64)
  assertMatch(state, /^[A-Za-z0-9_-]{43}$/)
  assertMatch(await pkceChallenge(verifier), /^[A-Za-z0-9_-]{43}$/)
  assertEquals((await sha256(state)).length, 64)
})

Deno.test('Meta token encryption is the exact shared AES-GCM implementation', async () => {
  const material = 'a-secure-test-key-that-is-longer-than-thirty-two-characters'
  const first = await encryptSecret('token', material)
  const second = await encryptSecret('token', material)
  assertNotEquals(first.iv, second.iv)
  assertNotEquals(first.ciphertext, second.ciphertext)
  assertEquals(await decryptSecret(first.ciphertext, first.iv, material), 'token')
})

Deno.test('snapshot dates reject rollover dates and default to yesterday', () => {
  assertEquals(snapshotDate('2026-09-01'), '2026-09-01')
  assertEquals(snapshotDate('', new Date('2026-09-02T12:00:00Z')), '2026-09-01')
  let message = ''
  try {
    snapshotDate('2026-02-31')
  } catch (error) {
    message = error instanceof Error ? error.message : ''
  }
  assertEquals(message, 'Snapshot date must be a real ISO date')
})

Deno.test('Meta POST actions require authentication before configuration', async () => {
  const response = await handleRequest(new Request('https://example.com/meta-oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start' }),
  }))
  assertEquals(response.status, 401)
})
