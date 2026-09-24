import { Buffer } from 'node:buffer'
import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { PNG } from 'npm:pngjs@7.0.0'
import { compileApprovedArtifactContext, stableJson } from '../_shared/approvedArtifactContext.ts'
import {
  resolveServerOrganizationContext,
  type ServerOrganizationContext,
  type ServerOrganizationScope,
} from '../_shared/serverOrganizationContext.ts'
import {
  freezeCreativeBrief, saveCreativeBrief, setWorkingDirection, validateCreativeBrief,
} from './creativeBriefs.ts'
import { archiveDesignAsset, DESIGN_ASSET_BUCKET, uploadDesignAssetVersion } from './assetVersions.ts'
import { recordAssetReview } from './assetReviews.ts'
import { previewDeliveryPackage, saveDeliveryPackage } from './packageDelivery.ts'
import { requireFreshVideoQuote } from '../_shared/designVideoQuote.js'
import { createDesignMediaAdapter } from '../_shared/designMediaAdapter.ts'
import { fetchDesignVideoOutput } from '../_shared/designVideoOutput.ts'

type Client = ReturnType<typeof createClient<any>>
type ScopedClient = Client & { organizationId: string }
type WorkshopOrganizationContext = Pick<ServerOrganizationContext, 'admin' | 'organizationId'>
type Json = Record<string, unknown>
const MEDIA_BUCKET = 'design-generated-media'
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
export const VIDEO_UNAVAILABLE_MESSAGE = 'Video generation is not yet configured. An API key and provider need to be added before this works.'
export const IMAGE_CANCELLATION_UNSUPPORTED_MESSAGE =
  'Cancellation is not supported after an image request is submitted. Reopen the request to see its authoritative status.'
const ARTIFACT_TYPES = new Set(['discovery', 'vision', 'audience'])
const SERVICE_OUTPUT_FAMILIES = new Map([
  ['brand_visual_identity', 'brand_identity'],
  ['design_systems', 'brand_identity'],
  ['website_ux_ui', 'website_design'],
  ['campaign_creative', 'marketing_asset'],
  ['social_assets', 'marketing_asset'],
  ['advertising_assets', 'marketing_asset'],
  ['video_concepts_storyboards', 'video_motion'],
  ['visual_production', 'marketing_asset'],
])
const VARIANT_SERVICE_SLUGS = new Set(['social_assets', 'advertising_assets'])
const VARIANT_FORMATS = new Map([
  ['square_1x1', { label: 'Square 1:1', width: 1080, height: 1080, providerSize: '1024x1024' }],
  ['story_9x16', { label: 'Story / Reel 9:16', width: 1080, height: 1920, providerSize: '1024x1536' }],
  ['landscape_1_91x1', { label: 'Landscape 1.91:1', width: 1200, height: 628, providerSize: '1536x1024' }],
  ['banner_728x90', { label: 'Leaderboard 728x90', width: 728, height: 90, providerSize: '1536x1024' }],
  ['banner_300x250', { label: 'Medium rectangle 300x250', width: 300, height: 250, providerSize: '1024x1024' }],
  ['portrait_4x5', { label: 'Portrait 4:5', width: 1080, height: 1350, providerSize: '1024x1536' }],
])
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

function requiredActionId(value: unknown, label: string) {
  const id = text(value, 80)
  if (!id) throw new Error(`${label} is required`)
  return id
}

type CallerRoot = { organizationId: string; engagementId: string }

async function callerSessionRoot(userClient: Client, sessionId: string): Promise<CallerRoot> {
  const { data: session, error } = await userClient.from('design_workshop_sessions')
    .select('id, organization_id, engagement_id, brand_id').eq('id', requiredActionId(sessionId, 'Session')).maybeSingle()
  if (error || !session) throw Object.assign(new Error('Design Workshop session not found'), { status: 404 })
  const { data: engagement, error: engagementError } = await userClient.from('engagements')
    .select('id, organization_id, brand_id').eq('id', session.engagement_id).maybeSingle()
  if (engagementError || !engagement || engagement.organization_id !== session.organization_id
    || engagement.brand_id !== session.brand_id) {
    throw Object.assign(new Error('Design Workshop session has an invalid organization chain'), { status: 409 })
  }
  return { organizationId: session.organization_id, engagementId: session.engagement_id }
}

async function callerDirectionRoot(userClient: Client, directionId: string): Promise<CallerRoot> {
  const { data: direction, error } = await userClient.from('design_directions')
    .select('id, organization_id, session_id').eq('id', requiredActionId(directionId, 'Direction')).maybeSingle()
  if (error || !direction) throw Object.assign(new Error('Design direction not found'), { status: 404 })
  const root = await callerSessionRoot(userClient, direction.session_id)
  if (root.organizationId !== direction.organization_id) {
    throw Object.assign(new Error('Design direction has an invalid organization chain'), { status: 409 })
  }
  return root
}

async function callerVersionRoot(userClient: Client, versionId: string): Promise<CallerRoot> {
  const { data: version, error } = await userClient.from('design_direction_versions')
    .select('id, organization_id, direction_id').eq('id', requiredActionId(versionId, 'Direction version')).maybeSingle()
  if (error || !version) throw Object.assign(new Error('Design direction version not found'), { status: 404 })
  const root = await callerDirectionRoot(userClient, version.direction_id)
  if (root.organizationId !== version.organization_id) {
    throw Object.assign(new Error('Design direction version has an invalid organization chain'), { status: 409 })
  }
  return root
}

async function callerImageGenerationJobRoot(userClient: Client, jobId: string): Promise<CallerRoot> {
  const { data: job, error } = await userClient.from('design_image_generation_jobs')
    .select('id, organization_id, direction_version_id').eq('id', requiredActionId(jobId, 'Generation request')).maybeSingle()
  if (error || !job) throw Object.assign(new Error('Image generation request not found'), { status: 404 })
  const root = await callerVersionRoot(userClient, job.direction_version_id)
  if (root.organizationId !== job.organization_id) {
    throw Object.assign(new Error('Image generation request has an invalid organization chain'), { status: 409 })
  }
  return root
}

async function callerCreativeBriefRoot(userClient: Client, briefId: string): Promise<CallerRoot> {
  const { data: brief, error } = await userClient.from('design_creative_briefs')
    .select('id, organization_id, engagement_id, visibility').eq('id', requiredActionId(briefId, 'Creative brief')).maybeSingle()
  if (error || !brief) throw Object.assign(new Error('Creative brief not found'), { status: 404 })
  if (brief.visibility === 'private') return { organizationId: brief.organization_id, engagementId: '' }
  const { data: engagement, error: engagementError } = await userClient.from('engagements')
    .select('id, organization_id').eq('id', brief.engagement_id).maybeSingle()
  if (engagementError || !engagement || engagement.organization_id !== brief.organization_id) {
    throw Object.assign(new Error('Creative brief has an invalid organization chain'), { status: 409 })
  }
  return { organizationId: brief.organization_id, engagementId: brief.engagement_id }
}
async function callerContentRequestRoot(userClient: Client, requestId: string): Promise<CallerRoot> {
  const { data: request, error } = await userClient.from('content_requests')
    .select('id, organization_id, engagement_id, brand_id').eq('id', requiredActionId(requestId, 'Content request')).maybeSingle()
  if (error || !request?.engagement_id) {
    throw Object.assign(new Error('Content request not found'), { status: 404 })
  }
  const { data: engagement, error: engagementError } = await userClient.from('engagements')
    .select('id, organization_id, brand_id').eq('id', request.engagement_id).maybeSingle()
  if (engagementError || !engagement || engagement.organization_id !== request.organization_id
    || engagement.brand_id !== request.brand_id) {
    throw Object.assign(new Error('Content request has an invalid organization chain'), { status: 409 })
  }
  return { organizationId: request.organization_id, engagementId: request.engagement_id }
}

async function callerReleasedVersionRoot(userClient: Client, versionId: string): Promise<CallerRoot> {
  const root = await callerVersionRoot(userClient, versionId)
  const { data: release, error } = await userClient.from('design_direction_releases')
    .select('id, organization_id, direction_version_id').eq('direction_version_id', versionId).maybeSingle()
  if (error || !release) throw Object.assign(new Error('Released direction version not found'), { status: 404 })
  if (release.organization_id !== root.organizationId || release.direction_version_id !== versionId) {
    throw Object.assign(new Error('Design release has an invalid organization chain'), { status: 409 })
  }
  return root
}
async function callerMediaRoot(userClient: Client, assetIds: string[]): Promise<CallerRoot | null> {
  if (!assetIds.length) return null
  const { data: assets, error } = await userClient.from('design_media_assets')
    .select('id, organization_id, design_direction_version_id, content_request_id, storage_path').in('id', assetIds)
  if (error || assets?.length !== assetIds.length) {
    throw Object.assign(new Error('One or more media assets are not visible'), { status: 404 })
  }
  let root: CallerRoot | null = null
  for (const asset of assets) {
    let candidate: CallerRoot
    if (asset.design_direction_version_id) {
      candidate = await callerVersionRoot(userClient, asset.design_direction_version_id)
    } else if (asset.content_request_id) {
      candidate = await callerContentRequestRoot(userClient, asset.content_request_id)
    } else {
      throw Object.assign(new Error('Media asset has no canonical target'), { status: 409 })
    }
    if (candidate.organizationId !== asset.organization_id
      || (asset.storage_path && !String(asset.storage_path).startsWith(`${asset.organization_id}/`))) {
      throw Object.assign(new Error('Media asset has an invalid organization chain'), { status: 409 })
    }
    if (root && root.organizationId !== candidate.organizationId) {
      throw Object.assign(new Error('Media assets must belong to one organization'), { status: 409 })
    }
    root = candidate
  }
  return root
}

async function callerDesignAssetRoot(userClient: Client, assetId: string): Promise<CallerRoot> {
  const { data: asset, error } = await userClient.from('design_assets')
    .select('id, organization_id, engagement_id, brand_id').eq('id', requiredActionId(assetId, 'Asset')).maybeSingle()
  if (error || !asset) throw Object.assign(new Error('Design asset not found'), { status: 404 })
  const { data: engagement, error: engagementError } = await userClient.from('engagements')
    .select('id, organization_id, brand_id').eq('id', asset.engagement_id).maybeSingle()
  if (engagementError || !engagement || engagement.organization_id !== asset.organization_id
    || engagement.brand_id !== asset.brand_id) {
    throw Object.assign(new Error('Design asset has an invalid organization chain'), { status: 409 })
  }
  return { organizationId: asset.organization_id, engagementId: asset.engagement_id }
}

async function callerAssetVersionRoot(userClient: Client, versionIds: string[]): Promise<CallerRoot | null> {
  if (!versionIds.length) return null
  const { data: versions, error } = await userClient.from('design_asset_versions')
    .select('id, organization_id, asset_id, storage_path').in('id', versionIds)
  if (error || versions?.length !== versionIds.length) {
    throw Object.assign(new Error('One or more Design asset versions are not visible'), { status: 404 })
  }
  let root: CallerRoot | null = null
  for (const version of versions) {
    const candidate = await callerDesignAssetRoot(userClient, version.asset_id)
    if (candidate.organizationId !== version.organization_id
      || !String(version.storage_path || '').startsWith(`${version.organization_id}/`)) {
      throw Object.assign(new Error('Design asset version has an invalid organization chain'), { status: 409 })
    }
    if (root && (root.organizationId !== candidate.organizationId || root.engagementId !== candidate.engagementId)) {
      throw Object.assign(new Error('Design asset versions must belong to one engagement'), { status: 409 })
    }
    root = candidate
  }
  return root
}

async function callerDeliveryPackageRoot(userClient: Client, artifactId: string): Promise<CallerRoot> {
  const { data, error } = await userClient.from('artifacts')
    .select('id, organization_id, engagement_id, artifact_type')
    .eq('id', artifactId).eq('artifact_type', 'design_delivery_package').maybeSingle()
  if (error || !data?.engagement_id) {
    throw Object.assign(new Error('Design delivery package is unavailable'), { status: 404 })
  }
  return { organizationId: data.organization_id, engagementId: data.engagement_id }
}

