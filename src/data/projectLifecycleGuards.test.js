import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'

// Execute the real edge handler locally with an in-memory client, never a provider.
const edgeSource = readFileSync(new URL('../../supabase/functions/portal-file-url/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace('serve(async request => {', 'export default (async request => {')
const edgeJS = await transform(`const { createClient, Deno } = globalThis.__lifecycleEdgeTest;\n${edgeSource}`, { loader: 'ts', format: 'esm' })
let state
const fakeClient = {
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  from(table) {
    const filters = {}
    const query = {
      select() { return this }, eq(key, value) { filters[key] = value; return this },
      limit() { return this }, contains() { return this }, is() { return this },
      single() { return this }, maybeSingle() { return this },
      then(resolve) {
        const data = table === 'files' ? { id: 'file', project_id: 'project', storage_bucket: 'files', storage_path: 'file', archived_at: null }
          : table === 'projects' ? { id: 'project', organization_id: 'org', archived_at: state.archived ? '2026-09-30' : null, portal_visible: state.visible }
            : table === 'organization_memberships' ? (state.teamOrg === filters.organization_id ? [{ id: 'membership' }] : [])
              : table === 'project_client_access' ? [{ id: 'access' }]
                : { id: 'released' }
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return query
  },
  storage: { from() { return { createSignedUrl: async () => {
    state.signed += 1
    return { data: { signedUrl: 'https://example.invalid/file' } }
  } } } },
}
globalThis.__lifecycleEdgeTest = { createClient: () => fakeClient, Deno: { env: { get: () => 'test-only' } } }
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(edgeJS.code).toString('base64'))
delete globalThis.__lifecycleEdgeTest

for (const scenario of [
  { name: 'archived client', archived: true, visible: true, teamOrg: null, expected: 403 },
  { name: 'client after restore', archived: false, visible: true, teamOrg: null, expected: 200 },
  { name: 'restored hidden project', archived: false, visible: false, teamOrg: null, expected: 403 },
  { name: 'unrelated team membership on archived client project', archived: true, visible: true, teamOrg: 'other-org', expected: 403 },
  { name: 'same-organization team retains archived files', archived: true, visible: true, teamOrg: 'org', expected: 200 },
]) test(`file-link lifecycle guard: ${scenario.name}`, async () => {
  state = { ...scenario, signed: 0 }
  const response = await handler(new Request('https://example.invalid/portal-file-url', {
    method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ file_id: 'file' }),
  }))
  assert.equal(response.status, scenario.expected)
  assert.equal(state.signed, scenario.expected === 200 ? 1 : 0)
})

// Source-contract regression checks; these do not claim database execution coverage.
const migration = readFileSync(new URL('../../supabase/migrations/20260930092316_project_lifecycle_archive_restore_delete.sql', import.meta.url), 'utf8')
test('deletion contract locks before catalog recheck, consumes preview transactionally and keeps a no-FK receipt', () => {
  const deletion = migration.slice(migration.indexOf('create function public.delete_empty_project')).split('create or replace function')[0]
  const replay = deletion.indexOf("return receipt.result || jsonb_build_object('replayed',true);")
  const parentLock = deletion.indexOf('select * into project from public.projects where id=p_project_id and organization_id=p_organization_id for update;')
  const recheck = deletion.indexOf('counts:=private.project_lifecycle_dependencies(p_project_id);')
  assert.ok(replay >= 0 && parentLock > replay, 'parent row lock follows receipt replay')
  assert.ok(recheck > parentLock, 'catalog recheck follows the parent row lock')
  assert.ok(deletion.indexOf('counts:=private.project_lifecycle_dependencies') < deletion.indexOf('delete from public.projects'))
  const cleanup = deletion.indexOf('delete from private.project_deletion_previews where id=p_preview_id;')
  assert.ok(cleanup > deletion.indexOf('delete from public.projects'))
  assert.ok(cleanup < deletion.indexOf('insert into private.project_lifecycle_commands'))
  assert.doesNotMatch(deletion, /update private.project_deletion_previews|exception\s+when/i)
  assert.match(migration, /\bbegin;[\s\S]*\bcommit;/)
  assert.match(deletion, /preview.expires_at<=clock_timestamp\(\)/)
  assert.match(migration, /delete from private.project_deletion_previews where expires_at<=clock_timestamp\(\)/)
  assert.match(deletion, /project.name is distinct from p_confirmation/)
  assert.match(deletion, /project.archived_at is not null or project.status<>'planning'/)
  const receipt = migration.split('create table private.project_lifecycle_commands (')[1].split(');')[0]
  assert.doesNotMatch(receipt, /references|foreign key/i)
  assert.deepEqual([...migration.matchAll(/delete from\s+([\w.]+)/gi)].map(match => match[1]), ['private.project_deletion_previews', 'public.projects', 'private.project_deletion_previews'])
})
test('catalog contract scans every non-system schema, pairs composite FK attributes and binds the UUID', () => {
  const dependencies = migration.split('create function private.project_lifecycle_dependencies')[1].split('create function public.set_project_archived')[0]
  assert.doesNotMatch(dependencies, /\b(stable|immutable)\b/i)
  assert.match(dependencies, /with recursive project_columns\(table_id,attnum\) as/)
  assert.match(dependencies, /a.attrelid='public.projects'::regclass and a.attname='id'/)
  assert.match(dependencies, /join pg_catalog.pg_constraint c on c.confrelid=root.table_id and c.contype='f'/)
  assert.match(dependencies, /unnest\(c.conkey,c.confkey\) as k\(child_att,parent_att\)/)
  assert.match(dependencies, /select c.conrelid,k.child_att/)
  assert.match(dependencies, /where k.parent_att=root.attnum/)
  assert.match(dependencies, /a.attrelid=root.table_id and a.attnum=root.attnum/)
  assert.match(dependencies, /n.nspname !~ '\^pg_' and n.nspname<>'information_schema'/)
  assert.match(dependencies, /n.nspname in \('public','private'\)/)
  assert.doesNotMatch(dependencies, /conparentid/)
  assert.match(dependencies, /t.oid not in \('public.projects'::regclass,'private.project_deletion_previews'::regclass\)/)
  assert.match(dependencies, /string_agg\(distinct format\('%I = \$1', refs.attname\), ' OR '\)/)
  assert.match(dependencies, /group by n.nspname,t.relname/)
  assert.match(dependencies, /select count\(\*\) from %I.%I where %s/)
  assert.match(dependencies, /into row_count using p_project/)
})
test('catalog contract includes UUID project_id soft references without a foreign key', () => {
  const dependencies = migration.split('create function private.project_lifecycle_dependencies')[1].split('create function public.set_project_archived')[0]
  assert.match(dependencies, /union\s+select a.attrelid as table_id, a.attname/)
  assert.match(dependencies, /a.attname='project_id' and a.atttypid='pg_catalog.uuid'::regtype/)
  assert.match(dependencies, /a.attnum>0 and not a.attisdropped/)
  assert.match(dependencies, /join pg_catalog.pg_namespace n on n.oid=t.relnamespace/)
  assert.match(dependencies, /n.nspname in \('public','private'\)/)
  assert.match(dependencies, /t.relkind in \('r','p'\)/)
  const installation = migration.split('do $$ declare ref record;')[1].split('end $$;')[0]
  for (const section of [dependencies, installation]) {
    assert.match(section, /not exists \(\s*select 1 from pg_catalog.pg_constraint fk\s*where fk.contype='f' and fk.conrelid=a.attrelid\s*and a.attnum=any\(fk.conkey\)\s*\)/)
    assert.doesNotMatch(section, /fk.confrelid=/)
  }
  assert.match(migration, /revoke all on function private.project_lifecycle_authority[^;]*private.lock_project_soft_reference_write\(\)[^;]*from public,anon,authenticated,service_role;/)
  assert.doesNotMatch(migration, /\block\s+(?:table\s+)?(?:only\s+)?[\w.%"]+\s+in\s+[\w\s]+\s+mode\b/i)
})
test('deletion requires READ COMMITTED at entry before authority, locks or receipt replay', () => {
  const deletion = migration.split('create function public.delete_empty_project')[1].split('create or replace function')[0]
  const body = deletion.split('\nbegin\n')[1].replace(/--[^\n]*/g, '').trimStart()
  assert.match(body, /^if pg_catalog\.current_setting\('transaction_isolation'\) <> 'read committed' then\s+raise exception '[^']+' using errcode='25001';\s+end if;/)
})
test('lifecycle commands retain only organization/actor/request idempotency advisory locks', () => {
  assert.doesNotMatch(migration, /project-lifecycle-softref:|pg_advisory_xact_lock_shared/)
  for (const name of ['set_project_archived', 'delete_empty_project']) {
    const command = migration.split(`create function public.${name}`)[1].split('end $$;')[0]
    assert.equal((command.match(/pg_advisory_xact_lock/g) || []).length, 1)
    assert.match(command, /perform pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(\s*'project-lifecycle:'\|\|p_organization_id::text\|\|actor::text\|\|p_request_id::text,0\)\);/)
    assert.ok(command.indexOf('pg_advisory_xact_lock') < command.indexOf('select * into receipt'))
  }
})
test('soft-reference inserts and project reassignment validate the new parent under key share', () => {
  const writer = migration.split('create function private.lock_project_soft_reference_write()')[1].split('end $$;')[0]
  assert.doesNotMatch(writer, /pg_advisory|\bold\b|\btg_op\b/i)
  assert.match(writer, /if new.project_id is not null then\s+perform 1 from public.projects p where p.id=new.project_id for key share;\s+if not found then\s+raise exception 'Project reference is unavailable\.' using errcode='23503';/)
  assert.match(writer, /end if;\s+return new;\s*$/)
  assert.match(migration, /create trigger trg_project_lifecycle_softref_lock before insert or update of project_id on %I\.%I for each row execute function private\.lock_project_soft_reference_write\(\)/)
})
test('catalog exception ignores only the untouched identity scaffold and counts all other records', () => {
  const dependencies = migration.split('create function private.project_lifecycle_dependencies')[1].split('create function public.set_project_archived')[0]
  assert.match(dependencies, /if child.nspname='public' and child.relname='living_project_documents' then/)
  assert.match(dependencies, /d.source_version<>1/)
  assert.match(dependencies, /or d.client_projection is distinct from '\{\}'::jsonb/)
  assert.match(dependencies, /or d.internal_projection is distinct from pg_catalog.jsonb_build_object\(\s*'identity',pg_catalog.jsonb_build_object\(\s*'project_id',p.id,'name',p.name,'engagement_type',p.engagement_type\)\)/)
  assert.match(dependencies, /join public.projects p on p.id=d.project_id\s*where d.project_id=\$1/)
  assert.equal((dependencies.match(/if child.nspname=/g) || []).length, 1)
})
test('immutable deletion receipts store only a confirmation digest and replay checks it with the preview ID', () => {
  const deletion = migration.slice(migration.indexOf('create function public.delete_empty_project')).split('create or replace function')[0]
  const payload = deletion.split('payload:=')[1].split(';')[0]
  assert.match(payload, /'preview_id',p_preview_id,'confirmation_sha256'/)
  assert.match(payload, /pg_catalog.encode\(extensions.digest\(pg_catalog.convert_to\(p_confirmation,'UTF8'\),'sha256'\),'hex'\)/)
  assert.doesNotMatch(payload, /'confirmation'|'project_name'|project.name/)
  assert.match(deletion, /if receipt.payload is distinct from payload then raise exception/)
  assert.ok(deletion.indexOf('return receipt.result') < deletion.indexOf('select * into preview'))
  assert.match(migration, /create trigger project_lifecycle_commands_immutable before update or delete/)
  const result = deletion.split('result:=')[1].split(';')[0]
  assert.doesNotMatch(result, /confirmation|project_name|project.name/)
})
