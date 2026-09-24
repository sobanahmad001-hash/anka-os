import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { ingestDesignVideoOutput, pollDesignVideoJob, signDesignVideoOutput } from './index.ts'

const org = '123e4567-e89b-42d3-a456-426614174000'
const actor = '123e4567-e89b-42d3-a456-426614174001'
const version = '123e4567-e89b-42d3-a456-426614174002'
const jobId = '123e4567-e89b-42d3-a456-426614174003'
const claim = '123e4567-e89b-42d3-a456-426614174004'
const path = `${org}/${version}/${jobId}/output.mp4`
const source = 'https://media.vendor.example/output.mp4?token=private'
const bytes = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109])
const job = { id: jobId, organization_id: org, direction_version_id: version,
  status: 'provider_completed', provider_output_url: source,
  dispatch_claim_id: claim, output_format: 'mp4' }

Deno.test('owner completion stores checked bytes at its exact private path', async () => {
  const prior = Deno.env.get('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS')
  Deno.env.set('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS', 'media.vendor.example')
  try {
    const calls: string[] = []
    const admin = { organizationId: org,
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push(name)
        if (name === 'get_design_video_job') {
          assertEquals(args.p_actor_id, actor)
          return { data: job, error: null }
        }
        assertEquals(name, 'complete_design_video_storage')
        assertEquals(args.p_storage_path, path)
        assertEquals(args.p_byte_length, bytes.length)
        assertEquals((args.p_sha256 as string).length, 64)
        return { data: { status: 'ready' }, error: null }
      },
      storage: { from: (bucket: string) => {
        assertEquals(bucket, 'design-generated-video')
        return { upload: async (actualPath: string, actualBytes: Uint8Array,
          options: { upsert: boolean, contentType: string }) => {
          calls.push('upload')
          assertEquals(actualPath, path)
          assertEquals(actualBytes, bytes)
          assertEquals(options, { contentType: 'video/mp4', upsert: false })
          return { error: null }
        } }
      } },
    } as unknown as Parameters<typeof ingestDesignVideoOutput>[0]
    const fetcher = (async (url: string) => {
      assertEquals(url, source)
      return new Response(new Uint8Array(bytes).buffer as ArrayBuffer,
        { headers: { 'content-type': 'video/mp4' } })
    }) as typeof fetch
    assertEquals(await ingestDesignVideoOutput(admin, { job_id: jobId }, actor, fetcher),
      { status: 'ready', job_id: jobId })
    assertEquals(calls, ['get_design_video_job','upload','complete_design_video_storage'])
  } finally {
    if (prior === undefined) Deno.env.delete('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS')
    else Deno.env.set('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS', prior)
  }
})

Deno.test('unapproved output host reaches neither network nor storage', async () => {
  const prior = Deno.env.get('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS')
  Deno.env.delete('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS')
  try {
    const admin = { organizationId: org,
      rpc: async () => ({ data: job, error: null }),
      storage: { from: () => { throw new Error('Storage must not be used') } },
    } as unknown as Parameters<typeof ingestDesignVideoOutput>[0]
    await assertRejects(() => ingestDesignVideoOutput(admin, { job_id: jobId }, actor,
      (async () => { throw new Error('Network must not be used') }) as typeof fetch))
  } finally {
    if (prior === undefined) Deno.env.delete('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS')
    else Deno.env.set('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS', prior)
  }
})

Deno.test('ready output signs only the actor-owned exact storage path', async () => {
  const admin = { organizationId: org,
    rpc: async () => ({ data: { ...job, status: 'ready', output_storage_path: path }, error: null }),
    storage: { from: () => ({ createSignedUrl: async (actualPath: string, seconds: number) => {
      assertEquals([actualPath, seconds], [path, 60])
      return { data: { signedUrl: 'https://storage.example/signed' }, error: null }
    } }) },
  } as unknown as Parameters<typeof signDesignVideoOutput>[0]
  assertEquals(await signDesignVideoOutput(admin, { job_id: jobId }, actor),
    { job_id: jobId, signed_url: 'https://storage.example/signed', expires_in: 60 })
})

Deno.test('recovery reads only the saved provider status URL and records its output', async () => {
  const prior = Deno.env.get('ANKA_HIGGSFIELD_OFFLINE_TEST')
  Deno.env.set('ANKA_HIGGSFIELD_OFFLINE_TEST', 'offline:placeholder')
  try {
    const requestId = 'offline-1'
    const statusUrl = `https://api.higgsfield.ai/requests/${requestId}/status`
    const pending = { ...job, status: 'provider_pending', provider_request_id: requestId,
      provider_status_url: statusUrl, connector_connection_id: claim }
    const query = {
      eq: () => query, is: () => query,
      maybeSingle: async () => ({ data: { id: claim, provider: 'higgsfield',
        status: 'verified', secret_name: 'ANKA_HIGGSFIELD_OFFLINE_TEST' }, error: null }),
    }
    let reads = 0
    const admin = { organizationId: org,
      from: (table: string) => {
        assertEquals(table, 'integration_connections')
        return { select: () => query }
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'get_design_video_job') return { data: reads ?
          { ...pending, status: 'provider_completed', provider_output_url: source } : pending,
          error: null }
        assertEquals(name, 'record_design_video_provider_state')
        assertEquals(args.p_provider_request_id, requestId)
        assertEquals(args.p_provider_status_url, statusUrl)
        assertEquals(args.p_provider_output_url, source)
        return { data: { status: 'provider_completed' }, error: null }
      },
    } as unknown as Parameters<typeof pollDesignVideoJob>[0]
    const reader = (async (url: string, options: RequestInit) => {
      assertEquals(url, statusUrl)
      assertEquals(options.method, 'GET')
      reads++
      return new Response(JSON.stringify({ request_id: requestId, status: 'completed',
        video: { url: source } }), { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const result = await pollDesignVideoJob(admin, { job_id: jobId }, actor, reader)
    assertEquals(result.status, 'provider_completed')
    assertEquals(Object.hasOwn(result, 'provider_output_url'), false)
    assertEquals(reads, 1)
  } finally {
    if (prior === undefined) Deno.env.delete('ANKA_HIGGSFIELD_OFFLINE_TEST')
    else Deno.env.set('ANKA_HIGGSFIELD_OFFLINE_TEST', prior)
  }
})
