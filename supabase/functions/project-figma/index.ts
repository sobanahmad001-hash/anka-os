import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { FigmaReadError, readDesignFile } from './provider.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,x-client-info,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Cache-Control': 'no-store',
}
const reply = (data: unknown, status = 200) => Response.json(data, {status, headers})

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, {headers})
  if (request.method !== 'POST') return reply({error:'POST required'}, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({error:'Sign in required'}, 401)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const db = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {global:{headers:{Authorization:authorization}}})
    const {data:{user}} = await db.auth.getUser(authorization.slice(7))
    if (!user) return reply({error:'Sign in required'},401)
    const body = await request.json()
    const scope = {p_org:body.org,p_project:body.project}
    const {data:settings,error} = await db.rpc('work_figma_settings',scope)
    if (error) return reply({error:'Project access required'},403)
    const file = settings.file
    if (!file || settings.revision !== body.revision) return reply({error:'Reopen the picker to load the current project file.'},409)
    const admin = createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const {data:connection} = await admin.from('integration_connections').select('secret_name')
      .eq('id',file.id).eq('organization_id',body.org).eq('provider','figma').eq('status','verified')
      .eq('public_config->>file_key',file.file_key).is('archived_at',null).maybeSingle()
    const secret = connection && /^ANKA_FIGMA_[A-Z0-9_]+$/.test(connection.secret_name) && Deno.env.get(connection.secret_name)
    if (!secret) return reply({error:'The selected Figma connection is unavailable.'},409)
    const design = await readDesignFile(file.file_key,secret)
    if (body.action === 'frames') return reply(design)
    if (body.action !== 'attach') return reply({error:'Unknown picker action'},400)
    if (body.version !== design.version || !design.frames.some(frame => frame.id === body.node)) {
      return reply({error:'The design changed. Reopen the picker to select a current frame.'},409)
    }
    const saved = await db.rpc('attach_work_figma_frame',{...scope,p_revision:body.revision,p_file:file.file_key,
      p_node:body.node,p_version:design.version,p_card_kind:body.cardKind,p_card_id:body.cardId})
    return saved.error ? reply({error:'The frame could not be attached. Check the card and project access.'},403) : reply({asset:saved.data})
  } catch (error) {
    return error instanceof FigmaReadError ? reply({error:error.message},error.status) : reply({error:'Figma request failed.'},502)
  }
})
