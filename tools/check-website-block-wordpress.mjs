// Local QA only. Arguments: pinned runtime root, output directory, Playwright ESM entrypoint, Chrome executable.
// Launch with an allowlisted environment, --max-old-space-size=512 and --experimental-wasm-jspi; enforce a parent timeout.
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {pathToFileURL,fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
const repo=fileURLToPath(new URL('../',import.meta.url)),runtimeRoot=resolve(process.argv[2]),out=pathToFileURL(resolve(process.argv[3])+'/')
const packageMeta=JSON.parse(await readFile(resolve(runtimeRoot,'node_modules/@wp-playground/cli/package.json'),'utf8'));assert.equal(packageMeta.version,'3.1.61')
const {runCLI}=await import(pathToFileURL(resolve(runtimeRoot,'node_modules/@wp-playground/cli/index.js')))
const {buildWebsiteBlockSource}=await import(pathToFileURL(repo+'/supabase/functions/_shared/websiteBlockBuild.js'))
const {websiteNativeFixture}=await import(pathToFileURL(repo+'/tools/website-native-fixture.js'))
const {createStoredZip}=await import(pathToFileURL(repo+'/supabase/functions/wordpress-export/theme.ts'))
const {chromium}=await import(pathToFileURL(resolve(process.argv[4])))
const themes=[],themeRoot=new URL('themes/',out)
for(const template of ['home','service','location','article','about','contact']){
 const built=await buildWebsiteBlockSource(await websiteNativeFixture(template)),root=new URL(built.directory+'/',themeRoot)
 for(const[name,text]of Object.entries(built.files)){const path=new URL(name,root);await mkdir(new URL('./',path),{recursive:true});await writeFile(path,text)}
 const bytes=createStoredZip(Object.entries(built.files).map(([name,text])=>({name:built.directory+'/'+name,bytes:new TextEncoder().encode(text)})))
 await writeFile(new URL(built.directory+'.zip',themeRoot),bytes)
 themes.push({template,built,bytes})
}
console.log('Pinned Playground3.1.61 WordPress7.1.3 PHP8.3 bootstrap; PHP networking disabled')
const server=await runCLI({command:'server',php:'8.3',wp:'7.1.3',port:5206,workers:1,login:false,'define-bool':{DISABLE_WP_CRON:true,WP_HTTP_BLOCK_EXTERNAL:true,AUTOMATIC_UPDATER_DISABLED:true},blueprint:{features:{networking:false},steps:[]}})
const browserEnv={...process.env,...JSON.parse(process.env.ANKA_QA_BROWSER_FOLDERS||'{}')}
const browser=await chromium.launchPersistentContext(fileURLToPath(new URL('chrome-qa-'+Date.now(),out)),{headless:true,executablePath:resolve(process.argv[5]),env:browserEnv}),journeys=[]
try{
 const run=async code=>{const response=await server.playground.run({code:'<?php require "/wordpress/wp-load.php"; '+code});assert.equal(response.exitCode,0,response.errors);return response.text}
 const versions=JSON.parse(await run('echo json_encode(array("wordpress"=>get_bloginfo("version"),"php"=>PHP_VERSION));'))
 assert.equal(versions.wordpress,'7.1.3');assert.ok(versions.php.startsWith('8.3.'));console.log(JSON.stringify(versions))
 for(const {template,built,bytes}of themes){
  await server.playground.writeFile('/tmp/anka-w3-theme.zip',bytes)
  const installed=await run('require_once ABSPATH . "wp-admin/includes/file.php";WP_Filesystem();$r=unzip_file("/tmp/anka-w3-theme.zip",WP_CONTENT_DIR . "/themes");echo is_wp_error($r)?$r->get_error_message():"installed";')
  assert.equal(installed,'installed')
  const name=built.directory,data=Buffer.from(JSON.stringify(built.page)).toString('base64')
  const php='switch_theme('+JSON.stringify(name)+');$p=json_decode(base64_decode("'+data+'"),true);$id=wp_insert_post(array("post_type"=>"page","post_status"=>"publish","post_title"=>$p["title"],"post_name"=>'+JSON.stringify(template)+',"post_content"=>$p["post_content"]));update_post_meta($id,"_wp_page_template",$p["template"]);update_post_meta($id,"_anka_meta_description",$p["meta_description"]);echo json_encode(array("id"=>$id,"block"=>wp_is_block_theme(),"theme"=>get_stylesheet(),"template"=>get_page_template_slug($id)));'
  const info=JSON.parse(await run(php))
  assert.equal(info.block,true);assert.equal(info.theme,name);assert.equal(info.template,'anka-'+template)
  const response=await fetch(server.serverUrl+'/?page_id='+info.id),html=await response.text()
  assert.equal(response.status,200);assert.ok(html.includes(built.page.meta_description));assert.ok(html.includes('anka-section'));assert.ok(html.includes('wp-block-column'));assert.ok(html.includes('anka-native-block-css'))
  await writeFile(new URL(template+'.html',out),html)
  console.log(JSON.stringify({template,info,status:response.status,bytes:html.length}))
  for(const width of [1440,390]){
   const page=await browser.newPage(),external=[]
   await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'})
   await page.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(server.serverUrl).origin)route.continue();else{external.push(route.request().url());route.abort()}})
   await page.goto(server.serverUrl+'/?page_id='+info.id,{waitUntil:'networkidle'})
   assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('meta[name="description"]').getAttribute('content'),built.page.meta_description)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   for(const link of await page.locator('a[href^="#"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))){if(link.length>1)assert.equal(await page.locator('[id="'+link.slice(1)+'"]').count(),1)}
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.tagName==='A'),true)
   assert.equal(await page.locator('.anka-reveal').first().evaluate(el=>getComputedStyle(el).animationName),'none')
   assert.deepEqual(external,[]);await page.screenshot({path:new URL('wp-'+template+'-'+width+'.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1')});journeys.push({template,width,zipInstalled:true,keyboard:true,reducedMotion:true,overflow:false,externalRequests:0});await page.close()
  }
 }
 await writeFile(new URL('runtime-receipt.json',out),JSON.stringify({versions,compiler:'anka-native-block-v1',templates:themes.map(t=>t.template),journeys,networking:false,client_site:false},null,2))
}finally{await browser.close();await server[Symbol.asyncDispose]()}
