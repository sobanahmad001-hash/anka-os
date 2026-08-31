import { createClient } from 'npm:@supabase/supabase-js@2.112.4'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const MEDIA_BUCKET = 'design-generated-media'
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
export const SEO_TITLE_PLACEHOLDER = 'SEO title not yet written'
export const SEO_DESCRIPTION_PLACEHOLDER = 'SEO meta description not yet written'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 8000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function outputText(result: Json) {
  if (typeof result.output_text === 'string') return result.output_text
  const output = Array.isArray(result.output) ? result.output : []
  return output.flatMap(item => {
    if (!item || typeof item !== 'object' || !Array.isArray((item as Json).content)) return []
    return ((item as Json).content as unknown[]).flatMap(part =>
      part && typeof part === 'object' && (part as Json).type === 'output_text'
        && typeof (part as Json).text === 'string' ? [(part as Json).text as string] : [])
  }).join('\n')
}

export function pageDesignSchema() {
  return {
    type: 'json_schema', name: 'anka_website_page_html_css', strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['html_content', 'css_content'],
      properties: {
        html_content: { type: 'string' },
        css_content: { type: 'string' },
      },
    },
  }
}

export function normalizePagePath(value: unknown) {
  const normalized = text(value, 240).replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0]
  return normalized.replace(/^\/+|\/+$/g, '') || 'home'
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function seoMetadata(contentPage: Json | null) {
  return {
    title: text(contentPage?.meta_title, 240) || SEO_TITLE_PLACEHOLDER,
    description: text(contentPage?.meta_description, 500) || SEO_DESCRIPTION_PLACEHOLDER,
  }
}

export function applySeoMetadata(htmlValue: unknown, title: string, description: string) {
  let html = text(htmlValue, 500000)
  const titleTag = `<title>${escapeHtml(title)}</title>`
  const descriptionTag = `<meta name="description" content="${escapeHtml(description)}">`
  html = /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, titleTag)
    : html.replace(/<\/head>/i, `${titleTag}\n</head>`)
  html = /<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i.test(html)
    ? html.replace(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i, descriptionTag)
    : html.replace(/<\/head>/i, `${descriptionTag}\n</head>`)
  return html
}

export function validatePageOutput(htmlValue: unknown, cssValue: unknown) {
  const html = text(htmlValue, 500000)
  const css = text(cssValue, 200000)
  if (!/^<!doctype html>/i.test(html) || !/<html\b/i.test(html) || !/<head\b/i.test(html)
    || !/<body\b/i.test(html) || !/<\/html>\s*$/i.test(html)) {
    throw new Error('Generated page must be a complete HTML document')
  }
  const descriptionTag = html.match(/<meta\b[^>]*>/gi)?.find(tag => /name\s*=\s*["']description["']/i.test(tag))
  if (!/<title\b[^>]*>[^<]+<\/title>/i.test(html)
    || !descriptionTag || !/content\s*=\s*["'][^"']+["']/i.test(descriptionTag)) {
    throw new Error('Generated page must include a title and meta description')
  }
  if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html)) throw new Error('Generated page must include one visible h1')
  if (!css) throw new Error('Generated page must include matching CSS')
  if (/<script\b|<iframe\b|<object\b|<embed\b|javascript\s*:|\son[a-z]+\s*=/i.test(html)) {
    throw new Error('Generated page contains executable or embedded content')
  }
  return { html, css }
}

export function hasPageDesignAuthority(membership: Json, action: string) {
  const role = text(membership.role, 80)
  const department = text(membership.department_id, 80)
  if (LEADER_ROLES.has(role)) return true
  if (action === 'approve') return department === 'design' && role === 'department_manager'
  return department === 'design'
}

async function requireUser(req: Request, url: string, anonKey: string, admin: Client) {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw new Error('Authentication required')
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw new Error('Authentication required')
  const { data: membership, error: membershipError } = await admin.from('organization_memberships')
    .select('organization_id, role, department_id')
    .eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id)
    .eq('member_kind', 'team').eq('status', 'active').maybeSingle()
  if (membershipError) throw membershipError
  if (!membership) throw new Error('Active team membership required')
  return { user, membership, userClient }
}

