// Admin-only LOCAL PostgreSQL proof. The template must already contain Design B06a.
// It accepts loopback only, clones/drops only its random database, and never contacts hosted services.
import pg from "npm:pg@8.23.0";
import assert from "node:assert/strict";

const raw = Deno.env.get("DESIGN_B06A_LOCAL_TEMPLATE_URL");
if (!raw) {
  throw new Error(
    "DESIGN_B06A_LOCAL_TEMPLATE_URL is required; no database was touched",
  );
}
const url = new URL(raw);
if (
  url.protocol !== "postgresql:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.search ||
  url.hash
) {
  throw new Error(
    "Only an explicitly configured loopback PostgreSQL template is allowed",
  );
}
const template = decodeURIComponent(url.pathname.slice(1));
if (
  !template.startsWith("design_b06a_template_") ||
  !/^[a-z0-9_]+$/.test(template)
) {
  throw new Error("Template database must be named design_b06a_template_*");
}
const database = "design_b06a_verify_" +
  crypto.randomUUID().replaceAll("-", "");
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const testUrl = new URL(url);
testUrl.pathname = "/" + database;
const admin = new pg.Client({ connectionString: adminUrl.toString() });
const clients: pg.Client[] = [];
let created = false;

async function beginService(client: pg.Client) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await client.query("set local role service_role");
}

