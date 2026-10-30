// Owned local WordPress only. Parent enforces a clean environment, one worker and a timeout.
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {buildWebsiteBlockSource} from '../supabase/functions/_shared/websiteBlockBuild.js'
import {stagingCommand,sha} from '../supabase/functions/_shared/websiteStaging.js'
import {websiteNativeSnapshotChecksum} from '../supabase/functions/_shared/websiteNativeDesign.js'
import {createStoredZip} from '../supabase/functions/wordpress-export/theme.ts'
import {websiteNativeFixture,bindWebsiteNativeFixture} from './website-native-fixture.js'
const runtime=resolve(process.argv[2]),out=resolve(process.argv[3]),playwright=resolve(process.argv[4]),chrome=resolve(process.argv[5]);await mkdir(out,{recursive:true})
assert.equal(JSON.parse(await readFile(resolve(runtime,'node_modules/@wp-playground/cli/package.json'),'utf8')).version,'3.1.61')
const {runCLI}=await import(pathToFileURL(resolve(runtime,'node_modules/@wp-playground/cli/index.js'))),{chromium}=await import(pathToFileURL(playwright))
const wpVersion=process.argv[6]||'7.1.3',port=Number(process.argv[7]||5210);assert.ok(['7.1.3','7.1.4'].includes(wpVersion))
const id=n=>'c0000000-0000-4000-8000-'+String(n).padStart(12,'0'),site=id(1),origin='https://staging.example.test',checks=[],journeys=[]
const server=await runCLI({command:'server',php:'8.3',wp:wpVersion,port,workers:1,login:false,blueprint:{features:{networking:false},steps:[{step:'defineWpConfigConsts',consts:{WP_ENVIRONMENT_TYPE:'staging',ANKA_STAGING_SITE_ID:site,DISABLE_WP_CRON:true,WP_HTTP_BLOCK_EXTERNAL:true,AUTOMATIC_UPDATER_DISABLED:true}}]}})
await server.playground.defineConstant('WP_HOME',origin);await server.playground.defineConstant('WP_SITEURL',origin)
const env={...process.env,...JSON.parse(process.env.ANKA_QA_BROWSER_FOLDERS||'{}')},browser=await chromium.launchPersistentContext(resolve(out,'chrome-'+Date.now()),{headless:true,executablePath:chrome,env})
const run=async code=>{const r=await server.playground.run({code:'<?php require "/wordpress/wp-load.php"; '+code});assert.equal(r.exitCode,0,r.errors);return r.text}
const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64')
try{
 const plugin=await readFile(new URL('../wordpress/anka-staging/anka-staging.php',import.meta.url),'utf8');await server.playground.mkdir('/wordpress/wp-content/plugins/anka-staging');await server.playground.writeFile('/wordpress/wp-content/plugins/anka-staging/anka-staging.php',plugin)
 const actor=JSON.parse(await run('require_once ABSPATH."wp-admin/includes/plugin.php";activate_plugin("anka-staging/anka-staging.php");update_option("home",'+JSON.stringify(origin)+');update_option("siteurl",'+JSON.stringify(origin)+');$id=wp_insert_user(array("user_login"=>"anka-w4-fixture","user_pass"=>wp_generate_password(32),"role"=>"anka_staging_agent"));echo json_encode(array("id"=>$id,"wordpress"=>get_bloginfo("version"),"php"=>PHP_VERSION));'))
 assert.equal(actor.wordpress,wpVersion);assert.ok(actor.php.startsWith('8.3.'))
 const call=async(path,method='GET',body=null,user=actor.id)=>JSON.parse(await run('wp_set_current_user('+user+');$r=new WP_REST_Request('+JSON.stringify(method)+','+JSON.stringify('/anka-stage/v1'+path)+');'+(body?'$r->set_header("Content-Type","application/json");$r->set_body(base64_decode("'+encoded(body)+'"));':'')+'$v=rest_do_request($r);echo json_encode(array("status"=>$v->get_status(),"data"=>$v->get_data()));'))
 assert.equal((await call('/identity','GET',null,0)).status,403);checks.push('actual WordPress denies anonymous receiver calls')
 console.log(await run('echo json_encode(array("environment"=>wp_get_environment_type(),"home"=>home_url(),"capability"=>user_can('+actor.id+',"anka_stage_packages"),"roles"=>get_userdata('+actor.id+')->roles));'));const identity=await call('/identity');assert.equal(identity.status,200,JSON.stringify(identity));assert.equal(identity.data.environment,'staging');assert.equal(identity.data.base_url,origin);checks.push('actual staging environment/site identity/capability verified')
 const guardCases=JSON.parse(await run('wp_set_current_user('+actor.id+');global $wp_version;$original=$wp_version;$results=array();foreach(array("7.1.3","7.1.4","7.1.2","7.1.5","7.2","7.1.4-RC1") as $version){$wp_version=$version;$r=anka_stage_permission();$results[$version]=is_wp_error($r)?$r->get_error_code():true;}$wp_version=$original;echo json_encode($results);'))
 assert.deepEqual(guardCases,{'7.1.3':true,'7.1.4':true,'7.1.2':'anka_stage_runtime','7.1.5':'anka_stage_runtime','7.2':'anka_stage_runtime','7.1.4-RC1':'anka_stage_runtime'});checks.push('actual PHP permission guard accepts only both reviewed WordPress versions and denies unreviewed patches minors and prereleases')

 const navigationCases=['https://ankasphere.com/contact-anka-sphere/','https://example.com/contact?a=1&b=2#team','https://localhost/','https://127.0.0.1/','https://service.internal/','https://user:pass@example.com/','https://example.com:443/','http://example.com/','//example.com/','https://example.com/%0afoo','https://example.com/\\@evil.com/']
 const navigationResult=JSON.parse(await run('$values=json_decode(base64_decode("'+encoded(navigationCases)+'"));echo json_encode(array_map("anka_stage_https_navigation",$values));'))
 assert.deepEqual(navigationResult,navigationCases.map((_,i)=>i<2));checks.push('actual PHP HTTPS navigation validator accepts exact contact and rejects credentials ports local hosts unsafe schemes and encoded controls')
 const rejectedMarkup=JSON.parse(await run('$values=json_decode(base64_decode("'+encoded(['<!-- wp:html --><a href="https://ankasphere.com/contact-anka-sphere/">Contact</a><!-- /wp:html -->','<!-- wp:html --><div href="https://example.com/">Remote</div><!-- /wp:html -->','<!-- wp:html --><a src="https://example.com/">Remote</a><!-- /wp:html -->','<!-- wp:html --><a href="javascript:alert(1)">Unsafe</a><!-- /wp:html -->'])+'"));$result=array();foreach($values as $html){try{anka_stage_safe_markup($html);$result[]=true;}catch(Throwable $e){$result[]=false;}}echo json_encode($result);'))
 assert.deepEqual(rejectedMarkup,[true,false,false,false]);checks.push('actual PHP markup allows HTTPS anchor navigation only and denies remote resources and unsafe hrefs')
 const strict=JSON.parse(await run('get_option("anka_stage_qa_strict",false);$first=anka_stage_insert_once("anka_stage_qa_strict","original");$second=anka_stage_insert_once("anka_stage_qa_strict","replacement");echo json_encode(array("first"=>$first,"second"=>$second,"retained"=>anka_stage_read_once("anka_stage_qa_strict")));'));assert.deepEqual(strict,{first:true,second:false,retained:'original'});checks.push('actual database unique insert and fresh read preserve original despite cached absence')
 const baseline=await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_var("SELECT COUNT(*) FROM ".$wpdb->posts),"active"=>get_option("active_plugins")));')
 const commands=[],firsts=[]
 for(const [index,template]of ['home','service','location','article','about','contact'].entries()){
  const manifest=await websiteNativeFixture(template);manifest.scope.page_id=id(20+index);manifest.scope.page_key='stable-key:'+template
  if(template==='home'){manifest.content.sections.at(-1).action={label:'Connect with Anka',path:'https://ankasphere.com/contact-anka-sphere/'};}
  if(template==='home')manifest.site.navigation=[{label:'Contact page',path:'/fixture-contact'},{label:'Our approach',path:'#approach'}]
  const bound=await bindWebsiteNativeFixture(manifest),bundle=await buildWebsiteBlockSource(bound),zip=createStoredZip(Object.entries(bundle.files).sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>({name:bundle.directory+'/'+name,bytes:new TextEncoder().encode(text)}))),checksum=await sha(zip)
  const command=await stagingCommand({target:{site_id:site},job:{artifact_sha256:checksum},source:{context:{page:{path:'fixture-'+template}}}},{request_id:id(40+index),remote_head:null,created_at:new Date().toISOString()},bundle)
  const result=await call('/deploy','POST',command);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.status,'staged');assert.equal(result.data.published,false)
  console.log('Staged local template '+template);commands.push(command);firsts.push({template,bundle,command,receipt:result.data});checks.push(template+' immutable native package stages without page or theme activation')
 }
 const resign=async c=>{for(const [name,text]of Object.entries(c.files))c.file_hashes[name]=await sha(new TextEncoder().encode(text));const copy={...c};delete copy.command_sha256;c.command_sha256=await websiteNativeSnapshotChecksum(copy);return c}
 const original=commands[0],same=await call('/deploy','POST',original);assert.equal(same.data.status,'staged');checks.push('original receiver request replay is idempotent')
 const changed=structuredClone(original);changed.package_sha256='f'.repeat(64);assert.equal((await call('/deploy','POST',changed)).status,400);checks.push('changed command checksum cannot replace an original request')
 const unsafe=structuredClone(original);unsafe.files['../unsafe.php']='<?php echo 1;';assert.equal((await call('/deploy','POST',await resign(unsafe))).status,400);checks.push('unsafe additional archive paths rejected')
 const badBlock=structuredClone(original);badBlock.files['parts/header.html']='<!-- wp:shortcode -->[remote]<!-- /wp:shortcode -->';assert.equal((await call('/deploy','POST',await resign(badBlock))).status,400);checks.push('unreviewed executable blocks rejected')
 const invalidPHP=structuredClone(original);invalidPHP.files['functions.php']='<?php exit;';assert.equal((await call('/deploy','POST',await resign(invalidPHP))).status,400);checks.push('arbitrary runtime PHP rejected')
 const revisionManifest=await websiteNativeFixture('home');revisionManifest.scope.page_id=original.scope.page_id;revisionManifest.scope.page_key=original.scope.page_key;revisionManifest.content.title='A reviewed new chapter.';revisionManifest.site.navigation=[{label:'Contact page',path:'/fixture-contact'},{label:'Our approach',path:'#approach'}]
 const revision=await buildWebsiteBlockSource(await bindWebsiteNativeFixture(revisionManifest)),zip=createStoredZip(Object.entries(revision.files).sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>({name:revision.directory+'/'+name,bytes:new TextEncoder().encode(text)}))),newChecksum=await sha(zip)
 const revised=await stagingCommand({target:{site_id:site},job:{artifact_sha256:newChecksum},source:{context:{page:{path:'fixture-home'}}}},{request_id:id(70),remote_head:original.request_id,created_at:new Date().toISOString()},revision)
 assert.equal((await call('/deploy','POST',revised)).data.status,'staged');checks.push('exact remote head revision appends a new retained version');assert.deepEqual((await call('/requests/'+revised.request_id)).data.unresolved_paths,[]);checks.push('approved path index resolves another staged canonical page without rewriting its key')
 const stale=await stagingCommand({target:{site_id:site},job:{artifact_sha256:newChecksum},source:{context:{page:{path:'fixture-home'}}}},{request_id:id(71),remote_head:original.request_id,created_at:new Date().toISOString()},revision)
 assert.equal((await call('/deploy','POST',stale)).data.status,'conflict');checks.push('stale remote-head compare-and-swap cannot replace a newer staging version')
 assert.equal((await call('/requests/'+original.request_id)).data.status,'staged');assert.equal((await call('/requests/'+revised.request_id)).data.status,'staged');checks.push('read-only recovery retains both original and revised source identities')
 assert.equal(await run('global $wpdb;echo json_encode(array("theme"=>get_stylesheet(),"posts"=>$wpdb->get_var("SELECT COUNT(*) FROM ".$wpdb->posts),"active"=>get_option("active_plugins")));'),baseline);checks.push('actual WordPress active theme pages and plugins remain unchanged after staging/revisions')
 await run('wp_set_current_user('+actor.id+');$u=new WP_User('+actor.id+');$u->set_role("subscriber");');assert.equal((await call('/identity')).status,403);checks.push('actual capability revocation blocks receiver access');await run('$u=new WP_User('+actor.id+');$u->set_role("anka_staging_agent");')
 const noCookie=await fetch(server.serverUrl+'/?anka_staging_preview='+original.request_id);assert.equal(noCookie.status,403);checks.push('actual preview denies unauthenticated visitors')
 const cookie=JSON.parse(await run('echo json_encode(array("name"=>LOGGED_IN_COOKIE,"value"=>wp_generate_auth_cookie('+actor.id+',time()+3600,"logged_in")));'))
 await browser.addCookies([{...cookie,url:server.serverUrl,httpOnly:true,sameSite:'Lax'}])
 for(const {template,bundle,command}of [...firsts,{template:'home-revision',bundle:revision,command:revised}]){
  for(const width of [1440,390]){
   const page=await browser.newPage(),external=[];await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'})
   await page.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(server.serverUrl).origin)route.continue();else{external.push(route.request().url());route.abort()}})
   const response=await page.goto(server.serverUrl+'/?anka_staging_preview='+command.request_id,{waitUntil:'networkidle'});assert.equal(response.status(),200)
   assert.ok(response.headers()['cache-control'].includes('no-store'));assert.ok(response.headers()['content-security-policy'].includes("script-src 'none'"));assert.ok(response.headers()['x-robots-tag'].includes('noindex'))
   if(template==='home'){assert.equal(await page.getByRole('link',{name:'Connect with Anka',exact:true}).getAttribute('href'),'https://ankasphere.com/contact-anka-sphere/');}
   if(template==='home-revision'){const link=page.getByRole('link',{name:'Contact page',exact:true});assert.equal(await link.getAttribute('href'),origin+'/?anka_staging_preview='+commands[5].request_id);const linked=await fetch(server.serverUrl+'/?anka_staging_preview='+commands[5].request_id,{headers:{Cookie:cookie.name+'='+cookie.value}});assert.equal(linked.status,200);assert.ok((await linked.text()).includes('name="anka-staging-request" content="'+commands[5].request_id+'"'));}
   assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('h1').textContent(),bundle.page.title);assert.equal(await page.locator('meta[name="anka-package-sha256"]').getAttribute('content'),command.package_sha256)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'A')
   for(const href of await page.locator('a[href^="#"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))){if(href.length>1)assert.equal(await page.locator('[id="'+href.slice(1)+'"]').count(),1)}
   assert.equal(await page.locator('.anka-reveal').first().evaluate(el=>getComputedStyle(el).animationName),'none');assert.deepEqual(external,[])
   await page.screenshot({path:resolve(out,'stage-'+template+'-'+width+'.png')});journeys.push({template,width,wordpressRendered:true,private:true,noindex:true,csp:true,keyboard:true,reducedMotion:true,overflow:false,externalRequests:0});await page.close();console.log('Verified local preview '+template+' '+width)
  }
 }
 await writeFile(resolve(out,'runtime-receipt.json'),JSON.stringify({wordpress:actor.wordpress,php:actor.php,protocol:'anka-stage-v1',checks,journeys,networking:false,syntheticLocalAccount:true,realClientConnection:false,clientPublication:false},null,2))
 console.log(JSON.stringify({checks:checks.length,journeys:journeys.length,wordpress:actor.wordpress,php:actor.php,networking:false}))
}finally{await browser.close();await server[Symbol.asyncDispose]()}
