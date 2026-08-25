import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
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

serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentication required' }, 401)
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    if (!url || !anonKey || !serviceKey) throw new Error('Function environment is incomplete')

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Authentication required' }, 401)

    const { data: membership } = await userClient.from('organization_memberships')
      .select('role, status, member_kind').eq('organization_id', ORGANIZATION_ID).eq('user_id', user.id).single()
    if (membership?.status !== 'active' || membership?.member_kind !== 'team' ||
      !['system_owner', 'operations_admin', 'executive', 'project_owner'].includes(membership?.role)) {
      return json({ error: 'Client administration access required' }, 403)
    }

    const body = await request.json()
    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const portalRole = typeof body.portalRole === 'string' ? body.portalRole : 'collaborator'
    const projectIds = Array.isArray(body.projectIds) ? [...new Set(body.projectIds.filter((id: unknown) => typeof id === 'string'))] : []
    if (!clientId || !fullName || !email.includes('@')) return json({ error: 'Client, full name, and a valid email are required' }, 400)
    if (!PORTAL_ROLES.has(portalRole)) return json({ error: 'Invalid portal role' }, 400)
    if (!projectIds.length) return json({ error: 'Select at least one project' }, 400)

    const { data: projects, error: projectError } = await adminClient.from('projects')
      .select('id').eq('client_id', clientId).in('id', projectIds).is('archived_at', null)
    if (projectError || projects?.length !== projectIds.length) return json({ error: 'One or more projects do not belong to this client' }, 400)

    const origin = request.headers.get('origin')
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, account_kind: 'client' },
      redirectTo: origin ? `${origin}/auth/callback` : undefined,
    })
    if (inviteError || !invited.user) throw inviteError ?? new Error('Client invite did not create a user')

    const { data: contact, error: contactError } = await adminClient.from('client_contacts').insert({
      organization_id: ORGANIZATION_ID,
      client_id: clientId,
      auth_user_id: invited.user.id,
      full_name: fullName,
      email,
      portal_role: portalRole,
      status: 'active',
    }).select().single()
    if (contactError || !contact) {
      await adminClient.auth.admin.deleteUser(invited.user.id)
      throw contactError ?? new Error('Client contact was not created')
    }

    const { error: accessError } = await adminClient.from('project_client_access').insert(projectIds.map(projectId => ({
      organization_id: ORGANIZATION_ID,
      project_id: projectId,
      client_contact_id: contact.id,
      access_role: portalRole,
      status: 'active',
    })))
    if (accessError) {
      await adminClient.auth.admin.deleteUser(invited.user.id)
      throw accessError
    }

    return json({ success: true, message: `Portal invite sent to ${email}`, contact_id: contact.id })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected client invitation error' }, 400)
  }
})
