// Actual isolated WordPress only. Writes a NEW INACTIVE synthetic theme; never a client target.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {WEBSITE_BLOCK_FUNCTIONS} from '../supabase/functions/_shared/websiteBlockBuild.js'
import {PUBLICATION_TEMPLATE} from '../supabase/functions/_shared/websitePublicationBundle.js'
import {websiteNativeSnapshotChecksum as digest} from '../supabase/functions/_shared/websiteNativeDesign.js'
const runtime=resolve(process.argv[2]),out=resolve(process.argv[3]);await mkdir(out,{recursive:true})
assert.equal(JSON.parse(await readFile(resolve(runtime,'node_modules/@wp-playground/cli/package.json'),'utf8')).version,'3.1.61')
const {runCLI}=await import(pathToFileURL(resolve(runtime,'node_modules/@wp-playground/cli/index.js')))
const id=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0'),site=id(950),origin='https://publication.example.test',checks=[]
const server=await runCLI({command:'server',php:'8.3',wp:'7.1.3',port:5236,workers:1,login:false,blueprint:{features:{networking:false},steps:[{step:'defineWpConfigConsts',consts:{WP_ENVIRONMENT_TYPE:'production',ANKA_PUBLICATION_SITE_ID:site,ANKA_PUBLICATION_ENABLED:true,DISABLE_WP_CRON:true,WP_HTTP_BLOCK_EXTERNAL:true,AUTOMATIC_UPDATER_DISABLED:true}}]}})
await server.playground.defineConstant('WP_HOME',origin);await server.playground.defineConstant('WP_SITEURL',origin)
const run=async code=>{const r=await server.playground.run({code:'<?php require "/wordpress/wp-load.php";'+code});assert.equal(r.exitCode,0,r.errors);return r.text}
try{
 await server.playground.mkdir('/wordpress/wp-content/plugins/anka-publication');await server.playground.writeFile('/wordpress/wp-content/plugins/anka-publication/anka-publication.php',await readFile(new URL('../wordpress/anka-publication/anka-publication.php',import.meta.url),'utf8'))
 const actor=JSON.parse(await run('require_once ABSPATH."wp-admin/includes/plugin.php";activate_plugin("anka-publication/anka-publication.php");$id=wp_insert_user(array("user_login"=>"synthetic-theme-agent","user_pass"=>wp_generate_password(32),"role"=>"anka_publication_agent"));update_option("permalink_structure","/%postname%/");foreach(get_posts(array("post_type"=>"page","post_status"=>"draft","numberposts"=>100)) as $post){wp_update_post(array("ID"=>$post->ID,"post_status"=>"publish"));}echo json_encode(array("id"=>$id,"wordpress"=>get_bloginfo("version"),"php"=>PHP_VERSION));'))
 assert.equal(actor.wordpress,'7.1.3');assert.ok(actor.php.startsWith('8.3.'))
 const inventory=JSON.parse(await run('wp_set_current_user('+actor.id+');echo json_encode(anka_publication_inventory());')),post=inventory.posts.find(p=>p.post_type==='page')
 assert.ok(post)
 const files={'functions.php':WEBSITE_BLOCK_FUNCTIONS,'parts/footer.html':'<!-- wp:paragraph --><p>Offline footer</p><!-- /wp:paragraph -->','parts/header.html':'<!-- wp:paragraph --><p>Offline header</p><!-- /wp:paragraph -->','style.css':'/*\nTheme Name: Synthetic publication fixture\nVersion: 1.0.0\n*/\nbody { color: #222; }','templates/index.html':PUBLICATION_TEMPLATE,'theme.json':JSON.stringify({version:3,settings:{layout:{contentSize:'1000px'}}})}
 const selected={page_id:id(951),page_key:'home-review',job_id:id(952),package_sha256:'a'.repeat(64),operation:'replace',post_id:post.post_id,path:post.path,expected_post_revision:post.revision,expected_post_sha256:post.sha256}
 const review={target:{site_id:site,origin},inspection:inventory,site_version_id:id(953),pages:[selected],theme_change:{mode:'replace',expected_sha256:inventory.theme_sha256,sitewide_impact_acknowledged:true,affected_posts:inventory.posts.map(p=>({post_id:p.post_id,revision:p.revision,sha256:p.sha256}))}}
 const sha=value=>createHash('sha256').update(value).digest('hex')
 async function command(change=()=>{}){
  const r=structuredClone(review),f=structuredClone(files),pages=[{page_id:selected.page_id,page_key:selected.page_key,job_id:selected.job_id,package_sha256:selected.package_sha256,title:'Offline title',meta_description:'Offline description',post_content:'<!-- wp:paragraph --><p>Offline replacement</p><!-- /wp:paragraph -->'}]
  change({review:r,files:f,pages});const theme={files:f,file_hashes:Object.fromEntries(Object.entries(f).map(([p,b])=>[p,sha(b)])),theme_sha256:await digest(f)};r.theme_change.reviewed_sha256=theme.theme_sha256
  const payload={compiler:'anka-publication-v1',site_version_id:r.site_version_id,theme,pages},bundle={...payload,payload_sha256:await digest(payload)},unsigned={protocol:'anka-publication-v1',kind:'publication',site_id:site,request_id:id(954),command_id:id(955),review_sha256:await digest(r),review_snapshot:r,bundle}
  return {...unsigned,command_sha256:await digest(unsigned)}
 }
 const original=await command(),call=async(fn,c=original,user=actor.id)=>{const encoded=Buffer.from(JSON.stringify(c)).toString('base64'),text=await run('wp_set_current_user('+user+');$command=json_decode(base64_decode('+JSON.stringify(encoded)+'),true);try{$r='+fn+'($command);echo json_encode(array("ok"=>true,"result"=>$r));}catch(Throwable $error){echo json_encode(array("ok"=>false,"reason"=>$error->getMessage()));}');try{return JSON.parse(text)}catch(error){console.log('Synthetic PHP result:',text.slice(0,4096));throw error}}
 const baseline=await run('global $wpdb;echo json_encode(array("stylesheet"=>get_stylesheet(),"template"=>get_template(),"posts"=>$wpdb->get_results("SELECT * FROM ".$wpdb->posts." ORDER BY ID",ARRAY_A)));')
 assert.equal((await call('anka_publication_theme_payload')).ok,true);checks.push('actual PHP accepts only the exact JavaScript fixed runtime/template and canonical compiled checksums')
 for(const [name,change] of [['PHP replacement',x=>{x.files['functions.php']='<?php echo "untrusted";';}],['template replacement',x=>{x.files['templates/index.html']='<!-- wp:shortcode -->[unreviewed]<!-- /wp:shortcode -->';}],['extra executable path',x=>{x.files['extra.php']='<?php echo 1;';}],['PHP in a non-PHP file',x=>{x.files['parts/header.html']='<?php echo 1;';}],['different exact page',x=>{x.pages[0].job_id=id(960);}]] ){
  assert.equal((await call('anka_publication_theme_payload',await command(change))).ok,false,name);checks.push('actual PHP denies '+name+' even when attacker recomputes all outer digests')
 }
 const corrupt=structuredClone(original);corrupt.bundle.theme.file_hashes['style.css']='b'.repeat(64);const {payload_sha256:_payload,...payload}=corrupt.bundle;corrupt.bundle.payload_sha256=await digest(payload);const {command_sha256:_command,...unsigned}=corrupt;corrupt.command_sha256=await digest(unsigned)
 assert.equal((await call('anka_publication_theme_payload',corrupt)).ok,false);checks.push('per-file hash validation rejects changed hash even with a valid outer command digest')
 assert.equal((await call('anka_publication_theme_materialize',original,0)).ok,false);checks.push('anonymous callers cannot create an inactive theme')
 assert.equal((await call('anka_publication_journal_claim')).result,true)
 assert.equal((await call('anka_publication_theme_materialize')).ok,false);checks.push('admission alone cannot cross the theme file-writing boundary')
 assert.match((await call('anka_publication_backup_prepare')).result,/^[a-f0-9]{64}$/)
 assert.equal((await call('anka_publication_theme_materialize')).ok,false);checks.push('prepared original backup still cannot write files without the one-time execution CAS')
 assert.equal((await call('anka_publication_journal_begin_execute')).result,true)
 const created=await call('anka_publication_theme_materialize');assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.result.theme_sha256,original.bundle.theme.theme_sha256)
 const exists=JSON.parse(await run('$theme=wp_get_theme('+JSON.stringify(created.result.stylesheet)+');echo json_encode(array("exists"=>$theme->exists(),"stylesheet"=>get_stylesheet()));'));assert.equal(exists.exists,true);assert.equal(exists.stylesheet,JSON.parse(baseline).stylesheet);checks.push('actual WordPress recognizes the new six-file block theme while the original active theme remains selected')
 assert.deepEqual((await call('anka_publication_theme_materialize')).result,created.result);checks.push('same original theme replay reads the retained files without overwriting or creating another directory')
 assert.equal(await run('global $wpdb;echo json_encode(array("stylesheet"=>get_stylesheet(),"template"=>get_template(),"posts"=>$wpdb->get_results("SELECT * FROM ".$wpdb->posts." ORDER BY ID",ARRAY_A)));'),baseline);checks.push('inactive theme construction changes no page row active theme or template selector')
 const directory='/wordpress/wp-content/themes/'+created.result.stylesheet
 await server.playground.writeFile(directory+'/parts/footer.html','A later local fixture edit')
 assert.equal((await call('anka_publication_theme_read')).ok,false);assert.equal((await call('anka_publication_theme_materialize')).ok,false);assert.equal(await server.playground.readFileAsText(directory+'/parts/footer.html'),'A later local fixture edit');assert.equal((await call('anka_publication_journal_fail_unchanged')).ok,false);assert.equal((await call('anka_publication_journal_read')).result.status,'pending');checks.push('later inactive file mutation is not repaired or falsely settled; original executing request stays unresolved')
 const routes=JSON.parse(await run('wp_set_current_user('+actor.id+');$out=array();foreach(array("publish","rollback") as $path){$r=rest_do_request(new WP_REST_Request("POST","/anka-publish/v1/".$path));$out[$path]=$r->get_status();}echo json_encode($out);'));assert.deepEqual(routes,{publish:409,rollback:409});checks.push('fixed execution routes reject malformed commands before admission')
 await writeFile(resolve(out,'verification.json'),JSON.stringify({wordpress:actor.wordpress,php:actor.php,checks,networking:false,theme:'new inactive fixture only',realClientConnection:false,clientPublication:false,fixtureWritesOnly:true},null,2));console.log(JSON.stringify({passed:checks.length,wordpress:actor.wordpress,php:actor.php,networking:false}))
}finally{await server[Symbol.asyncDispose]()}
