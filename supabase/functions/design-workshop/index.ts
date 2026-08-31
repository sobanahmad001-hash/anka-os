import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { compileApprovedArtifactContext, stableJson } from '../_shared/approvedArtifactContext.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const MEDIA_BUCKET = 'design-generated-media'
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
export const VIDEO_UNAVAILABLE_MESSAGE = 'Video generation is not yet configured. An API key and provider need to be added before this works.'
const ARTIFACT_TYPES = new Set(['discovery', 'vision', 'audience'])
const OUTPUT_FAMILIES = new Set(['brand_identity', 'website_design', 'marketing_asset', 'video_motion'])
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const LANES = [
  { key: 'clarity', direction: 'Restrained, editorial and trust-led. Prioritise clarity, hierarchy and disciplined use of brand equity.' },
  { key: 'expression', direction: 'Expressive, memorable and concept-led. Use a bold visual territory without compromising accessibility.' },
  { key: 'utility', direction: 'Pragmatic, modular and conversion-aware. Prioritise reusable systems and production feasibility.' },
] as const
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function text(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function strings(value: unknown, maxItems = 12) {
  return Array.isArray(value)
    ? value.map(item => text(item, 500)).filter(Boolean).slice(0, maxItems)
    : []
}

function directionText(direction: Json) {
  return [direction.title, direction.rationale, direction.creative_thesis,
    ...(Array.isArray(direction.visual_principles) ? direction.visual_principles : []),
    direction.imagery_direction, direction.layout_direction].map(item => text(item, 2000)).join(' ')
}

function tokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(item => item.length > 3))
}

export function similarity(left: Json, right: Json) {
  const a = tokens(directionText(left)); const b = tokens(directionText(right))
  const intersection = [...a].filter(item => b.has(item)).length
  const union = new Set([...a, ...b]).size
  return union ? intersection / union : 1
}

export function directionsAreDistinct(directions: Json[], threshold = 0.62) {
  for (let i = 0; i < directions.length; i += 1) {
    for (let j = i + 1; j < directions.length; j += 1) {
      if (similarity(directions[i], directions[j]) >= threshold) return false
    }
  }
  return true
}

export function directionSchema() {
  const stringArray = { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 }
  return {
    type: 'json_schema', name: 'anka_design_direction', strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['title', 'rationale', 'creative_thesis', 'visual_principles', 'palette', 'typography',
        'imagery_direction', 'layout_direction', 'audience_connection', 'discovery_connection',
        'channel_goal', 'accessibility_checks', 'production_feasibility', 'risks', 'open_questions', 'preview_spec'],
      properties: {
        title: { type: 'string' }, rationale: { type: 'string' }, creative_thesis: { type: 'string' },
        visual_principles: stringArray,
        palette: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'object', additionalProperties: false,
          required: ['name', 'hex', 'role'], properties: { name: { type: 'string' }, hex: { type: 'string' }, role: { type: 'string' } } } },
        typography: { type: 'object', additionalProperties: false, required: ['display', 'body', 'approach'],
          properties: { display: { type: 'string' }, body: { type: 'string' }, approach: { type: 'string' } } },
        imagery_direction: { type: 'string' }, layout_direction: { type: 'string' },
        audience_connection: { type: 'string' }, discovery_connection: { type: 'string' }, channel_goal: { type: 'string' },
        accessibility_checks: stringArray, production_feasibility: { type: 'string' }, risks: stringArray,
        open_questions: stringArray,
        preview_spec: { type: 'object', additionalProperties: false,
          required: ['background', 'surface', 'accent', 'heading_style', 'composition'],
          properties: { background: { type: 'string' }, surface: { type: 'string' }, accent: { type: 'string' },
            heading_style: { type: 'string' }, composition: { type: 'string' } } },
      },
    },
  }
}

