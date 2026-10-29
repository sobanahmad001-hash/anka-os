// Actual isolated WordPress replacement-row fixture only; no client target.
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
const server=await runCLI({command:'server',php:'8.3',wp:'7.1.3',port:5238,workers:1,login:false,blueprint:{features:{networking:false},steps:[{step:'defineWpConfigConsts',consts:{WP_ENVIRONMENT_TYPE:'production',ANKA_PUBLICATION_SITE_ID:site,ANKA_PUBLICATION_ENABLED:true,DISABLE_WP_CRON:true,WP_HTTP_BLOCK_EXTERNAL:true,AUTOMATIC_UPDATER_DISABLED:true}}]}})
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
 const original=await command(x=>{x.pages[0].title='Exact “reviewed” عنوان';x.pages[0].post_content='<!-- wp:paragraph --><p>Exact Unicode عنوان, apostrophe \' and newline\nretained.</p><!-- /wp:paragraph -->'}),call=async(fn,c=original,user=actor.id)=>{const encoded=Buffer.from(JSON.stringify(c)).toString('base64'),text=await run('wp_set_current_user('+user+');$command=json_decode(base64_decode('+JSON.stringify(encoded)+'),true);try{$r='+fn+'($command);echo json_encode(array("ok"=>true,"result"=>$r));}catch(Throwable $error){echo json_encode(array("ok"=>false,"reason"=>$error->getMessage()));}');try{return JSON.parse(text)}catch(error){console.log('Synthetic PHP result:',text.slice(0,4096));throw error}}

 const rowCall=async(c=original,user=actor.id)=>{const encoded=Buffer.from(JSON.stringify(c)).toString('base64');return JSON.parse(await run('wp_set_current_user('+user+');$command=json_decode(base64_decode('+JSON.stringify(encoded)+'),true);try{echo json_encode(array("ok"=>true,"result"=>anka_publication_replace_row($command,'+JSON.stringify(selected.page_id)+')));}catch(Throwable $e){echo json_encode(array("ok"=>false,"reason"=>$e->getMessage()));}'))}
 assert.equal((await rowCall()).ok,false);checks.push('replacement row cannot write before original admission')
 assert.equal((await call('anka_publication_journal_claim')).result,true)
 assert.equal((await rowCall()).ok,false);checks.push('admitted command cannot write without retained backup and execution CAS')
 await call('anka_publication_backup_prepare')
 assert.equal((await rowCall()).ok,false);checks.push('prepared backup does not authorize row mutation')
 assert.equal((await call('anka_publication_journal_begin_execute')).result,true)
 assert.equal((await rowCall(original,0)).ok,false);checks.push('anonymous callers cannot cross row-write boundary')
 const backupBefore=await run('wp_set_current_user('+actor.id+');echo json_encode(anka_publication_option_read("anka_publication_backup_'+original.request_id+'"));')
 const result=await rowCall();assert.equal(result.ok,true,JSON.stringify(result));checks.push('actual WordPress page title and exact block body replaced through original-row byte CAS')
 const state=JSON.parse(await run('clean_post_cache('+post.post_id+');$p=get_post('+post.post_id+');echo json_encode(array("title"=>$p->post_title,"body"=>$p->post_content,"revisions"=>count(wp_get_post_revisions($p->ID)),"parent"=>$p->post_parent,"meta"=>get_post_meta($p->ID,"_anka_publication_page_id",false)));'))
 assert.equal(state.title,original.bundle.pages[0].title);assert.equal(state.body,original.bundle.pages[0].post_content);assert.ok(state.revisions>=1);assert.deepEqual(state.meta,[]);checks.push('normal core save lifecycle creates revision history while metadata remains unchanged')
 assert.equal((await rowCall()).ok,false);checks.push('same original command cannot repeat a page row write')
 assert.equal((await call('anka_publication_journal_fail_unchanged')).ok,false);assert.equal((await call('anka_publication_journal_read')).result.status,'pending');checks.push('row-written is incomplete pending work and cannot be falsely settled failed')
 assert.equal(await run('wp_set_current_user('+actor.id+');echo json_encode(anka_publication_option_read("anka_publication_backup_'+original.request_id+'"));'),backupBefore);checks.push('immutable original private backup retained byte exactly')
 // Fresh original request exercises the stale-source denial, not the earlier lock.
 await run('delete_option("anka_publication_active_command");')
 const inventory2=JSON.parse(await run('wp_set_current_user('+actor.id+');echo json_encode(anka_publication_inventory());')),p2=inventory2.posts.find(p=>p.post_id===post.post_id)
 const stale=structuredClone(original);stale.request_id=id(970);stale.command_id=id(971);stale.review_snapshot.inspection=inventory2;stale.review_snapshot.pages[0].expected_post_revision=p2.revision;stale.review_snapshot.pages[0].expected_post_sha256=p2.sha256;stale.review_snapshot.theme_change.affected_posts=inventory2.posts.map(p=>({post_id:p.post_id,revision:p.revision,sha256:p.sha256}));stale.review_sha256=await digest(stale.review_snapshot);const {command_sha256:_sha,...unsigned}=stale;stale.command_sha256=await digest(unsigned)
 assert.equal((await call('anka_publication_journal_claim',stale)).result,true);assert.equal((await call('anka_publication_backup_prepare',stale)).ok,true);assert.equal((await call('anka_publication_journal_begin_execute',stale)).result,true)
 await run('wp_update_post(array("ID"=>'+post.post_id+',"post_content"=>"Later human fixture edit"));')
 assert.equal((await rowCall(stale)).ok,false);assert.equal(await run('echo get_post('+post.post_id+')->post_content;'),'Later human fixture edit');checks.push('later human edit is preserved and stale original source denied')

 await run('delete_option("anka_publication_active_command");')
 const inventory3=JSON.parse(await run('wp_set_current_user('+actor.id+');echo json_encode(anka_publication_inventory());')),p3=inventory3.posts.find(p=>p.post_id===post.post_id)
 const race=structuredClone(stale);race.request_id=id(972);race.command_id=id(973);race.review_snapshot.inspection=inventory3;race.review_snapshot.pages[0].expected_post_revision=p3.revision;race.review_snapshot.pages[0].expected_post_sha256=p3.sha256;race.review_snapshot.theme_change.affected_posts=inventory3.posts.map(p=>({post_id:p.post_id,revision:p.revision,sha256:p.sha256}));race.review_sha256=await digest(race.review_snapshot);const {command_sha256:_race,...raceUnsigned}=race;race.command_sha256=await digest(raceUnsigned)
 assert.equal((await call('anka_publication_journal_claim',race)).result,true);assert.equal((await call('anka_publication_backup_prepare',race)).ok,true);assert.equal((await call('anka_publication_journal_begin_execute',race)).result,true)
 const encodedRace=Buffer.from(JSON.stringify(race)).toString('base64')
 const racing=JSON.parse(await run('wp_set_current_user('+actor.id+');$command=json_decode(base64_decode('+JSON.stringify(encodedRace)+'),true);$intercept=function($sql)use(&$intercept){global $wpdb;if(str_starts_with($sql,"UPDATE {$wpdb->posts} SET post_title=")){remove_filter("query",$intercept);$wpdb->update($wpdb->posts,array("post_content"=>"Human edit at SQL boundary"),array("ID"=>'+post.post_id+'));}return $sql;};add_filter("query",$intercept);try{anka_publication_replace_row($command,'+JSON.stringify(selected.page_id)+');echo json_encode(array("ok"=>true));}catch(Throwable $e){echo json_encode(array("ok"=>false,"reason"=>$e->getMessage()));}'))
 assert.equal(racing.ok,false,JSON.stringify(racing));assert.match(racing.reason,/compare-and-swap/);assert.equal(await run('clean_post_cache('+post.post_id+');echo get_post('+post.post_id+')->post_content;'),'Human edit at SQL boundary');checks.push('edit injected after source read at actual SQL boundary wins; original byte CAS never overwrites it')
 assert.equal((await rowCall(race)).ok,false);assert.equal((await call('anka_publication_journal_fail_unchanged',race)).ok,false);checks.push('CAS failure retains durable page-writing uncertainty and denies redispatch or false failure settlement')
 const routes=JSON.parse(await run('wp_set_current_user('+actor.id+');$out=array();foreach(array("publish","rollback") as $path){$r=rest_do_request(new WP_REST_Request("POST","/anka-publish/v1/".$path));$out[$path]=$r->get_status();}echo json_encode($out);'));assert.deepEqual(routes,{publish:409,rollback:409});checks.push('malformed publication and rollback are denied before journal admission')
 await writeFile(resolve(out,'verification.json'),JSON.stringify({wordpress:actor.wordpress,php:actor.php,checks,networking:false,fixtureWritesOnly:true,clientPublication:false,completePublisher:false},null,2));console.log(JSON.stringify({passed:checks.length,wordpress:actor.wordpress,php:actor.php,networking:false}))
}finally{await server[Symbol.asyncDispose]()}