async function loadPermittedVersion(userClient: Client, directionVersionId: string) {
  const { data: version, error: versionError } = await userClient.from('design_direction_versions').select('*')
    .eq('id', directionVersionId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (versionError) throw versionError
  if (!version) throw new Error('Direction version not found or not visible to this reviewer')
  const { data: direction, error: directionError } = await userClient.from('design_directions')
    .select('id, session_id').eq('id', version.direction_id).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (directionError) throw directionError
  const { data: session, error: sessionError } = direction
    ? await userClient.from('design_workshop_sessions').select('id, engagement_id, brand_id')
      .eq('id', direction.session_id).eq('organization_id', ORGANIZATION_ID).maybeSingle()
    : { data: null, error: null }
  if (sessionError) throw sessionError
  if (!direction || !session) throw new Error('Direction version has no accessible Workshop session')
  return { version, session }
}

async function latestArtifactContent(userClient: Client, engagementId: string, artifactType: string) {
  const { data: artifact, error: artifactError } = await userClient.from('artifacts').select('id')
    .eq('organization_id', ORGANIZATION_ID).eq('engagement_id', engagementId)
    .eq('artifact_type', artifactType).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (artifactError) throw artifactError
  if (!artifact) return null
  const { data: version, error: versionError } = await userClient.from('artifact_versions').select('content')
    .eq('organization_id', ORGANIZATION_ID).eq('artifact_id', artifact.id)
    .order('version_number', { ascending: false }).limit(1).maybeSingle()
  if (versionError) throw versionError
  return version?.content && typeof version.content === 'object' ? version.content as Json : null
}

async function resolveOpenAi(admin: Client, engagementId: string) {
  const { data: mappings, error: mappingError } = await admin.from('integration_connection_engagements')
    .select('connection_id').eq('organization_id', ORGANIZATION_ID)
    .eq('engagement_id', engagementId).eq('department_id', 'design')
  if (mappingError) throw mappingError
  const connectionIds = (mappings || []).map(item => item.connection_id)
  if (!connectionIds.length) throw new Error('A verified OpenAI connector must be mapped to this engagement and Design')
  const { data: connection, error } = await admin.from('integration_connections')
    .select('id, provider, status, secret_name').eq('organization_id', ORGANIZATION_ID)
    .eq('provider', 'openai').eq('status', 'verified').is('archived_at', null)
    .in('id', connectionIds).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const secretName = connection?.secret_name || ''
  const credential = secretName ? Deno.env.get(secretName) : null
  if (!connection || !credential) throw new Error('The verified Design OpenAI connector credential is unavailable')
  return credential
}

async function signedImageContext(admin: Client, userClient: Client, directionVersionId: string) {
  const { data: assets, error } = await userClient.from('design_media_assets')
    .select('id, prompt, storage_path').eq('design_direction_version_id', directionVersionId)
    .eq('media_type', 'image').eq('status', 'ready').not('storage_path', 'is', null)
    .order('created_at', { ascending: false }).limit(8)
  if (error) throw error
  if (!assets?.length) return []
  const { data: signed, error: signedError } = await admin.storage.from(MEDIA_BUCKET)
    .createSignedUrls(assets.map(asset => asset.storage_path), 300)
  if (signedError) throw signedError
  return assets.map((asset, index) => ({
    asset_id: asset.id, prompt: asset.prompt, signed_url: signed?.[index]?.signedUrl || null,
  })).filter(asset => asset.signed_url)
}

export async function generateOpenAiPage(
  credential: string, modelId: string, prompt: string, fetcher: typeof fetch = fetch,
) {
  const apiResponse = await fetcher(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId, store: false,
      instructions: 'Create one production-quality standalone webpage. Return only the strict JSON response. Use semantic HTML, accessible headings and alt text, and matching standalone CSS. Do not include scripts, inline event handlers, iframes, objects, embeds, or approval claims.',
      input: prompt,
      text: { format: pageDesignSchema() },
      max_output_tokens: 12000,
    }),
  })
  const result = await apiResponse.json() as Json
  if (!apiResponse.ok) {
    const apiError = result.error && typeof result.error === 'object' ? result.error as Json : {}
    throw new Error(text(apiError.message, 1000) || 'OpenAI HTML/CSS generation failed')
  }
  const raw = outputText(result)
  if (!raw) throw new Error('OpenAI HTML/CSS generation returned no output')
  try { return JSON.parse(raw) as Json } catch { throw new Error('OpenAI HTML/CSS generation returned invalid JSON') }
}

