import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { generateDesignVideo, getDesignVideoJob, getDesignVideoQuote } from './index.ts'

const org = '123e4567-e89b-42d3-a456-426614174000'
const actor = '123e4567-e89b-42d3-a456-426614174001'
const version = '123e4567-e89b-42d3-a456-426614174002'
const body = { direction_version_id: version, duration_seconds: 5,
  resolution: '720p', aspect_ratio: '16:9', output_format: 'mp4',
  generate_audio: false }
const quote = () => ({
  id: '123e4567-e89b-42d3-a456-426614174003',
  provider: 'higgsfield', model_id: 'bytedance/seedance-2.5/text-to-video',
  duration_seconds: 5, resolution: '720p', aspect_ratio: '16:9',
  output_format: 'mp4', generate_audio: false, currency: 'USD',
  max_charge_microusd: 1800000,
  source_url: 'https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video',
  verified_at: new Date(Date.now() - 60000).toISOString(),
  valid_until: new Date(Date.now() + 3600000).toISOString(),
})

Deno.test('Design quote readiness binds exact server RPC and keeps paid execution off', async () => {
  const calls: unknown[] = []
  const admin = { organizationId: org, rpc: async (name: string, args: unknown) => {
    calls.push([name, args])
    return { data: { quote: quote(), organization_cap_configured: true }, error: null }
  } } as unknown as Parameters<typeof getDesignVideoQuote>[0]
  const result = await getDesignVideoQuote(admin, body, actor)
  assertEquals(result.paid_execution_enabled, false)
  assertEquals(result.quote && (result.quote as { max_charge_microusd: number }).max_charge_microusd, 1800000)
  assertEquals(calls, [['get_design_video_quote', {
    p_organization_id: org, p_direction_version_id: version, p_actor_id: actor,
    p_duration_seconds: 5, p_resolution: '720p', p_aspect_ratio: '16:9',
    p_output_format: 'mp4', p_generate_audio: false,
  }]])
})

Deno.test('Design quote readiness fails closed on stale price and invalid settings', async () => {
  let calls = 0
  const admin = { organizationId: org, rpc: async () => {
    calls++
    return { data: { quote: { ...quote(), valid_until: new Date(Date.now() - 1000).toISOString() },
      organization_cap_configured: true }, error: null }
  } } as unknown as Parameters<typeof getDesignVideoQuote>[0]
  await assertRejects(() => getDesignVideoQuote(admin, body, actor))
  await assertRejects(() => getDesignVideoQuote(admin, { ...body, resolution: '1080p' }, actor))
  assertEquals(calls, 1)
})

Deno.test('owner job status hides claim, provider receipt, prompt, and storage identity', async () => {
  const jobId = '123e4567-e89b-42d3-a456-426614174004'
  const admin = { organizationId: org, rpc: async (name: string, args: unknown) => {
    assertEquals(name,'get_design_video_job')
    assertEquals(args,{ p_organization_id: org, p_job_id: jobId, p_actor_id: actor })
    return { data: {
      id: jobId, direction_version_id: version, status: 'provider_pending',
      mode: 'explore', duration_seconds: 5, resolution: '720p',
      aspect_ratio: '16:9', output_format: 'mp4', generate_audio: false,
      prompt: 'private prompt', dispatch_claim_id: 'claim-secret',
      provider_request_id: 'provider-secret', provider_status_url: 'https://api.higgsfield.ai/secret',
      provider_output_url: 'https://private.vendor.example/signed?token=secret',
      output_storage_path: 'private/storage', created_at: '2026-09-24T00:00:00Z',
    }, error: null }
  } } as unknown as Parameters<typeof getDesignVideoJob>[0]
  const visible = await getDesignVideoJob(admin,{ job_id: jobId },actor)
  assertEquals(visible.status,'provider_pending')
  for (const hidden of ['prompt','dispatch_claim_id','provider_request_id',
    'provider_status_url','provider_output_url','output_storage_path']) {
    assertEquals(Object.hasOwn(visible,hidden),false)
  }
})

Deno.test('disabled video execution makes no database or provider calls', async () => {
  const previous = Deno.env.get('DESIGN_VIDEO_PAID_EXECUTION_ENABLED')
  Deno.env.delete('DESIGN_VIDEO_PAID_EXECUTION_ENABLED')
  try {
    const admin = { organizationId: org,
      rpc: () => { throw new Error('Database must not be called') },
      from: () => { throw new Error('Connector must not be read') },
    } as unknown as Parameters<typeof generateDesignVideo>[0]
    await assertRejects(() => generateDesignVideo(admin, body, actor),
      Error, 'Video generation is not enabled')
  } finally {
    if (previous === undefined) Deno.env.delete('DESIGN_VIDEO_PAID_EXECUTION_ENABLED')
    else Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED', previous)
  }
})
