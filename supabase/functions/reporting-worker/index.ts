import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'
import { createReportingWorkerHandler, reportingScheduleConfiguration } from '../_shared/reportingWorkerEndpoint.js'

// Registration grants no capability. Resource-specific modules must be implemented,
// reviewed and match the native installed manifest before activation.
const installedAdapters: unknown[] = []
const environment = (name: string) => Deno.env.get(name) || ''
const handler = createReportingWorkerHandler({
  adapters: installedAdapters,
  machineSecret: () => environment('ANKA_REPORTING_WORKER_SECRET'),
  schedules: () => reportingScheduleConfiguration(environment('ANKA_REPORTING_SCHEDULES')),
  getUserClient: async (request: Request) => {
    const authorization = request.headers.get('Authorization') || ''
    if (!authorization.startsWith('Bearer ')) throw new Error('Authentication required')
    const client = createClient(environment('SUPABASE_URL'), namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) throw new Error('Authentication required')
    return client
  },
  getAdminClient: async () => createClient(environment('SUPABASE_URL'), namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
})
if (import.meta.main) Deno.serve(handler)