function outputText(result: Json) {
  if (typeof result.output_text === 'string') return result.output_text
  const output = Array.isArray(result.output) ? result.output : []
  return output.flatMap(item => {
    if (!item || typeof item !== 'object' || !Array.isArray((item as Json).content)) return []
    return ((item as Json).content as unknown[]).flatMap(part =>
      part && typeof part === 'object' && (part as Json).type === 'output_text' && typeof (part as Json).text === 'string'
        ? [(part as Json).text as string] : [])
  }).join('\n')
}

async function requireUser(req: Request, url: string, anonKey: string, admin: Client) {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw new Error('Authentication required')
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw new Error('Authentication required')
  const { data: membership } = await admin.from('organization_memberships').select('organization_id, role, department_id')
    .eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id).eq('member_kind', 'team').eq('status', 'active').maybeSingle()
  if (!membership) throw new Error('Active team membership required')
  return { user, membership, userClient }
}

export function hasWorkshopAuthority(membership: Json, action: string) {
  const role = String(membership.role || ''); const department = String(membership.department_id || '')
  if (LEADER_ROLES.has(role)) return true
  if (action === 'release_direction') return department === 'design' && role === 'department_manager'
  if (action === 'promote_direction_experiment' || action === 'list_experiment_reviewers' || action === 'sign_media_assets') return true
  return department === 'design'
}

function uniqueIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => text(item, 80)).filter(Boolean))].slice(0, 50)
    : []
}

function supportsOutput(model: Json, outputType: string) {
  return Array.isArray(model.supported_output_types)
    && model.supported_output_types.includes(outputType)
}

export function mediaPrompt(content: Json, requested: unknown) {
  const explicit = text(requested, 6000)
  if (explicit) return explicit
  const imagery = text(content.imagery_direction, 3000)
  const thesis = text(content.creative_thesis, 3000)
  return text([imagery, thesis].filter(Boolean).join('\n\n'), 6000)
}

export function mediaStoragePath(versionId: string, assetId: string) {
  return `${ORGANIZATION_ID}/${versionId}/${assetId}.png`
}

export function designEventLink(sessionId: string, externalEventId: string, actorId: string) {
  return {
    id: sessionId, organization_id: ORGANIZATION_ID, external_event_id: externalEventId,
    content_type: 'design_asset', linked_work_item_id: null, lead_time_days: 0,
    status: 'in_progress', created_by: actorId,
  }
}

async function insertEvent(admin: Client, engagementId: string, eventType: string, actorId: string,
  recordType: string, recordId: string, versionId: string, action: string) {
  const { error } = await admin.from('engagement_events').insert({
    organization_id: ORGANIZATION_ID, engagement_id: engagementId, event_type: eventType, actor_id: actorId,
    payload: { record_type: recordType, record_id: recordId, version_id: versionId, action },
  })
  if (error) throw error
}

