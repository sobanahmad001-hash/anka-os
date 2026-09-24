const MAX_BYTES = 50 * 1024 * 1024
const mimeByFormat: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime',
}

export async function fetchDesignVideoOutput(
  rawUrl: string, allowedHosts: string[], outputFormat: 'mp4' | 'mov',
  fetcher: typeof fetch = fetch, maxBytes = MAX_BYTES,
) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096
    || !Array.isArray(allowedHosts) || !allowedHosts.length
    || !mimeByFormat[outputFormat]
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) {
    throw new Error('Private video ingestion is unavailable')
  }
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('Invalid video output URL') }
  const host = url.hostname.toLowerCase()
  const publicHost = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(host)
    && host.includes('.') && !host.endsWith('.local')
    && host !== 'localhost' && !/^[0-9.]+$/.test(host)
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.hash || !publicHost || !allowedHosts.includes(host)) {
    throw new Error('Video output host is not approved')
  }
  const response = await fetcher(url.href, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Accept: mimeByFormat[outputFormat] },
  })
  if (!response.ok || (response.url && response.url !== url.href)) {
    throw new Error('Video output download failed')
  }
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const length = Number(response.headers.get('content-length'))
  if (contentType !== mimeByFormat[outputFormat]
    || (response.headers.has('content-length') && (!Number.isSafeInteger(length)
      || length < 1 || length > maxBytes))
    || !response.body) {
    throw new Error('Video output type or size is unsupported')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('Video output exceeds the private storage limit')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  if (total < 12) throw new Error('Video output is incomplete')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  if (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') {
    throw new Error('Video output signature is invalid')
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { bytes, contentType, byteLength: total, checksum }
}
