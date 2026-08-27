type TokenAdminClient = {
  from: (table: string) => any
}

export function namedKey(envName: string, fallbackName: string) {
  const encoded = Deno.env.get(envName)
  if (encoded) {
    try {
      const keys = JSON.parse(encoded)
      if (typeof keys.default === 'string') return keys.default
      const first = Object.values(keys).find(value => typeof value === 'string')
      if (typeof first === 'string') return first
    } catch { /* use the legacy fallback */ }
  }
  return Deno.env.get(fallbackName) ?? ''
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function randomToken(byteLength = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return bytesToBase64Url(new Uint8Array(digest))
}

async function encryptionKey(material: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(value: string, material: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(material),
    new TextEncoder().encode(value),
  )
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  }
}

export async function decryptSecret(ciphertext: string, iv: string, material: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    await encryptionKey(material),
    base64UrlToBytes(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

export function googleCredentialConfiguration() {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? ''
  const encryptionMaterial = Deno.env.get('GOOGLE_OAUTH_ENCRYPTION_KEY') ?? ''
  if (!clientId || !clientSecret || encryptionMaterial.length < 32) {
    throw new Error('Google OAuth is not configured on the server')
  }
  return { clientId, clientSecret, encryptionMaterial }
}

export async function googleAccessToken(
  admin: TokenAdminClient,
  connectionId: string,
  provider: string,
  fetcher: typeof fetch = fetch,
) {
  const config = googleCredentialConfiguration()
  const { data: credential, error } = await admin.from('integration_oauth_credentials')
    .select('*').eq('connection_id', connectionId).eq('provider', provider).maybeSingle()
  if (error || !credential) throw new Error('Verified Google connector credential is unavailable')
  if (new Date(credential.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return decryptSecret(credential.access_token_ciphertext, credential.access_token_iv, config.encryptionMaterial)
  }

  const refreshToken = await decryptSecret(
    credential.refresh_token_ciphertext,
    credential.refresh_token_iv,
    config.encryptionMaterial,
  )
  const tokenResponse = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const tokens = await tokenResponse.json() as { access_token?: string; expires_in?: number; error?: string }
  if (!tokenResponse.ok || !tokens.access_token) {
    throw new Error(`Google token refresh failed (${tokens.error || tokenResponse.status})`)
  }
  const encrypted = await encryptSecret(tokens.access_token, config.encryptionMaterial)
  const expiresIn = Number(tokens.expires_in)
  const expiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000).toISOString()
  const { error: updateError } = await admin.from('integration_oauth_credentials').update({
    access_token_ciphertext: encrypted.ciphertext,
    access_token_iv: encrypted.iv,
    access_token_expires_at: expiresAt,
  }).eq('connection_id', connectionId)
  if (updateError) throw updateError
  return tokens.access_token
}