async function validateScope(admin: Client, engagementId: string, brandId: string, stageId?: string | null) {
  const { data: engagement } = await admin.from('engagements').select('id, brand_id, engagement_type')
    .eq('id', engagementId).eq('organization_id', ORGANIZATION_ID).eq('brand_id', brandId).maybeSingle()
  if (!engagement) throw new Error('Engagement and brand are unavailable')
  if (stageId) {
    const { data: stage } = await admin.from('engagement_stage_instances').select('id').eq('id', stageId)
      .eq('engagement_id', engagementId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
    if (!stage) throw new Error('The selected stage is outside this engagement')
  }
  return engagement
}

async function createSession(admin: Client, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80); const brandId = text(body.brand_id, 80)
  const stageId = text(body.engagement_stage_instance_id, 80) || null
  const outputFamily = text(body.output_family, 60)
  if (!OUTPUT_FAMILIES.has(outputFamily)) throw new Error('Unsupported output family')
  await validateScope(admin, engagementId, brandId, stageId)
  const externalEventId = text(body.external_event_id, 80) || null
  if (externalEventId) {
    const { data: externalEvent, error: externalEventError } = await admin.from('external_events').select('id')
      .eq('id', externalEventId).eq('organization_id', ORGANIZATION_ID).eq('brand_id', brandId).maybeSingle()
    if (externalEventError || !externalEvent) throw new Error('The selected external event is outside this brand')
  }
  const modelIds = Array.isArray(body.model_registry_ids)
    ? [...new Set(body.model_registry_ids.map(value => text(value, 80)).filter(Boolean))].slice(0, 3) : []
  if (!modelIds.length) throw new Error('Select at least one registered model')
  const { data: models, error: modelError } = await admin.from('design_model_registry').select('*')
    .eq('organization_id', ORGANIZATION_ID).eq('is_active', true).in('id', modelIds)
  if (modelError || models?.length !== modelIds.length) throw new Error('One or more selected models are unavailable')
  if (models.some(model => !supportsOutput(model, 'design_direction'))) {
    throw new Error('Direction sessions require models registered for design direction output')
  }
  const { selected, manifest: contextManifest } = await compileApprovedArtifactContext(admin, {
    organizationId: ORGANIZATION_ID,
    engagementId,
    brandId,
    artifactTypes: [...ARTIFACT_TYPES],
    requireAiSafe: true,
  })
  const outputBrief = body.output_brief && typeof body.output_brief === 'object' && !Array.isArray(body.output_brief)
    ? body.output_brief as Json : {}
  const designerInstructions = text(body.designer_instructions, 6000)
  if (!designerInstructions || body.instructions_safe_for_ai !== true) {
    throw new Error('Designer instructions must be present and explicitly safe for AI use')
  }
  const checksum = await sha256(stableJson(contextManifest))
  const sessionId = crypto.randomUUID()
  const { data: session, error: sessionError } = await admin.from('design_workshop_sessions').insert({
    id: sessionId, organization_id: ORGANIZATION_ID, engagement_id: engagementId, brand_id: brandId,
    engagement_stage_instance_id: stageId, output_family: outputFamily, output_brief: outputBrief,
    designer_instructions: designerInstructions, context_manifest: contextManifest,
    context_checksum: checksum, created_by: actorId,
  }).select('*').single()
  if (sessionError) throw sessionError
  try {
    const { error: contextError } = await admin.from('design_workshop_context_versions').insert(selected.map(({ artifact, approval, version }) => ({
      organization_id: ORGANIZATION_ID, session_id: session.id, artifact_id: artifact.id,
      artifact_version_id: version.id, artifact_approval_id: approval.id, artifact_type: artifact.artifact_type,
    })))
    if (contextError) throw contextError
    const { error: selectionError } = await admin.from('design_workshop_model_selections').insert(modelIds.map((id, index) => ({
      organization_id: ORGANIZATION_ID, session_id: session.id, model_registry_id: id, position: index + 1,
    })))
    if (selectionError) throw selectionError
    if (externalEventId) {
      const { error: linkError } = await admin.from('content_event_links')
        .insert(designEventLink(session.id, externalEventId, actorId))
      if (linkError) throw linkError
    }
  } catch (error) {
    await admin.from('design_workshop_sessions').delete().eq('id', session.id)
    throw error
  }
  return session
}

async function resolveOpenAi(admin: Client, engagementId: string) {
  const { data: mappings, error: mappingError } = await admin.from('integration_connection_engagements')
    .select('connection_id').eq('organization_id', ORGANIZATION_ID).eq('engagement_id', engagementId).eq('department_id', 'design')
  if (mappingError) throw mappingError
  const connectionIds = (mappings || []).map(item => item.connection_id)
  if (!connectionIds.length) throw new Error('A verified OpenAI connector must be mapped to this engagement and Design')
  const { data: connection, error } = await admin.from('integration_connections').select('id, provider, status, secret_name')
    .eq('organization_id', ORGANIZATION_ID).eq('provider', 'openai').eq('status', 'verified')
    .is('archived_at', null).in('id', connectionIds).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const secretName = connection?.secret_name || ''
  const credential = secretName ? Deno.env.get(secretName) : null
  if (!connection || !credential) throw new Error('The verified Design OpenAI connector credential is unavailable')
  return { connectionId: connection.id, credential }
}