export async function designWorkshopScope(userClient: Client, body: Json): Promise<ServerOrganizationScope> {
  const action = text(body.action, 80)
  const requestedOrganizationId = text(body.organization_id, 80) || null
  if (action === 'create_page_flow' || action === 'create_session') return {
    root: { kind: 'engagement', id: requiredActionId(body.engagement_id, 'Engagement') }, requestedOrganizationId,
  }
  if (action === 'validate_creative_brief'
    || (action === 'save_creative_brief' && !text(body.creative_brief_id, 80))) {
    if (text(body.visibility, 20) === 'private') return { root: null, requestedOrganizationId: requestedOrganizationId || '' }
    return { root: { kind: 'engagement', id: requiredActionId(body.engagement_id, 'Engagement') }, requestedOrganizationId }
  }
  if (action === 'save_creative_brief' || action === 'freeze_creative_brief') {
    const root = await callerCreativeBriefRoot(userClient, requiredActionId(body.creative_brief_id, 'Creative brief'))
    if (requestedOrganizationId && requestedOrganizationId !== root.organizationId) {
      throw Object.assign(new Error('Requested organization does not match the creative brief'), { status: 403 })
    }
    return root.engagementId
      ? { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
      : { root: null, requestedOrganizationId: root.organizationId }
  }
  if (action === 'set_working_direction') {
    const root = await callerSessionRoot(userClient, requiredActionId(body.session_id, 'Session'))
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'generate_directions' || action === 'select_direction' || action === 'release_direction') {
    const root = await callerSessionRoot(userClient, requiredActionId(body.session_id, 'Session'))
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'create_direction_revision') {
    const root = await callerDirectionRoot(userClient, requiredActionId(body.direction_id, 'Direction'))
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'promote_direction_experiment' || action === 'generate_image'
    || action === 'create_video_placeholder' || action === 'get_video_quote'
    || action === 'generate_video' || action === 'list_video_jobs') {
    const root = await callerVersionRoot(userClient, requiredActionId(body.direction_version_id, 'Direction version'))
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'get_image_generation_job' || action === 'retry_image_generation') {
    const root = await callerImageGenerationJobRoot(userClient, requiredActionId(body.job_id, 'Generation request'))
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'generate_variants') {
    const root = await callerReleasedVersionRoot(userClient,
      requiredActionId(body.source_direction_version_id, 'Source direction version'))
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'generate_content_request_image' || action === 'create_content_request_video_placeholder') {
    const requestId = requiredActionId(body.content_request_id, 'Content request')
    await callerContentRequestRoot(userClient, requestId)
    return { root: { kind: 'content_request', id: requestId }, requestedOrganizationId }
  }
  if (action === 'preview_private_promotion' || action === 'promote_private_image') {
    return { root: { kind: 'engagement', id: requiredActionId(body.target_engagement_id, 'Target engagement') }, requestedOrganizationId }
  }
  if (['generate_private_image', 'get_private_image_job', 'reconcile_private_image_request', 'sign_private_image_job'].includes(action)) {
    return { root: null, requestedOrganizationId: requestedOrganizationId || '' }
  }
  if (['get_video_job', 'poll_video_job', 'ingest_video_output', 'sign_video_output'].includes(action)) {
    return { root: null, requestedOrganizationId: requestedOrganizationId || '' }
  }
  if (action === 'list_experiment_reviewers') {
    return { root: null, requestedOrganizationId: requestedOrganizationId || '' }
  }
  if (action === 'upload_asset_version') {
    const assetId = text(body.asset_id, 80)
    if (assetId) {
      const root = await callerDesignAssetRoot(userClient, assetId)
      return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
    }
    return { root: { kind: 'engagement', id: requiredActionId(body.engagement_id, 'Engagement') }, requestedOrganizationId }
  }
  if (action === 'submit_asset_review' || action === 'decide_asset_review') {
    const root = await callerAssetVersionRoot(userClient, [requiredActionId(body.asset_version_id, 'Asset version')])
    return { root: { kind: 'engagement', id: root!.engagementId }, requestedOrganizationId }
  }
  if (action === 'archive_asset') {
    const root = await callerDesignAssetRoot(userClient, requiredActionId(body.asset_id, 'Asset'))
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'preview_delivery_package'
    || (action === 'save_delivery_package' && !text(body.artifact_id, 80))) {
    return { root: { kind: 'engagement', id: requiredActionId(body.engagement_id, 'Engagement') }, requestedOrganizationId }
  }
  if (action === 'save_delivery_package') {
    const root = await callerDeliveryPackageRoot(userClient, requiredActionId(body.artifact_id, 'Design delivery package'))
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'sign_asset_versions') {
    const root = await callerAssetVersionRoot(userClient, uniqueIds(body.version_ids))
    if (!root) return { root: null, requestedOrganizationId: requestedOrganizationId || '' }
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  if (action === 'sign_media_assets') {
    const root = await callerMediaRoot(userClient, uniqueIds(body.asset_ids))
    if (!root) return { root: null, requestedOrganizationId: requestedOrganizationId || '' }
    return { root: { kind: 'engagement', id: root.engagementId }, requestedOrganizationId }
  }
  throw new Error('Unsupported action')
}

function publicApiKey() {
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')?.split(',').map(value => value.trim()).find(Boolean)
    || Deno.env.get('SUPABASE_ANON_KEY') || ''
}

async function callerClient(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) {
    throw Object.assign(new Error('Authentication required'), { status: 401 })
  }
  const url = Deno.env.get('SUPABASE_URL') || ''; const key = publicApiKey()
  if (!url || !key) throw new Error('Function environment is incomplete')
  const client = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return client
}
type HandlerDependencies = {
  createCallerClient?: (request: Request) => Promise<Client>
  resolveContext?: typeof resolveServerOrganizationContext
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

export function isStoryboardSession(session: Json, serviceSlug?: unknown) {
  return text(serviceSlug, 80) === 'video_concepts_storyboards'
    || text(session.output_family, 80) === 'video_motion'
}

export function directionGenerationPrompt(storyboard: boolean, slot: number, frameCount: number,
  previous: Json[], laneDirection: string) {
  if (!storyboard) {
    const differentiation = previous.length
      ? `Existing directions that this output must be materially different from: ${JSON.stringify(previous.map(item => ({ title: item.title, thesis: item.creative_thesis, principles: item.visual_principles })))}`
      : 'This is the first direction.'
    return {
      instructions: 'You are assisting an accountable designer. Produce one traceable visual design direction, not a final approved asset. Follow the JSON schema exactly. Do not claim approval.',
      context: `MANDATORY DIRECTION LANE\n${laneDirection}\n\n${differentiation}`,
    }
  }
  const priorFrames = previous.map((content, index) => ({ frame_order: index + 1, content }))
  return {
    instructions: 'You are assisting an accountable designer. Produce one traceable storyboard frame in a connected static sequence, not an alternative concept or a final approved asset. Follow the JSON schema exactly. Do not claim approval.',
    context: `STORYBOARD SEQUENCE\nFRAME ORDER\n${slot} of ${frameCount}\n\nNARRATIVE CONTINUITY\n${priorFrames.length
      ? `Continue directly from the prior frame content below. Preserve characters, setting, visual language, palette, props, and screen direction while advancing the narrative by one clear beat. Do not restart or propose an alternative concept.\n${JSON.stringify(priorFrames)}`
      : 'Establish the opening frame and visual language for one connected sequence. Later frames will receive this exact frame content as narrative context.'}`,
  }
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

export function hasWorkshopAuthority(membership: Json, action: string) {
  if (membership.member_kind !== 'team') return false
  const role = String(membership.role || ''); const department = String(membership.department_id || '')
  if (LEADER_ROLES.has(role)) return true
  if (action === 'release_direction' || action === 'decide_asset_review') return department === 'design' && role === 'department_manager'
  if (action === 'generate_content_request_image' || action === 'create_content_request_video_placeholder') {
    return department === 'content'
  }
  if (action === 'promote_direction_experiment' || action === 'list_experiment_reviewers'
    || action === 'sign_media_assets' || action === 'sign_asset_versions') return true
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

export function variantFormatSpec(value: unknown) {
  const format = text(value, 80)
  const spec = VARIANT_FORMATS.get(format)
  if (!spec) throw new Error('Unsupported variant format')
  return { format, ...spec }
}

export function variantPrompt(content: Json, format: unknown) {
  const spec = variantFormatSpec(format)
  const source = mediaPrompt(content, '')
  if (!source) throw new Error('The released direction has no imagery direction or creative thesis to adapt')
  return text(`${source}\n\nCreate a faithful format variant of this already-approved creative direction. `
    + `Target format: ${spec.label}; target canvas: ${spec.width}x${spec.height}px. `
    + 'Preserve the concept, brand cues, message hierarchy, and essential subject matter. Recompose rather than inventing a new concept. '
    + 'Keep all critical text, logos, faces, and calls to action inside a conservative safe area for the target placement.', 6000)
}

export function mediaStoragePath(organizationId: string, versionId: string, assetId: string) {
  return `${organizationId}/${versionId}/${assetId}.png`
}

export function designEventLink(organizationId: string, sessionId: string, externalEventId: string, actorId: string) {
  return {
    id: sessionId, organization_id: organizationId, external_event_id: externalEventId,
    content_type: 'design_asset', linked_work_item_id: null, lead_time_days: 0,
    status: 'in_progress', created_by: actorId,
  }
}

export function contentRequestMediaStoragePath(organizationId: string, contentRequestId: string, assetId: string) {
  return `${organizationId}/content-requests/${contentRequestId}/${assetId}.png`
}

export function mediaTargetColumns(directionVersionId: string | null, contentRequestId: string | null) {
  if ((directionVersionId === null) === (contentRequestId === null)) {
    throw new Error('Exactly one media target is required')
  }
  return directionVersionId
    ? { design_direction_version_id: directionVersionId }
    : { content_request_id: contentRequestId }
}

async function insertEvent(admin: ScopedClient, engagementId: string, eventType: string, actorId: string,
  recordType: string, recordId: string, versionId: string, action: string) {
  const { error } = await admin.from('engagement_events').insert({
    organization_id: admin.organizationId, engagement_id: engagementId, event_type: eventType, actor_id: actorId,
    payload: { record_type: recordType, record_id: recordId, version_id: versionId, action },
  })
  if (error) throw error
}

async function validateScope(admin: ScopedClient, engagementId: string, brandId: string, stageId?: string | null) {
  const { data: engagement } = await admin.from('engagements').select('id, brand_id, engagement_type')
    .eq('id', engagementId).eq('organization_id', admin.organizationId).eq('brand_id', brandId).maybeSingle()
  if (!engagement) throw new Error('Engagement and brand are unavailable')
  if (stageId) {
    const { data: stage } = await admin.from('engagement_stage_instances').select('id').eq('id', stageId)
      .eq('engagement_id', engagementId).eq('organization_id', admin.organizationId).maybeSingle()
    if (!stage) throw new Error('The selected stage is outside this engagement')
  }
  return engagement
}

function normalizePageSlug(value: unknown) {
  return text(value, 200).toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '')
}
function extractFlowPages(content: Json) {
  const rows = Array.isArray(content.pages) ? content.pages : []
  const pages = new Set<string>()
  for (const item of rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const normalized = normalizePageSlug(text((item as Json).slug, 200))
    if (normalized) pages.add(normalized)
  }
  return pages
}
async function architecturePageSlugs(admin: ScopedClient, engagementId: string, artifactId: string) {
  const { data: artifact, error: artifactError } = await admin.from('artifacts').select('id, artifact_type, engagement_id').eq('id', artifactId).eq('organization_id', admin.organizationId).maybeSingle()
  if (artifactError || !artifact || artifact.artifact_type !== 'website_architecture' || artifact.engagement_id !== engagementId) throw new Error('The selected website architecture artifact is unavailable for this engagement')
  const { data: approvals, error: approvalError } = await admin.from('artifact_approvals').select('artifact_version_id').eq('artifact_id', artifactId).eq('organization_id', admin.organizationId).order('approved_at', { ascending: false }).limit(1)
  if (approvalError) throw approvalError
  const approvedVersionId = approvals?.[0]?.artifact_version_id
  if (!approvedVersionId) throw new Error('A linked website architecture artifact must have an approved version')
  const { data: version, error: versionError } = await admin.from('artifact_versions').select('content').eq('id', approvedVersionId).eq('organization_id', admin.organizationId).maybeSingle()
  if (versionError || !version) throw new Error('The approved website architecture version is unavailable')
  return extractFlowPages(version.content || {})
}
async function resolvePageFlow(admin: ScopedClient, engagementId: string, pageFlowId: string, pageSlug: string) {
  const flowId = text(pageFlowId, 80); const rawSlug = text(pageSlug, 200)
  if (!flowId || !normalizePageSlug(rawSlug)) throw new Error('A page flow requires a non-empty page slug')
  const { data: flow, error: flowError } = await admin.from('design_page_flows').select('*').eq('id', flowId).eq('organization_id', admin.organizationId).eq('engagement_id', engagementId).maybeSingle()
  if (flowError || !flow) throw new Error('The selected page flow is unavailable for this engagement')
  if (flow.website_architecture_artifact_id && !(await architecturePageSlugs(admin, engagementId, flow.website_architecture_artifact_id)).has(normalizePageSlug(rawSlug))) throw new Error('The selected flow does not contain this page slug')
}
async function createPageFlow(admin: ScopedClient, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80); const flowName = text(body.flow_name, 200)
  const architectureArtifactId = text(body.website_architecture_artifact_id, 80) || null
  if (!engagementId || !flowName) throw new Error('Engagement and flow name are required')
  const { data: engagement, error: engagementError } = await admin.from('engagements').select('id').eq('id', engagementId).eq('organization_id', admin.organizationId).maybeSingle()
  if (engagementError || !engagement) throw new Error('Engagement is unavailable')
  if (architectureArtifactId) await architecturePageSlugs(admin, engagementId, architectureArtifactId)
  const { data: flow, error: flowError } = await admin.from('design_page_flows').insert({ organization_id: admin.organizationId, engagement_id: engagementId, website_architecture_artifact_id: architectureArtifactId, flow_name: flowName, created_by: actorId }).select('*').single()
  if (flowError) throw flowError
  return flow
}
export function outputFamilyForService(serviceSlug: unknown) {
  const outputFamily = SERVICE_OUTPUT_FAMILIES.get(text(serviceSlug, 80))
  if (!outputFamily) throw new Error('Unsupported Design service')
  return outputFamily
}

export async function requireActiveDesignService(context: WorkshopOrganizationContext, engagementId: string, engagementServiceId: string) {
  const admin = context.admin
  if (!engagementServiceId) throw new Error('Select an active Design service')
  const { data: service, error } = await admin.from('engagement_services')
    .select('id, engagement_id, status, service_catalog!inner(id, slug, name, department_id, is_active)')
    .eq('id', engagementServiceId).eq('organization_id', context.organizationId).eq('engagement_id', engagementId)
    .eq('status', 'active').eq('service_catalog.department_id', 'design')
    .eq('service_catalog.is_active', true).maybeSingle()
  if (error) throw error
  const catalog = Array.isArray(service?.service_catalog) ? service.service_catalog[0] : service?.service_catalog
  if (!service || service.status !== 'active' || catalog?.department_id !== 'design' || catalog?.is_active !== true) {
    throw new Error('The selected Design service is not active on this engagement')
  }
  return { service, catalog, outputFamily: outputFamilyForService(catalog.slug) }
}

export async function createSession(admin: ScopedClient, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80); const brandId = text(body.brand_id, 80)
  const stageId = text(body.engagement_stage_instance_id, 80) || null
  const engagementServiceId = text(body.engagement_service_id, 80)
  const projectTaskId = text(body.project_task_id, 80) || null
  const engagementWorkItemId = text(body.engagement_work_item_id, 80) || null
  if (projectTaskId && engagementWorkItemId) throw new Error('A Design session can target a task or work item, not both')
  await validateScope(admin, engagementId, brandId, stageId)
  const pageFlowId = text(body.flow_id, 80) || null
  const pageSlug = text(body.page_slug, 200)
  if (pageFlowId) await resolvePageFlow(admin, engagementId, pageFlowId, pageSlug)
  const externalEventId = text(body.external_event_id, 80) || null
  if (externalEventId) {
    const { data: externalEvent, error: externalEventError } = await admin.from('external_events').select('id')
      .eq('id', externalEventId).eq('organization_id', admin.organizationId).eq('brand_id', brandId).maybeSingle()
    if (externalEventError || !externalEvent) throw new Error('The selected external event is outside this brand')
  }
  const { outputFamily } = await requireActiveDesignService({ admin, organizationId: admin.organizationId }, engagementId, engagementServiceId)
  const modelIds = Array.isArray(body.model_registry_ids)
    ? [...new Set(body.model_registry_ids.map(value => text(value, 80)).filter(Boolean))].slice(0, 3) : []
  if (!modelIds.length) throw new Error('Select at least one registered model')
  const { data: models, error: modelError } = await admin.from('design_model_registry').select('*')
    .eq('organization_id', admin.organizationId).eq('is_active', true).in('id', modelIds)
  if (modelError || models?.length !== modelIds.length) throw new Error('One or more selected models are unavailable')
  if (models.some(model => !supportsOutput(model, 'design_direction'))) {
    throw new Error('Direction sessions require models registered for design direction output')
  }
  const { selected, manifest: contextManifest } = await compileApprovedArtifactContext(admin, {
    organizationId: admin.organizationId,
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
  const sessionValues: Record<string, unknown> = {
    id: sessionId, organization_id: admin.organizationId, engagement_id: engagementId, brand_id: brandId,
    engagement_stage_instance_id: stageId, engagement_service_id: engagementServiceId,
    project_task_id: projectTaskId, engagement_work_item_id: engagementWorkItemId,
    output_family: outputFamily, output_brief: outputBrief,
    designer_instructions: designerInstructions, context_manifest: contextManifest,
    context_checksum: checksum, created_by: actorId,
  }
  if (pageFlowId) { sessionValues.page_flow_id = pageFlowId; sessionValues.page_slug = pageSlug }
  const { data: session, error: sessionError } = await admin.from('design_workshop_sessions').insert(sessionValues).select('*').single()
  if (sessionError) throw sessionError
  try {
    const { error: contextError } = await admin.from('design_workshop_context_versions').insert(selected.map(({ artifact, approval, version }) => ({
      organization_id: admin.organizationId, session_id: session.id, artifact_id: artifact.id,
      artifact_version_id: version.id, artifact_approval_id: approval.id, artifact_type: artifact.artifact_type,
    })))
    if (contextError) throw contextError
    const { error: selectionError } = await admin.from('design_workshop_model_selections').insert(modelIds.map((id, index) => ({
      organization_id: admin.organizationId, session_id: session.id, model_registry_id: id, position: index + 1,
    })))
    if (selectionError) throw selectionError
    if (externalEventId) {
      const { error: linkError } = await admin.from('content_event_links')
        .insert(designEventLink(admin.organizationId, session.id, externalEventId, actorId))
      if (linkError) throw linkError
    }
  } catch (error) {
    await admin.from('design_workshop_sessions').delete().eq('id', session.id).eq('organization_id', admin.organizationId)
    throw error
  }
  return session
}

async function resolveOpenAi(admin: ScopedClient, engagementId: string) {
  const { data: mappings, error: mappingError } = await admin.from('integration_connection_engagements')
    .select('connection_id').eq('organization_id', admin.organizationId).eq('engagement_id', engagementId).eq('department_id', 'design')
  if (mappingError) throw mappingError
  const connectionIds = (mappings || []).map(item => item.connection_id)
  if (!connectionIds.length) throw new Error('A verified OpenAI connector must be mapped to this engagement and Design')
  const { data: connection, error } = await admin.from('integration_connections').select('id, provider, status, secret_name')
    .eq('organization_id', admin.organizationId).eq('provider', 'openai').eq('status', 'verified')
    .is('archived_at', null).in('id', connectionIds).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const secretName = connection?.secret_name || ''
  const credential = secretName ? Deno.env.get(secretName) : null
  if (!connection || !credential) throw new Error('The verified Design OpenAI connector credential is unavailable')
  return { connectionId: connection.id, credential }
}

async function generateOne(admin: ScopedClient, session: any, model: any, lane: typeof LANES[number], slot: number,
  actorId: string, credential: string, previous: Json[], storyboard: boolean) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { data: run, error: runError } = await admin.from('design_generation_runs').insert({
      organization_id: admin.organizationId, engagement_id: session.engagement_id, session_id: session.id,
      model_registry_id: model.id, provider: model.provider, model_id: model.model_id,
      direction_slot: slot, attempt_number: attempt, status: 'running',
      input_manifest_checksum: session.context_checksum,
      parameters: storyboard
        ? { sequence_mode: 'storyboard', frame_order: slot, frame_count: LANES.length, structured_output: 'anka_design_direction_v1', store: false }
        : { lane: lane.key, structured_output: 'anka_design_direction_v1', store: false },
      created_by: actorId,
    }).select('*').single()
    if (runError) throw runError
    try {
      const prompt = directionGenerationPrompt(storyboard, slot, LANES.length, previous, lane.direction)
      const apiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.model_id, store: false, safety_identifier: await sha256(actorId),
          metadata: { anka_session_id: session.id, anka_run_id: run.id, direction_slot: String(slot) },
          instructions: prompt.instructions,
          input: `APPROVED CONTEXT MANIFEST\n${JSON.stringify(session.context_manifest)}\n\nOUTPUT FAMILY\n${session.output_family}\n\nOUTPUT BRIEF\n${JSON.stringify(session.output_brief)}\n\nDESIGNER INSTRUCTIONS\n${session.designer_instructions}\n\n${prompt.context}`,
          text: { format: directionSchema() }, max_output_tokens: 2600,
        }),
      })
      const result = await apiResponse.json()
      if (!apiResponse.ok) throw new Error(result?.error?.message || 'OpenAI direction generation failed')
      const generated = JSON.parse(outputText(result)) as Json
      const duplicate = !storyboard && previous.some(item => similarity(item, generated) >= 0.62)
      const checksum = await sha256(stableJson(generated))
      await admin.from('design_generation_runs').update({
        status: duplicate ? 'rejected_duplicate' : 'completed', external_response_id: result.id || null,
        output_checksum: checksum, failure_reason: duplicate ? 'Similarity threshold rejected this output.' : '', completed_at: new Date().toISOString(),
      }).eq('id', run.id).eq('organization_id', admin.organizationId)
      if (!duplicate) return { generated, runId: run.id, checksum, signature: await sha256(directionText(generated).toLowerCase()) }
    } catch (error) {
      await admin.from('design_generation_runs').update({
        status: 'failed', failure_reason: error instanceof Error ? error.message.slice(0, 1000) : 'Generation failed',
        completed_at: new Date().toISOString(),
      }).eq('id', run.id).eq('organization_id', admin.organizationId)
      if (attempt === 2) throw error
    }
  }
  throw new Error('A duplicate direction was rejected twice; no duplicate was stored')
}

