import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1'

const ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const DEPARTMENTS = new Set(['content', 'design', 'development', 'marketing'])
const ROLES = new Set([
  'operations_admin',
  'executive',
  'department_manager',
  'project_owner',
  'contributor',
])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function profileRole(role: string) {
  if (role === 'operations_admin') return 'admin'
  if (role === 'executive') return 'executive'
  if (role === 'department_manager') return 'department_head'
  return 'member'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!['POST', 'DELETE'].includes(req.method)) return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Authentication required' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Function environment is incomplete')

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Authentication required' }, 401)

    const { data: membership, error: membershipError } = await userClient
      .from('organization_memberships')
      .select('role, status, member_kind')
      .eq('organization_id', ORGANIZATION_ID)
      .eq('user_id', user.id)
      .single()

    if (membershipError || membership?.status !== 'active' || membership?.member_kind !== 'team' ||
      !['system_owner', 'operations_admin'].includes(membership?.role)) {
      return json({ error: 'Organization administrator access required' }, 403)
    }

    const body = await req.json()

    if (req.method === 'DELETE') {
      const targetUserId = typeof body.user_id === 'string' ? body.user_id : ''
      if (!targetUserId) return json({ error: 'User ID is required' }, 400)
      if (targetUserId === user.id) return json({ error: 'You cannot remove your own account' }, 400)

      const { error } = await adminClient.auth.admin.deleteUser(targetUserId)
      if (error) throw error
      return json({ success: true, message: 'Team member removed' })
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const department = typeof body.department === 'string' ? body.department : ''
    const role = typeof body.role === 'string' ? body.role : 'contributor'
    if (!email || !email.includes('@')) return json({ error: 'A valid email is required' }, 400)
    if (!DEPARTMENTS.has(department)) return json({ error: 'A valid department is required' }, 400)
    if (!ROLES.has(role)) return json({ error: 'A valid organization role is required' }, 400)

    const origin = req.headers.get('origin')
    const redirectTo = origin ? `${origin}/auth/callback` : undefined
    const { data, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { department },
      redirectTo,
    })
    if (inviteError || !data.user) throw inviteError ?? new Error('Invite did not create a user')

    const { error: profileError } = await adminClient.from('profiles').upsert({
      id: data.user.id,
      email,
      full_name: email.split('@')[0],
      department,
      role: profileRole(role),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

    const { error: organizationError } = await adminClient.from('organization_memberships').upsert({
      organization_id: ORGANIZATION_ID,
      user_id: data.user.id,
      member_kind: 'team',
      role,
      department_id: department,
      status: 'active',
    }, { onConflict: 'organization_id,user_id' })

    if (profileError || organizationError) {
      await adminClient.auth.admin.deleteUser(data.user.id)
      throw profileError ?? organizationError
    }

    return json({ success: true, message: `Invite sent to ${email}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected invite service error'
    return json({ error: message }, 400)
  }
})