async function generateOne(admin: Client, session: any, model: any, lane: typeof LANES[number], slot: number,
  actorId: string, credential: string, previous: Json[]) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { data: run, error: runError } = await admin.from('design_generation_runs').insert({
      organization_id: ORGANIZATION_ID, engagement_id: session.engagement_id, session_id: session.id,
      model_registry_id: model.id, provider: model.provider, model_id: model.model_id,
      direction_slot: slot, attempt_number: attempt, status: 'running',
      input_manifest_checksum: session.context_checksum,
      parameters: { lane: lane.key, structured_output: 'anka_design_direction_v1', store: false }, created_by: actorId,
    }).select('*').single()
    if (runError) throw runError
    try {
      const differentiation = previous.length
        ? `Existing directions that this output must be materially different from: ${JSON.stringify(previous.map(item => ({ title: item.title, thesis: item.creative_thesis, principles: item.visual_principles })))}`
        : 'This is the first direction.'
      const apiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.model_id, store: false, safety_identifier: await sha256(actorId),
          metadata: { anka_session_id: session.id, anka_run_id: run.id, direction_slot: String(slot) },
          instructions: 'You are assisting an accountable designer. Produce one traceable visual design direction, not a final approved asset. Follow the JSON schema exactly. Do not claim approval.',
          input: `APPROVED CONTEXT MANIFEST\n${JSON.stringify(session.context_manifest)}\n\nOUTPUT FAMILY\n${session.output_family}\n\nOUTPUT BRIEF\n${JSON.stringify(session.output_brief)}\n\nDESIGNER INSTRUCTIONS\n${session.designer_instructions}\n\nMANDATORY DIRECTION LANE\n${lane.direction}\n\n${differentiation}`,
          text: { format: directionSchema() }, max_output_tokens: 2600,
        }),
      })
      const result = await apiResponse.json()
      if (!apiResponse.ok) throw new Error(result?.error?.message || 'OpenAI direction generation failed')
      const generated = JSON.parse(outputText(result)) as Json
      const duplicate = previous.some(item => similarity(item, generated) >= 0.62)
      const checksum = await sha256(stableJson(generated))
      await admin.from('design_generation_runs').update({
        status: duplicate ? 'rejected_duplicate' : 'completed', external_response_id: result.id || null,
        output_checksum: checksum, failure_reason: duplicate ? 'Similarity threshold rejected this output.' : '', completed_at: new Date().toISOString(),
      }).eq('id', run.id)
      if (!duplicate) return { generated, runId: run.id, checksum, signature: await sha256(directionText(generated).toLowerCase()) }
    } catch (error) {
      await admin.from('design_generation_runs').update({
        status: 'failed', failure_reason: error instanceof Error ? error.message.slice(0, 1000) : 'Generation failed',
        completed_at: new Date().toISOString(),
      }).eq('id', run.id)
      if (attempt === 2) throw error
    }
  }
  throw new Error('A duplicate direction was rejected twice; no duplicate was stored')
}

