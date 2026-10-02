import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey, decryptSecret } from '../_shared/googleOAuthTokens.ts'
import { createReportingWorkerHandler, reportingScheduleConfiguration } from '../_shared/reportingWorkerEndpoint.js'

import { createGoogleReportingAdapters, createReportingGoogleTokenReader } from '../_shared/reportingGoogleAdapters.js'
import manifests from '../_shared/reportingGoogleManifests.json' with { type: 'json' }

const environment = (name: string) => Deno.env.get(name) || ''
const admin = () => createClient(environment('SUPABASE_URL'), namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
// Compiled modules are not resource grants. Native registry entries are initially
// disabled and must match these exact reviewed manifests before a claim can dispatch.
const installedAdapters = createGoogleReportingAdapters({
  getToken: createReportingGoogleTokenReader({ admin, decrypt: decryptSecret, encryptionMaterial: () => environment('GOOGLE_OAUTH_ENCRYPTION_KEY') }),
  manifests: Object.fromEntries(manifests.adapters.map(entry => [entry.sourceContract, entry.manifestSha256])),
})
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
  getAdminClient: async () => admin(),
})
if (import.meta.main) Deno.serve(handler)