async function generate(admin: Client, userClient: Client, body: Json, actorId: string) {
  const directionVersionId = text(body.design_direction_version_id, 80)
  const slug = text(body.slug, 240)
  const modelRegistryId = text(body.model_registry_id, 80)
  if (!slug) throw new Error('Select a website architecture slug')
  const { version, session } = await loadPermittedVersion(userClient, directionVersionId)

  const architecture = await latestArtifactContent(userClient, session.engagement_id, 'website_architecture')
  const pages = Array.isArray(architecture?.pages) ? architecture.pages as Json[] : []
  const architecturePage = pages.find(page => text(page.slug, 240) === slug)
  if (!architecturePage) throw new Error('Slug does not exist in the latest visible website architecture')

  const content = await latestArtifactContent(userClient, session.engagement_id, 'content')
  const contentPages = Array.isArray(content?.pages) ? content.pages as Json[] : []
  const contentPage = contentPages.find(page => normalizePagePath(page.page_path) === normalizePagePath(slug)) || null
  const keywords = await latestArtifactContent(userClient, session.engagement_id, 'keyword_strategy')
  const pageKeywords = (Array.isArray(keywords?.keywords) ? keywords.keywords as Json[] : [])
    .filter(keyword => text(keyword.target_page_slug, 240) === slug)
  const seo = seoMetadata(contentPage)

  const { data: model, error: modelError } = await admin.from('design_model_registry').select('*')
    .eq('id', modelRegistryId).eq('organization_id', ORGANIZATION_ID).eq('is_active', true).maybeSingle()
  if (modelError) throw modelError
  if (!model || !Array.isArray(model.supported_output_types)
    || !model.supported_output_types.includes('html_css')) {
    throw new Error('Select an active HTML/CSS-capable model from the Design registry')
  }
  if (model.provider !== 'openai') throw new Error('No installed HTML/CSS adapter exists for the selected provider')

  const images = await signedImageContext(admin, userClient, version.id)
  const credential = await resolveOpenAi(admin, session.engagement_id)
  const prompt = [
    `TARGET ARCHITECTURE PAGE\n${JSON.stringify(architecturePage)}`,
    `APPROVED DESIGN DIRECTION VERSION\n${JSON.stringify(version.content)}`,
    `PAGE CONTENT (actual artifact type: content; match field: page_path)\n${JSON.stringify(contentPage || { page_path: slug, page_brief: 'Page content not yet written', draft_copy: 'Page content not yet written', meta_title: seo.title, meta_description: seo.description, primary_cta: 'CTA not yet written' })}`,
    `PAGE KEYWORDS\n${JSON.stringify(pageKeywords)}`,
    `AVAILABLE PR39 IMAGE ASSETS (use only these signed URLs if imagery is needed)\n${JSON.stringify(images)}`,
    `MANDATORY SEO\nUse this exact title: ${seo.title}\nUse this exact meta description: ${seo.description}`,
    'Return a complete <!doctype html> document and standalone CSS. The HTML must contain one clear h1 and meaningful alt text for every image. Each page stands alone; do not build multi-page navigation behavior.',
  ].join('\n\n')
  const generated = await generateOpenAiPage(credential, model.model_id, prompt)
  const htmlWithSeo = applySeoMetadata(generated.html_content, seo.title, seo.description)
  const validated = validatePageOutput(htmlWithSeo, generated.css_content)
  const { data: design, error: insertError } = await admin.from('website_page_designs').insert({
    organization_id: ORGANIZATION_ID,
    design_direction_version_id: version.id,
    slug,
    html_content: validated.html,
    css_content: validated.css,
    status: 'draft',
    created_by: actorId,
  }).select('*').single()
  if (insertError) throw insertError
  return design
}

async function transition(admin: Client, userClient: Client, body: Json, nextStatus: 'in_review' | 'approved') {
  const designId = text(body.website_page_design_id, 80)
  const { data: visible, error } = await userClient.from('website_page_designs').select('id, status')
    .eq('id', designId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
  if (error) throw error
  if (!visible) throw new Error('Website page design not found or not visible')
  const expected = nextStatus === 'in_review' ? 'draft' : 'in_review'
  if (visible.status !== expected) throw new Error(`Only ${expected} page designs can move to ${nextStatus}`)
  const { data, error: updateError } = await admin.from('website_page_designs').update({ status: nextStatus })
    .eq('id', visible.id).eq('organization_id', ORGANIZATION_ID).eq('status', expected)
    .select('*').single()
  if (updateError) throw updateError
  return data
}

async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !anonKey || !serviceKey) throw new Error('Supabase function configuration is incomplete')
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { user, membership, userClient } = await requireUser(req, url, anonKey, admin)
    const body = await req.json() as Json
    const action = text(body.action, 80)
    if (!hasPageDesignAuthority(membership as Json, action)) {
      return response({ error: 'Your department role cannot perform this action' }, 403)
    }
    const actions: Record<string, () => Promise<unknown>> = {
      generate: () => generate(admin, userClient, body, user.id),
      submit_review: () => transition(admin, userClient, body, 'in_review'),
      approve: () => transition(admin, userClient, body, 'approved'),
    }
    if (!actions[action]) return response({ error: 'Unsupported action' }, 400)
    return response({ data: await actions[action]() })
  } catch (error) {
    console.error('Website page design failure', error)
    return response({ error: error instanceof Error ? error.message : 'Website page design failed' }, 400)
  }
}

if (import.meta.main) Deno.serve(handler)

export { handler }