async function generateDirections(admin: Client, body: Json, actorId: string) {
  const sessionId = text(body.session_id, 80)
  const { data: session } = await admin.from('design_workshop_sessions').select('*')
    .eq('id', sessionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (!session || !['ready', 'generation_failed'].includes(session.status)) throw new Error('Session is not ready to generate')
  const { count } = await admin.from('design_directions').select('id', { count: 'exact', head: true }).eq('session_id', session.id)
  if (count) throw new Error('This session already has its three comparison directions')
  const { data: selections, error: selectionError } = await admin.from('design_workshop_model_selections').select('*')
    .eq('session_id', session.id).order('position')
  if (selectionError || !selections?.length) throw new Error('Session has no model routing')
  const modelIds = selections.map(item => item.model_registry_id)
  const { data: models, error: modelError } = await admin.from('design_model_registry').select('*').in('id', modelIds).eq('is_active', true)
  if (modelError || !models?.length) throw new Error('Selected models are unavailable')
  const modelById = new Map(models.map(item => [item.id, item]))
  const orderedModels = selections.map(item => modelById.get(item.model_registry_id)).filter(Boolean)
  if (orderedModels.length !== selections.length || orderedModels.some(model => !supportsOutput(model, 'design_direction'))) {
    throw new Error('One or more selected models no longer support design direction output')
  }
  if (orderedModels.some(model => model.provider !== 'openai')) throw new Error('No installed adapter exists for one selected provider')
  const { credential } = await resolveOpenAi(admin, session.engagement_id)
  await admin.from('design_workshop_sessions').update({ status: 'generating' }).eq('id', session.id)
  try {
    const outputs: Array<{ generated: Json; runId: string; checksum: string; signature: string }> = []
    for (let index = 0; index < LANES.length; index += 1) {
      outputs.push(await generateOne(admin, session, orderedModels[index % orderedModels.length], LANES[index], index + 1,
        actorId, credential, outputs.map(item => item.generated)))
    }
    if (!directionsAreDistinct(outputs.map(item => item.generated))) throw new Error('Distinctness gate rejected the generated set')
    const { data: directions, error: directionError } = await admin.from('design_directions').insert(outputs.map((_, index) => ({
      organization_id: ORGANIZATION_ID, session_id: session.id, direction_slot: index + 1,
    }))).select('*')
    if (directionError) throw directionError
    const bySlot = new Map((directions || []).map(item => [item.direction_slot, item]))
    const { data: versions, error: versionError } = await admin.from('design_direction_versions').insert(outputs.map((item, index) => ({
      organization_id: ORGANIZATION_ID, direction_id: bySlot.get(index + 1).id, version_number: 1,
      generation_run_id: item.runId, content: item.generated, content_checksum: item.checksum,
      distinctness_signature: item.signature, created_by: actorId,
    }))).select('*')
    if (versionError) throw versionError
    await admin.from('design_workshop_sessions').update({ status: 'comparison' }).eq('id', session.id)
    return { directions, versions }
  } catch (error) {
    await admin.from('design_directions').delete().eq('session_id', session.id)
    await admin.from('design_workshop_sessions').update({ status: 'generation_failed' }).eq('id', session.id)
    throw error
  }
}

async function loadPermittedDirectionVersion(userClient: Client, directionVersionId: string) {
  const { data: version, error: versionError } = await userClient.from('design_direction_versions').select('*')
    .eq('id', directionVersionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (versionError) throw versionError
  if (!version) throw new Error('Direction version not found or not visible to this reviewer')
  const { data: direction, error: directionError } = await userClient.from('design_directions').select('id, session_id')
    .eq('id', version.direction_id).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (directionError) throw directionError
  const { data: session, error: sessionError } = direction
    ? await userClient.from('design_workshop_sessions').select('id, engagement_id').eq('id', direction.session_id)
      .eq('organization_id', ORGANIZATION_ID).maybeSingle()
    : { data: null, error: null }
  if (sessionError) throw sessionError
  if (!direction || !session) throw new Error('Direction version has no accessible Workshop session')
  return { version, direction, session }
}

export async function generateOpenAiImage(credential: string, modelId: string, prompt: string,
  fetcher: typeof fetch = fetch) {
  const apiResponse = await fetcher(OPENAI_IMAGES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, prompt }),
  })
  const result = await apiResponse.json() as Json
  if (!apiResponse.ok) {
    const apiError = result.error && typeof result.error === 'object' ? result.error as Json : {}
    throw new Error(text(apiError.message, 1000) || 'OpenAI image generation failed')
  }
  const first = Array.isArray(result.data) ? result.data[0] as Json | undefined : undefined
  const encoded = text(first?.b64_json, 20_000_000)
  if (!encoded) throw new Error('OpenAI image generation returned no image data')
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Generated image exceeds the 10 MB storage limit')
  return bytes
}