async function generateDirections(admin: ScopedClient, body: Json, actorId: string) {
  const sessionId = text(body.session_id, 80)
  const { data: session } = await admin.from('design_workshop_sessions').select('*')
    .eq('id', sessionId).eq('organization_id', admin.organizationId).maybeSingle()
  if (!session || !['ready', 'generation_failed'].includes(session.status)) throw new Error('Session is not ready to generate')
  let briefQuery = admin.from('design_creative_briefs').select('id, frozen_version_id')
    .eq('organization_id', admin.organizationId).eq('engagement_id', session.engagement_id)
    .eq('engagement_service_id', session.engagement_service_id).eq('visibility', 'official')
  briefQuery = session.project_task_id ? briefQuery.eq('project_task_id', session.project_task_id) : briefQuery.is('project_task_id', null)
  briefQuery = session.engagement_work_item_id ? briefQuery.eq('engagement_work_item_id', session.engagement_work_item_id) : briefQuery.is('engagement_work_item_id', null)
  const { data: frozenBrief, error: briefError } = await briefQuery.maybeSingle()
  if (briefError || !frozenBrief?.frozen_version_id) throw new Error('Freeze the exact-scope creative brief before generation')
  const storyboard = isStoryboardSession(session)
  const { count } = await admin.from('design_directions').select('id', { count: 'exact', head: true }).eq('session_id', session.id).eq('organization_id', admin.organizationId)
  if (count) throw new Error(storyboard
    ? 'This session already has its storyboard frame sequence'
    : 'This session already has its three comparison directions')
  const { data: selections, error: selectionError } = await admin.from('design_workshop_model_selections').select('*')
    .eq('session_id', session.id).eq('organization_id', admin.organizationId).order('position')
  if (selectionError || !selections?.length) throw new Error('Session has no model routing')
  const modelIds = selections.map(item => item.model_registry_id)
  const { data: models, error: modelError } = await admin.from('design_model_registry').select('*').in('id', modelIds).eq('organization_id', admin.organizationId).eq('is_active', true)
  if (modelError || !models?.length) throw new Error('Selected models are unavailable')
  const modelById = new Map(models.map(item => [item.id, item]))
  const orderedModels = selections.map(item => modelById.get(item.model_registry_id)).filter(Boolean)
  if (orderedModels.length !== selections.length || orderedModels.some(model => !supportsOutput(model, 'design_direction'))) {
    throw new Error('One or more selected models no longer support design direction output')
  }
  if (orderedModels.some(model => model.provider !== 'openai')) throw new Error('No installed adapter exists for one selected provider')
  const { credential } = await resolveOpenAi(admin, session.engagement_id)
  await admin.from('design_workshop_sessions').update({ status: 'generating' }).eq('id', session.id).eq('organization_id', admin.organizationId)
  try {
    const outputs: Array<{ generated: Json; runId: string; checksum: string; signature: string }> = []
    for (let index = 0; index < LANES.length; index += 1) {
      outputs.push(await generateOne(admin, session, orderedModels[index % orderedModels.length], LANES[index], index + 1,
        actorId, credential, outputs.map(item => item.generated), storyboard))
    }
    if (!storyboard && !directionsAreDistinct(outputs.map(item => item.generated))) {
      throw new Error('Distinctness gate rejected the generated set')
    }
    const { data: directions, error: directionError } = await admin.from('design_directions').insert(outputs.map((_, index) => ({
      organization_id: admin.organizationId, session_id: session.id, direction_slot: index + 1,
    }))).select('*')
    if (directionError) throw directionError
    const bySlot = new Map((directions || []).map(item => [item.direction_slot, item]))
    const { data: versions, error: versionError } = await admin.from('design_direction_versions').insert(outputs.map((item, index) => ({
      organization_id: admin.organizationId, direction_id: bySlot.get(index + 1).id, version_number: 1,
      generation_run_id: item.runId, content: item.generated, content_checksum: item.checksum,
      distinctness_signature: item.signature, creative_brief_version_id: frozenBrief.frozen_version_id,
      created_by: actorId,
    }))).select('*')
    if (versionError) throw versionError
    await admin.from('design_workshop_sessions').update({ status: 'comparison' }).eq('id', session.id).eq('organization_id', admin.organizationId)
    return { directions, versions }
  } catch (error) {
    await admin.from('design_directions').delete().eq('session_id', session.id).eq('organization_id', admin.organizationId)
    await admin.from('design_workshop_sessions').update({ status: 'generation_failed' }).eq('id', session.id).eq('organization_id', admin.organizationId)
    throw error
  }
}