await admin.connect();
try {
  const guard = await admin.query(
    "select inet_server_addr()::text address,exists(select 1 from pg_database where datname=$1) template_exists",
    [template],
  );
  assert.ok(
    ["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"].includes(
      guard.rows[0].address,
    ),
  );
  assert.equal(guard.rows[0].template_exists, true);
  await admin.query(
    'CREATE DATABASE "' + database + '" TEMPLATE "' + template + '"',
  );
  created = true;
  for (let index = 0; index < 3; index += 1) {
    const client = new pg.Client({ connectionString: testUrl.toString() });
    await client.connect();
    clients.push(client);
  }
  const [setup, archiver, saver] = clients;
  const id = Object.fromEntries(
    [
      "actor",
      "org",
      "client",
      "brand",
      "engagement",
      "service",
      "engagementService",
      "task",
      "asset1",
      "version1",
      "asset2",
      "version2",
    ]
      .map((key) => [key, crypto.randomUUID()]),
  );
  await setup.query("insert into auth.users(id) values($1)", [id.actor]);
  await setup.query(
    "insert into public.organizations(id,name,slug,status) values($1,'B06a race',$2,'active')",
    [id.org, "b06a-" + id.org],
  );
  await setup.query(
    "insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values($1,$2,'team','contributor','design','active')",
    [id.org, id.actor],
  );
  await setup.query(
    "insert into public.agency_clients(id,organization_id,name,created_by) values($1,$2,'B06a client',$3)",
    [id.client, id.org, id.actor],
  );
  await setup.query(
    "insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values($1,$2,$3,'B06a brand',true,$4)",
    [id.brand, id.org, id.client, id.actor],
  );
  await setup.query(
    "insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by) values($1,$2,$3,$4,'B06a engagement','active',$5)",
    [id.engagement, id.org, id.client, id.brand, id.actor],
  );
  await setup.query(
    "insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values($1,$2,'design','b06a_race','B06a race',true)",
    [id.service, id.org],
  );
  await setup.query(
    "insert into public.engagement_services(id,organization_id,engagement_id,service_id,status,activated_by) values($1,$2,$3,$4,'active',$5)",
    [id.engagementService, id.org, id.engagement, id.service, id.actor],
  );
  await setup.query(
    "insert into public.tasks(id,user_id,title,status,project_id,organization_id,department,department_id,created_by) select $1,$2,'Existing task','ready',project_id,$3,'design','design',$2 from public.engagements where id=$4",
    [id.task, id.actor, id.org, id.engagement],
  );
  for (
    const [asset, version, operation] of [[
      id.asset1,
      id.version1,
      "archive-first-upload",
    ], [id.asset2, id.version2, "reference-first-upload"]]
  ) {
    await setup.query(
      "select public.register_design_asset_upload($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,null,null,'Race asset','static_image','','','race.png',$1::text||'/assets/'||$4::text||'/'||$5::text||'/file.png','image/png',68,1,1,repeat('a',64),'',$6::text,repeat('1',64),$7::uuid)",
      [id.org, id.engagement, id.brand, asset, version, operation, id.actor],
    );
  }
  const content = JSON.stringify({
    schema_version: 1,
    destination_type: "website",
    placement_label: "Hero",
    placement_description: "",
    website_page_section: "Home / Hero",
    social_platform: "",
    width: 1440,
    height: 900,
    usage_instructions: "Use exact version",
    export_guidance: "",
  });
  const save = (
    client: pg.Client,
    version: string,
    key: string,
    requestChecksum: string,
    contentChecksum: string,
  ) =>
    client.query(
      "select public.save_design_delivery_package_version($1,$2,null,$3,$4,$5,null,null,$6,null,null,$7,$8,'Race package',$9::jsonb,$10,array[$11::uuid]) result",
      [
        id.org,
        id.actor,
        id.engagement,
        id.brand,
        id.engagementService,
        id.task,
        key,
        requestChecksum,
        content,
        contentChecksum,
        version,
      ],
    );

  // Archive-first: save waits on the root and then rejects the archived asset.
  await archiver.query("begin");
  await archiver.query(
    "select id from public.design_assets where id=$1 for update",
    [id.asset1],
  );
  let saveSettled = false;
  const blockedSave = (async () => {
    await beginService(saver);
    try {
      await save(
        saver,
        id.version1,
        "archive-first-package",
        "2".repeat(64),
        "3".repeat(64),
      );
      await saver.query("commit");
      return null;
    } catch (error) {
      await saver.query("rollback");
      return error as { message?: string };
    } finally {
      saveSettled = true;
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(
    saveSettled,
    false,
    "package reference did not wait on the archive root lock",
  );
  await archiver.query(
    "select public.archive_design_asset($1,$2,$3,'archive-first-operation','Explicit race test',$4)",
    [id.org, id.asset1, id.version1, id.actor],
  );
  await archiver.query("commit");
  const saveError = await blockedSave;
  assert.match(
    saveError?.message || "",
    /Archived Design assets cannot be packaged/,
  );

  // Reference-first: archive waits, then the committed package reference rejects it.
  await beginService(saver);
  const saved = await save(
    saver,
    id.version2,
    "reference-first-package",
    "4".repeat(64),
    "5".repeat(64),
  );
  let archiveSettled = false;
  const blockedArchive = (async () => {
    await beginService(archiver);
    try {
      await archiver.query(
        "select public.archive_design_asset($1,$2,$3,'reference-first-archive','Explicit race test',$4)",
        [id.org, id.asset2, id.version2, id.actor],
      );
      await archiver.query("commit");
      return null;
    } catch (error) {
      await archiver.query("rollback");
      return error as { message?: string };
    } finally {
      archiveSettled = true;
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(
    archiveSettled,
    false,
    "archive did not wait on the package reference root lock",
  );
  await saver.query("commit");
  const archiveError = await blockedArchive;
  assert.match(archiveError?.message || "", /referenced by delivery packages/);
  const final = await setup.query(
    "select (select count(*)::int from public.artifacts where organization_id=$1 and artifact_type='design_delivery_package') packages,(select count(*)::int from public.design_delivery_package_version_assets where organization_id=$1) refs,(select archived_at is not null from public.design_assets where id=$2) first_archived,(select archived_at is null from public.design_assets where id=$3) second_active",
    [id.org, id.asset1, id.asset2],
  );
  assert.deepEqual(final.rows[0], {
    packages: 1,
    refs: 1,
    first_archived: true,
    second_active: true,
  });
  assert.equal(saved.rows[0].result.idempotent_replay, false);
  console.log(
    "loopback_clone=true; archive_first_reference_waited=true; archive_first_save_rejected=true; reference_first_archive_waited=true; reference_first_archive_rejected=true; packages=1; refs=1; first_archived=true; second_active=true; storage_deleted=0",
  );
} finally {
  for (const client of clients) {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  if (created) await admin.query('DROP DATABASE "' + database + '"');
  await admin.end();
}