async function generateImage(admin: Client, userClient: Client, body: Json, actorId: string) {
  const directionVersionId = text(body.direction_version_id, 80)
  const modelRegistryId = text(body.model_registry_id, 80)
  const { version, session } = await loadPermittedDirectionVersion(userClient, directionVersionId)
  const prompt = mediaPrompt((version.content as Json) || {}, body.prompt)
  if (!prompt) throw new Error('Add an image prompt or complete the direction imagery and creative thesis')
  const { data: model, error: modelError } = await admin.from('design_model_registry').select('*')
    .eq('id', modelRegistryId).eq('organization_id', ORGANIZATION_ID).eq('is_active', true).maybeSingle()
  if (modelError) throw modelError
  if (!model || !supportsOutput(model, 'image')) throw new Error('Select an active image-capable model from the Design registry')
  if (model.provider !== 'openai') throw new Error('No installed image adapter exists for the selected provider')
  const { credential } = await resolveOpenAi(admin, session.engagement_id)
  const { data: asset, error: assetError } = await admin.from('design_media_assets').insert({
    organization_id: ORGANIZATION_ID, design_direction_version_id: version.id,
    media_type: 'image', status: 'generating', model_registry_id: model.id,
    provider: model.provider, prompt, generated_by: actorId,
  }).select('*').single()
  if (assetError) throw assetError
  const storagePath = mediaStoragePath(version.id, asset.id)
  let uploaded = false
  try {
    const bytes = await generateOpenAiImage(credential, model.model_id, prompt)
    const { error: uploadError } = await admin.storage.from(MEDIA_BUCKET).upload(storagePath, bytes, {
      contentType: 'image/png', upsert: false,
    })
    if (uploadError) throw uploadError
    uploaded = true
    const { data: ready, error: readyError } = await admin.from('design_media_assets').update({
      status: 'ready', storage_path: storagePath, failure_reason: '',
    }).eq('id', asset.id).eq('organization_id', ORGANIZATION_ID).select('*').single()
    if (readyError) throw readyError
    return ready
  } catch (error) {
    if (uploaded) await admin.storage.from(MEDIA_BUCKET).remove([storagePath])
    const failureReason = error instanceof Error ? error.message.slice(0, 2000) : 'Image generation failed'
    const { data: failed } = await admin.from('design_media_assets').update({
      status: 'failed', storage_path: null, failure_reason: failureReason,
    }).eq('id', asset.id).eq('organization_id', ORGANIZATION_ID).select('*').single()
    return failed || { ...asset, status: 'failed', failure_reason: failureReason }
  }
}

