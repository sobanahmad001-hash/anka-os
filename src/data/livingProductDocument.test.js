import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../../supabase/migrations/20260923100000_living_product_document_store.sql')
const hook = read('../hooks/useLivingProductDocument.js')
const screen = read('../apps/LivingProductDocument.jsx')

test('Product Document has one tenant-scoped row with explicit leadership RLS', () => {
  assert.match(migration, /organization_id uuid not null unique references public\.organizations/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all on public\.living_product_document from public, anon, authenticated/)
  assert.match(migration, /grant select, insert on public\.living_product_document to authenticated/)
  assert.match(migration, /grant update \(content, changelog, version, updated_at, updated_by\)/)
  assert.match(migration, /has_organization_role\(organization_id, array\['system_owner', 'operations_admin'\]\)/)
  assert.match(migration, /updated_by = auth\.uid\(\)/)
  assert.doesNotMatch(migration, /insert into public\.living_product_document/)
})

test('Product Document uses selected-org identity and optimistic version on save', () => {
  assert.match(screen, /<OrganizationGate><ScopedLivingProductDocument \/><\/OrganizationGate>/)
  assert.match(screen, /activeMembership\?\.role/)
  assert.match(hook, /\.eq\('organization_id', activeOrganizationId\)/)
  assert.match(hook, /\.eq\('version', document\.version\)/)
  assert.match(hook, /requestSignal\.aborted/)
  assert.doesNotMatch(hook, /profile\?\.role === 'admin'/)
})