async function loadPermittedDirectionVersion(userClient: Client, organizationId: string, directionVersionId: string) {
  const { data: version, error: versionError } = await userClient.from('design_direction_versions').select('*')
    .eq('id', directionVersionId).eq('organization_id', organizationId).maybeSingle()
  if (versionError) throw versionError
  if (!version) throw new Error('Direction version not found or not visible to this reviewer')
  const { data: direction, error: directionError } = await userClient.from('design_directions').select('id, session_id')
    .eq('id', version.direction_id).eq('organization_id', organizationId).maybeSingle()
  if (directionError) throw directionError
  const { data: session, error: sessionError } = direction
    ? await userClient.from('design_workshop_sessions').select('id, engagement_id, engagement_service_id').eq('id', direction.session_id)
      .eq('organization_id', organizationId).maybeSingle()
    : { data: null, error: null }
  if (sessionError) throw sessionError
  if (!direction || !session) throw new Error('Direction version has no accessible Workshop session')
  return { version, direction, session }
}

export async function generateOpenAiImage(credential: string, modelId: string, prompt: string,
  sizeOrFetcher?: string | typeof fetch, fetcher: typeof fetch = fetch) {
  const size = typeof sizeOrFetcher === 'string' ? sizeOrFetcher : null
  const request = typeof sizeOrFetcher === 'function' ? sizeOrFetcher : fetcher
  const apiResponse = await request(OPENAI_IMAGES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, prompt, ...(size ? { size } : {}) }),
  })
  const result = await apiResponse.json() as Json
  if (!apiResponse.ok) {
    const apiError = result.error && typeof result.error === 'object' ? result.error as Json : {}
    const message = text(apiError.message, 1000) || `OpenAI image generation returned HTTP ${apiResponse.status}`
    if (isConfirmedProviderRejection(apiResponse.status, apiError)) {
      throw new ConfirmedProviderFailure(message)
    }
    throw new Error(`Provider outcome is unconfirmed after HTTP ${apiResponse.status}: ${message}`)
  }
  const first = Array.isArray(result.data) ? result.data[0] as Json | undefined : undefined
  const encoded = text(first?.b64_json, 20_000_000)
  if (!encoded) throw new Error('OpenAI image generation returned no image data')
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Generated image exceeds the 10 MB storage limit')
  return bytes
}

export class ConfirmedProviderFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfirmedProviderFailure'
  }
}

export function isConfirmedProviderRejection(status: number, providerError: Json) {
  if (status !== 400 || text(providerError.type, 80) !== 'invalid_request_error') return false
  return Boolean(text(providerError.code, 200) || text(providerError.param, 200))
}

export function durableProviderFailureState(error: unknown) {
  const confirmed = error instanceof ConfirmedProviderFailure
  return {
    status: confirmed ? 'failed' : 'outcome_unknown',
    failure_phase: 'provider',
    retryable: confirmed,
  }
}

export function canRetryImageGenerationJob(job: Json) {
  return job.status === 'failed' && job.failure_phase === 'provider'
}

export class DurableImageFailure extends Error {
  phase: 'provider' | 'storage' | 'registration'
  outcomeUnknown: boolean
  asset: Json | null

  constructor(message: string, phase: 'provider' | 'storage' | 'registration',
    outcomeUnknown: boolean, asset: Json | null) {
    super(message)
    this.name = 'DurableImageFailure'
    this.phase = phase
    this.outcomeUnknown = outcomeUnknown
    this.asset = asset
  }
}

export function pngDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.byteLength < 24 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Generated image is not a valid PNG')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height) throw new Error('Generated PNG has invalid dimensions')
  return { width, height }
}

export async function cropResizePng(bytes: Uint8Array, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new Error('Target image dimensions are invalid')
  }
  const declaredSource = pngDimensions(bytes)
  if (declaredSource.width > 4096 || declaredSource.height > 4096 || declaredSource.width * declaredSource.height > 16_777_216) {
    throw new Error('Generated PNG dimensions exceed the processing limit')
  }
  const source = PNG.sync.read(Buffer.from(bytes))
  const targetRatio = width / height
  const sourceRatio = source.width / source.height
  const cropWidth = sourceRatio > targetRatio ? source.height * targetRatio : source.width
  const cropHeight = sourceRatio > targetRatio ? source.height : source.width / targetRatio
  const cropX = (source.width - cropWidth) / 2
  const cropY = (source.height - cropHeight) / 2
  const outputPng = new PNG({ width, height })

  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(cropY + ((targetY + 0.5) * cropHeight / height)))
    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(cropX + ((targetX + 0.5) * cropWidth / width)))
      const sourceOffset = (sourceY * source.width + sourceX) * 4
      const targetOffset = (targetY * width + targetX) * 4
      outputPng.data[targetOffset] = source.data[sourceOffset]
      outputPng.data[targetOffset + 1] = source.data[sourceOffset + 1]
      outputPng.data[targetOffset + 2] = source.data[sourceOffset + 2]
      outputPng.data[targetOffset + 3] = source.data[sourceOffset + 3]
    }
  }

  const output = new Uint8Array(PNG.sync.write(outputPng, { deflateLevel: 6 }))
  const actual = pngDimensions(output)
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`Generated PNG is ${actual.width}x${actual.height}; expected ${width}x${height}`)
  }
  if (output.byteLength > 10 * 1024 * 1024) throw new Error('Processed image exceeds the 10 MB storage limit')
  return output
}

async function generateImageForTarget(admin: ScopedClient, input: {
  directionVersionId: string | null
  contentRequestId: string | null
  engagementId: string
  modelRegistryId: string
  prompt: string
  actorId: string
  providerSize?: string
  targetWidth?: number
  targetHeight?: number
  durable?: boolean
  onAssetReserved?: (asset: Json) => Promise<void>
}) {
  const { data: model, error: modelError } = await admin.from('design_model_registry').select('*')
    .eq('id', input.modelRegistryId).eq('organization_id', admin.organizationId).eq('is_active', true).maybeSingle()
  if (modelError) throw modelError
  if (!model || !supportsOutput(model, 'image')) throw new Error('Select an active image-capable model from the Design registry')
  if (model.provider !== 'openai') throw new Error('No installed image adapter exists for the selected provider')
  const { credential } = await resolveOpenAi(admin, input.engagementId)
  const { data: asset, error: assetError } = await admin.from('design_media_assets').insert({
    organization_id: admin.organizationId,
    ...mediaTargetColumns(input.directionVersionId, input.contentRequestId),
    media_type: 'image', status: 'generating', model_registry_id: model.id,
    provider: model.provider, prompt: input.prompt, generated_by: input.actorId,
  }).select('*').single()
  if (assetError) throw assetError
  const storagePath = input.directionVersionId
    ? mediaStoragePath(admin.organizationId, input.directionVersionId, asset.id)
    : contentRequestMediaStoragePath(admin.organizationId, input.contentRequestId!, asset.id)
  let uploaded = false
  let phase: 'provider' | 'storage' | 'registration' = 'provider'
  try {
    if (input.onAssetReserved) await input.onAssetReserved(asset as Json)
    let bytes = input.providerSize
      ? await generateOpenAiImage(credential, model.model_id, input.prompt, input.providerSize)
      : await generateOpenAiImage(credential, model.model_id, input.prompt)
    phase = 'storage'
    const hasTargetDimensions = input.targetWidth !== undefined || input.targetHeight !== undefined
    if (hasTargetDimensions) {
      if (input.targetWidth === undefined || input.targetHeight === undefined) {
        throw new Error('Both target image dimensions are required')
      }
      bytes = await cropResizePng(bytes, input.targetWidth, input.targetHeight)
    }
    const { error: uploadError } = await admin.storage.from(MEDIA_BUCKET).upload(storagePath, bytes, {
      contentType: 'image/png', upsert: false,
    })
    if (uploadError) throw uploadError
    uploaded = true
    phase = 'registration'
    const { data: ready, error: readyError } = await admin.from('design_media_assets').update({
      status: 'ready', storage_path: storagePath, failure_reason: '',
    }).eq('id', asset.id).eq('organization_id', admin.organizationId).select('*').single()
    if (readyError) throw readyError
    return ready
  } catch (error) {
    if (uploaded) await admin.storage.from(MEDIA_BUCKET).remove([storagePath])
    const failureReason = error instanceof Error ? error.message.slice(0, 2000) : 'Image generation failed'
    const { data: failed, error: failedError } = await admin.from('design_media_assets').update({
      status: 'failed', storage_path: null, failure_reason: failureReason,
    }).eq('id', asset.id).eq('organization_id', admin.organizationId).select('*').single()
    if (input.durable) {
      const providerState = durableProviderFailureState(error)
      const outcomeUnknown = phase === 'provider' && providerState.status === 'outcome_unknown'
      const durableReason = failedError
        ? `${failureReason}; media failure status could not be recorded: ${failedError.message}`
        : failureReason
      throw new DurableImageFailure(durableReason.slice(0, 2000), phase, outcomeUnknown,
        (failed || { ...asset, status: 'failed', failure_reason: failureReason }) as Json)
    }
    if (failedError) throw new Error(`Image generation failed and its asset status could not be recorded: ${failedError.message}`)
    return failed || { ...asset, status: 'failed', failure_reason: failureReason }
  }
}

export function imageGenerationRequestChecksum(directionVersionId: string, modelRegistryId: string, prompt: string) {
  return stableJson({ direction_version_id: directionVersionId, model_registry_id: modelRegistryId, prompt })
}

function operationKey(value: unknown) {
  const key = text(value, 200)
  if (key.length < 8) throw new Error('A stable operation_key of at least 8 characters is required')
  return key
}

export async function reserveImageGenerationJob(admin: ScopedClient, input: {
  directionVersionId: string
  modelRegistryId: string
  actorId: string
  operationKey: string
  requestChecksum: string
  prompt: string
  retryOfJobId?: string | null
}) {
  const record = {
    organization_id: admin.organizationId,
    direction_version_id: input.directionVersionId,
    model_registry_id: input.modelRegistryId,
    requested_by: input.actorId,
    operation_key: input.operationKey,
    request_checksum: input.requestChecksum,
    prompt: input.prompt,
    retry_of_job_id: input.retryOfJobId || null,
  }
  const { data: inserted, error } = await admin.from('design_image_generation_jobs').insert(record).select('*').single()
  if (!error && inserted) return inserted
  if (error?.code !== '23505') throw error

  const { data: existing, error: existingError } = await admin.from('design_image_generation_jobs').select('*')
    .eq('organization_id', admin.organizationId).eq('requested_by', input.actorId)
    .eq('operation_key', input.operationKey).maybeSingle()
  if (existingError) throw existingError
  if (!existing) throw error
  if (existing.direction_version_id !== input.directionVersionId
    || existing.model_registry_id !== input.modelRegistryId
    || existing.request_checksum !== input.requestChecksum
    || existing.prompt !== input.prompt
    || (existing.retry_of_job_id || null) !== (input.retryOfJobId || null)) {
    throw Object.assign(new Error('operation_key was already used for a different image request'), { status: 409 })
  }
  return existing
}

export async function claimImageGenerationJob(admin: ScopedClient, jobId: string) {
  const { data, error } = await admin.from('design_image_generation_jobs').update({
    status: 'running', started_at: new Date().toISOString(),
  }).eq('id', jobId).eq('organization_id', admin.organizationId).eq('status', 'queued').select('*').maybeSingle()
  if (error) throw error
  return data
}

async function loadImageGenerationJob(admin: ScopedClient, jobId: string) {
  const { data, error } = await admin.from('design_image_generation_jobs').select('*')
    .eq('id', jobId).eq('organization_id', admin.organizationId).maybeSingle()
  if (error) throw error
  if (!data) throw Object.assign(new Error('Image generation request not found'), { status: 404 })
  return data
}

async function finishImageGenerationJob(admin: ScopedClient, jobId: string, values: Json) {
  const { data, error } = await admin.from('design_image_generation_jobs').update({
    ...values, completed_at: new Date().toISOString(),
  }).eq('id', jobId).eq('organization_id', admin.organizationId).eq('status', 'running').select('*').single()
  if (error) throw error
  return data
}

