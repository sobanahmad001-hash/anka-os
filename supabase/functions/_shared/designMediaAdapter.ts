// Server-only adapter for @higgsfield/client 0.2.6 /v2. Inject the official
// createHiggsfieldClient export; never its global config/singleton.
// A caller MUST first obtain the shared durable dispatch claim. This transport
// is not a job ledger, authorization check, budget reservation or retry policy.
export const SEEDANCE_MODEL = 'bytedance/seedance-2.5/text-to-video'
type Input = { prompt: string; duration: number; resolution: string; aspect_ratio: string;
  output_format: string; generate_audio: boolean }
type Client = { subscribe(endpoint: string, options: { input: Input; withPolling: boolean }): Promise<unknown> }
export type SdkFactory = (config: { credentials: string; maxRetries: number; timeout: number; baseURL: string }) => Client
export type MediaReceipt = { state: 'pending' | 'provider_completed' | 'provider_failed' | 'safety_refused'; requestId: string; outputUrl?: string }
const requestIdPattern = /^[a-zA-Z0-9_-]{1,128}$/

function normalize(raw: unknown, expectedId?: string): MediaReceipt {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid provider receipt')
  const row = raw as Record<string, unknown>
  if (typeof row.request_id !== 'string' || !requestIdPattern.test(row.request_id)
    || (expectedId && row.request_id !== expectedId)) throw new Error('Invalid provider receipt')
  const base = { requestId: row.request_id }
  if (row.status === 'queued' || row.status === 'in_progress') return { ...base, state: 'pending' }
  if (row.status === 'failed') return { ...base, state: 'provider_failed' }
  if (row.status === 'nsfw') return { ...base, state: 'safety_refused' }
  if (row.status !== 'completed') throw new Error('Invalid provider receipt')
  const video = row.video as Record<string, unknown> | undefined
  if (!video || typeof video.url !== 'string' || video.url.length > 4096) throw new Error('Missing video output')
  const url = new URL(video.url)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid video output')
  // URL is untrusted provider metadata, never fetched here. The shared output
  // ingestion owner must validate destination/content and store private bytes.
  return { ...base, state: 'provider_completed', outputUrl: video.url }
}

function validate(input: Input): Input {
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12000
    || !Number.isInteger(input.duration) || input.duration < 4 || input.duration > 30
    || !['480p', '720p'].includes(input.resolution)
    || !['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].includes(input.aspect_ratio)
    || !['mp4', 'mov'].includes(input.output_format) || typeof input.generate_audio !== 'boolean') {
    throw new Error('Unsupported Seedance request')
  }
  // Allowlist fields so credentials, webhook URLs and unrelated browser input
  // can never be forwarded through a spread operation.
  return { prompt: input.prompt.trim(), duration: input.duration, resolution: input.resolution,
    aspect_ratio: input.aspect_ratio, output_format: input.output_format, generate_audio: input.generate_audio }
}

export function createDesignMediaAdapter(createClient: SdkFactory, credential: string, read: typeof fetch = fetch) {
  if (typeof credential !== 'string' || !/^[^\s:]+:[^\s:]+$/.test(credential)) throw new Error('Media credential unavailable')
  const client = createClient({ credentials: credential, maxRetries: 0, timeout: 30000, baseURL: 'https://api.higgsfield.ai' })
  return {
    async submit(input: Input): Promise<MediaReceipt> {
      const pinned = validate(input)
      try {
        return normalize(await client.subscribe(SEEDANCE_MODEL, { input: pinned, withPolling: false }))
      } catch {
        // SDK/Axios errors may contain request headers, credentials or prompts.
        throw new Error('Media submission outcome unknown; reconcile before resubmission')
      }
    },
    async status(requestId: string): Promise<MediaReceipt> {
      if (!requestIdPattern.test(requestId)) throw new Error('Invalid provider request identity')
      try {
        // Reconstruct a trusted URL; never follow provider-supplied status_url.
        const response = await read(`https://api.higgsfield.ai/requests/${requestId}/status`, {
          method: 'GET', headers: { Authorization: `Key ${credential}` },
          redirect: 'error', signal: AbortSignal.timeout(30000),
        })
        if (!response.ok) throw new Error('Status unavailable')
        return normalize(await response.json(), requestId)
      } catch {
        throw new Error('Media status unavailable; retain the original request identity')
      }
    },
  }
}
