import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1'

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

    const body = await request.json()
    const fileId = typeof body.file_id === 'string' ? body.file_id : ''
    if (!fileId) return json({ error: 'File ID is required' }, 400)

    const { data: file, error: fileError } = await adminClient.from('files')
      .select('id, project_id, storage_bucket, storage_path, archived_at')
      .eq('id', fileId).single()
    if (fileError || !file || file.archived_at) return json({ error: 'File not found' }, 404)

    const [{ data: team }, { data: clientAccess }] = await Promise.all([
      adminClient.from('organization_memberships').select('id')
        .eq('user_id', user.id).eq('member_kind', 'team').eq('status', 'active').limit(1),
      adminClient.from('project_client_access').select('id, client_contacts!inner(auth_user_id, status)')
        .eq('project_id', file.project_id).eq('status', 'active')
        .eq('client_contacts.auth_user_id', user.id).eq('client_contacts.status', 'active').limit(1),
    ])
    if (!team?.length && !clientAccess?.length) return json({ error: 'Project file access denied' }, 403)

    const { data: portalItem } = await adminClient.from('client_portal_items').select('id')
      .eq('project_id', file.project_id).eq('source_type', 'deliverable_version')
      .contains('payload', { file_id: file.id }).is('withdrawn_at', null).limit(1).maybeSingle()
    if (!team?.length && !portalItem) return json({ error: 'This file has not been released' }, 403)

    const { data: signed, error: signedError } = await adminClient.storage
      .from(file.storage_bucket).createSignedUrl(file.storage_path, 300)
    if (signedError || !signed?.signedUrl) throw signedError ?? new Error('Signed URL was not created')
    return json({ signed_url: signed.signedUrl, expires_in: 300 })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected file access error' }, 400)
  }
})