async function executeImageGenerationJob(admin: ScopedClient, userClient: Client, job: Json, actorId: string) {
  const claimed = await claimImageGenerationJob(admin, String(job.id))
  if (!claimed) return loadImageGenerationJob(admin, String(job.id))

  try {
    const { version, session } = await loadPermittedDirectionVersion(
      userClient, admin.organizationId, String(claimed.direction_version_id))
    const asset = await generateImageForTarget(admin, {
      directionVersionId: version.id,
      contentRequestId: null,
      engagementId: session.engagement_id,
      modelRegistryId: String(claimed.model_registry_id),
      prompt: String(claimed.prompt),
      actorId,
      durable: true,
    })
    try {
      return await finishImageGenerationJob(admin, String(claimed.id), {
        status: 'succeeded', media_asset_id: asset.id,
      })
    } catch (error) {
      throw new DurableImageFailure(
        `Generated media is ready but request completion could not be recorded: ${error instanceof Error ? error.message : 'unknown registration failure'}`,
        'registration', false, asset as Json)
    }
  } catch (error) {
    if (error instanceof DurableImageFailure) {
      return finishImageGenerationJob(admin, String(claimed.id), {
        status: error.outcomeUnknown ? 'outcome_unknown' : 'failed',
        failure_phase: error.phase,
        failure_reason: error.message.slice(0, 2000),
        media_asset_id: error.asset?.id || null,
      })
    }
    return finishImageGenerationJob(admin, String(claimed.id), {
      status: 'failed',
      failure_phase: 'configuration',
      failure_reason: error instanceof Error ? error.message.slice(0, 2000) : 'Image request configuration failed',
    })
  }
}

async function privateImageJob(userClient: Client, organizationId: string, jobId: string, actorId: string) {
  const { data, error } = await userClient.from('design_private_experiment_jobs').select('*')
    .eq('id', jobId).eq('organization_id', organizationId).eq('owner_id', actorId).maybeSingle()
  if (error) throw error
  if (!data) throw Object.assign(new Error('Private image request not found'), { status: 404 })
  return data
}

async function reconcilePrivateImageRequest(userClient: Client, organizationId: string, actorId: string, key: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error('A stable UUID operation key is required')
  }
  const { data, error } = await userClient.from('design_private_experiment_jobs').select('*')
    .eq('organization_id', organizationId).eq('owner_id', actorId).eq('operation_key', key).maybeSingle()
  if (error) throw error
  return data || { status: 'not_submitted', operation_key: key }
}

async function privateImageConnection(admin: ScopedClient, connectionId: string) {
  const { data, error } = await admin.from('integration_connections')
    .select('id, provider, status, secret_name, integration_connection_departments!inner(department_id)')
    .eq('id', connectionId).eq('organization_id', admin.organizationId)
    .eq('provider', 'openai').eq('status', 'verified').is('archived_at', null)
    .eq('integration_connection_departments.department_id', 'design').maybeSingle()
  if (error) throw error
  const credential = data?.secret_name ? Deno.env.get(String(data.secret_name)) : null
  const { count, error: mappingError } = await admin.from('integration_connection_engagements')
    .select('connection_id', { count: 'exact', head: true })
    .eq('organization_id', admin.organizationId).eq('connection_id', connectionId)
  if (mappingError) throw mappingError
  if (!data || !credential || count !== 0) throw new Error('A separate verified organization-level Design OpenAI connection is required')
  return { connection: data, credential }
}

export async function reservePrivateImageJob(admin: ScopedClient, input: {
  ownerId: string, versionId: string, modelId: string, connectionId: string,
  requestKey: string, checksum: string, prompt: string, providerSize: string,
}) {
  const identity = { organization_id: admin.organizationId, owner_id: input.ownerId,
    creative_brief_version_id: input.versionId, model_registry_id: input.modelId,
    connection_id: input.connectionId, operation_key: input.requestKey,
    request_checksum: input.checksum, prompt: input.prompt, provider_size: input.providerSize }
  const { data: inserted, error: insertError } = await admin.from('design_private_experiment_jobs')
    .insert(identity).select('*').single()
  if (!insertError && inserted) return inserted
  if (insertError?.code !== '23505') throw insertError || new Error('Private image request was not reserved')
  const { data: existing, error } = await admin.from('design_private_experiment_jobs').select('*')
    .eq('organization_id', admin.organizationId).eq('owner_id', input.ownerId)
    .eq('operation_key', input.requestKey).maybeSingle()
  if (error) throw error
  if (!existing) throw insertError
  if (existing.request_checksum !== input.checksum || existing.creative_brief_version_id !== input.versionId
    || existing.model_registry_id !== input.modelId || existing.connection_id !== input.connectionId
    || existing.prompt !== input.prompt || existing.provider_size !== input.providerSize) {
    throw Object.assign(new Error('Operation key belongs to a different private image request'), { status: 409 })
  }
  return existing
}

async function generatePrivateImage(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const versionId = requiredActionId(body.creative_brief_version_id, 'Private brief version')
  const modelId = requiredActionId(body.model_registry_id, 'Image model')
  const connectionId = requiredActionId(body.connection_id, 'Design connection')
  const prompt = text(body.prompt, 6000)
  if (!prompt) throw new Error('Add a private image prompt')
  const providerSize = text(body.provider_size, 20)
  if (!['1024x1024', '1024x1536', '1536x1024'].includes(providerSize)) {
    throw new Error('Choose an explicitly supported image size')
  }
  const requestKey = text(body.operation_key, 80)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw new Error('A stable UUID operation key is required')
  }
  const { data: version, error: versionError } = await userClient.from('design_creative_brief_versions')
    .select('id, organization_id, creative_brief_id, design_creative_briefs!inner(id, visibility, created_by, frozen_version_id)')
    .eq('id', versionId).eq('organization_id', admin.organizationId).maybeSingle()
  if (versionError) throw versionError
  const brief = Array.isArray(version?.design_creative_briefs)
    ? version.design_creative_briefs[0] : version?.design_creative_briefs
  if (!version || !brief || brief.visibility !== 'private' || brief.created_by !== actorId
    || brief.frozen_version_id !== version.id) {
    throw Object.assign(new Error('Only the owner can generate from the exact frozen private brief version'), { status: 403 })
  }
  const { data: model, error: modelError } = await admin.from('design_model_registry').select('id, model_id, provider, supported_output_types, is_active')
    .eq('id', modelId).eq('organization_id', admin.organizationId).eq('is_active', true).maybeSingle()
  if (modelError) throw modelError
  if (!model || model.provider !== 'openai' || !supportsOutput(model, 'image')) {
    throw new Error('Select an active image-capable Design model')
  }
  const { credential } = await privateImageConnection(admin, connectionId)
  const checksum = await sha256(stableJson({ version_id: versionId, model_id: modelId, connection_id: connectionId, prompt, provider_size: providerSize }))
  const job = await reservePrivateImageJob(admin, {
    ownerId: actorId, versionId, modelId, connectionId, requestKey,
    checksum, prompt, providerSize,
  })
  if (!job || job.status !== 'queued') return job
  const { data: claimed, error: claimError } = await admin.from('design_private_experiment_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id).eq('organization_id', admin.organizationId).eq('status', 'queued').select('*').maybeSingle()
  if (claimError) throw claimError
  if (!claimed) return privateImageJob(userClient, admin.organizationId, String(job.id), actorId)
  let phase: 'provider' | 'storage' | 'registration' = 'provider'
  const storagePath = `${admin.organizationId}/private/${actorId}/${claimed.id}.png`
  let uploaded = false
  try {
    const bytes = await generateOpenAiImage(credential, String(model.model_id), prompt, providerSize)
    pngDimensions(bytes)
    phase = 'storage'
    const { error: uploadError } = await admin.storage.from(MEDIA_BUCKET).upload(storagePath, bytes, {
      contentType: 'image/png', upsert: false,
    })
    if (uploadError) throw uploadError
    uploaded = true
    phase = 'registration'
    const { data: completed, error: completeError } = await admin.from('design_private_experiment_jobs')
      .update({ status: 'succeeded', storage_path: storagePath, completed_at: new Date().toISOString() })
      .eq('id', claimed.id).eq('organization_id', admin.organizationId).eq('status', 'running').select('*').single()
    if (completeError) throw completeError
    return completed
  } catch (error) {
    if (uploaded) {
      const { error: cleanupError } = await admin.storage.from(MEDIA_BUCKET).remove([storagePath])
      if (cleanupError) throw new Error(`Private image registration and cleanup failed: ${cleanupError.message}`)
    }
    const unknown = phase === 'provider' && !(error instanceof ConfirmedProviderFailure)
    const { data: failed, error: failError } = await admin.from('design_private_experiment_jobs')
      .update({ status: unknown ? 'outcome_unknown' : 'failed', failure_phase: phase,
        failure_reason: (error instanceof Error ? error.message : 'Private image generation failed').slice(0, 2000),
        completed_at: new Date().toISOString() })
      .eq('id', claimed.id).eq('organization_id', admin.organizationId).eq('status', 'running').select('*').single()
    if (failError) throw failError
    return failed
  }
}

async function signPrivateImageJob(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const job = await privateImageJob(userClient, admin.organizationId, requiredActionId(body.job_id, 'Private image request'), actorId)
  if (job.status !== 'succeeded' || job.storage_path !== `${admin.organizationId}/private/${actorId}/${job.id}.png`) {
    throw new Error('Private image is not ready')
  }
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(job.storage_path, 300)
  if (error || !data?.signedUrl) throw error || new Error('Private image could not be opened')
  return { job_id: job.id, signed_url: data.signedUrl, expires_in: 300 }
}

async function privatePromotionPreview(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const job = await privateImageJob(userClient, admin.organizationId, requiredActionId(body.job_id, 'Private image request'), actorId)
  if (job.status !== 'succeeded' || job.storage_path !== `${admin.organizationId}/private/${actorId}/${job.id}.png`) {
    throw new Error('Only a stored successful private image can be promoted')
  }
  const engagementId = requiredActionId(body.target_engagement_id, 'Target engagement')
  const serviceId = requiredActionId(body.target_service_id, 'Target Design service')
  const { data: engagement, error: engagementError } = await userClient.from('engagements')
    .select('id, organization_id, brand_id, name').eq('id', engagementId)
    .eq('organization_id', admin.organizationId).maybeSingle()
  if (engagementError) throw engagementError
  const { data: service, error: serviceError } = await userClient.from('engagement_services')
    .select('id, organization_id, engagement_id, status, service_catalog!inner(department_id, is_active)')
    .eq('id', serviceId).eq('organization_id', admin.organizationId)
    .eq('engagement_id', engagementId).eq('status', 'active')
    .eq('service_catalog.department_id', 'design').eq('service_catalog.is_active', true).maybeSingle()
  if (serviceError) throw serviceError
  if (!engagement?.brand_id || !service) throw new Error('Choose an accessible engagement with an active Design service')
  const { data: version, error: versionError } = await userClient.from('design_creative_brief_versions')
    .select('id, content').eq('id', job.creative_brief_version_id)
    .eq('organization_id', admin.organizationId).maybeSingle()
  if (versionError) throw versionError
  if (!version) throw new Error('Private source brief version is unavailable')
  const content = version.content as Json
  const name = text(content.title, 180) || `Private image ${String(job.id).slice(0, 8)}`
  const placement = text(content.placement_destination, 500)
  const rightsNotes = text(content.rights_notes, 2000)
  const checksum = await sha256(stableJson({ source_job_id: job.id, storage_path: job.storage_path,
    brief_version_id: version.id, target_engagement_id: engagementId,
    target_brand_id: engagement.brand_id, target_service_id: serviceId, name, placement, rights_notes: rightsNotes }))
  return { job, engagement, service, version, name, placement, rightsNotes, checksum }
}

async function promotePrivateImage(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const requestKey = text(body.operation_key, 80)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw new Error('A stable UUID promotion key is required')
  }
  const expectedChecksum = text(body.expected_preview_checksum, 64)
  const sourceJobId = requiredActionId(body.job_id, 'Private image request')
  const targetEngagementId = requiredActionId(body.target_engagement_id, 'Target engagement')
  const targetServiceId = requiredActionId(body.target_service_id, 'Target Design service')
  const { data: existing, error: existingError } = await admin.from('design_private_experiment_promotions').select('*')
    .eq('organization_id', admin.organizationId).eq('owner_id', actorId)
    .eq('operation_key', requestKey).maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    if (existing.request_checksum !== expectedChecksum || existing.source_job_id !== sourceJobId
      || existing.target_engagement_id !== targetEngagementId || existing.target_service_id !== targetServiceId) {
      throw Object.assign(new Error('Promotion key belongs to a different exact source or target'), { status: 409 })
    }
    return { promotion: existing, idempotent_replay: true }
  }
  const preview = await privatePromotionPreview(admin, userClient, body, actorId)
  if (expectedChecksum !== preview.checksum) {
    throw Object.assign(new Error('Private promotion preview is stale; review the exact target again'), { status: 409 })
  }
  const { data: object, error: downloadError } = await admin.storage.from(MEDIA_BUCKET).download(String(preview.job.storage_path))
  if (downloadError || !object) throw downloadError || new Error('Private source image is unavailable')
  const bytes = new Uint8Array(await object.arrayBuffer())
  pngDimensions(bytes)
  const result = await uploadDesignAssetVersion(admin, {
    engagement_id: preview.engagement.id, brand_id: preview.engagement.brand_id,
    operation_key: requestKey, name: preview.name, placement: preview.placement,
    rights_notes: preview.rightsNotes, change_summary: 'Promoted from an owner-private Design experiment.',
    original_filename: 'private-experiment.png', mime_type: 'image/png',
    file_base64: Buffer.from(bytes).toString('base64'),
    private_promotion_job_id: preview.job.id,
    private_promotion_service_id: preview.service.id,
    private_promotion_checksum: preview.checksum,
  }, actorId)
  const { data: linked, error: linkError } = await admin.from('design_private_experiment_promotions').select('*')
    .eq('organization_id', admin.organizationId).eq('owner_id', actorId)
    .eq('operation_key', requestKey).maybeSingle()
  if (linkError) throw linkError
  if (!linked || linked.asset_version_id !== result.version.id || linked.request_checksum !== preview.checksum) {
    throw new Error('Private promotion registration is incomplete; retry the same operation key')
  }
  return { promotion: linked, asset: result.asset, version: result.version,
    idempotent_replay: result.idempotent_replay }
}

