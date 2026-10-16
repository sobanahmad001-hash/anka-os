import { invitationRedirect } from '../_shared/invitationRedirect.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1'

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const PORTAL_ROLES = new Set(['admin', 'approver', 'collaborator', 'viewer'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
})

export function createClientInvitationHandler(makeClient: typeof createClient = createClient, environment: (key: string) => string | undefined = key => Deno.env.get(key)) {
return async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let invitedUserId: string | null = null
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentication required' }, 401)
    const url = environment('SUPABASE_URL') ?? ''
    const anonKey = environment('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = environment('SUPABASE_SERVICE_ROLE_KEY') ?? environment('SERVICE_ROLE_KEY') ?? ''
    if (!url || !anonKey || !serviceKey) throw new Error('Function environment is incomplete')

    const userClient = makeClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
    const adminClient = makeClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Authentication required' }, 401)

    const { data: membership } = await userClient.from('organization_memberships')
      .select('role, status, member_kind').eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id).single()
    if (membership?.status !== 'active' || membership?.member_kind !== 'team' ||
      !['system_owner', 'operations_admin', 'executive', 'project_owner'].includes(membership?.role)) {
      return json({ error: 'Client administration access required' }, 403)
    }

    const body = await request.json()
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : ''
    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return json({ error: 'Stable invitation request ID required' }, 400)
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const portalRole = typeof body.portalRole === 'string' ? body.portalRole : 'collaborator'
    const projectIds = Array.isArray(body.projectIds) ? [...new Set(body.projectIds.filter((id: unknown) => typeof id === 'string'))] : []
    if (organizationId !== ORGANIZATION_ID) return json({ error: 'Active organization mismatch' }, 403)
    if (!clientId || !fullName || fullName.length > 160 || !email.includes('@')) return json({ error: 'Client, full name, and a valid email are required' }, 400)
    if (!PORTAL_ROLES.has(portalRole)) return json({ error: 'Invalid portal role' }, 400)
    if (!projectIds.length) return json({ error: 'Select at least one project' }, 400)
    if (projectIds.length > 100 || !Array.isArray(body.projectIds) || body.projectIds.some((id: unknown) => typeof id !== 'string')) return json({ error: 'Invalid selected projects' }, 400)

    const { data: clientRecord, error: clientError } = await adminClient.from('clients')
      .select('id, status').eq('id', clientId).eq('organization_id', ORGANIZATION_ID).maybeSingle()
    if (clientError || !clientRecord || clientRecord.status !== 'active') return json({ error: 'Client is unavailable in this organization' }, 404)

    const { data: projects, error: projectError } = await adminClient.from('projects')
      .select('id, status').eq('organization_id', ORGANIZATION_ID).eq('client_id', clientId).in('id', projectIds).is('archived_at', null)
    if (projectError || projects?.length !== projectIds.length || projects?.some(project => !project.status || ['completed', 'cancelled', 'archived'].includes(project.status))) return json({ error: 'One or more projects do not belong to this client' }, 400)

    const redirectTo = invitationRedirect(environment('ANKA_APP_URL'), url)
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, account_kind: 'client' },
      redirectTo,
    })
    if (inviteError || !invited.user) throw new Error('Invitation not confirmed')
    invitedUserId = invited.user.id

    const { data: completed, error: completionError } = await userClient.rpc('complete_client_invitation', {
      p_organization_id: organizationId, p_client_id: clientId, p_user_id: invited.user.id,
      p_email: email, p_full_name: fullName, p_portal_role: portalRole,
      p_project_ids: projectIds, p_request_id: requestId,
    })
    if (completionError || completed?.user_id !== invited.user.id || completed?.request_id !== requestId || !completed?.contact_id || completed?.organization_id !== organizationId || completed?.client_id !== clientId || !Array.isArray(completed?.project_ids) || JSON.stringify([...completed.project_ids].sort()) !== JSON.stringify([...projectIds].sort())) throw new Error('Client access setup not confirmed')

    return json({ success: true, message: `Portal invite sent to ${email}`, contact_id: completed.contact_id, request_id: requestId })
  } catch {
    if (invitedUserId) return json({ error: 'Invitation account retained because client access setup was not confirmed. An administrator must review existing contact and project access before retrying. No account or history was deleted.', recovery_required: true, cleanup_incomplete: true, user_id: invitedUserId }, 409)
    return json({ error: 'Client invitation was not confirmed. Check current account state before retrying; no automatic retry was attempted.', recovery_required: true }, 400)
  }
}
}
if (import.meta.main) Deno.serve(createClientInvitationHandler())
