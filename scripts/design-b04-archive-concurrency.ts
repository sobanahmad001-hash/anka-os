// Admin-only LOCAL PostgreSQL proof. The template must already contain Design B04.
// It accepts loopback only, clones/drops only its random database, and never contacts hosted services.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const raw = Deno.env.get('DESIGN_B04_LOCAL_TEMPLATE_URL')
if (!raw) throw new Error('DESIGN_B04_LOCAL_TEMPLATE_URL is required; no database was touched')
const url = new URL(raw)
if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
  throw new Error('Only an explicitly configured loopback PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('design_b04_template_') || !/^[a-z0-9_]+$/.test(template)) {
  throw new Error('Template database must be named design_b04_template_*')
}
const database = 'design_b04_verify_' + crypto.randomUUID().replaceAll('-', '')
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const testUrl = new URL(url); testUrl.pathname = '/' + database
const admin = new pg.Client({ connectionString: adminUrl.toString() })
const clients: pg.Client[] = []
let created = false

await admin.connect()
try {
  const guard = await admin.query('select inet_server_addr()::text address,exists(select 1 from pg_database where datname=$1) template_exists', [template])
  assert.ok(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(guard.rows[0].address))
  assert.equal(guard.rows[0].template_exists, true)
  await admin.query('CREATE DATABASE "' + database + '" TEMPLATE "' + template + '"')
  created = true
  for (let index = 0; index < 3; index++) {
    const client = new pg.Client({ connectionString: testUrl.toString() }); await client.connect(); clients.push(client)
  }
  const [setup, archiver, writer] = clients
  const id = Object.fromEntries(['actor','org','client','brand','engagement','service','asset','version','next','asset2','version2','next2'].map(key => [key, crypto.randomUUID()]))
  await setup.query('insert into auth.users(id) values($1)', [id.actor])
  await setup.query("insert into public.organizations(id,name,slug,status) values($1,'B04 race',$2,'active')", [id.org, 'b04-' + id.org])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values($1,$2,'team','contributor','design','active')", [id.org, id.actor])
  await setup.query("insert into public.agency_clients(id,organization_id,name,created_by) values($1,$2,'B04 client',$3)", [id.client, id.org, id.actor])
  await setup.query("insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values($1,$2,$3,'B04 brand',true,$4)", [id.brand, id.org, id.client, id.actor])
  await setup.query("insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by) values($1,$2,$3,$4,'B04 engagement','active',$5)", [id.engagement, id.org, id.client, id.brand, id.actor])
  await setup.query("insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values($1,$2,'design','b04_race','B04 race',true)", [id.service, id.org])
  await setup.query("insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values($1,$2,$3,'active',$4)", [id.org, id.engagement, id.service, id.actor])
  await setup.query(
    "select public.register_design_asset_upload($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,null,null,'Race draft','static_image','','','race.png',$1::text||'/assets/'||$4::text||'/'||$5::text||'/file.png','image/png',68,1,1,repeat('a',64),'','race-upload-operation',repeat('1',64),$6::uuid)",
    [id.org, id.engagement, id.brand, id.asset, id.version, id.actor],
  )
  await setup.query(
    "select public.register_design_asset_upload($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,null,null,'Writer-first draft','static_image','','','writer.png',$1::text||'/assets/'||$4::text||'/'||$5::text||'/file.png','image/png',68,1,1,repeat('c',64),'','writer-first-upload',repeat('3',64),$6::uuid)",
    [id.org, id.engagement, id.brand, id.asset2, id.version2, id.actor],
  )

  await archiver.query('begin')
  await archiver.query('select id from public.design_assets where id=$1 for update', [id.asset])
  let writerSettled = false
  const contender = (async () => {
    await writer.query('begin')
    try {
      await writer.query(
        "insert into public.design_asset_versions(id,organization_id,asset_id,version_number,parent_version_id,source_kind,lifecycle_status,storage_path,mime_type,byte_size,width,height,original_filename,content_checksum,change_summary,operation_key,request_checksum,created_by) values($1::uuid,$2::uuid,$3::uuid,2,$4::uuid,'upload','draft',$2::text||'/assets/'||$3::text||'/'||$1::text||'/file.png','image/png',68,1,1,'next.png',repeat('b',64),'','race-next-operation',repeat('2',64),$5::uuid)",
        [id.next, id.org, id.asset, id.version, id.actor],
      )
      await writer.query('commit')
      return null
    } catch (error) {
      await writer.query('rollback')
      return error as { message?: string }
    } finally { writerSettled = true }
  })()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(writerSettled, false, 'version writer did not wait on the asset root lock')
  const archived = await archiver.query(
    "select public.archive_design_asset($1,$2,$3,'race-archive-operation','Explicit race confirmation',$4) result",
    [id.org, id.asset, id.version, id.actor],
  )
  await archiver.query('commit')
  assert.equal(archived.rows[0].result.storage_objects_deleted, 0)
  const loser = await contender
  assert.match(loser?.message || '', /cannot receive new versions/)
  await writer.query('begin')
  await writer.query(
    "insert into public.design_asset_versions(id,organization_id,asset_id,version_number,parent_version_id,source_kind,lifecycle_status,storage_path,mime_type,byte_size,width,height,original_filename,content_checksum,change_summary,operation_key,request_checksum,created_by) values($1::uuid,$2::uuid,$3::uuid,2,$4::uuid,'upload','draft',$2::text||'/assets/'||$3::text||'/'||$1::text||'/file.png','image/png',68,1,1,'writer-next.png',repeat('d',64),'','writer-first-next',repeat('4',64),$5::uuid)",
    [id.next2, id.org, id.asset2, id.version2, id.actor],
  )
  let archiveSettled = false
  const staleArchive = (async () => {
    await archiver.query('begin')
    try {
      await archiver.query(
        "select public.archive_design_asset($1,$2,$3,'writer-first-archive','Explicit writer-first confirmation',$4)",
        [id.org, id.asset2, id.version2, id.actor],
      )
      await archiver.query('commit')
      return null
    } catch (error) {
      await archiver.query('rollback')
      return error as { code?: string; message?: string }
    } finally { archiveSettled = true }
  })()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(archiveSettled, false, 'archive did not wait on the version writer root lock')
  await writer.query('commit')
  const stale = await staleArchive
  assert.equal(stale?.code, '40001')
  assert.match(stale?.message || '', /changed since it was loaded/)
  const final = await setup.query('select a.archived_at,count(v.id)::int version_count from public.design_assets a join public.design_asset_versions v on v.asset_id=a.id where a.id=$1 group by a.archived_at', [id.asset])
  assert.ok(final.rows[0].archived_at)
  assert.equal(final.rows[0].version_count, 1)
  console.log('loopback_clone=true; writer_waited=true; archive_won=true; concurrent_version_rejected=true; archive_waited=true; writer_won=true; stale_archive_sqlstate_40001=true; history_retained=true; storage_deleted=0')
} finally {
  for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end() }
  if (created) await admin.query('DROP DATABASE "' + database + '"')
  await admin.end()
}