async function generateImage(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const directionVersionId = text(body.direction_version_id, 80)
  const modelRegistryId = text(body.model_registry_id, 80)
  const { version } = await loadPermittedDirectionVersion(userClient, admin.organizationId, directionVersionId)
  const prompt = mediaPrompt((version.content as Json) || {}, body.prompt)
  if (!prompt) throw new Error('Add an image prompt or complete the direction imagery and creative thesis')
  const checksum = await sha256(imageGenerationRequestChecksum(version.id, modelRegistryId, prompt))
  const job = await reserveImageGenerationJob(admin, {
    directionVersionId: version.id,
    modelRegistryId,
    actorId,
    operationKey: operationKey(body.operation_key),
    requestChecksum: checksum,
    prompt,
  })
  if (job.status !== 'queued') return job
  return executeImageGenerationJob(admin, userClient, job, actorId)
}

async function getImageGenerationJob(admin: ScopedClient, body: Json) {
  return loadImageGenerationJob(admin, requiredActionId(body.job_id, 'Generation request'))
}

async function retryImageGeneration(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const source = await loadImageGenerationJob(admin, requiredActionId(body.job_id, 'Generation request'))
  if (!canRetryImageGenerationJob(source as Json)) {
    throw Object.assign(new Error('Only a confirmed provider failure can be retried'), { status: 409 })
  }
  const job = await reserveImageGenerationJob(admin, {
    directionVersionId: String(source.direction_version_id),
    modelRegistryId: String(source.model_registry_id),
    actorId,
    operationKey: operationKey(body.operation_key),
    requestChecksum: String(source.request_checksum),
    prompt: String(source.prompt),
    retryOfJobId: String(source.id),
  })
  if (job.status !== 'queued') return job
  return executeImageGenerationJob(admin, userClient, job, actorId)
}

async function loadPermittedContentRequest(userClient: Client, organizationId: string, contentRequestId: string) {
  const { data: request, error } = await userClient.from('content_requests')
    .select('id, organization_id, engagement_id, brand_id, output_path, mode, format, brief')
    .eq('id', contentRequestId).eq('organization_id', organizationId).maybeSingle()
  if (error) throw error
  if (!request || request.mode !== 'project' || !request.engagement_id) {
    throw new Error('Project content request not found or not visible')
  }
  if (request.output_path !== 'internal_engine' || request.format === 'article') {
    throw new Error('Only visual internal-engine requests can generate media')
  }
  return request
}

async function generateContentRequestImage(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const request = await loadPermittedContentRequest(userClient, admin.organizationId, text(body.content_request_id, 80))
  const prompt = text(body.prompt, 6000) || text(request.brief, 6000)
  if (!prompt) throw new Error('Add an image prompt or complete the content request brief')
  return generateImageForTarget(admin, {
    directionVersionId: null,
    contentRequestId: request.id,
    engagementId: request.engagement_id,
    modelRegistryId: text(body.model_registry_id, 80),
    prompt,
    actorId,
  })
}

export async function requireReleasedVariantSource(admin: ScopedClient, userClient: Client, directionVersionId: string) {
  const source = await loadPermittedDirectionVersion(userClient, admin.organizationId, directionVersionId)
  const { data: release, error: releaseError } = await admin.from('design_direction_releases').select('id, direction_version_id')
    .eq('organization_id', admin.organizationId).eq('direction_version_id', source.version.id).maybeSingle()
  if (releaseError) throw releaseError
  if (!release) throw new Error('Variants can only be generated from a released direction version')
  const { data: engagementService, error: serviceError } = await admin.from('engagement_services')
    .select('id, service_catalog!inner(slug)')
    .eq('id', source.session.engagement_service_id).eq('organization_id', admin.organizationId)
    .eq('engagement_id', source.session.engagement_id).maybeSingle()
  if (serviceError) throw serviceError
  const catalog = Array.isArray(engagementService?.service_catalog)
    ? engagementService.service_catalog[0] : engagementService?.service_catalog
  const serviceSlug = text(catalog?.slug, 80)
  if (!engagementService || !VARIANT_SERVICE_SLUGS.has(serviceSlug)) {
    throw new Error('Variants are available only for Social Assets and Advertising Assets sessions')
  }
  return { ...source, release, serviceSlug }
}

export async function runIndependentVariantJobs(formats: string[], processor: (format: string) => Promise<unknown>) {
  const results = []
  for (const format of formats) {
    try {
      results.push(await processor(format))
    } catch (error) {
      results.push({ variant_format: format, status: 'failed', error: error instanceof Error ? error.message : 'Variant generation failed' })
    }
  }
  return results
}

async function generateVariants(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const directionVersionId = text(body.source_direction_version_id, 80)
  const requestedFormats = [...new Set(strings(body.variant_formats, 6))]
  if (!requestedFormats.length) throw new Error('Select at least one variant format')
  requestedFormats.forEach(variantFormatSpec)
  const source = await requireReleasedVariantSource(admin, userClient, directionVersionId)

  return runIndependentVariantJobs(requestedFormats, async format => {
    const spec = variantFormatSpec(format)
    const prompt = variantPrompt((source.version.content as Json) || {}, format)
    const { data: variant, error: variantError } = await admin.from('design_direction_variants').insert({
      organization_id: admin.organizationId, source_direction_version_id: source.version.id,
      variant_format: format, status: 'pending', created_by: actorId,
    }).select('*').single()
    if (variantError) throw variantError
    try {
      const { error: generatingError } = await admin.from('design_direction_variants').update({ status: 'generating' })
        .eq('id', variant.id).eq('organization_id', admin.organizationId)
      if (generatingError) throw generatingError
      const asset = await generateImageForTarget(admin, {
        directionVersionId: source.version.id,
        contentRequestId: null,
        engagementId: source.session.engagement_id,
        modelRegistryId: text(body.model_registry_id, 80),
        prompt,
        actorId,
        providerSize: spec.providerSize,
        targetWidth: spec.width,
        targetHeight: spec.height,
        onAssetReserved: async reserved => {
          const { error: linkError } = await admin.from('design_direction_variants')
            .update({ design_media_asset_id: reserved.id }).eq('id', variant.id)
            .eq('organization_id', admin.organizationId)
          if (linkError) throw linkError
        },
      })
      const status = asset?.status === 'ready' ? 'ready' : 'failed'
      const { data: finished, error: finishError } = await admin.from('design_direction_variants').update({
        status,
      }).eq('id', variant.id).eq('organization_id', admin.organizationId).select('*').single()
      if (finishError) throw finishError
      return { ...finished, media_asset: asset }
    } catch (error) {
      const { error: failedStatusError } = await admin.from('design_direction_variants').update({ status: 'failed' })
        .eq('id', variant.id).eq('organization_id', admin.organizationId)
      if (failedStatusError) {
        throw new Error(`Variant generation failed and its status could not be recorded: ${failedStatusError.message}`)
      }
      throw error
    }
  })
}

