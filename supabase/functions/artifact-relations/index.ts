import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import {
  createArtifactRelation,
  loadReadablePair,
  relationInput,
  requireRelationTeamMembership,
} from '../_shared/artifactRelations.ts'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Client = ReturnType<typeof createClient<any>>
type Json = Record<string, unknown>

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

export { loadReadablePair, relationInput }

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

async function createRelation(userClient: Client, admin: Client, body: Json, actorId: string) {
  return createArtifactRelation(userClient, admin, body, actorId)
}

async function deleteRelation(userClient: Client, admin: Client, body: Json, actorId: string) {
  const relationId = text(body.relation_id, 80)
  if (!relationId) throw new Error('Relation ID is required')
  const { data: relation, error } = await userClient.from('artifact_relations')
    .select('*').eq('id', relationId).maybeSingle()
  if (error || !relation) throw Object.assign(new Error('Artifact relation is unavailable'), { status: 404 })
  await requireRelationTeamMembership(admin, String(relation.organization_id), actorId)
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
