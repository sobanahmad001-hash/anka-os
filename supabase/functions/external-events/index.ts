import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const ACTIONS = new Set(['create_event', 'update_event', 'create_link', 'update_link'])
const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])
const ALLOWED_DEPARTMENTS = new Set(['content', 'marketing', 'design'])
const CATEGORIES = new Set(['concert', 'sports', 'festival', 'awards', 'holiday', 'fashion', 'conference', 'other'])
const CONTENT_TYPES = new Set(['blog', 'social', 'email', 'design_asset'])
const STATUSES = new Set(['planned', 'in_progress', 'ready', 'published'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function requiredId(value: unknown, label: string) {
  const id = text(value, 80)
  if (!id) throw new Error(`${label} is required`)
  return id
}

function optionalText(value: unknown, max = 2000) {
  return text(value, max) || null
}

function date(value: unknown, label: string, required = false) {
  const normalized = text(value, 10)
  if (!normalized && !required) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} must be a date`)
  return normalized
}

function integer(value: unknown, label: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative whole number`)
  return parsed
}

export function hasEventWriteAuthority(membership: Json) {
  return LEADER_ROLES.has(text(membership.role, 60))
    || ALLOWED_DEPARTMENTS.has(text(membership.department_id, 60))
}

async function requireContext(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Authentication required'), { status: 401 })
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')
  const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } })
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return { userClient, admin, user }
}

async function readableBrand(userClient: Client, brandId: string) {
  const { data: brand, error } = await userClient.from('brands')
    .select('id, organization_id').eq('id', brandId).maybeSingle()
  if (error || !brand) throw Object.assign(new Error('Brand is unavailable'), { status: 404 })
  return brand
}

async function readableEvent(userClient: Client, eventId: string) {
  const { data: event, error } = await userClient.from('external_events')
    .select('id, organization_id, brand_id').eq('id', eventId).maybeSingle()
  if (error || !event) throw Object.assign(new Error('External event is unavailable'), { status: 404 })
  return event
}

async function requireWriter(admin: Client, organizationId: string, userId: string) {
  const { data: membership } = await admin.from('organization_memberships')
    .select('role, department_id, status, member_kind')
    .eq('organization_id', organizationId).eq('user_id', userId).maybeSingle()
  if (!membership || membership.status !== 'active' || membership.member_kind !== 'team' || !hasEventWriteAuthority(membership)) {
    throw Object.assign(new Error('Content, Marketing, Design, or organization leadership access required'), { status: 403 })
  }
}

async function saveEvent(userClient: Client, admin: Client, actorId: string, body: Json, update: boolean) {
  const existing = update ? await readableEvent(userClient, requiredId(body.eventId, 'Event')) : null
  const brand = await readableBrand(userClient, update ? existing!.brand_id : requiredId(body.brandId, 'Brand'))
  if (existing && existing.organization_id !== brand.organization_id) throw new Error('Event organization mismatch')
  await requireWriter(admin, brand.organization_id, actorId)
  const category = text(body.category, 40)
  const eventName = text(body.eventName, 200)
  const startDate = date(body.startDate, 'Start date', true)
  const endDate = date(body.endDate, 'End date')
  if (!eventName) throw new Error('Event name is required')
  if (!CATEGORIES.has(category)) throw new Error('Unsupported event category')
  if (endDate && endDate < startDate!) throw new Error('End date cannot be before start date')
  const sourceUrl = optionalText(body.sourceUrl)
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    } catch { throw new Error('Source URL must be a valid HTTP or HTTPS URL') }
  }
  const payload = {
    event_name: eventName, category, venue: optionalText(body.venue, 300),
    location: optionalText(body.location, 300), start_date: startDate,
    end_date: endDate, source_url: sourceUrl,
  }
  const query = update
    ? admin.from('external_events').update(payload).eq('id', existing!.id).eq('organization_id', brand.organization_id)
    : admin.from('external_events').insert({ ...payload, organization_id: brand.organization_id, brand_id: brand.id, created_by: actorId })
  const { data: saved, error } = await query.select('*').single()
  if (error) throw error
  return saved
}

async function saveLink(userClient: Client, admin: Client, actorId: string, body: Json, update: boolean) {
  let existing: Json | null = null
  if (update) {
    const { data, error } = await userClient.from('content_event_links')
      .select('id, organization_id, external_event_id').eq('id', requiredId(body.linkId, 'Link')).maybeSingle()
    if (error || !data) throw Object.assign(new Error('Content event link is unavailable'), { status: 404 })
    existing = data
  }
  const event = await readableEvent(userClient, update ? String(existing!.external_event_id) : requiredId(body.eventId, 'Event'))
  await requireWriter(admin, event.organization_id, actorId)
  const contentType = text(body.contentType, 40)
  const status = text(body.status, 40) || 'planned'
  if (!CONTENT_TYPES.has(contentType)) throw new Error('Unsupported content type')
  if (!STATUSES.has(status)) throw new Error('Unsupported link status')
  const linkedWorkItemId = text(body.linkedWorkItemId, 80) || null
  if (linkedWorkItemId) {
    const { data: item } = await userClient.from('work_items')
      .select('id, organization_id, brand_id, deleted_at').eq('id', linkedWorkItemId).maybeSingle()
    if (!item || item.organization_id !== event.organization_id || item.brand_id !== event.brand_id || item.deleted_at) {
      throw new Error('Linked work item must be an active item for this event brand')
    }
  }
  const payload = { content_type: contentType, linked_work_item_id: linkedWorkItemId, lead_time_days: integer(body.leadTimeDays, 'Lead time'), status }
  const query = update
    ? admin.from('content_event_links').update(payload).eq('id', String(existing!.id)).eq('organization_id', event.organization_id)
    : admin.from('content_event_links').insert({ ...payload, organization_id: event.organization_id, external_event_id: event.id, created_by: actorId })
  const { data: saved, error } = await query.select('*').single()
  if (error) throw error
  return saved
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const body = await request.json() as Json
    const action = text(body.action, 40)
    if (!ACTIONS.has(action)) return response({ error: 'Unsupported action' }, 400)
    const { userClient, admin, user } = await requireContext(request)
    if (action === 'create_event') return response({ data: await saveEvent(userClient, admin, user.id, body, false) })
    if (action === 'update_event') return response({ data: await saveEvent(userClient, admin, user.id, body, true) })
    if (action === 'create_link') return response({ data: await saveLink(userClient, admin, user.id, body, false) })
    return response({ data: await saveLink(userClient, admin, user.id, body, true) })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected external events error' }, Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