async function createVideoPlaceholder(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const directionVersionId = text(body.direction_version_id, 80)
  const { version } = await loadPermittedDirectionVersion(userClient, admin.organizationId, directionVersionId)
  const prompt = mediaPrompt((version.content as Json) || {}, body.prompt)
  if (!prompt) throw new Error('Add a video prompt or complete the direction imagery and creative thesis')
  const { data, error } = await admin.from('design_media_assets').insert({
    organization_id: admin.organizationId, design_direction_version_id: version.id,
    media_type: 'video', status: 'unavailable', prompt,
    failure_reason: VIDEO_UNAVAILABLE_MESSAGE, generated_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function createContentRequestVideoPlaceholder(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const request = await loadPermittedContentRequest(userClient, admin.organizationId, text(body.content_request_id, 80))
  const prompt = text(body.prompt, 6000) || text(request.brief, 6000)
  if (!prompt) throw new Error('Add a video prompt or complete the content request brief')
  const { data, error } = await admin.from('design_media_assets').insert({
    organization_id: admin.organizationId, content_request_id: request.id,
    media_type: 'video', status: 'unavailable', prompt,
    failure_reason: VIDEO_UNAVAILABLE_MESSAGE, generated_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function signMediaAssets(admin: ScopedClient, userClient: Client, body: Json) {
  const assetIds = uniqueIds(body.asset_ids)
  if (!assetIds.length) return { signed_urls: {}, expires_in: 300 }
  const { data: assets, error } = await userClient.from('design_media_assets').select('id, storage_path')
    .in('id', assetIds).eq('organization_id', admin.organizationId).eq('media_type', 'image').eq('status', 'ready')
  if (error) throw error
  const signable = (assets || []).filter(asset => asset.storage_path)
  if (!signable.length) return { signed_urls: {}, expires_in: 300 }
  const { data: signed, error: signedError } = await admin.storage.from(MEDIA_BUCKET)
    .createSignedUrls(signable.map(asset => asset.storage_path), 300)
  if (signedError) throw signedError
  const signedUrls = Object.fromEntries(signable.map((asset, index) => [asset.id, signed?.[index]?.signedUrl || null]))
  return { signed_urls: signedUrls, expires_in: 300 }
}

async function signAssetVersions(admin: ScopedClient, userClient: Client, body: Json) {
  const versionIds = uniqueIds(body.version_ids)
  if (!versionIds.length) return { signed_urls: {}, expires_in: 300 }
  const { data: versions, error } = await userClient.from('design_asset_versions')
    .select('id, storage_bucket, storage_path').in('id', versionIds)
    .eq('organization_id', admin.organizationId)
  if (error || versions?.length !== versionIds.length) {
    throw Object.assign(new Error('One or more Design asset versions are not visible'), { status: 404 })
  }
  const signable = versions.filter(version => version.storage_bucket === DESIGN_ASSET_BUCKET
    && String(version.storage_path || '').startsWith(`${admin.organizationId}/`))
  if (signable.length !== versionIds.length) {
    throw Object.assign(new Error('One or more Design asset version objects are outside the configured bucket'), { status: 409 })
  }
  const { data: signed, error: signedError } = await admin.storage.from(DESIGN_ASSET_BUCKET)
    .createSignedUrls(signable.map(version => version.storage_path), 300)
  if (signedError) throw signedError
  return {
    signed_urls: Object.fromEntries(signable.map((version, index) => [version.id, signed?.[index]?.signedUrl || null])),
    expires_in: 300,
  }
}

async function validateExperimentReviewers(admin: ScopedClient, reviewerIds: string[], actorId: string) {
  const invited = reviewerIds.filter(id => id !== actorId)
  if (!invited.length) return []
  const { data, error } = await admin.from('organization_memberships').select('user_id')
    .eq('organization_id', admin.organizationId).eq('member_kind', 'team').eq('status', 'active').in('user_id', invited)
  if (error) throw error
  if (data?.length !== invited.length) throw new Error('Every experiment reviewer must be an active team member')
  return invited
}

async function insertDirectionVersion(admin: ScopedClient, directionId: string, parent: any, content: Json,
  actorId: string, isExperimental: boolean, experimentVisibility: string[] | null,
  creativeBriefVersionId: string | null = parent?.creative_brief_version_id || null) {
  const { data: latest, error: latestError } = await admin.from('design_direction_versions').select('version_number')
    .eq('direction_id', directionId).eq('organization_id', admin.organizationId).order('version_number', { ascending: false }).limit(1).single()
  if (latestError) throw latestError
  const checksum = await sha256(stableJson(content))
  const { data: version, error } = await admin.from('design_direction_versions').insert({
    organization_id: admin.organizationId, direction_id: directionId, version_number: latest.version_number + 1,
    parent_version_id: parent.id, content, content_checksum: checksum,
    distinctness_signature: await sha256(directionText(content).toLowerCase()), created_by: actorId,
    is_experimental: isExperimental, experiment_visibility: isExperimental ? experimentVisibility : null,
    creative_brief_version_id: creativeBriefVersionId,
  }).select('*').single()
  if (error) throw error
  return version
}

async function createDirectionRevision(admin: ScopedClient, body: Json, actorId: string) {
  const directionId = text(body.direction_id, 80)
  const { data: direction } = await admin.from('design_directions').select('id, session_id')
    .eq('id', directionId).eq('organization_id', admin.organizationId).maybeSingle()
  if (!direction) throw new Error('Direction not found')
  const parentId = text(body.parent_version_id, 80)
  const { data: parent } = await admin.from('design_direction_versions').select('id, direction_id, is_experimental, creative_brief_version_id')
    .eq('id', parentId).eq('organization_id', admin.organizationId).eq('direction_id', direction.id).maybeSingle()
  if (!parent) throw new Error('Parent direction version not found')
  if (parent.is_experimental) throw new Error('Use the dedicated promotion action for an experimental version')
  const content = body.content && typeof body.content === 'object' && !Array.isArray(body.content) ? body.content as Json : null
  if (!content || !text(content.title) || !text(content.rationale)) throw new Error('A complete direction revision is required')
  const isExperimental = body.is_experimental === true
  const reviewers = isExperimental
    ? await validateExperimentReviewers(admin, uniqueIds(body.experiment_visibility), actorId)
    : null
  const creativeBriefVersionId = text(body.creative_brief_version_id, 80) || parent.creative_brief_version_id || null
  if (creativeBriefVersionId) {
    const { data: session } = await admin.from('design_workshop_sessions').select('engagement_id')
      .eq('id', direction.session_id).eq('organization_id', admin.organizationId).maybeSingle()
    const { data: briefVersion } = await admin.from('design_creative_brief_versions')
      .select('id, design_creative_briefs!inner(engagement_id, visibility)')
      .eq('id', creativeBriefVersionId).eq('organization_id', admin.organizationId).maybeSingle()
    const brief = Array.isArray(briefVersion?.design_creative_briefs)
      ? briefVersion.design_creative_briefs[0] : briefVersion?.design_creative_briefs
    if (!session || !briefVersion || brief?.visibility !== 'official' || brief?.engagement_id !== session.engagement_id) {
      throw new Error('Direction drafts require an exact official brief version from this engagement')
    }
  }
  return insertDirectionVersion(admin, direction.id, parent, content, actorId, isExperimental, reviewers, creativeBriefVersionId)
}

async function listExperimentReviewers(admin: ScopedClient, membership: Json) {
  const role = text(membership.role, 60)
  if (text(membership.department_id, 60) !== 'design' && !LEADER_ROLES.has(role)) return []
  const { data: memberships, error } = await admin.from('organization_memberships').select('user_id, role, department_id')
    .eq('organization_id', admin.organizationId).eq('member_kind', 'team').eq('status', 'active').order('department_id')
  if (error) throw error
  const ids = (memberships || []).map(item => item.user_id)
  const { data: profiles, error: profileError } = ids.length
    ? await admin.from('profiles').select('id, full_name').in('id', ids)
    : { data: [], error: null }
  if (profileError) throw profileError
  const names = new Map((profiles || []).map(item => [item.id, item.full_name]))
  return (memberships || []).map(item => ({ ...item, full_name: names.get(item.user_id) || 'Team member' }))
}

async function promoteDirectionExperiment(admin: ScopedClient, body: Json, actorId: string) {
  const versionId = text(body.direction_version_id, 80)
  const { data: experiment, error } = await admin.from('design_direction_versions').select('*')
    .eq('id', versionId).eq('organization_id', admin.organizationId).eq('is_experimental', true).maybeSingle()
  if (error) throw error
  if (!experiment) throw new Error('Experimental direction version not found')
  const invited = Array.isArray(experiment.experiment_visibility) ? experiment.experiment_visibility : []
  if (experiment.created_by !== actorId && !invited.includes(actorId)) {
    throw new Error('Only the experiment creator or an invited reviewer can promote it')
  }
  return insertDirectionVersion(admin, experiment.direction_id, experiment, experiment.content, actorId, false, null)
}

async function selectDirection(admin: ScopedClient, body: Json, actorId: string) {
  const sessionId = text(body.session_id, 80); const versionId = text(body.direction_version_id, 80)
  const { data: session } = await admin.from('design_workshop_sessions').select('id, engagement_id')
    .eq('id', sessionId).eq('organization_id', admin.organizationId).eq('status', 'comparison').maybeSingle()
  if (!session) throw new Error('Session is not ready for selection')
  const { data: version } = await admin.from('design_direction_versions').select('id, direction_id').eq('id', versionId)
    .eq('organization_id', admin.organizationId).eq('is_experimental', false).maybeSingle()
  const { data: direction } = version
    ? await admin.from('design_directions').select('id').eq('id', version.direction_id).eq('organization_id', admin.organizationId).eq('session_id', session.id).maybeSingle()
    : { data: null }
  if (!version || !direction) throw new Error('Direction version is outside this session')
  const { data, error } = await admin.from('design_direction_selections').insert({
    organization_id: admin.organizationId, engagement_id: session.engagement_id, session_id: session.id,
    direction_version_id: version.id, notes: text(body.notes, 2000), selected_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function releaseDirection(admin: ScopedClient, body: Json, actorId: string) {
  const sessionId = text(body.session_id, 80)
  const { data: session } = await admin.from('design_workshop_sessions').select('id, engagement_id')
    .eq('id', sessionId).eq('organization_id', admin.organizationId).eq('status', 'comparison').maybeSingle()
  const { data: selection } = session
    ? await admin.from('design_direction_selections').select('*').eq('session_id', session.id).eq('organization_id', admin.organizationId).maybeSingle()
    : { data: null }
  if (!session || !selection) throw new Error('A human-selected direction is required before release')
  const { data: version } = await admin.from('design_direction_versions').select('id, direction_id')
    .eq('id', selection.direction_version_id).eq('organization_id', admin.organizationId).eq('is_experimental', false).maybeSingle()
  if (!version) throw new Error('Selected direction version is unavailable')
  const { data: release, error } = await admin.from('design_direction_releases').insert({
    organization_id: admin.organizationId, engagement_id: session.engagement_id, session_id: session.id,
    direction_version_id: version.id, release_notes: text(body.release_notes, 2000), released_by: actorId,
  }).select('*').single()
  if (error) throw error
  await admin.from('design_workshop_sessions').update({ status: 'released' }).eq('id', session.id).eq('organization_id', admin.organizationId)
  await insertEvent(admin, session.engagement_id, 'design_direction_released', actorId,
    'design_direction', version.direction_id, version.id, 'released')
  return release
}

export async function getDesignVideoQuote(admin: ScopedClient, body: Json, actorId: string) {
  const duration = body.duration_seconds
  const resolution = body.resolution
  const aspectRatio = body.aspect_ratio
  const outputFormat = body.output_format
  const generateAudio = body.generate_audio
  if (!Number.isInteger(duration) || (duration as number) < 4 || (duration as number) > 30
    || !['480p', '720p'].includes(resolution as string)
    || !['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].includes(aspectRatio as string)
    || !['mp4', 'mov'].includes(outputFormat as string)
    || typeof generateAudio !== 'boolean') {
    throw Object.assign(new Error('Exact supported video settings are required'), { status: 400 })
  }
  const { data, error } = await admin.rpc('get_design_video_quote', {
    p_organization_id: admin.organizationId,
    p_direction_version_id: requiredActionId(body.direction_version_id, 'Direction version'),
    p_actor_id: actorId,
    p_duration_seconds: duration,
    p_resolution: resolution,
    p_aspect_ratio: aspectRatio,
    p_output_format: outputFormat,
    p_generate_audio: generateAudio,
  })
  if (error || !data || typeof data !== 'object') {
    throw Object.assign(new Error('Video price readiness is unavailable'), { status: 503 })
  }
  const readiness = data as { quote?: unknown, organization_cap_configured?: unknown }
  if (readiness.quote) {
    requireFreshVideoQuote({
      duration, resolution, aspect_ratio: aspectRatio,
      output_format: outputFormat, generate_audio: generateAudio,
    }, readiness.quote)
  }
  return {
    quote: readiness.quote || null,
    organization_cap_configured: readiness.organization_cap_configured === true,
    paid_execution_enabled: false,
  }
}

async function loadActorDesignVideoJob(admin: ScopedClient, body: Json, actorId: string): Promise<Json> {
  const { data, error } = await admin.rpc('get_design_video_job', {
    p_organization_id: admin.organizationId,
    p_job_id: requiredActionId(body.job_id, 'Video job'),
    p_actor_id: actorId,
  })
  if (error || !data || typeof data !== 'object') {
    throw Object.assign(new Error('Video job is unavailable'), { status: 404 })
  }
  return data as Json
}

export async function getDesignVideoJob(admin: ScopedClient, body: Json, actorId: string) {
  const job = await loadActorDesignVideoJob(admin, body, actorId)
  return {
    id: job.id, direction_version_id: job.direction_version_id,
    status: job.status, mode: job.mode,
    duration_seconds: job.duration_seconds, resolution: job.resolution,
    aspect_ratio: job.aspect_ratio, output_format: job.output_format,
    generate_audio: job.generate_audio,
    failure_reason: job.failure_reason,
    created_at: job.created_at, updated_at: job.updated_at,
  }
}

export async function listDesignVideoJobs(admin: ScopedClient, body: Json, actorId: string) {
  const beforeCreatedAt = body.before_created_at
  const beforeId = body.before_id
  if ((beforeCreatedAt == null) !== (beforeId == null)
    || (beforeCreatedAt != null && (typeof beforeCreatedAt !== 'string'
      || beforeCreatedAt.length > 40 || !Number.isFinite(Date.parse(beforeCreatedAt))))) {
    throw Object.assign(new Error('Complete video history cursor is required'), { status: 400 })
  }
  const { data, error } = await admin.rpc('list_design_video_jobs', {
    p_organization_id: admin.organizationId,
    p_direction_version_id: requiredActionId(body.direction_version_id, 'Direction version'),
    p_actor_id: actorId,
    p_before_created_at: beforeCreatedAt || null,
    p_before_id: beforeId == null ? null : requiredActionId(beforeId, 'Video history cursor'),
  })
  if (error || !Array.isArray(data)) {
    throw Object.assign(new Error('Private video history is unavailable'), { status: 503 })
  }
  return data
}

const VIDEO_BUCKET = 'design-generated-video'

export async function ingestDesignVideoOutput(admin: ScopedClient, body: Json, actorId: string,
  fetcher: typeof fetch = fetch) {
  // Never fetch provider metadata supplied in this request. Only the original
  // owner can recover the private, immutable output URL in the job ledger.
  const job = await loadActorDesignVideoJob(admin, body, actorId)
  if (job.status === 'ready') return { status: 'ready', job_id: job.id }
  if (job.status !== 'provider_completed' || typeof job.provider_output_url !== 'string'
    || typeof job.dispatch_claim_id !== 'string' || typeof job.output_format !== 'string') {
    throw Object.assign(new Error('Completed private video output is unavailable'), { status: 409 })
  }
  const allowedHosts = (Deno.env.get('DESIGN_VIDEO_OUTPUT_ALLOWED_HOSTS') || '')
    .split(',').map(host => host.trim().toLowerCase()).filter(Boolean)
  const output = await fetchDesignVideoOutput(job.provider_output_url, allowedHosts,
    job.output_format as 'mp4' | 'mov', fetcher)
  const path = `${admin.organizationId}/${job.direction_version_id}/${job.id}/output.${job.output_format}`
  const bucket = admin.storage.from(VIDEO_BUCKET)
  const { error: uploadError } = await bucket.upload(path, output.bytes, {
    contentType: output.contentType, upsert: false,
  })
  if (uploadError) {
    // A prior upload may have succeeded before the Edge response was lost.
    // Verify its exact bytes before reusing it; never overwrite blindly.
    const { data: existing, error: downloadError } = await bucket.download(path)
    if (downloadError || !existing || existing.size !== output.byteLength
      || existing.type.split(';')[0].toLowerCase() !== output.contentType) {
      throw Object.assign(new Error('Private video storage conflict'), { status: 409 })
    }
    const digest = await crypto.subtle.digest('SHA-256', await existing.arrayBuffer())
    const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (checksum !== output.checksum) {
      throw Object.assign(new Error('Private video storage conflict'), { status: 409 })
    }
  }
  const { data: completed, error: completeError } = await admin.rpc('complete_design_video_storage', {
    p_organization_id: admin.organizationId, p_job_id: job.id, p_actor_id: actorId,
    p_claim_id: job.dispatch_claim_id, p_storage_path: path,
    p_sha256: output.checksum, p_byte_length: output.byteLength,
    p_mime_type: output.contentType,
  })
  if (completeError || completed?.status !== 'ready') {
    throw Object.assign(new Error('Private video completion is pending recovery'), { status: 503 })
  }
  return { status: 'ready', job_id: job.id }
}

export async function signDesignVideoOutput(admin: ScopedClient, body: Json, actorId: string) {
  const job = await loadActorDesignVideoJob(admin, body, actorId)
  if (job.status !== 'ready' || typeof job.output_storage_path !== 'string') {
    throw Object.assign(new Error('Ready private video is unavailable'), { status: 409 })
  }
  const path = `${admin.organizationId}/${job.direction_version_id}/${job.id}/output.${job.output_format}`
  if (job.output_storage_path !== path) {
    throw Object.assign(new Error('Private video storage identity is invalid'), { status: 409 })
  }
  const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) {
    throw Object.assign(new Error('Private video preview is unavailable'), { status: 503 })
  }
  return { job_id: job.id, signed_url: data.signedUrl, expires_in: 60 }
}

export async function pollDesignVideoJob(admin: ScopedClient, body: Json, actorId: string,
  reader: typeof fetch = fetch) {
  const job = await loadActorDesignVideoJob(admin, body, actorId)
  if (job.status !== 'provider_pending' || typeof job.provider_request_id !== 'string'
    || typeof job.provider_status_url !== 'string'
    || typeof job.dispatch_claim_id !== 'string'
    || typeof job.connector_connection_id !== 'string') {
    throw Object.assign(new Error('Original video status request is unavailable'), { status: 409 })
  }
  const { data: connection, error: connectionError } = await admin.from('integration_connections')
    .select('id,provider,status,secret_name').eq('id', job.connector_connection_id)
    .eq('organization_id', admin.organizationId).eq('provider', 'higgsfield')
    .eq('status', 'verified').is('archived_at', null).maybeSingle()
  if (connectionError || !connection || typeof connection.secret_name !== 'string'
    || !/^ANKA_HIGGSFIELD_[A-Z0-9_]+$/.test(connection.secret_name)) {
    throw Object.assign(new Error('Pinned video connection is unavailable'), { status: 503 })
  }
  const credential = Deno.env.get(connection.secret_name)
  if (!credential) throw Object.assign(new Error('Video connection credential is unavailable'), { status: 503 })
  const { createHiggsfieldClient } = await import('npm:@higgsfield/client@0.2.6/v2')
  const adapter = createDesignMediaAdapter(createHiggsfieldClient, credential, reader)
  const receipt = await adapter.status(job.provider_request_id, job.provider_status_url)
  const state = receipt.state === 'pending' ? 'provider_pending' : receipt.state
  const { error } = await admin.rpc('record_design_video_provider_state', {
    p_organization_id: admin.organizationId, p_job_id: job.id,
    p_actor_id: actorId, p_claim_id: job.dispatch_claim_id,
    p_state: state, p_provider_request_id: receipt.requestId,
    p_provider_status_url: receipt.statusUrl || null,
    p_provider_output_url: receipt.outputUrl || null,
    p_evidence: state === 'provider_completed'
      ? 'Original provider request completed; private ingestion pending'
      : state === 'provider_pending' ? 'Original provider request remains pending'
      : 'Original provider request ended; billing reconciliation pending',
  })
  if (error) throw Object.assign(new Error('Video status receipt could not be recorded'), { status: 503 })
  return getDesignVideoJob(admin, { job_id: job.id }, actorId)
}

// The paid switch is intentionally absent in production. This path can only
// reach the provider after the exact job, shared budget, and single-use claim
// are durably recorded. A lost submit response remains uncertain and is never
// retried with the same operation key.
export async function generateDesignVideo(admin: ScopedClient, body: Json, actorId: string) {
  if (Deno.env.get('DESIGN_VIDEO_PAID_EXECUTION_ENABLED') !== 'true') {
    throw Object.assign(new Error('Video generation is not enabled'), { status: 503 })
  }
  const operationKey = requiredActionId(body.operation_key, 'Operation key')
  const connectionId = requiredActionId(body.connector_connection_id, 'Design video connection')
  const quoteId = requiredActionId(body.quote_id, 'Video price quote')
  if (![operationKey, connectionId, quoteId].every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) {
    throw Object.assign(new Error('Stable video request identities are required'), { status: 400 })
  }
  const prompt = text(body.prompt, 12001)
  const mode = text(body.mode, 20)
  if (!prompt || prompt.length > 12000 || !['explore', 'production'].includes(mode)) {
    throw Object.assign(new Error('Exact video prompt and mode are required'), { status: 400 })
  }
  const readiness = await getDesignVideoQuote(admin, body, actorId)
  const quote = readiness.quote as Json | null
  if (!quote || quote.id !== quoteId || readiness.organization_cap_configured !== true) {
    throw Object.assign(new Error('Exact quote and organization cap are required'), { status: 503 })
  }
  requireFreshVideoQuote({ duration: body.duration_seconds, resolution: body.resolution,
    aspect_ratio: body.aspect_ratio, output_format: body.output_format,
    generate_audio: body.generate_audio }, quote)
  const { data: connection, error: connectionError } = await admin.from('integration_connections')
    .select('id,provider,status,secret_name').eq('id', connectionId)
    .eq('organization_id', admin.organizationId).eq('provider', 'higgsfield')
    .eq('status', 'verified').is('archived_at', null).maybeSingle()
  if (connectionError || !connection || typeof connection.secret_name !== 'string'
    || !/^ANKA_HIGGSFIELD_[A-Z0-9_]+$/.test(connection.secret_name)) {
    throw Object.assign(new Error('Verified organization video connection is unavailable'), { status: 503 })
  }
  const credential = Deno.env.get(connection.secret_name)
  if (!credential) throw Object.assign(new Error('Video connection credential is unavailable'), { status: 503 })
  // The official SDK is loaded only after local gates; constructing its
  // isolated client makes no provider request. SQL rechecks connector mapping.
  const { createHiggsfieldClient } = await import('npm:@higgsfield/client@0.2.6/v2')
  const adapter = createDesignMediaAdapter(createHiggsfieldClient, credential)
  const identity = { p_organization_id: admin.organizationId,
    p_direction_version_id: requiredActionId(body.direction_version_id, 'Direction version'),
    p_actor_id: actorId }
  const { data: created, error: createError } = await admin.rpc('create_design_video_job', {
    ...identity, p_connector_connection_id: connectionId, p_quote_id: quoteId,
    p_operation_key: operationKey, p_prompt: prompt, p_mode: mode,
    p_duration_seconds: body.duration_seconds, p_resolution: body.resolution,
    p_aspect_ratio: body.aspect_ratio, p_output_format: body.output_format,
    p_generate_audio: body.generate_audio,
  })
  if (createError || !created?.job_id || !created?.request_checksum) {
    throw Object.assign(new Error('Video job could not be recorded'), { status: 503 })
  }
  if (created.idempotent_replay === true && created.status !== 'queued') {
    return getDesignVideoJob(admin, { job_id: created.job_id }, actorId)
  }
  const jobIdentity = { p_organization_id: admin.organizationId,
    p_job_id: created.job_id, p_actor_id: actorId }
  const { data: reserved, error: reserveError } = await admin.rpc('reserve_design_video_budget', jobIdentity)
  if (reserveError || reserved?.status !== 'reserved') {
    throw Object.assign(new Error('Shared video budget is unavailable'), { status: 503 })
  }
  const { data: claim, error: claimError } = await admin.rpc('claim_design_video_dispatch', {
    ...jobIdentity, p_dispatch_request_id: crypto.randomUUID(),
    p_request_checksum: created.request_checksum,
  })
  if (claimError || !claim?.claim_id) {
    throw Object.assign(new Error('Video dispatch claim is unavailable'), { status: 503 })
  }
  if (claim.must_not_submit === true) return getDesignVideoJob(admin, { job_id: created.job_id }, actorId)
  const record = async (state: string, requestId: string | null,
    statusUrl: string | null, outputUrl: string | null, evidence: string) => {
    const { error } = await admin.rpc('record_design_video_provider_state', {
      ...jobIdentity, p_claim_id: claim.claim_id, p_state: state,
      p_provider_request_id: requestId, p_provider_status_url: statusUrl,
      p_provider_output_url: outputUrl,
      p_evidence: evidence,
    })
    if (error) throw Object.assign(new Error('Video provider receipt could not be recorded'), { status: 503 })
  }
  let receipt
  try {
    receipt = await adapter.submit({ prompt, duration: body.duration_seconds as number,
      resolution: body.resolution as string, aspect_ratio: body.aspect_ratio as string,
      output_format: body.output_format as string, generate_audio: body.generate_audio as boolean })
  } catch {
    await record('outcome_unknown', null, null, null,
      'Submission outcome unavailable; manual provider reconciliation required')
    return getDesignVideoJob(admin, { job_id: created.job_id }, actorId)
  }
  const state = receipt.state === 'pending' ? 'provider_pending' : receipt.state
  await record(state, receipt.requestId, receipt.statusUrl || null, receipt.outputUrl || null,
    state === 'provider_completed' ? 'Provider completed; private output ingestion pending'
      : state === 'provider_pending' ? 'Provider accepted the original request'
      : 'Provider returned a terminal result; billing reconciliation pending')
  return getDesignVideoJob(admin, { job_id: created.job_id }, actorId)
}

async function handler(req: Request, dependencies: HandlerDependencies = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request body must be an object')
    const body = parsed as Json
    const action = text(body.action, 80)
    const preflightClient = await (dependencies.createCallerClient || callerClient)(req)
    const scope = await designWorkshopScope(preflightClient, body)
    const context = await (dependencies.resolveContext || resolveServerOrganizationContext)(req, scope)
    const admin = context.admin as ScopedClient
    admin.organizationId = context.organizationId
    const { user, membership, userClient } = context
    const actions: Record<string, () => Promise<unknown>> = {
      create_page_flow: () => createPageFlow(admin, body, user.id),
      create_session: () => createSession(admin, body, user.id),
      validate_creative_brief: async () => validateCreativeBrief(body.content),
      save_creative_brief: () => saveCreativeBrief(admin, userClient, body, user.id),
      freeze_creative_brief: () => freezeCreativeBrief(admin, body, user.id),
      set_working_direction: () => setWorkingDirection(admin, body, user.id),
      generate_directions: () => generateDirections(admin, body, user.id),
      create_direction_revision: () => createDirectionRevision(admin, body, user.id),
      list_experiment_reviewers: () => listExperimentReviewers(admin, membership as Json),
      promote_direction_experiment: () => promoteDirectionExperiment(admin, body, user.id),
      select_direction: () => selectDirection(admin, body, user.id),
      release_direction: () => releaseDirection(admin, body, user.id),
      generate_private_image: () => generatePrivateImage(admin, userClient, body, user.id),
      get_private_image_job: () => privateImageJob(userClient, admin.organizationId, requiredActionId(body.job_id, 'Private image request'), user.id),
      reconcile_private_image_request: () => reconcilePrivateImageRequest(userClient, admin.organizationId, user.id, requiredActionId(body.operation_key, 'Operation key')),
      sign_private_image_job: () => signPrivateImageJob(admin, userClient, body, user.id),
      preview_private_promotion: () => privatePromotionPreview(admin, userClient, body, user.id),
      promote_private_image: () => promotePrivateImage(admin, userClient, body, user.id),
      generate_image: () => generateImage(admin, userClient, body, user.id),
      get_image_generation_job: () => getImageGenerationJob(admin, body),
      retry_image_generation: () => retryImageGeneration(admin, userClient, body, user.id),
      generate_variants: () => generateVariants(admin, userClient, body, user.id),
      create_video_placeholder: () => createVideoPlaceholder(admin, userClient, body, user.id),
      get_video_quote: () => getDesignVideoQuote(admin, body, user.id),
      get_video_job: () => getDesignVideoJob(admin, body, user.id),
      list_video_jobs: () => listDesignVideoJobs(admin, body, user.id),
      generate_video: () => generateDesignVideo(admin, body, user.id),
      poll_video_job: () => pollDesignVideoJob(admin, body, user.id),
      ingest_video_output: () => ingestDesignVideoOutput(admin, body, user.id),
      sign_video_output: () => signDesignVideoOutput(admin, body, user.id),
      generate_content_request_image: () => generateContentRequestImage(admin, userClient, body, user.id),
      create_content_request_video_placeholder: () => createContentRequestVideoPlaceholder(admin, userClient, body, user.id),
      sign_media_assets: () => signMediaAssets(admin, userClient, body),
      upload_asset_version: () => uploadDesignAssetVersion(admin, body, user.id),
      archive_asset: () => archiveDesignAsset(admin, body, user.id),
      submit_asset_review: () => recordAssetReview(admin, userClient, body, user.id),
      decide_asset_review: () => recordAssetReview(admin, userClient, body, user.id),
      sign_asset_versions: () => signAssetVersions(admin, userClient, body),
      preview_delivery_package: () => previewDeliveryPackage(admin, userClient, body),
      save_delivery_package: () => saveDeliveryPackage(admin, userClient, body, user.id),
    }
    if (!hasWorkshopAuthority(membership as Json, action)) {
      return response({ error: 'Your department role cannot perform this action' }, 403)
    }
    return response({ data: await actions[action]() })
  } catch (error) {
    console.error('Design Workshop failure', error)
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Design Workshop failed' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(req => handler(req))

export { handler }
