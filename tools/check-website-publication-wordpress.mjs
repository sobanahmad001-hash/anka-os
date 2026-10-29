// Isolated local WordPress fixture only. No real target, provider, credentials or external networking.
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {websiteNativeSnapshotChecksum} from '../supabase/functions/_shared/websiteNativeDesign.js'

const runtime = resolve(process.argv[2]), out = resolve(process.argv[3])
await mkdir(out, {recursive: true})
assert.equal(JSON.parse(await readFile(resolve(runtime, 'node_modules/@wp-playground/cli/package.json'), 'utf8')).version, '3.1.61')
const {runCLI} = await import(pathToFileURL(resolve(runtime, 'node_modules/@wp-playground/cli/index.js')))
const site = 'a0000000-0000-4000-8000-000000000901', origin = 'https://publication.example.test', checks = []
const server = await runCLI({command: 'server', php: '8.3', wp: '7.1.3', port: 5230, workers: 1, login: false, blueprint: {features: {networking: false}, steps: [{step: 'defineWpConfigConsts', consts: {WP_ENVIRONMENT_TYPE: 'production', ANKA_PUBLICATION_SITE_ID: site, ANKA_PUBLICATION_ENABLED: false, DISABLE_WP_CRON: true, WP_HTTP_BLOCK_EXTERNAL: true, AUTOMATIC_UPDATER_DISABLED: true}}]}})
await server.playground.defineConstant('WP_HOME', origin)
await server.playground.defineConstant('WP_SITEURL', origin)
const run = async code => {
  const result = await server.playground.run({code: '<?php require "/wordpress/wp-load.php";' + code})
  assert.equal(result.exitCode, 0, result.errors)
  return result.text
}
try {
  await server.playground.mkdir('/wordpress/wp-content/plugins/anka-publication')
  await server.playground.writeFile('/wordpress/wp-content/plugins/anka-publication/anka-publication.php', await readFile(new URL('../wordpress/anka-publication/anka-publication.php', import.meta.url), 'utf8'))
  const actor = JSON.parse(await run('require_once ABSPATH."wp-admin/includes/plugin.php";$e=activate_plugin("anka-publication/anka-publication.php");if(is_wp_error($e)){throw new Exception("Fixture activation failed");}$id=wp_insert_user(array("user_login"=>"synthetic-publication-agent","user_pass"=>wp_generate_password(32),"role"=>"anka_publication_agent"));echo json_encode(array("id"=>$id,"wordpress"=>get_bloginfo("version"),"php"=>PHP_VERSION));'))
  assert.equal(actor.wordpress, '7.1.3'); assert.ok(actor.php.startsWith('8.3.'))
  const call = async (path, method = 'GET', user = actor.id) => JSON.parse(await run('wp_set_current_user(' + user + ');$request=new WP_REST_Request(' + JSON.stringify(method) + ',' + JSON.stringify('/anka-publish/v1' + path) + ');$response=rest_do_request($request);echo json_encode(array("status"=>$response->get_status(),"data"=>$response->get_data(),"headers"=>$response->get_headers()));'))
  assert.equal((await call('/identity')).status, 403); checks.push('production receiver is disabled without its separate explicit enable switch')
  await server.playground.defineConstant('ANKA_PUBLICATION_ENABLED', true)
  assert.equal((await call('/identity', 'GET', 0)).status, 403); checks.push('anonymous calls cannot inspect production identity')
  const identity = await call('/identity')
  assert.equal(identity.status, 200, JSON.stringify(identity)); assert.equal(identity.data.site_id, site); assert.equal(identity.data.environment, 'production')
  assert.ok(identity.headers['Cache-Control'].includes('no-store')); checks.push('dedicated capability returns exact uncached production identity')
  assert.equal((await call('/publish', 'POST')).status, 409); assert.equal((await call('/rollback', 'POST')).status, 409); checks.push('inspection-only receiver exposes no publication or rollback route')
  const pages = JSON.parse(await run('update_option("permalink_structure","/%postname%/");$drafts=get_posts(array("post_type"=>"page","post_status"=>"draft","numberposts"=>100));foreach($drafts as $p){wp_update_post(array("ID"=>$p->ID,"post_status"=>"publish"));}$id=wp_insert_post(array("post_type"=>"page","post_status"=>"publish","post_name"=>"reviewed-page","post_title"=>"Original exact page","post_content"=>"Original fixture content"));echo json_encode(array("id"=>$id));'))
  const baseline = await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_results("SELECT ID,post_title,post_content,post_status,post_name FROM ".$wpdb->posts." ORDER BY ID",ARRAY_A)));')
  const result = await call('/inventory')
  if (result.status !== 200) console.log(await run('try{anka_publication_inventory();}catch(Throwable $error){echo "Synthetic fixture inspection reason: ".$error->getMessage();}'))
  assert.equal(result.status, 200, JSON.stringify(result))
  const inventory = result.data.inventory, {inventory_sha256, ...unsigned} = inventory
  assert.equal(inventory_sha256, await websiteNativeSnapshotChecksum(unsigned)); checks.push('actual WordPress inventory checksum matches canonical JavaScript hashing')
  const page = inventory.posts.find(row => row.post_id === pages.id)
  assert.equal(page.path, '/reviewed-page'); assert.equal(page.post_type, 'page'); assert.equal(page.post_status, 'publish'); assert.equal(page.managed_page_id, null)
  assert.ok(page.revision > 0); checks.push('complete inventory pins canonical path type status revision and opaque post checksum')
  assert.equal(JSON.stringify(inventory).includes('Original fixture content'), false); checks.push('inspection returns post checksums without private post bodies')
  const after = await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_results("SELECT ID,post_title,post_content,post_status,post_name FROM ".$wpdb->posts." ORDER BY ID",ARRAY_A)));')
  assert.equal(after, baseline); checks.push('identity and inventory do not change pages or activate a theme')
  await run('wp_update_post(array("ID"=>' + pages.id + ',"post_content"=>"A later human fixture edit"));')
  const changed = (await call('/inventory')).data.inventory.posts.find(row => row.post_id === pages.id)
  assert.notEqual(changed.sha256, page.sha256); checks.push('later human content edit changes inspected page checksum')
  const bad = await run('update_post_meta(' + pages.id + ',"_anka_publication_page_id","invalid");echo "ok";'); assert.equal(bad, 'ok')
  assert.equal((await call('/inventory')).status, 409); checks.push('invalid retained page identity blocks complete inventory')
  await run('delete_post_meta(' + pages.id + ',"_anka_publication_page_id");')
  const beforeTheme = (await call('/inventory')).data.inventory.theme_sha256
  await run('file_put_contents(get_stylesheet_directory()."/anka-qa-marker.txt","Synthetic local fixture marker");')
  const afterTheme = (await call('/inventory')).data.inventory.theme_sha256
  assert.notEqual(beforeTheme, afterTheme); checks.push('active theme file change invalidates the exact inspected theme fingerprint')
  await run('unlink(get_stylesheet_directory()."/anka-qa-marker.txt");')
  // Internal journal admission has no REST execution route. These mutations are
  // confined to the disposable local fixture and never touch page/theme state.
  console.log('Completed isolated inspection checks; verifying private backup journal')
  const journalBaseline = await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_results("SELECT ID,post_title,post_content,post_status,post_name FROM ".$wpdb->posts." ORDER BY ID",ARRAY_A)));')
  const currentInspection = (await call('/inventory')).data.inventory, currentPage = currentInspection.posts.find(p => p.post_id === pages.id)
  const backupReview = {target: {site_id: site, origin}, inspection: currentInspection, pages: [{page_id: 'a0000000-0000-4000-8000-000000000910', operation: 'replace', post_id: pages.id, path: currentPage.path, expected_post_revision: currentPage.revision, expected_post_sha256: currentPage.sha256}]}
  const unsignedCommand = {protocol: 'anka-publication-v1', kind: 'publication', site_id: site, request_id: 'a0000000-0000-4000-8000-000000000902', command_id: 'a0000000-0000-4000-8000-000000000903', review_sha256: await websiteNativeSnapshotChecksum(backupReview), review_snapshot: backupReview}
  const originalCommand = {...unsignedCommand, command_sha256: await websiteNativeSnapshotChecksum(unsignedCommand)}
  const journal = async (operation, command = originalCommand, user = actor.id) => JSON.parse(await run('wp_set_current_user(' + user + ');$command=json_decode(' + JSON.stringify(JSON.stringify(command)) + ',true);try{$result=anka_publication_journal_' + operation + '($command);echo json_encode(array("ok"=>true,"result"=>$result));}catch(Throwable $error){echo json_encode(array("ok"=>false));}'))
  assert.equal((await journal('claim', originalCommand, 0)).ok, false); checks.push('journal admission requires current dedicated production authority')
  assert.equal((await journal('read')).result.status, 'missing')
  assert.equal((await journal('claim')).result, true)
  assert.equal((await journal('claim')).result, false)
  assert.equal((await journal('read')).result.status, 'pending'); checks.push('durable original journal admits once and repeated requests never redispatch')
  const other = {...unsignedCommand, request_id: 'a0000000-0000-4000-8000-000000000904'}
  assert.equal((await journal('claim', {...other, command_sha256: await websiteNativeSnapshotChecksum(other)})).ok, false); checks.push('pending site lock blocks replacement by another original request')
  const changedCommand = {...unsignedCommand, review_sha256: 'b'.repeat(64)}
  const signedChangedCommand = {...changedCommand, command_sha256: await websiteNativeSnapshotChecksum(changedCommand)}
  assert.equal((await journal('claim', signedChangedCommand)).ok, false)
  assert.equal((await journal('read', signedChangedCommand)).ok, false); checks.push('same request UUID cannot substitute a differently signed reviewed payload')
  assert.equal((await journal('claim', {...originalCommand, command_sha256: 'f'.repeat(64)})).ok, false); checks.push('PHP admission verifies the canonical JavaScript command digest')
  const backup = async (operation, command = originalCommand, user = actor.id) => JSON.parse(await run('wp_set_current_user(' + user + ');$command=json_decode(' + JSON.stringify(JSON.stringify(command)) + ',true);try{$result=anka_publication_backup_' + operation + '($command);echo json_encode(array("ok"=>true,"result"=>$result));}catch(Throwable $error){echo json_encode(array("ok"=>false));}'))
  assert.equal((await backup('prepare', originalCommand, 0)).ok, false)
  const backupHash = (await backup('prepare')).result;assert.match(backupHash,/^[a-f0-9]{64}$/)
  assert.equal((await backup('prepare')).result,backupHash);checks.push('dedicated authority retains one immutable original backup before any writer exists')
  const retainedBackup=(await backup('read')).result
  assert.equal(retainedBackup.snapshot.posts[0].before.fields.post_content,'A later human fixture edit')
  assert.equal(retainedBackup.sha256,await websiteNativeSnapshotChecksum(retainedBackup.snapshot));checks.push('retained private original bodies and exact metadata have matching PHP JavaScript backup checksums')
  const noBodies=await call('/inventory');assert.equal(JSON.stringify(noBodies.data).includes('A later human fixture edit'),false);checks.push('backup bodies are absent from public receiver inspection projections')
  const terminal=await journal('fail_unchanged');assert.equal(terminal.result,true);assert.equal((await journal('read')).result.status,'failed');assert.equal((await journal('fail_unchanged')).result,false);checks.push('only proven unchanged prewrite failure closes once and releases its exact original lock')
  const secondCommand={...other,command_sha256:await websiteNativeSnapshotChecksum(other)}
  assert.equal((await journal('claim',secondCommand)).result,true)
  assert.equal((await journal('fail_unchanged')).result,false)
  const blocked={...unsignedCommand,request_id:'a0000000-0000-4000-8000-000000000906'}
  assert.equal((await journal('claim',{...blocked,command_sha256:await websiteNativeSnapshotChecksum(blocked)})).ok,false);checks.push('old terminal replay cannot remove a newer command lock or authorize replacement')
  const secondBackup=(await backup('prepare',secondCommand)).result
  assert.equal((await journal('begin_execute',secondCommand)).result,true);assert.equal((await journal('begin_execute',secondCommand)).result,false);assert.equal((await journal('fail_unchanged',secondCommand)).ok,false);checks.push('durable execution phase admits once and unchanged inventory never closes a possibly executing command')
  await run('wp_update_post(array("ID"=>'+pages.id+',"post_content"=>"Later concurrent fixture edit after backup"));')
  const afterEditBaseline = await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_results("SELECT ID,post_title,post_content,post_status,post_name FROM ".$wpdb->posts." ORDER BY ID",ARRAY_A)));')
  assert.equal((await journal('fail_unchanged',secondCommand)).ok,false)
  assert.equal((await journal('read',secondCommand)).result.status,'pending')
  assert.equal((await backup('prepare',secondCommand)).ok,false);assert.equal((await backup('read',secondCommand)).result.sha256,secondBackup);checks.push('later page mutation prevents false failure settlement and never rewrites the retained original backup')
  const staleCache=await run('wp_set_current_user('+actor.id+');wp_cache_set("anka_publication_request_'+secondCommand.request_id+'",false,"options");$command=json_decode('+JSON.stringify(JSON.stringify(secondCommand))+',true);echo json_encode(anka_publication_journal_read($command));')
  assert.equal(JSON.parse(staleCache).status,'pending');checks.push('journal recovery reads authoritative option bytes instead of stale cached absence')
  // Simulate interruption between the durable site lock and receipt insert. The
  // retained lock is never expired, removed or converted into permission to retry.
  await run('delete_option("anka_publication_request_' + secondCommand.request_id + '");')
  assert.equal((await journal('read',secondCommand)).result.status, 'uncertain')
  assert.equal((await journal('claim',secondCommand)).result, false)
  const secondChanged={...other,review_sha256:'c'.repeat(64)};assert.equal((await journal('read', {...secondChanged,command_sha256:await websiteNativeSnapshotChecksum(secondChanged)})).ok, false); checks.push('interrupted original receipt remains uncertain and its site lock cannot be stolen')
  const journalAfter = await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_results("SELECT ID,post_title,post_content,post_status,post_name FROM ".$wpdb->posts." ORDER BY ID",ARRAY_A)));')
  assert.equal(journalAfter, afterEditBaseline);assert.equal(JSON.parse(journalBaseline).theme,JSON.parse(journalAfter).theme)
  assert.equal((await call('/publish', 'POST')).status, 409); assert.equal((await call('/rollback', 'POST')).status, 409); checks.push('journal admission changes no pages or active theme and rejects malformed execution before admission')
  await writeFile(resolve(out, 'verification.json'), JSON.stringify({wordpress: actor.wordpress, php: actor.php, checks, networking: false, realClientConnection: false, clientPublication: false, fixtureWritesOnly: true, receiver: 'inspection only'}, null, 2))
  console.log(JSON.stringify({passed: checks.length, wordpress: actor.wordpress, php: actor.php, networking: false}))
} finally {await server[Symbol.asyncDispose]()}
