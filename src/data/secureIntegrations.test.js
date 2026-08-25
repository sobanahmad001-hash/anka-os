import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../../supabase/migrations/20260825100000_secure_integration_gateway.sql', import.meta.url), 'utf8')
const gateway = readFileSync(new URL('../../supabase/functions/integration-gateway/index.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../apps/Settings.jsx', import.meta.url), 'utf8')

test('integration metadata is RLS-protected and browser writes are unavailable', () => {
  assert.match(migration, /alter table public\.integration_connections enable row level security/)
  assert.match(migration, /alter table public\.integration_events enable row level security/)
  assert.match(migration, /public\.is_team_organization_member\(organization_id\)/)
  assert.match(migration, /grant select on public\.integration_connections to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on public\.integration_connections to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on public\.integration_events to authenticated/)
})

test('secret-bearing fields are rejected from public metadata and audit', () => {
  for (const field of ['token', 'api_key', 'secret', 'password', 'authorization', 'credentials', 'private_key', 'app_password']) {
    assert.match(migration, new RegExp(`'${field}'`))
  }
  assert.match(migration, /ANKA_GITHUB_/)
  assert.match(migration, /ANKA_FIGMA_/)
  assert.match(migration, /ANKA_WORDPRESS_/)
})

test('integration gateway requires team and leadership authorization', () => {
  assert.match(gateway, /userClient\.auth\.getUser\(\)/)
  assert.match(gateway, /from\('organization_memberships'\)/)
  assert.match(gateway, /member_kind !== 'team'/)
  assert.match(gateway, /LEADER_ROLES/)
  assert.match(gateway, /Deno\.env\.get\(connection\.secret_name\)/)
  assert.doesNotMatch(settings, /password|access token|api key/i)
})

test('Release 1 provider operations are read and test only', () => {
  assert.match(gateway, /api\.github\.com\/repos/)
  assert.match(gateway, /api\.figma\.com\/v1\/files/)
  assert.match(gateway, /wp-json\/wp\/v2\/users\/me/)
  assert.doesNotMatch(gateway, /method:\s*['"](PUT|PATCH|DELETE)['"]/)
  assert.doesNotMatch(gateway, /wp-json\/wp\/v2\/(posts|pages)/)
})

test('retired browser credential modules and unaudited media proxies are removed', () => {
  for (const relativePath of [
    '../apps/CodingAgent.jsx',
    '../apps/GitIntegration.jsx',
    '../apps/SphereCreativeStudio.jsx',
    '../apps/SphereFigmaWorkspace.jsx',
    '../apps/SphereWPEngine.jsx',
    '../lib/github.js',
    '../../supabase/functions/hf-proxy/index.ts',
    '../../supabase/functions/kling-proxy/index.ts',
  ]) {
    assert.equal(existsSync(new URL(relativePath, import.meta.url)), false, `${relativePath} should be retired`)
  }
  assert.doesNotMatch(config, /hf-proxy|kling-proxy/)
  assert.match(config, /\[functions\.integration-gateway\][\s\S]*verify_jwt = true/)
})
