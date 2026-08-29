import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

const RELATION_TYPES = new Set(['feeds_into', 'derived_from', 'referenced_by'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function text(value: unknown, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function relationInput(input: Json) {
  const sourceArtifactId = text(input.source_artifact_id, 80)
  const targetArtifactId = text(input.target_artifact_id, 80)
  const relationType = text(input.relation_type, 40)
  if (!sourceArtifactId || !targetArtifactId) throw new Error('Select both relation artifacts')
  if (sourceArtifactId === targetArtifactId) throw new Error('An artifact cannot relate to itself')
  if (!RELATION_TYPES.has(relationType)) throw new Error('Unsupported relation type')
  return { sourceArtifactId, targetArtifactId, relationType }
}

export async function loadReadablePair(userClient: Client, sourceArtifactId: string, targetArtifactId: string) {
  const { data, error } = await userClient.from('artifacts')
    .select('id, organization_id, title, artifact_type, engagement_id')
    .in('id', [sourceArtifactId, targetArtifactId])
  if (error) throw error
  const rows = data || []
  const source = rows.find((artifact: Json) => artifact.id === sourceArtifactId)
  const target = rows.find((artifact: Json) => artifact.id === targetArtifactId)
  if (!source || !target) {
    throw Object.assign(new Error('Both artifacts must be visible before they can be related'), { status: 404 })
  }
  if (source.organization_id !== target.organization_id) {
    throw Object.assign(new Error('Artifacts must belong to the same organization'), { status: 409 })
  }
  return { source, target, organizationId: String(source.organization_id) }
}

async function requireContext(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) {
    throw Object.assign(new Error('Authentication required'), { status: 401 })
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('Function environment is incomplete')
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
  })
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return { userClient, admin, user }
}

async function requireTeamMembership(admin: Client, organizationId: string, userId: string) {
  const { data, error } = await admin.from('organization_memberships')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('member_kind', 'team')
    .eq('status', 'active')
    .maybeSingle()
  if (error || !data) throw Object.assign(new Error('Active team membership required'), { status: 403 })
}

async function createRelation(userClient: Client, admin: Client, body: Json, actorId: string) {
  const input = relationInput(body)
  const pair = await loadReadablePair(userClient, input.sourceArtifactId, input.targetArtifactId)
  await requireTeamMembership(admin, pair.organizationId, actorId)
  const { data, error } = await admin.from('artifact_relations').insert({
    organization_id: pair.organizationId,
    source_artifact_id: input.sourceArtifactId,
    target_artifact_id: input.targetArtifactId,
    relation_type: input.relationType,
    created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}

async function deleteRelation(userClient: Client, admin: Client, body: Json, actorId: string) {
  const relationId = text(body.relation_id, 80)
  if (!relationId) throw new Error('Relation ID is required')
  const { data: relation, error } = await userClient.from('artifact_relations')
    .select('*').eq('id', relationId).maybeSingle()
  if (error || !relation) throw Object.assign(new Error('Artifact relation is unavailable'), { status: 404 })
  await requireTeamMembership(admin, String(relation.organization_id), actorId)
  const { error: deleteError } = await admin.from('artifact_relations')
    .delete().eq('id', relation.id).eq('organization_id', relation.organization_id)
  if (deleteError) throw deleteError
  return { id: relation.id }
}

export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  try {
    const { userClient, admin, user } = await requireContext(request)
    const body = await request.json() as Json
    const action = text(body.action, 60)
    if (action === 'create_relation') {
      return response({ data: await createRelation(userClient, admin, body, user.id) })
    }
    if (action === 'delete_relation') {
      return response({ data: await deleteRelation(userClient, admin, body, user.id) })
    }
    return response({ error: 'Unsupported action' }, 400)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400
    return response({ error: error instanceof Error ? error.message : 'Unexpected artifact relation error' },
      Number.isFinite(status) ? status : 400)
  }
}

if (import.meta.main) Deno.serve(handleRequest)
