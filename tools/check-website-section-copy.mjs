// Local WordPress rehearsal only: synthetic identities/styles, preserved source copy,
// networking disabled. Never connects to the user's browser or real staging site.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {prepareWebsiteNativeManifest,verifyWebsiteNativeManifest,websiteNativeLayout} from '../supabase/functions/_shared/websiteNativeDraft.js'
import {compileWebsiteNativeDesign} from '../supabase/functions/_shared/websiteNativeDesign.js'
import {buildWebsiteBlockSource} from '../supabase/functions/_shared/websiteBlockBuild.js'
import {stagingCommand,sha} from '../supabase/functions/_shared/websiteStaging.js'
import {createStoredZip} from '../supabase/functions/wordpress-export/theme.ts'
const [runtime,copyFile,outArg,playwright,chrome,portArg]=process.argv.slice(2),out=resolve(outArg)
await mkdir(out,{recursive:true})
assert.equal(JSON.parse(await readFile(resolve(runtime,'node_modules/@wp-playground/cli/package.json'),'utf8')).version,'3.1.61')
const {runCLI}=await import(pathToFileURL(resolve(runtime,'node_modules/@wp-playground/cli/index.js'))),{chromium}=await import(pathToFileURL(resolve(playwright)))
const id=n=>'d0000000-0000-4000-8000-'+String(n).padStart(12,'0'),origin='https://staging.example.test',copy=await readFile(resolve(copyFile),'utf8')
const context={scope:{organization_id:id(1),project_id:id(2),engagement_id:id(3),page_id:id(4),page_key:'home'},architecture:{artifact_version_id:id(5),content_checksum:'a'.repeat(64)},page:{title:'Home'},content_version:{id:id(6),content_checksum:await sha(new TextEncoder().encode(copy))},brief_version:{id:id(7),content_checksum:'c'.repeat(64)},site_version:{id:id(8),request_sha256:'d'.repeat(64),site:{title:'Anka Sphere',language:'en',description:'Local rehearsal styles only',palette:{background:'#ffffff',surface:'#eeeeee',ink:'#111111',accent:'#224466'},navigation:[{label:'Services',path:'#services'},{label:'Selected work',path:'#selected-work'},{label:'Connect with Anka',path:'https://ankasphere.com/contact-anka-sphere/'}],footer:'Anka Sphere'}},content_page:{page_brief:'Local rehearsal of preserved approved homepage copy',draft_copy:copy,meta_title:'Anka Sphere',meta_description:'A marketing and design studio connecting brand, digital experiences, marketing, data and AI.',primary_cta:'Connect with Anka'}}
const manifest=await prepareWebsiteNativeManifest(context,websiteNativeLayout(context));await verifyWebsiteNativeManifest(context,manifest)
assert.equal(manifest.content.sections.length,6)
const compiled=await compileWebsiteNativeDesign(manifest),bundle=await buildWebsiteBlockSource(manifest)
await writeFile(resolve(out,'source-preview.html'),compiled.preview)
await writeFile(resolve(out,'synthetic-source-package.json'),JSON.stringify(bundle,null,2))
const server=await runCLI({command:'server',php:'8.3',wp:'7.1.3',port:Number(portArg||5252),workers:1,login:false,blueprint:{features:{networking:false},steps:[{step:'defineWpConfigConsts',consts:{WP_ENVIRONMENT_TYPE:'staging',ANKA_STAGING_SITE_ID:id(9),DISABLE_WP_CRON:true,WP_HTTP_BLOCK_EXTERNAL:true,AUTOMATIC_UPDATER_DISABLED:true}}]}})
let browser
const checks=[],cases=[],encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64')
const run=async code=>{const r=await server.playground.run({code:'<?php require "/wordpress/wp-load.php"; '+code});assert.equal(r.exitCode,0,r.errors);return r.text}
try{
 await server.playground.defineConstant('WP_HOME',origin);await server.playground.defineConstant('WP_SITEURL',origin)
 await server.playground.mkdir('/wordpress/wp-content/plugins/anka-staging');await server.playground.writeFile('/wordpress/wp-content/plugins/anka-staging/anka-staging.php',await readFile(new URL('../wordpress/anka-staging/anka-staging.php',import.meta.url),'utf8'))
 const actor=JSON.parse(await run('require_once ABSPATH."wp-admin/includes/plugin.php";activate_plugin("anka-staging/anka-staging.php");$id=wp_insert_user(array("user_login"=>"section-copy-local-qa","user_pass"=>wp_generate_password(32),"role"=>"anka_staging_agent"));echo json_encode(array("id"=>$id,"wordpress"=>get_bloginfo("version"),"php"=>PHP_VERSION));'))
 const baseline=await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_var("SELECT COUNT(*) FROM ".$wpdb->posts)));')
 const zip=createStoredZip(Object.entries(bundle.files).sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>({name:bundle.directory+'/'+name,bytes:new TextEncoder().encode(text)}))),checksum=await sha(zip)
 const command=await stagingCommand({target:{site_id:id(9)},job:{artifact_sha256:checksum},source:{context:{page:{path:'/'}}}},{request_id:id(10),remote_head:null,created_at:new Date().toISOString()},bundle)
 const result=JSON.parse(await run('wp_set_current_user('+actor.id+');$r=new WP_REST_Request("POST","/anka-stage/v1/deploy");$r->set_header("Content-Type","application/json");$r->set_body(base64_decode("'+encoded(command)+'"));$v=rest_do_request($r);echo json_encode(array("status"=>$v->get_status(),"data"=>$v->get_data()));'))
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.status,'staged');assert.equal(result.data.published,false);checks.push('six-section fixed native package accepted by actual receiver')
 assert.equal(await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_var("SELECT COUNT(*) FROM ".$wpdb->posts)));'),baseline);checks.push('existing pages and active theme unchanged')
 const url=server.serverUrl+'/?anka_staging_preview='+command.request_id
 assert.equal((await fetch(url)).status,403);checks.push('anonymous preview denied')
 const cookie=JSON.parse(await run('echo json_encode(array("name"=>LOGGED_IN_COOKIE,"value"=>wp_generate_auth_cookie('+actor.id+',time()+3600,"logged_in")));'))
 browser=await chromium.launch({headless:true,executablePath:chrome})
 const session=await browser.newContext();await session.addCookies([{...cookie,url:server.serverUrl,httpOnly:true,sameSite:'Lax'}])
 for(const width of [390,1440])for(const colorScheme of ['light','dark']){
  const page=await session.newPage(),external=[],errors=[];await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(server.serverUrl).origin)return route.continue();external.push(route.request().url());return route.abort()})
  const response=await page.goto(url,{waitUntil:'networkidle'});assert.equal(response.status(),200)
  assert.match(response.headers()['cache-control'],/no-store/);assert.match(response.headers()['x-robots-tag'],/noindex/);assert.match(response.headers()['content-security-policy'],/script-src 'none'/)
  assert.equal(await page.locator('main .anka-section').count(),6);assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('h1').textContent(),manifest.content.sections[0].heading)
  for(const section of manifest.content.sections){
   const node=page.locator('#'+section.key);assert.equal(await node.count(),1)
   assert.equal(await node.locator('h1,h2').textContent(),section.heading)
   for(const p of section.paragraphs)assert.ok((await node.textContent()).includes(p))
   for(const item of section.items){assert.ok((await node.textContent()).includes(item.title));assert.ok((await node.textContent()).includes(item.body))}
   assert.equal(await node.getByRole('link',{name:section.action.label,exact:true}).getAttribute('href'),section.action.path)
  }
  assert.equal(await page.locator('main a[href="https://ankasphere.com/contact-anka-sphere/"]').count(),6)
  await page.getByRole('link',{name:'Explore our work',exact:true}).click();assert.equal(new URL(page.url()).hash,'#selected-work')
  for(const hash of await page.locator('a[href^="#"]').evaluateAll(nodes=>nodes.map(n=>n.hash)))assert.equal(await page.locator('[id="'+hash.slice(1)+'"]').count(),1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.keyboard.press('Tab')
  for(const link of await page.locator('main a').all()){await link.focus();assert.equal(await link.evaluate(n=>n===document.activeElement),true);assert.notEqual(await link.evaluate(n=>getComputedStyle(n).outlineStyle),'none')}
  assert.equal(await page.locator('script,iframe,img,form').count(),0);assert.deepEqual(external,[]);assert.deepEqual(errors,[])
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:resolve(out,`wordpress-${width}-${colorScheme}.png`),fullPage:true})
  cases.push({width,colorScheme,sections:6,exactText:true,contactLinks:6,anchor:true,focus:true,overflow:false,externalRequests:0});await page.close()
 }
 await writeFile(resolve(out,'verification.json'),JSON.stringify({status:'LOCAL_WORDPRESS_REHEARSAL_ONLY',wordpress:actor.wordpress,php:actor.php,networking:false,sourceCopyChecksum:context.content_version.content_checksum,checks,cases,syntheticIdentitiesAndStyles:true,realAuthenticatedApp:false,realStaging:false,livePublication:false,paidCalls:0},null,2))
 console.log(JSON.stringify({checks,cases,realStaging:false}))
}finally{await browser?.close();await server[Symbol.asyncDispose]()}