async function createVideoPlaceholder(admin: Client, userClient: Client, body: Json, actorId: string) {
  const directionVersionId = text(body.direction_version_id, 80)
  const { version } = await loadPermittedDirectionVersion(userClient, directionVersionId)
  const prompt = mediaPrompt((version.content as Json) || {}, body.prompt)
  if (!prompt) throw new Error('Add a video prompt or complete the direction imagery and creative thesis')
  const { data, error } = await admin.from('design_media_assets').insert({
    organization_id: ORGANIZATION_ID, design_direction_version_id: version.id,
    media_type: 'video', status: 'unavailable', prompt,
    failure_reason: VIDEO_UNAVAILABLE_MESSAGE, generated_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function signMediaAssets(admin: Client, userClient: Client, body: Json) {
  const assetIds = uniqueIds(body.asset_ids)
  if (!assetIds.length) return { signed_urls: {}, expires_in: 300 }
  const { data: assets, error } = await userClient.from('design_media_assets').select('id, storage_path')
    .in('id', assetIds).eq('media_type', 'image').eq('status', 'ready')
  if (error) throw error
  const signable = (assets || []).filter(asset => asset.storage_path)
  if (!signable.length) return { signed_urls: {}, expires_in: 300 }
  const { data: signed, error: signedError } = await admin.storage.from(MEDIA_BUCKET)
    .createSignedUrls(signable.map(asset => asset.storage_path), 300)
  if (signedError) throw signedError
  const signedUrls = Object.fromEntries(signable.map((asset, index) => [asset.id, signed?.[index]?.signedUrl || null]))
  return { signed_urls: signedUrls, expires_in: 300 }
}

async function validateExperimentReviewers(admin: Client, reviewerIds: string[], actorId: string) {
  const invited = reviewerIds.filter(id => id !== actorId)
  if (!invited.length) return []
  const { data, error } = await admin.from('organization_memberships').select('user_id')
    .eq('organization_id', ORGANIZATION_ID).eq('member_kind', 'team').eq('status', 'active').in('user_id', invited)
  if (error) throw error
  if (data?.length !== invited.length) throw new Error('Every experiment reviewer must be an active team member')
  return invited
}

async function insertDirectionVersion(admin: Client, directionId: string, parent: any, content: Json,
  actorId: string, isExperimental: boolean, experimentVisibility: string[] | null) {
  const { data: latest, error: latestError } = await admin.from('design_direction_versions').select('version_number')
    .eq('direction_id', directionId).order('version_number', { ascending: false }).limit(1).single()
  if (latestError) throw latestError
  const checksum = await sha256(stableJson(content))
  const { data: version, error } = await admin.from('design_direction_versions').insert({
    organization_id: ORGANIZATION_ID, direction_id: directionId, version_number: latest.version_number + 1,
    parent_version_id: parent.id, content, content_checksum: checksum,
    distinctness_signature: await sha256(directionText(content).toLowerCase()), created_by: actorId,
    is_experimental: isExperimental, experiment_visibility: isExperimental ? experimentVisibility : null,
  }).select('*').single()
  if (error) throw error
  return version
}

async function createDirectionRevision(admin: Client, body: Json, actorId: string) {
  const directionId = text(body.direction_id, 80)
  const { data: direction } = await admin.from('design_directions').select('id, session_id')
    .eq('id', directionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (!direction) throw new Error('Direction not found')
  const parentId = text(body.parent_version_id, 80)
  const { data: parent } = await admin.from('design_direction_versions').select('id, direction_id, is_experimental')
    .eq('id', parentId).eq('direction_id', direction.id).maybeSingle()
  if (!parent) throw new Error('Parent direction version not found')
  if (parent.is_experimental) throw new Error('Use the dedicated promotion action for an experimental version')
  const content = body.content && typeof body.content === 'object' && !Array.isArray(body.content) ? body.content as Json : null
  if (!content || !text(content.title) || !text(content.rationale)) throw new Error('A complete direction revision is required')
  const isExperimental = body.is_experimental === true
  const reviewers = isExperimental
    ? await validateExperimentReviewers(admin, uniqueIds(body.experiment_visibility), actorId)
    : null
  return insertDirectionVersion(admin, direction.id, parent, content, actorId, isExperimental, reviewers)
}

async function listExperimentReviewers(admin: Client, membership: Json) {
  const role = text(membership.role, 60)
  if (text(membership.department_id, 60) !== 'design' && !LEADER_ROLES.has(role)) return []
  const { data: memberships, error } = await admin.from('organization_memberships').select('user_id, role, department_id')
    .eq('organization_id', ORGANIZATION_ID).eq('member_kind', 'team').eq('status', 'active').order('department_id')
  if (error) throw error
  const ids = (memberships || []).map(item => item.user_id)
  const { data: profiles, error: profileError } = ids.length
    ? await admin.from('profiles').select('id, full_name').in('id', ids)
    : { data: [], error: null }
  if (profileError) throw profileError
  const names = new Map((profiles || []).map(item => [item.id, item.full_name]))
  return (memberships || []).map(item => ({ ...item, full_name: names.get(item.user_id) || 'Team member' }))
}

async function promoteDirectionExperiment(admin: Client, body: Json, actorId: string) {
  const versionId = text(body.direction_version_id, 80)
  const { data: experiment, error } = await admin.from('design_direction_versions').select('*')
    .eq('id', versionId).eq('organization_id', ORGANIZATION_ID).eq('is_experimental', true).maybeSingle()
  if (error) throw error
  if (!experiment) throw new Error('Experimental direction version not found')
  const invited = Array.isArray(experiment.experiment_visibility) ? experiment.experiment_visibility : []
  if (experiment.created_by !== actorId && !invited.includes(actorId)) {
    throw new Error('Only the experiment creator or an invited reviewer can promote it')
  }
  return insertDirectionVersion(admin, experiment.direction_id, experiment, experiment.content, actorId, false, null)
}

async function selectDirection(admin: Client, body: Json, actorId: string) {
  const sessionId = text(body.session_id, 80); const versionId = text(body.direction_version_id, 80)
  const { data: session } = await admin.from('design_workshop_sessions').select('id, engagement_id')
    .eq('id', sessionId).eq('organization_id', ORGANIZATION_ID).eq('status', 'comparison').maybeSingle()
  if (!session) throw new Error('Session is not ready for selection')
  const { data: version } = await admin.from('design_direction_versions').select('id, direction_id').eq('id', versionId)
    .eq('is_experimental', false).maybeSingle()
  const { data: direction } = version
    ? await admin.from('design_directions').select('id').eq('id', version.direction_id).eq('session_id', session.id).maybeSingle()
    : { data: null }
  if (!version || !direction) throw new Error('Direction version is outside this session')
  const { data, error } = await admin.from('design_direction_selections').insert({
    organization_id: ORGANIZATION_ID, engagement_id: session.engagement_id, session_id: session.id,
    direction_version_id: version.id, notes: text(body.notes, 2000), selected_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function releaseDirection(admin: Client, body: Json, actorId: string) {
  const sessionId = text(body.session_id, 80)
  const { data: session } = await admin.from('design_workshop_sessions').select('id, engagement_id')
    .eq('id', sessionId).eq('organization_id', ORGANIZATION_ID).eq('status', 'comparison').maybeSingle()
  const { data: selection } = session
    ? await admin.from('design_direction_selections').select('*').eq('session_id', session.id).maybeSingle()
    : { data: null }
  if (!session || !selection) throw new Error('A human-selected direction is required before release')
  const { data: version } = await admin.from('design_direction_versions').select('id, direction_id')
    .eq('id', selection.direction_version_id).eq('is_experimental', false).maybeSingle()
  if (!version) throw new Error('Selected direction version is unavailable')
  const { data: release, error } = await admin.from('design_direction_releases').insert({
    organization_id: ORGANIZATION_ID, engagement_id: session.engagement_id, session_id: session.id,
    direction_version_id: version.id, release_notes: text(body.release_notes, 2000), released_by: actorId,
  }).select('*').single()
  if (error) throw error
  await admin.from('design_workshop_sessions').update({ status: 'released' }).eq('id', session.id)
  await insertEvent(admin, session.engagement_id, 'design_direction_released', actorId,
    'design_direction', version.direction_id, version.id, 'released')
  return release
}

async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL') || ''; const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !anonKey || !serviceKey) throw new Error('Supabase function configuration is incomplete')
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { user, membership, userClient } = await requireUser(req, url, anonKey, admin)
    const body = await req.json() as Json
    const action = text(body.action, 80)
    const actions: Record<string, () => Promise<unknown>> = {
      create_session: () => createSession(admin, body, user.id),
      generate_directions: () => generateDirections(admin, body, user.id),
      create_direction_revision: () => createDirectionRevision(admin, body, user.id),
      list_experiment_reviewers: () => listExperimentReviewers(admin, membership as Json),
      promote_direction_experiment: () => promoteDirectionExperiment(admin, body, user.id),
      select_direction: () => selectDirection(admin, body, user.id),
      release_direction: () => releaseDirection(admin, body, user.id),
      generate_image: () => generateImage(admin, userClient, body, user.id),
      create_video_placeholder: () => createVideoPlaceholder(admin, userClient, body, user.id),
      sign_media_assets: () => signMediaAssets(admin, userClient, body),
    }
    if (!actions[action]) return response({ error: 'Unsupported action' }, 400)
    if (!hasWorkshopAuthority(membership as Json, action)) return response({ error: 'Your department role cannot perform this action' }, 403)
    return response({ data: await actions[action]() })
  } catch (error) {
    console.error('Design Workshop failure', error)
    return response({ error: error instanceof Error ? error.message : 'Design Workshop failed' }, 400)
  }
}

if (import.meta.main) Deno.serve(handler)

export { handler }
