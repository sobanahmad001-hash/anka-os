import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'

type Context = { actorId: string; rpc: (name: string, input: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }
type Json = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function schedulerInput(body: Json) {
  if (body.action !== 'admit' && body.action !== 'execute') throw new Error('Expected admit or execute')
  const target = body.action === 'admit' ? body.planId : body.admissionId
  if (typeof target !== 'string' || !UUID.test(target)) throw new Error('Valid target UUID required')
  if (body.action === 'execute') return { name: 'execute_recurring_schedule', args: { p_admission_id: target } }
  const date = body.periodStart
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('Real period date required')
  return { name: 'admit_recurring_schedule', args: { p_plan_id: target, p_period_start: date } }
}
async function context(request: Request): Promise<Context> {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw new Error('Authentication required')
  const url = Deno.env.get('SUPABASE_URL') || ''
  const userClient = createClient(url, namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw new Error('Authentication required')
  const admin = createClient(url, namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { actorId: user.id, rpc: async (name, input) => await admin.rpc(name, input) }
}
export function createSchedulerHandler(getContext: (request: Request) => Promise<Context> = context) {
  return async (request: Request) => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    let ctx: Context
    try { ctx = await getContext(request) } catch { return json({ error: 'Authentication required' }, 401) }
    try {
      const body = await request.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Object required')
      const input = schedulerInput(body)
      // Identity always comes from verified auth; database checks the private machine binding.
      const { data, error } = await ctx.rpc(input.name, { ...input.args, p_actor_id: ctx.actorId })
      if (error) return json({ error: 'Scheduler request rejected' }, 403)
      return json({ data })
    } catch { return json({ error: 'Invalid scheduler request' }, 400) }
  }
}
if (import.meta.main) Deno.serve(createSchedulerHandler())
