import { createClient } from 'npm:@supabase/supabase-js@2.112.4'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function text(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function strings(value: unknown, maxItems = 12) {
  return Array.isArray(value)
    ? value.map(item => text(item, 500)).filter(Boolean).slice(0, maxItems)
    : []
}

export function validateArtifactContent(type: string, value: unknown): Json {
  if (!ARTIFACT_TYPES.has(type) || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unsupported artifact content')
  }
  const input = value as Json
  const fields: Record<string, string[]> = {
    discovery: ['summary', 'objectives', 'offers', 'evidence', 'constraints'],
    vision: ['vision_statement', 'positioning', 'value_proposition', 'values', 'voice_principles'],
    audience: ['primary_audience', 'segments', 'motivations', 'objections', 'desired_response', 'accessibility_considerations'],
  }
  const output: Json = {}
  for (const field of fields[type]) {
    const listField = !['summary', 'vision_statement', 'positioning', 'value_proposition', 'primary_audience', 'desired_response'].includes(field)
    output[field] = listField ? strings(input[field]) : text(input[field], 3000)
    if (listField ? !(output[field] as string[]).length : !output[field]) {
      throw new Error(`${field.replaceAll('_', ' ')} is required`)
    }
  }
  return output
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
  return { user, membership }
}

export function hasWorkshopAuthority(membership: Json, action: string) {
  const role = String(membership.role || ''); const department = String(membership.department_id || '')
  if (LEADER_ROLES.has(role)) return true
  if (action === 'save_artifact') return department === 'content'
  if (action === 'approve_artifact') return department === 'content' && role === 'department_manager'
  if (action === 'release_direction') return department === 'design' && role === 'department_manager'
  return department === 'design'
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

async function saveArtifact(admin: Client, body: Json, actorId: string) {
  const artifactType = text(body.artifact_type, 40)
  const engagementId = text(body.engagement_id, 80); const brandId = text(body.brand_id, 80)
  const stageId = text(body.engagement_stage_instance_id, 80) || null
  const content = validateArtifactContent(artifactType, body.content)
  await validateScope(admin, engagementId, brandId, stageId)
  let artifactId = text(body.artifact_id, 80)
  let createdArtifact = false
  let parentVersionId: string | null = null
  let versionNumber = 1
  if (artifactId) {
    const { data: artifact } = await admin.from('artifacts').select('id, artifact_type, engagement_id, brand_id')
      .eq('id', artifactId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
    if (!artifact || artifact.artifact_type !== artifactType || artifact.engagement_id !== engagementId || artifact.brand_id !== brandId) {
      throw new Error('Artifact identity does not match this engagement, brand and type')
    }
    const { data: latest } = await admin.from('artifact_versions').select('id, version_number')
      .eq('artifact_id', artifactId).order('version_number', { ascending: false }).limit(1).maybeSingle()
    if (latest) { parentVersionId = latest.id; versionNumber = latest.version_number + 1 }
  } else {
    const { data: artifact, error } = await admin.from('artifacts').insert({
      organization_id: ORGANIZATION_ID, brand_id: brandId, engagement_id: engagementId,
      engagement_stage_instance_id: stageId, artifact_type: artifactType,
      title: text(body.title, 240) || `${artifactType[0].toUpperCase()}${artifactType.slice(1)} artifact`, created_by: actorId,
    }).select('id').single()
    if (error) throw error
    artifactId = artifact.id
    createdArtifact = true
  }
  const checksum = await sha256(stableJson(content))
  const { data: version, error: versionError } = await admin.from('artifact_versions').insert({
    organization_id: ORGANIZATION_ID, artifact_id: artifactId, version_number: versionNumber,
    parent_version_id: parentVersionId, content, content_checksum: checksum,
    change_summary: text(body.change_summary, 1000), ai_use_allowed: body.ai_use_allowed === true,
    data_classification: ['public', 'internal', 'confidential', 'restricted'].includes(String(body.data_classification))
      ? body.data_classification : 'internal', created_by: actorId,
  }).select('*').single()
  if (versionError) {
    if (createdArtifact) await admin.from('artifacts').delete().eq('id', artifactId)
    throw versionError
  }
  await insertEvent(admin, engagementId, 'artifact_version_created', actorId, 'artifact', artifactId, version.id, 'version_created')
  return { artifact_id: artifactId, version }
}

async function approveArtifact(admin: Client, body: Json, actorId: string) {
  const versionId = text(body.artifact_version_id, 80)
  const { data: version } = await admin.from('artifact_versions').select('id, artifact_id')
    .eq('id', versionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (!version) throw new Error('Artifact version not found')
  const { data: artifact } = await admin.from('artifacts').select('id, engagement_id')
    .eq('id', version.artifact_id).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (!artifact?.engagement_id) throw new Error('This phase approves engagement-scoped artifacts only')
  const { data: approval, error } = await admin.from('artifact_approvals').insert({
    organization_id: ORGANIZATION_ID, artifact_id: artifact.id, artifact_version_id: version.id,
    engagement_id: artifact.engagement_id, notes: text(body.notes, 2000), approved_by: actorId,
  }).select('*').single()
  if (error) throw error
  await insertEvent(admin, artifact.engagement_id, 'artifact_approved', actorId, 'artifact', artifact.id, version.id, 'approved')
  return approval
}

async function createSession(admin: Client, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80); const brandId = text(body.brand_id, 80)
  const stageId = text(body.engagement_stage_instance_id, 80) || null
  const outputFamily = text(body.output_family, 60)
  if (!OUTPUT_FAMILIES.has(outputFamily)) throw new Error('Unsupported output family')
  await validateScope(admin, engagementId, brandId, stageId)
  const modelIds = Array.isArray(body.model_registry_ids)
    ? [...new Set(body.model_registry_ids.map(value => text(value, 80)).filter(Boolean))].slice(0, 3) : []
  if (!modelIds.length) throw new Error('Select at least one registered model')
  const { data: models, error: modelError } = await admin.from('design_model_registry').select('*')
    .eq('organization_id', ORGANIZATION_ID).eq('is_active', true).in('id', modelIds)
  if (modelError || models?.length !== modelIds.length) throw new Error('One or more selected models are unavailable')
  const { data: artifacts, error: artifactError } = await admin.from('artifacts').select('*')
    .eq('organization_id', ORGANIZATION_ID).eq('engagement_id', engagementId).eq('brand_id', brandId)
    .in('artifact_type', [...ARTIFACT_TYPES])
  if (artifactError) throw artifactError
  const artifactIds = (artifacts || []).map(item => item.id)
  const { data: approvals, error: approvalError } = artifactIds.length
    ? await admin.from('artifact_approvals').select('*').in('artifact_id', artifactIds).order('approved_at', { ascending: false })
    : { data: [], error: null }
  if (approvalError) throw approvalError
  const versionIds = (approvals || []).map(item => item.artifact_version_id)
  const { data: versions, error: versionError } = versionIds.length
    ? await admin.from('artifact_versions').select('*').in('id', versionIds)
    : { data: [], error: null }
  if (versionError) throw versionError
  const versionById = new Map((versions || []).map(item => [item.id, item]))
  const artifactById = new Map((artifacts || []).map(item => [item.id, item]))
  const selected: Array<{ artifact: any; approval: any; version: any }> = []
  for (const type of ARTIFACT_TYPES) {
    const approval = (approvals || []).find(item => artifactById.get(item.artifact_id)?.artifact_type === type)
    const artifact = approval ? artifactById.get(approval.artifact_id) : null
    const version = approval ? versionById.get(approval.artifact_version_id) : null
    if (!artifact || !version) throw new Error(`Approved ${type} context is required`)
    if (!version.ai_use_allowed || version.data_classification === 'restricted') {
      throw new Error(`Approved ${type} context is not authorised for AI use`)
    }
    selected.push({ artifact, approval, version })
  }
  const outputBrief = body.output_brief && typeof body.output_brief === 'object' && !Array.isArray(body.output_brief)
    ? body.output_brief as Json : {}
  const designerInstructions = text(body.designer_instructions, 6000)
  if (!designerInstructions || body.instructions_safe_for_ai !== true) {
    throw new Error('Designer instructions must be present and explicitly safe for AI use')
  }
  const contextManifest = {
    schema_version: 1, engagement_id: engagementId, brand_id: brandId,
    artifacts: Object.fromEntries(selected.map(({ artifact, approval, version }) => [artifact.artifact_type, {
      artifact_id: artifact.id, artifact_version_id: version.id, version_number: version.version_number,
      approval_id: approval.id, approved_at: approval.approved_at, content_checksum: version.content_checksum,
      content: version.content,
    }])),
  }
  const checksum = await sha256(stableJson(contextManifest))
  const { data: session, error: sessionError } = await admin.from('design_workshop_sessions').insert({
    organization_id: ORGANIZATION_ID, engagement_id: engagementId, brand_id: brandId,
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

async function createDirectionRevision(admin: Client, body: Json, actorId: string) {
  const directionId = text(body.direction_id, 80)
  const { data: direction } = await admin.from('design_directions').select('id, session_id')
    .eq('id', directionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (!direction) throw new Error('Direction not found')
  const { data: latest } = await admin.from('design_direction_versions').select('*').eq('direction_id', direction.id)
    .order('version_number', { ascending: false }).limit(1).single()
  const content = body.content && typeof body.content === 'object' && !Array.isArray(body.content) ? body.content as Json : null
  if (!content || !text(content.title) || !text(content.rationale)) throw new Error('A complete direction revision is required')
  const checksum = await sha256(stableJson(content))
  const { data: version, error } = await admin.from('design_direction_versions').insert({
    organization_id: ORGANIZATION_ID, direction_id: direction.id, version_number: latest.version_number + 1,
    parent_version_id: latest.id, content, content_checksum: checksum,
    distinctness_signature: await sha256(directionText(content).toLowerCase()), created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return version
}

async function selectDirection(admin: Client, body: Json, actorId: string) {
  const sessionId = text(body.session_id, 80); const versionId = text(body.direction_version_id, 80)
  const { data: session } = await admin.from('design_workshop_sessions').select('id, engagement_id')
    .eq('id', sessionId).eq('organization_id', ORGANIZATION_ID).eq('status', 'comparison').maybeSingle()
  if (!session) throw new Error('Session is not ready for selection')
  const { data: version } = await admin.from('design_direction_versions').select('id, direction_id').eq('id', versionId).maybeSingle()
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
    .eq('id', selection.direction_version_id).maybeSingle()
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
    const { user, membership } = await requireUser(req, url, anonKey, admin)
    const body = await req.json() as Json
    const action = text(body.action, 80)
    const actions: Record<string, () => Promise<unknown>> = {
      save_artifact: () => saveArtifact(admin, body, user.id),
      approve_artifact: () => approveArtifact(admin, body, user.id),
      create_session: () => createSession(admin, body, user.id),
      generate_directions: () => generateDirections(admin, body, user.id),
      create_direction_revision: () => createDirectionRevision(admin, body, user.id),
      select_direction: () => selectDirection(admin, body, user.id),
      release_direction: () => releaseDirection(admin, body, user.id),
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
