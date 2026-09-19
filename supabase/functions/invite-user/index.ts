import { createClient } from 'npm:@supabase/supabase-js@2.112.4'

export const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const DEPARTMENTS = new Set(['content', 'design', 'development', 'marketing'])
const ROLES = new Set(['operations_admin', 'executive', 'department_manager', 'project_owner', 'contributor'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
}
type Result = { data: unknown; error: unknown }
export type TeamContext = {
  actorId: string
  isAdmin: () => Promise<boolean>
  invite: (email: string, department: string, redirectTo?: string) => Promise<{ userId: string | null; error: unknown }>
  rpc: (name: string, input: Record<string, unknown>) => Promise<Result>
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
async function context(req: Request): Promise<TeamContext> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new Error('Authentication required')
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  if (!url || !anonKey || !serviceKey) throw new Error('Unavailable')
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw new Error('Authentication required')
  return {
    actorId: user.id,
    async isAdmin() {
      const { data, error } = await userClient.from('organization_memberships').select('role,status,member_kind')
        .eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id).single()
      return !error && data?.status === 'active' && data?.member_kind === 'team' && ['system_owner', 'operations_admin'].includes(data.role)
    },
    async invite(email, department, redirectTo) {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, { data: { department, full_name: email.split('@')[0] }, redirectTo })
      return { userId: data.user?.id ?? null, error }
    },
    // The authenticated connection preserves verified identity; SQL rechecks current authority.
    rpc: async (name, input) => await userClient.rpc(name, input),
  }
}
export function createTeamHandler(getContext: (req: Request) => Promise<TeamContext> = context) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (!['POST', 'DELETE'].includes(req.method)) return json({ error: 'Method not allowed' }, 405)
    let ctx: TeamContext
    try { ctx = await getContext(req) } catch { return json({ error: 'Authentication required' }, 401) }
    let invitedUserId: string | null = null
    try {
      if (!await ctx.isAdmin()) return json({ error: 'Anka organization administrator access required' }, 403)
      const body = await req.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Object required' }, 400)
      if (body.organization_id && body.organization_id !== ORGANIZATION_ID) return json({ error: 'This endpoint manages only the Anka organization' }, 403)
      if (req.method === 'DELETE' || body.action === 'deactivate') {
        if (!UUID.test(body.user_id || '') || !UUID.test(body.request_id || '')) return json({ error: 'User ID and stable request ID are required' }, 400)
        if (body.user_id === ctx.actorId) return json({ error: 'You cannot deactivate your own organization membership' }, 400)
        const { data, error } = await ctx.rpc('deactivate_organization_member', {
          p_organization_id: ORGANIZATION_ID, p_user_id: body.user_id, p_request_id: body.request_id,
        })
        if (error) return json({ error: 'Deactivation rejected. Reload current membership and administrator authority before retrying.' }, 403)
        return json({ success: true, data, message: 'Anka access deactivated. Membership, work and history are preserved; review assignments for reassignment. Other organizations and Auth sessions are unchanged.' })
      }
      if (body.action && body.action !== 'invite') return json({ error: 'Unsupported team action' }, 400)
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const department = typeof body.department === 'string' ? body.department : ''
      const role = typeof body.role === 'string' ? body.role : 'contributor'
      if (!email || !email.includes('@') || !DEPARTMENTS.has(department) || !ROLES.has(role)) return json({ error: 'Valid email, department and organization role required' }, 400)
      const origin = req.headers.get('origin')
      const invited = await ctx.invite(email, department, origin ? origin + '/auth/callback' : undefined)
      if (invited.error || !invited.userId) return json({ error: 'Invitation was not confirmed. Check account state before retrying; no automatic retry was attempted.' }, 400)
      invitedUserId = invited.userId
      const { error } = await ctx.rpc('complete_team_invitation', {
        p_user_id: invited.userId, p_email: email, p_department: department, p_role: role,
      })
      if (error) return json({
        error: 'Invitation account was retained because organization setup failed. Cleanup is incomplete; an administrator must review the account before retrying. No account or history was deleted.',
        cleanup_incomplete: true, recovery_required: true, user_id: invited.userId,
      }, 409)
      return json({ success: true, message: 'Invitation sent and Anka organization access provisioned.' })
    } catch {
      if (invitedUserId) return json({ error: 'Invitation account retained; organization setup outcome is unknown. Cleanup is incomplete. Review current state before retrying.',
        cleanup_incomplete: true, recovery_required: true, user_id: invitedUserId }, 409)
      return json({ error: 'Team request outcome could not be confirmed. Review current state before retrying; no automatic cleanup or retry was attempted.', recovery_required: true }, 400)
    }
  }
}
if (import.meta.main) Deno.serve(createTeamHandler())
