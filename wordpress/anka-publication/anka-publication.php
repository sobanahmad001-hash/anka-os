<?php
/**
 * Plugin Name: Anka Publication Receiver
 * Description: Independently enabled production identity and bounded exact inventory. Explicit original-command publication and rollback with immutable recovery.
 * Version: 1.0.0
 */
if (!defined('ABSPATH')) { exit; }

function anka_publication_uuid($value) { return is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value); }
function anka_publication_canonical($value) {
 if (is_array($value)&&!array_is_list($value)) { return anka_publication_canonical((object)$value); }
 if (is_object($value)) { $value=get_object_vars($value);ksort($value,SORT_STRING);foreach($value as $key=>$item){$value[$key]=anka_publication_canonical($item);}return (object)$value; }
 if (is_array($value)) { return array_map('anka_publication_canonical',$value); }
 return $value;
}
function anka_publication_digest($value) { return hash('sha256',json_encode(anka_publication_canonical($value),JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_LINE_TERMINATORS|JSON_THROW_ON_ERROR)); }
function anka_publication_permission() {
 if (wp_get_environment_type()!=='production'||!defined('ANKA_PUBLICATION_ENABLED')||ANKA_PUBLICATION_ENABLED!==true||!defined('ANKA_PUBLICATION_SITE_ID')||!anka_publication_uuid(ANKA_PUBLICATION_SITE_ID)) { return new WP_Error('anka_publication_environment','Separate enabled production publication identity required.',array('status'=>403)); }
 if (get_bloginfo('version')!=='7.1.3'||PHP_MAJOR_VERSION!==8||PHP_MINOR_VERSION!==3) { return new WP_Error('anka_publication_runtime','Reviewed WordPress and PHP runtime required.',array('status'=>403)); }
 if (!current_user_can('anka_publish_packages')) { return new WP_Error('anka_publication_capability','Dedicated publication capability required.',array('status'=>403)); }
 if (!preg_match('~^https://[a-z0-9.-]+$~i',untrailingslashit(home_url()))) { return new WP_Error('anka_publication_origin','Exact canonical HTTPS production origin required.',array('status'=>403)); }
 return true;
}
register_activation_hook(__FILE__,static function(){add_role('anka_publication_agent','Anka Publication Agent',array('read'=>true,'anka_publish_packages'=>true));});
function anka_publication_identity() { return array('protocol'=>'anka-publication-v1','receiver_version'=>'1.0.0','environment'=>'production','wordpress_version'=>get_bloginfo('version'),'php_version'=>PHP_VERSION,'compiler'=>'anka-native-block-v1','base_url'=>untrailingslashit(home_url()),'site_id'=>ANKA_PUBLICATION_SITE_ID,'publication_enabled'=>true); }

function anka_publication_post($id) {
 clean_post_cache($id);$post=get_post($id);if(!$post){throw new Exception('Exact inspected post unavailable.');}
 $link_post=clone $post;
 // Inspect the intended canonical destination of an unpublished page without publishing it.
 if(in_array($post->post_status,array('draft','pending','future'),true)){if($post->post_name===''){throw new Exception('Unpublished posts need an explicit reviewed slug.');}$link_post->post_status='publish';}
 $url=get_permalink($link_post);$origin=untrailingslashit(home_url());$parts=wp_parse_url($url);
 if(!$url||strpos($url,$origin.'/')!==0||!empty($parts['query'])||!empty($parts['fragment'])){throw new Exception('Inventory requires supported canonical local permalinks.');}
 $path=isset($parts['path'])?rtrim($parts['path'],'/'):'/';if($path===''){$path='/';}
 if(strlen($path)>240||!preg_match('~^/(?:[a-z0-9_-]+/)*[a-z0-9_-]*$~',$path)){throw new Exception('Inventory contains an unsupported canonical page path.');}
 $managed=get_post_meta($id,'_anka_publication_page_id',true);if($managed!==''&&!anka_publication_uuid($managed)){throw new Exception('Registered page identity is invalid.');}
 $revisions=wp_get_post_revisions($id,array('posts_per_page'=>1,'orderby'=>'ID','order'=>'DESC'));$latest=reset($revisions);$revision=$latest?(int)$latest->ID:(int)$id;
 $state=(object)array('post_id'=>(int)$id,'post_type'=>$post->post_type,'post_status'=>$post->post_status,'post_title'=>$post->post_title,'post_content'=>$post->post_content,'post_excerpt'=>$post->post_excerpt,'post_name'=>$post->post_name,'post_parent'=>(int)$post->post_parent,'post_modified_gmt'=>$post->post_modified_gmt,'template'=>get_post_meta($id,'_wp_page_template',true),'meta_description'=>get_post_meta($id,'_anka_meta_description',true),'managed_page_id'=>$managed===''?null:$managed,'path'=>$path);
 return array('post_id'=>(int)$id,'revision'=>$revision,'path'=>$path,'sha256'=>anka_publication_digest($state),'managed_page_id'=>$managed===''?null:$managed,'post_type'=>$post->post_type,'post_status'=>$post->post_status);
}

function anka_publication_theme($stylesheet=null) {
 $stylesheet=$stylesheet===null?get_stylesheet():$stylesheet;$theme=wp_get_theme($stylesheet);if(!$theme->exists()){throw new Exception('Active theme is unavailable.');}
 // WP_Theme::get_files returns relative keys and absolute values; parent files are inspected separately.
 // https://developer.wordpress.org/reference/classes/wp_theme/get_files/
 $themes=array($theme);if($theme->parent()){$themes[]=$theme->parent();}
 $inventory=array();$active=array();$bytes=0;$count=0;
 foreach($themes as $index=>$item){
  $root=realpath($item->get_stylesheet_directory());$files=$item->get_files(null,-1,false);
  foreach($files as $path=>$file){
   $resolved=realpath($file);$count++;
   if(!$resolved||!$root||strpos($resolved,$root.DIRECTORY_SEPARATOR)!==0||is_link($file)||$count>1000){throw new Exception('Theme inventory exceeds its safe local file scope.');}
   $size=filesize($resolved);if($size===false){throw new Exception('Theme file size unavailable.');}$bytes+=$size;if($bytes>33554432){throw new Exception('Theme inventory exceeds thirty-two MiB.');}
   $hash=hash_file('sha256',$resolved);if(!$hash){throw new Exception('Theme file checksum unavailable.');}
   $inventory[$index.':'.$path]=$hash;
   if($index===0){$active[$path]=$resolved;}
  }
 }
 $custom=get_posts(array('post_type'=>array('wp_template','wp_template_part','wp_global_styles','wp_navigation','custom_css'),'post_status'=>'any','cache_results'=>false,'posts_per_page'=>501,'orderby'=>'ID','order'=>'ASC','suppress_filters'=>true));
 if(count($custom)>500){throw new Exception('Theme customizations exceed their bound.');}
 $custom_hashes=array();foreach($custom as $post){$custom_hashes[(string)$post->ID]=anka_publication_digest((object)array('type'=>$post->post_type,'status'=>$post->post_status,'content'=>$post->post_content,'modified'=>$post->post_modified_gmt));}
 $mods=anka_publication_option_read('theme_mods_'.$stylesheet);if($mods===null){$mods=array();}
 // Core caches the absence of custom CSS as -1 on the first frontend read. It
 // is not a style override. Real custom_css posts remain in the fingerprint.
 $has_css=false;foreach($custom as $post){if($post->post_type==='custom_css'&&$post->post_name===sanitize_title($stylesheet)){$has_css=true;}}
 if(is_array($mods)&&!$has_css&&($mods['custom_css_post_id']??null)===-1){unset($mods['custom_css_post_id']);}
 // Only a clean six-file Anka publication theme can be retained as the compiler's exact theme.
 $expected=array('functions.php','parts/footer.html','parts/header.html','style.css','templates/index.html','theme.json');$paths=array_keys($active);sort($paths);
 if($bytes<=4194304&&count($themes)===1&&$paths===$expected&&count($custom)===0&&is_array($mods)&&empty($mods)){
  $contents=array();foreach($active as $path=>$file){$contents[$path]=file_get_contents($file);if($contents[$path]===false){throw new Exception('Active native theme bytes unavailable.');}}
  return anka_publication_digest((object)$contents);
 }
 return anka_publication_digest((object)array('stylesheet'=>$stylesheet,'template'=>$theme->get_template(),'files'=>(object)$inventory,'customizations'=>(object)$custom_hashes,'theme_mods_sha256'=>anka_publication_digest((object)$mods),'permalink_structure'=>get_option('permalink_structure'),'show_on_front'=>get_option('show_on_front'),'page_on_front'=>(int)get_option('page_on_front'),'page_for_posts'=>(int)get_option('page_for_posts')));
}

function anka_publication_inventory() {
 $types=array_values(get_post_types(array('public'=>true),'names'));
 $ids=get_posts(array('post_type'=>$types,'post_status'=>array('publish','future','draft','pending','private','inherit'),'cache_results'=>false,'posts_per_page'=>5001,'fields'=>'ids','orderby'=>'ID','order'=>'ASC','suppress_filters'=>true));
 if(count($ids)>5000){throw new Exception('Complete post inventory exceeds five thousand posts.');}
 if($ids){global $wpdb;$safe_ids=implode(',',array_map('intval',$ids));$bytes=$wpdb->get_var("SELECT COALESCE(SUM(OCTET_LENGTH(post_content)+OCTET_LENGTH(post_title)+OCTET_LENGTH(post_excerpt)),0) FROM {$wpdb->posts} WHERE ID IN ($safe_ids)");if($bytes===null||(int)$bytes>33554432){throw new Exception('Complete post content exceeds thirty-two MiB.');}}
 $posts=array();$paths=array();$pages=array();
 foreach($ids as $id){
  $post=anka_publication_post($id);
  if(isset($paths[$post['path']])||($post['managed_page_id']!==null&&isset($pages[$post['managed_page_id']]))){throw new Exception('WordPress paths or registered page identities are ambiguous.');}
  $paths[$post['path']]=true;if($post['managed_page_id']!==null){$pages[$post['managed_page_id']]=true;}$posts[]=$post;
 }
 $head=anka_publication_option_read('anka_publication_head');if($head!==null&&!anka_publication_uuid($head)){throw new Exception('Retained publication head is invalid.');}
 $inventory=array('site_id'=>ANKA_PUBLICATION_SITE_ID,'origin'=>untrailingslashit(home_url()),'environment'=>'production','head'=>$head,'theme_sha256'=>anka_publication_theme(),'complete'=>true,'posts'=>$posts);
 $inventory['inventory_sha256']=anka_publication_digest((object)$inventory);
 return $inventory;
}

// Fresh private option reads and exact-value CAS avoid object-cache decisions at
// journal boundaries. A failed comparison never authorizes another execution.
function anka_publication_option_read($key) {
 global $wpdb;$value=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",$key));
 return $value===null?null:maybe_unserialize($value);
}
function anka_publication_option_cas($key,$expected,$replacement) {
 global $wpdb;$count=$wpdb->query($wpdb->prepare("UPDATE {$wpdb->options} SET option_value=%s WHERE option_name=%s AND HEX(option_value)=HEX(%s)",maybe_serialize($replacement),$key,maybe_serialize($expected)));
 if($count===1){wp_cache_delete($key,'options');}return $count===1;
}
function anka_publication_lock_release($identity) {
 global $wpdb;$count=$wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name=%s AND HEX(option_value)=HEX(%s)",'anka_publication_active_command',maybe_serialize($identity)));
 if($count===1){wp_cache_delete('anka_publication_active_command','options');}return $count===1;
}

// Durable admission only. No execution route calls this helper until full payload,
// retained backup and inventory-CAS validation are implemented. A pending lock never
// expires: elapsed time cannot establish whether an interrupted write took effect.
function anka_publication_journal_identity($command) {
 if(!is_array($command)||!isset($command['protocol'],$command['kind'],$command['site_id'],$command['request_id'],$command['command_id'],$command['review_sha256'],$command['command_sha256'])||$command['protocol']!=='anka-publication-v1'||!in_array($command['kind'],array('publication','rollback'),true)||$command['site_id']!==ANKA_PUBLICATION_SITE_ID||!anka_publication_uuid($command['request_id'])||!anka_publication_uuid($command['command_id'])||!preg_match('/^[a-f0-9]{64}$/',$command['review_sha256'])||!preg_match('/^[a-f0-9]{64}$/',$command['command_sha256'])){throw new Exception('Exact original journal command identity required.');}
 $unsigned=$command;unset($unsigned['command_sha256']);
 if(!hash_equals($command['command_sha256'],anka_publication_digest((object)$unsigned))){throw new Exception('Original journal command checksum differs.');}
 return array('request_id'=>$command['request_id'],'kind'=>$command['kind'],'command_id'=>$command['command_id'],'review_sha256'=>$command['review_sha256'],'command_sha256'=>$command['command_sha256']);
}
function anka_publication_journal_read($command) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication journal authority required.');}
 $identity=anka_publication_journal_identity($command);
 $stored=anka_publication_option_read('anka_publication_request_'.$identity['request_id']);
 $lock=anka_publication_option_read('anka_publication_active_command');
 if($stored===null){
  if(is_array($lock)&&($lock['request_id']??null)===$identity['request_id']){
   if($lock!==$identity){throw new Exception('Retained journal lock belongs to another command payload.');}
   return array_merge($identity,array('status'=>'uncertain'));
  }
  return array_merge($identity,array('status'=>'missing'));
 }
 if(!is_array($stored)||($stored['identity']??null)!==$identity||!in_array($stored['status']??null,array('pending','failed','succeeded'),true)){throw new Exception('Retained journal command differs or is unsupported.');}
 return array_merge($identity,array('status'=>$stored['status']));
}
function anka_publication_journal_claim($command) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication journal authority required.');}
 $identity=anka_publication_journal_identity($command);
 $key='anka_publication_request_'.$identity['request_id'];
 if(anka_publication_option_read($key)!==null){anka_publication_journal_read($command);return false;}
 // add_option's unique option_name admits one site-wide original command only.
 // Never remove or steal the lock after a crash, timeout or failed receipt insert.
 if(!add_option('anka_publication_active_command',$identity,'',false)){
  $lock=anka_publication_option_read('anka_publication_active_command');
  if($lock!==$identity){throw new Exception('Another original command has an unresolved outcome.');}
  return false;
 }
 if(!add_option($key,array('identity'=>$identity,'status'=>'pending','phase'=>'admitted'),'',false)){throw new Exception('Original command outcome requires read-only recovery.');}
 return true;
}

// Internal pre-write backup. No REST dispatch or complete page/theme publisher exists.
// Original data stays in non-autoloaded private options; public inspection never
// returns these bodies. Existing theme files will never be overwritten.
function anka_publication_backup_read($command) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication backup authority required.');}
 $identity=anka_publication_journal_identity($command);$stored=anka_publication_option_read('anka_publication_backup_'.$identity['request_id']);
 if($stored===null){return null;}
 if(!is_array($stored)||($stored['snapshot']['identity']??null)!==$identity||!isset($stored['sha256'])||!hash_equals($stored['sha256'],anka_publication_digest((object)$stored['snapshot']))){throw new Exception('Retained original backup checksum differs.');}
 return $stored;
}
function anka_publication_backup_snapshot($command,$inventory=null) {
 if(is_wp_error(anka_publication_permission())){throw new Exception('Publication backup authority required.');}$identity=anka_publication_journal_identity($command);
 $review=$command['review_snapshot']??null;
 if(!is_array($review)||!hash_equals($identity['review_sha256'],anka_publication_digest((object)$review))||($review['target']['site_id']??null)!==ANKA_PUBLICATION_SITE_ID||($review['target']['origin']??null)!==untrailingslashit(home_url())||!isset($review['pages'])||!is_array($review['pages'])||count($review['pages'])<1||count($review['pages'])>100){throw new Exception('Exact retained review required before backup.');}
 $inventory=$inventory===null?anka_publication_inventory():$inventory;
 if(($review['inspection']['inventory_sha256']??null)!==$inventory['inventory_sha256']){throw new Exception('Inspected inventory changed before backup.');}
 $posts=array();$seen=array();$seen_posts=array();
 foreach($review['pages'] as $selected){
  $page=$selected['page_id']??null;$operation=$selected['operation']??null;$id=$selected['post_id']??null;
  if(!anka_publication_uuid($page)||isset($seen[$page])||!in_array($operation,array('create','replace'),true)){throw new Exception('Exact distinct reviewed backup pages required.');}$seen[$page]=true;
  $before=null;
  if($operation==='replace'){
   if(!is_int($id)||$id<1||isset($seen_posts[$id])){throw new Exception('Exact replacement post required.');}$seen_posts[$id]=true;$current=anka_publication_post($id);
   if($current['post_type']!=='page'||$current['path']!==($selected['path']??null)||$current['revision']!==($selected['expected_post_revision']??null)||$current['sha256']!==($selected['expected_post_sha256']??null)||($current['managed_page_id']!==null&&$current['managed_page_id']!==$page)){throw new Exception('Reviewed replacement changed before backup.');}
   $post=get_post($id);$fields=array();foreach(array('ID','post_type','post_status','post_title','post_content','post_excerpt','post_name','post_parent') as $field){$fields[$field]=$post->$field;}
   $meta=array();foreach(array('_wp_page_template','_anka_meta_description','_anka_publication_page_id') as $key){$values=get_post_meta($id,$key,false);if(count($values)>1||array_filter($values,static function($value){return !is_string($value);})) {throw new Exception('Ambiguous or unsupported managed metadata cannot be backed up.');}$meta[$key]=$values;}
   global $wpdb;$row=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d",$id),ARRAY_A);
   if(!is_array($row)){throw new Exception('Original page row unavailable.');}
   $before=array('fields'=>$fields,'row'=>$row,'meta'=>$meta,'inspection'=>$current);
  }else{
   if($id!==null){throw new Exception('Create backup cannot replace a post.');}
   foreach($inventory['posts'] as $current){if($current['path']===($selected['path']??null)||$current['managed_page_id']===$page){throw new Exception('Create backup collides with current inventory.');}}
  }
  $posts[]=array('page_id'=>$page,'operation'=>$operation,'post_id'=>$id,'before'=>$before);
 }
 $snapshot=array('protocol'=>'anka-publication-backup-v1','identity'=>$identity,'inventory'=>$inventory,'posts'=>$posts,'scope'=>$review['scope']??null,'target_id'=>$review['target']['target_id']??null,'site_version_id'=>$review['site_version_id']??null,'theme'=>array('stylesheet'=>get_stylesheet(),'template'=>get_template(),'mods'=>get_option('theme_mods_'.get_stylesheet(),null),'sidebars'=>get_option('sidebars_widgets',null)),'settings'=>array('show_on_front'=>get_option('show_on_front'),'page_on_front'=>get_option('page_on_front'),'page_for_posts'=>get_option('page_for_posts'),'permalink_structure'=>get_option('permalink_structure')));
 if(strlen(json_encode($snapshot,JSON_THROW_ON_ERROR))>33554432){throw new Exception('Original backup exceeds thirty-two MiB.');}
 $backup=array('snapshot'=>$snapshot,'sha256'=>anka_publication_digest((object)$snapshot));
 return $backup;
}
function anka_publication_backup_prepare($command) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication backup authority required.');}
 $identity=anka_publication_journal_identity($command);
 $receipt=anka_publication_option_read('anka_publication_request_'.$identity['request_id']);
 if($identity['kind']!=='publication'||!is_array($receipt)||($receipt['identity']??null)!==$identity||($receipt['status']??null)!=='pending'||anka_publication_option_read('anka_publication_active_command')!==$identity){throw new Exception('Original pending publication lock required before backup.');}
 $old=anka_publication_backup_read($command);if($old!==null){return anka_publication_backup_attach($command,$old['sha256']);}
 $backup=anka_publication_backup_snapshot($command);
 if(!add_option('anka_publication_backup_'.$identity['request_id'],$backup,'',false)){throw new Exception('Original backup admission requires read-only recovery.');}
 $retained=anka_publication_backup_read($command);if($retained===null||$retained['sha256']!==$backup['sha256']){throw new Exception('Original backup was not retained exactly.');}
 return anka_publication_backup_attach($command,$retained['sha256']);
}
function anka_publication_backup_attach($command,$hash) {
 $identity=anka_publication_journal_identity($command);$key='anka_publication_request_'.$identity['request_id'];$stored=anka_publication_option_read($key);
 if(!is_array($stored)||($stored['identity']??null)!==$identity||($stored['status']??null)!=='pending'||anka_publication_option_read('anka_publication_active_command')!==$identity){throw new Exception('Original pending backup receipt required.');}
 if(($stored['phase']??null)==='prepared'&&($stored['backup_snapshot_sha256']??null)===$hash){return $hash;}
 if(($stored['phase']??null)!=='admitted'){throw new Exception('A command that may have executed cannot prepare again.');}
 $prepared=array('identity'=>$identity,'status'=>'pending','phase'=>'prepared','backup_snapshot_sha256'=>$hash);
 if(!anka_publication_option_cas($key,$stored,$prepared)){throw new Exception('Backup receipt changed concurrently.');}return $hash;
}
// This only claims the internal write boundary; it performs no execution. The
// future fixed executor must win this CAS exactly once before touching anything.
function anka_publication_journal_begin_execute($command) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication execution authority required.');}
 $identity=anka_publication_journal_identity($command);$key='anka_publication_request_'.$identity['request_id'];$stored=anka_publication_option_read($key);
 if(!is_array($stored)||($stored['identity']??null)!==$identity||($stored['status']??null)!=='pending'||anka_publication_option_read('anka_publication_active_command')!==$identity){throw new Exception('Original pending execution receipt required.');}
 if(($stored['phase']??null)==='executing'){return false;}
 $backup=anka_publication_backup_read($command);
 if(($stored['phase']??null)!=='prepared'||$backup===null||($stored['backup_snapshot_sha256']??null)!==$backup['sha256']||$backup['snapshot']['inventory']['inventory_sha256']!==anka_publication_inventory()['inventory_sha256']){throw new Exception('Exact prepared backup and unchanged inventory required before execution.');}
 $executing=$stored;$executing['phase']='executing';return anka_publication_option_cas($key,$stored,$executing);
}
// Only a proven unchanged pre-write failure may close here. Success and rollback
// settlement remain unavailable until the fixed executors verify their outcomes.
function anka_publication_journal_fail_unchanged($command) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication settlement authority required.');}
 $identity=anka_publication_journal_identity($command);$key='anka_publication_request_'.$identity['request_id'];$stored=anka_publication_option_read($key);
 if(!is_array($stored)||($stored['identity']??null)!==$identity){throw new Exception('Original pending receipt required.');}
 if(($stored['status']??null)==='failed'){anka_publication_lock_release($identity);return false;}
 if(($stored['status']??null)!=='pending'||($stored['phase']??null)!=='prepared'||anka_publication_option_read('anka_publication_active_command')!==$identity){throw new Exception('Only an original command that never crossed execution may fail unchanged.');}
 $backup=anka_publication_backup_read($command);$inventory=anka_publication_inventory();
 if($backup===null||$backup['snapshot']['inventory']['inventory_sha256']!==$inventory['inventory_sha256']){throw new Exception('Changed or uncertain outcome cannot be closed as failed.');}
 $terminal=array('identity'=>$identity,'status'=>'failed','backup_snapshot_sha256'=>$backup['sha256']);
 if(!anka_publication_option_cas($key,$stored,$terminal)){throw new Exception('Terminal original receipt changed concurrently.');}
 anka_publication_lock_release($identity);return true;
}

// Internal fixed-theme construction for the future publisher. No caller or REST
// route invokes this yet. It creates a new inactive directory, never overwrites
// an existing theme, activates anything, or interprets caller-supplied PHP.
function anka_publication_theme_payload($command) {
 $identity=anka_publication_journal_identity($command);$review=$command['review_snapshot']??null;$bundle=$command['bundle']??null;
 if($identity['kind']!=='publication'||!is_array($review)||!hash_equals($identity['review_sha256'],anka_publication_digest((object)$review))||!is_array($bundle)||($bundle['compiler']??null)!=='anka-publication-v1'||($bundle['site_version_id']??null)!==($review['site_version_id']??null)||!anka_publication_uuid($bundle['site_version_id']??null)){throw new Exception('Exact original compiled publication theme required.');}
 $keys=array_keys($bundle);sort($keys);if($keys!==array('compiler','pages','payload_sha256','site_version_id','theme')){throw new Exception('Unexpected compiled publication fields.');}
 $unsigned=$bundle;unset($unsigned['payload_sha256']);
 if(!is_string($bundle['payload_sha256'])||!hash_equals($bundle['payload_sha256'],anka_publication_digest((object)$unsigned))||strlen(json_encode($bundle,JSON_THROW_ON_ERROR))>4194304){throw new Exception('Bounded original compiled payload checksum differs.');}
 if(!is_array($bundle['pages'])||!array_is_list($bundle['pages'])||count($bundle['pages'])<1||count($bundle['pages'])>100||!is_array($review['pages']??null)||count($bundle['pages'])!==count($review['pages'])){throw new Exception('Exact reviewed compiled pages required.');}
 $seen=array();foreach($bundle['pages'] as $page){$keys=is_array($page)?array_keys($page):array();sort($keys);if($keys!==array('job_id','meta_description','package_sha256','page_id','page_key','post_content','title')||!anka_publication_uuid($page['page_id'])||isset($seen[$page['page_id']])){throw new Exception('Distinct exact compiled pages required.');}$seen[$page['page_id']]=true;$matches=array_values(array_filter($review['pages'],static fn($row)=>is_array($row)&&($row['page_id']??null)===$page['page_id']));if(count($matches)!==1){throw new Exception('Compiled page is absent from the original review.');}$selected=$matches[0];foreach(array('page_key','job_id','package_sha256') as $key){if(!is_string($page[$key])||$page[$key]!==($selected[$key]??null)){throw new Exception('Compiled page source differs from the original review.');}}foreach(array('title','meta_description','post_content') as $key){if(!is_string($page[$key])||strpos($page[$key],"\0")!==false){throw new Exception('Bounded compiled page text required.');}}}
 $theme=$bundle['theme'];$keys=is_array($theme)?array_keys($theme):array();sort($keys);
 if($keys!==array('file_hashes','files','theme_sha256')||!is_array($theme['files'])||!is_array($theme['file_hashes'])){throw new Exception('Exact compiled theme manifest required.');}
 $paths=array('functions.php','parts/footer.html','parts/header.html','style.css','templates/index.html','theme.json');$keys=array_keys($theme['files']);sort($keys);$hashes=array_keys($theme['file_hashes']);sort($hashes);
 if($keys!==$paths||$hashes!==$paths||!is_string($theme['theme_sha256'])||!hash_equals($theme['theme_sha256'],anka_publication_digest((object)$theme['files']))||($review['theme_change']['reviewed_sha256']??null)!==$theme['theme_sha256']){throw new Exception('Reviewed six-file theme checksum differs.');}
 foreach($paths as $path){$body=$theme['files'][$path];$hash=$theme['file_hashes'][$path];if(!is_string($body)||strpos($body,"\0")!==false||!is_string($hash)||!hash_equals($hash,hash('sha256',$body))||($path!=='functions.php'&&strpos($body,'<?')!==false)){throw new Exception('Unsafe or changed fixed theme file.');}}
 // Pinned bytes from WEBSITE_BLOCK_FUNCTIONS / PUBLICATION_TEMPLATE. The local
 // actual WordPress harness also compares these with the JavaScript compiler.
 if(hash('sha256',$theme['files']['functions.php'])!=='9972bb43ba67ce4d199bf7c989733e9069f7b0436706919e370a9fae6d09ec7e'||hash('sha256',$theme['files']['templates/index.html'])!=='2016c2c095c104d484daa43f9ab7eaebf646a56ccc7791c0ad4e23d763c7de5e'){throw new Exception('Only the fixed reviewed PHP runtime and post-content template are supported.');}
 $json=json_decode($theme['files']['theme.json'],true,512,JSON_THROW_ON_ERROR);if(!is_array($json)||($json['version']??null)!==3||!preg_match('/Theme Name:\s*[^\r\n]+/',$theme['files']['style.css'])){throw new Exception('A supported compiled block theme is required.');}
 ksort($theme['file_hashes'],SORT_STRING);ksort($theme['files'],SORT_STRING);return $theme;
}
function anka_publication_theme_read($command) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication theme authority required.');}
 $identity=anka_publication_journal_identity($command);$retained=anka_publication_option_read('anka_publication_theme_'.$identity['request_id']);if($retained===null){return null;}
 $theme=anka_publication_theme_payload($command);$slug='anka-pub-'.str_replace('-','',$identity['request_id']);
 $expected=array('identity'=>$identity,'stylesheet'=>$slug,'theme_sha256'=>$theme['theme_sha256'],'file_hashes'=>$theme['file_hashes']);
 if($retained!==$expected){throw new Exception('Retained original theme descriptor differs.');}
 $root=realpath(get_theme_root());$directory=$root?($root.DIRECTORY_SEPARATOR.$slug):null;
 if(!$directory||is_link($directory)||realpath($directory)!==$directory){throw new Exception('Retained theme directory is unavailable or unsafe.');}
 $expected_entries=array(''=>array('functions.php','parts','style.css','templates','theme.json'),'parts'=>array('footer.html','header.html'),'templates'=>array('index.html'));
 foreach($expected_entries as $part=>$entries){$dir=$directory.($part===''?'':DIRECTORY_SEPARATOR.$part);if(is_link($dir)){throw new Exception('Retained theme directory cannot be a symbolic link.');}$actual=scandir($dir);if($actual===false){throw new Exception('Retained theme manifest unavailable.');}$actual=array_values(array_diff($actual,array('.','..')));sort($actual);if($actual!==$entries){throw new Exception('Retained theme contains unexpected files.');}}
 foreach($theme['file_hashes'] as $path=>$hash){$file=$directory.DIRECTORY_SEPARATOR.$path;if(is_link($file)||!is_file($file)||realpath($file)!==$file||!hash_equals($hash,hash_file('sha256',$file))){throw new Exception('Retained original theme file changed.');}}
 return $expected;
}
function anka_publication_theme_materialize($command) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication theme authority required.');}
 $identity=anka_publication_journal_identity($command);$theme=anka_publication_theme_payload($command);$stored=anka_publication_option_read('anka_publication_request_'.$identity['request_id']);$backup=anka_publication_backup_read($command);
 if(!is_array($stored)||($stored['identity']??null)!==$identity||($stored['status']??null)!=='pending'||($stored['phase']??null)!=='executing'||anka_publication_option_read('anka_publication_active_command')!==$identity||$backup===null||($stored['backup_snapshot_sha256']??null)!==$backup['sha256']||($command['review_snapshot']['theme_change']['mode']??null)!=='replace'){throw new Exception('Original executing command, retained backup and reviewed theme replacement required.');}
 $change=$command['review_snapshot']['theme_change'];$inventory=$backup['snapshot']['inventory'];$affected=$change['affected_posts']??null;
 if(($change['sitewide_impact_acknowledged']??null)!==true||($change['expected_sha256']??null)!==$inventory['theme_sha256']||!is_array($affected)||!array_is_list($affected)||count($affected)!==count($inventory['posts'])){throw new Exception('Complete explicit theme impact acknowledgement required.');}
 $seen=array();foreach($affected as $post){$id=$post['post_id']??null;$matches=array_values(array_filter($inventory['posts'],static fn($row)=>$row['post_id']===$id));if(!is_int($id)||isset($seen[$id])||count($matches)!==1||($post['revision']??null)!==$matches[0]['revision']||($post['sha256']??null)!==$matches[0]['sha256']){throw new Exception('Original complete theme impact manifest differs.');}$seen[$id]=true;}
 $old=anka_publication_theme_read($command);if($old!==null){return $old;}
 // A crash may leave a partial directory. Never delete, reuse or repair it here;
 // its unresolved executing request remains locked for read-only recovery.
 $root=realpath(get_theme_root());$slug='anka-pub-'.str_replace('-','',$identity['request_id']);$directory=$root?($root.DIRECTORY_SEPARATOR.$slug):null;
 if(!$directory||file_exists($directory)||is_link($directory)||!mkdir($directory,0755)){throw new Exception('A fresh original theme directory could not be admitted.');}
 foreach(array('parts','templates') as $part){if(!mkdir($directory.DIRECTORY_SEPARATOR.$part,0755)){throw new Exception('Original inactive theme requires read-only recovery.');}}
 foreach($theme['files'] as $path=>$body){$file=$directory.DIRECTORY_SEPARATOR.$path;$handle=fopen($file,'x+b');if($handle===false){throw new Exception('Original inactive theme file requires recovery.');}
  try{$offset=0;$length=strlen($body);while($offset<$length){$written=fwrite($handle,substr($body,$offset));if($written===false||$written===0){throw new Exception('Original inactive theme file was not written completely.');}$offset+=$written;}if(!fflush($handle)){throw new Exception('Original inactive theme file did not flush.');}}finally{fclose($handle);}
  if(!hash_equals($theme['file_hashes'][$path],hash_file('sha256',$file))){throw new Exception('Original inactive theme file checksum differs.');}
 }
 $descriptor=array('identity'=>$identity,'stylesheet'=>$slug,'theme_sha256'=>$theme['theme_sha256'],'file_hashes'=>$theme['file_hashes']);
 if(!add_option('anka_publication_theme_'.$identity['request_id'],$descriptor,'',false)){throw new Exception('Original inactive theme descriptor requires read-only recovery.');}
 return anka_publication_theme_read($command);
}


// Guarded replacement-row primitive; the original composer verifies metadata and settlement.
// Admission is durable BEFORE the first row mutation. Any interruption remains
// unresolved and cannot repeat the write, even if the row still looks unchanged.
// MySQL reports zero changed rows for a matching no-op, unlike SQLite. Zero
// proves success only if all assignments AND the full original row/revision match.
function anka_publication_verify_row_update($affected,$before,$assigned,$revision) {
 if($affected===1){return true;}if($affected!==0){throw new Exception('Original page compare-and-swap failed.');}
 foreach($assigned as $field=>$value){if(!array_key_exists($field,$before)||(string)$before[$field]!== (string)$value){throw new Exception('Original page compare-and-swap failed.');}}
 global $wpdb;$id=(int)$before['ID'];$fresh=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d",$id),ARRAY_A);
 if($fresh!==$before||anka_publication_post($id)['revision']!==$revision){throw new Exception('Original page compare-and-swap failed.');}return true;
}
function anka_publication_replace_row($command,$page_id) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication page authority required.');}
 anka_publication_theme_payload($command);$identity=anka_publication_journal_identity($command);$key='anka_publication_request_'.$identity['request_id'];$stored=anka_publication_option_read($key);$backup=anka_publication_backup_read($command);
 if($identity['kind']!=='publication'||!is_array($stored)||($stored['identity']??null)!==$identity||($stored['status']??null)!=='pending'||($stored['phase']??null)!=='executing'||anka_publication_option_read('anka_publication_active_command')!==$identity||$backup===null||($stored['backup_snapshot_sha256']??null)!==$backup['sha256']){throw new Exception('Original executing publication and exact backup required.');}
 $selected=null;$payload=null;$original=null;
 foreach($command['review_snapshot']['pages'] as $page){if(($page['page_id']??null)===$page_id){$selected=$page;}}
 foreach($command['bundle']['pages'] as $page){if(($page['page_id']??null)===$page_id){$payload=$page;}}
 foreach($backup['snapshot']['posts'] as $page){if(($page['page_id']??null)===$page_id){$original=$page;}}
 if($selected===null||$payload===null||$original===null||($selected['operation']??null)!=='replace'||($original['operation']??null)!=='replace'||($original['post_id']??null)!==($selected['post_id']??null)||!is_array($original['before']['row']??null)){throw new Exception('Exact backed-up replacement page required.');}
 foreach(($stored['completed_pages']??array()) as $completed){if($completed['page_id']===$page_id){throw new Exception('Original page already written; recovery never resends.');}}
 $id=$selected['post_id'];clean_post_cache($id);$inspection=anka_publication_post($id);
 if($inspection!==$original['before']['inspection']){throw new Exception('Replacement source changed after review.');}
 global $wpdb;$before=$original['before']['row'];$current=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d",$id),ARRAY_A);
 if($current!==$before||($before['post_type']??null)!=='page'){throw new Exception('Original page row changed after backup.');}
 // Constrain identifiers to the actual fixed WordPress schema, never command input.
 $columns=array('ID','post_author','post_date','post_date_gmt','post_content','post_title','post_excerpt','post_status','comment_status','ping_status','post_password','post_name','to_ping','pinged','post_modified','post_modified_gmt','post_content_filtered','post_parent','guid','menu_order','post_type','post_mime_type','comment_count');
 $actual=array_keys($before);sort($actual);$expected=$columns;sort($expected);if($actual!==$expected){throw new Exception('Unsupported page schema requires review.');}
 $writing=$stored;$writing['phase']='page-row-writing';$writing['active_page_id']=$page_id;
 if(!anka_publication_option_cas($key,$stored,$writing)){throw new Exception('Original page write admission changed.');}
 $where=array();$args=array($payload['title'],$payload['post_content'],current_time('mysql'),current_time('mysql',true));
 foreach($columns as $column){$where[]="HEX(CAST(`$column` AS CHAR))=HEX(%s)";$args[]=(string)$before[$column];}
 // A grouped derived table prevents a merged self-select on MySQL. The original
 // latest revision is checked in the same statement as every original row byte.
 $args[]=$id;$args[]=$selected['expected_post_revision'];
 $sql="UPDATE {$wpdb->posts} SET post_title=%s,post_content=%s,post_status='publish',post_modified=%s,post_modified_gmt=%s WHERE ".implode(' AND ',$where)." AND COALESCE((SELECT latest FROM (SELECT post_parent,MAX(ID) AS latest FROM {$wpdb->posts} WHERE post_type='revision' AND post_status='inherit' GROUP BY post_parent) AS anka_versions WHERE post_parent=%d),ID)=%d";
 $affected=$wpdb->query($wpdb->prepare($sql,$args));anka_publication_verify_row_update($affected,$before,array('post_title'=>$payload['title'],'post_content'=>$payload['post_content'],'post_status'=>'publish','post_modified'=>$args[2],'post_modified_gmt'=>$args[3]),$selected['expected_post_revision']);
 clean_post_cache($id);$post=get_post($id);$post_before=new WP_Post((object)$before);
 // Normal core lifecycle follows the guarded write, without an unconditional
 // second wp_update_post that could overwrite a concurrent human edit.
 wp_transition_post_status($post->post_status,$post_before->post_status,$post);
 do_action('edit_post_page',$id,$post);do_action('edit_post',$id,$post);do_action('post_updated',$id,$post,$post_before);
 do_action('save_post_page',$id,$post,true);do_action('save_post',$id,$post,true);do_action('wp_insert_post',$id,$post,true);wp_after_insert_post($post,true,$post_before);
 clean_post_cache($id);$after=get_post($id);
 if($after===null||$after->post_title!==$payload['title']||$after->post_content!==$payload['post_content']||$after->post_status!=='publish'||$after->post_name!==$post_before->post_name||(int)$after->post_parent!==(int)$post_before->post_parent){throw new Exception('Page changed during save lifecycle; outcome requires read-only recovery.');}
 foreach($original['before']['meta'] as $meta_key=>$values){if(get_post_meta($id,$meta_key,false)!==$values){throw new Exception('Managed metadata changed during row write; outcome requires read-only recovery.');}}
 $written=$writing;$written['phase']='page-row-written';$written['row_result']=anka_publication_post($id);
 if(!anka_publication_option_cas($key,$writing,$written)){throw new Exception('Page receipt changed; outcome requires read-only recovery.');}
 return $written['row_result'];
}


// All database changes, final head, terminal journal and exact lock release commit
// together on the one original connection. Unknown/interrupted execution is never
// retried. Inactive theme files are retained outside this transaction for evidence.
function anka_publication_dispatch_window($command) {
 $created=is_string($command['created_at']??null)?strtotime($command['created_at']):false;
 if($created===false||$created>time()||$created+600<=time()){throw new Exception('Original dispatch window expired; recover without resending.');}
}
function anka_publication_transaction_begin() {
 global $wpdb;if(is_multisite()){throw new Exception('Publication requires a separately reviewed single site.');}
 $sqlite=defined('DB_ENGINE')&&DB_ENGINE==='sqlite';
 if(!$sqlite){
  foreach(array($wpdb->posts,$wpdb->postmeta,$wpdb->options,$wpdb->users,$wpdb->usermeta) as $table){$engine=$wpdb->get_row($wpdb->prepare('SHOW TABLE STATUS LIKE %s',$wpdb->esc_like($table)),ARRAY_A);if(!is_array($engine)||strtoupper($engine['Engine']??'')!=='INNODB'){throw new Exception('Transactional InnoDB publication tables required.');}}
  if($wpdb->query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')===false){throw new Exception('Publication transaction isolation unavailable.');}
 }
 if($wpdb->query('START TRANSACTION')===false){throw new Exception('Publication transaction unavailable.');}
 if(!$sqlite){foreach(array(array($wpdb->posts,'ID'),array($wpdb->postmeta,'meta_id'),array($wpdb->options,'option_id'),array($wpdb->users,'ID'),array($wpdb->usermeta,'umeta_id')) as $entry){if($wpdb->query("SELECT {$entry[1]} FROM {$entry[0]} ORDER BY {$entry[1]} FOR UPDATE")===false){$wpdb->query('ROLLBACK');throw new Exception('Original publication row locks unavailable.');}}}
}
function anka_publication_cache_clear($ids=array()) {
 foreach($ids as $id){clean_post_cache($id);}wp_cache_delete('alloptions','options');wp_cache_delete('notoptions','options');wp_cache_delete('anka_publication_head','options');wp_clean_themes_cache();
}
function anka_publication_finish_theme_switch() {
 $soft=static function(){return false;};add_filter('flush_rewrite_rules_hard',$soft,PHP_INT_MAX);
 try{check_theme_switched();}finally{remove_filter('flush_rewrite_rules_hard',$soft,PHP_INT_MAX);}
}
function anka_publication_meta_cas($id,$key,$before,$after) {
 global $wpdb;
 if(!in_array($key,array('_wp_page_template','_anka_meta_description','_anka_publication_page_id'),true)||!is_array($before)||!is_array($after)||count($before)>1||count($after)>1){throw new Exception('Exact single managed metadata values required.');}
 foreach(array_merge($before,$after) as $value){if(!is_string($value)){throw new Exception('Managed metadata must be exact text.');}}
 $rows=$wpdb->get_results($wpdb->prepare("SELECT meta_id,meta_value FROM {$wpdb->postmeta} WHERE post_id=%d AND meta_key=%s ORDER BY meta_id",$id,$key),ARRAY_A);
 if(array_column($rows,'meta_value')!==$before){throw new Exception('Managed metadata changed after review.');}
 if($before!==$after){
  if(count($before)===1){
   $query=count($after)===0?$wpdb->prepare("DELETE FROM {$wpdb->postmeta} WHERE meta_id=%d AND HEX(meta_value)=HEX(%s)",$rows[0]['meta_id'],$before[0]):$wpdb->prepare("UPDATE {$wpdb->postmeta} SET meta_value=%s WHERE meta_id=%d AND HEX(meta_value)=HEX(%s)",$after[0],$rows[0]['meta_id'],$before[0]);
   if($wpdb->query($query)!==1){throw new Exception('Managed metadata byte comparison failed.');}
  }elseif(count($after)===1){
   if($wpdb->query($wpdb->prepare("INSERT INTO {$wpdb->postmeta}(post_id,meta_key,meta_value) SELECT %d,%s,%s WHERE NOT EXISTS (SELECT 1 FROM (SELECT post_id,meta_key FROM {$wpdb->postmeta} WHERE post_id=%d AND meta_key=%s) AS anka_meta)",$id,$key,$after[0],$id,$key))!==1){throw new Exception('New managed metadata admission changed.');}
  }
 }
 wp_cache_delete($id,'post_meta');
 if(get_post_meta($id,$key,false)!==$after){throw new Exception('Managed metadata outcome differs.');}
}
function anka_publication_preflight($command) {
 anka_publication_theme_payload($command);$review=$command['review_snapshot'];$inventory=anka_publication_inventory();
 if(($review['inspection']['inventory_sha256']??null)!==$inventory['inventory_sha256']){throw new Exception('Original complete inventory changed.');}
 foreach($review['pages'] as $page){
  $path=$page['path']??null;
  if(is_string($path)&&preg_match('~^/(?:wp-admin|wp-json|wp-content|wp-includes)(?:/|$)~',$path)){throw new Exception('WordPress system routes cannot be publication destinations.');}
  if(!is_string($path)||strlen($path)>240||!preg_match('~^/(?:[a-z0-9_-]+/)*[a-z0-9_-]+$~',$path)&&$path!=='/'||$path!=='/'&&str_ends_with($path,'/')){throw new Exception('Canonical exact page path required.');}
  if($page['operation']==='create'){
   if($path==='/'){throw new Exception('Creating a new front page requires separate site-settings review; replace an inspected existing front page instead.');}
   $parent=substr($path,0,strrpos($path,'/'));
   if($parent!==''){
    $found=false;foreach($inventory['posts'] as $post){if($post['path']===$parent&&$post['post_type']==='page'&&$post['post_status']==='publish'){$found=true;}}
    foreach($review['pages'] as $ancestor){if($ancestor['path']===$parent){$found=true;}}
    if(!$found){throw new Exception('Exact parent page must already exist or be included in this review.');}
   }
  }
 }
 anka_publication_backup_snapshot($command,$inventory);return $inventory;
}
function anka_publication_create_row($command,$page_id) {
 $permission=anka_publication_permission();if(is_wp_error($permission)){throw new Exception('Publication page authority required.');}
 $identity=anka_publication_journal_identity($command);anka_publication_theme_payload($command);$key='anka_publication_request_'.$identity['request_id'];$stored=anka_publication_option_read($key);$backup=anka_publication_backup_read($command);
 if(($stored['identity']??null)!==$identity||($stored['status']??null)!=='pending'||($stored['phase']??null)!=='executing'||anka_publication_option_read('anka_publication_active_command')!==$identity||$backup===null||($stored['backup_snapshot_sha256']??null)!==$backup['sha256']){throw new Exception('Original executing create and backup required.');}
 foreach(($stored['completed_pages']??array()) as $done){if($done['page_id']===$page_id){throw new Exception('Original create already completed.');}}
 $selected=null;$payload=null;foreach($command['review_snapshot']['pages'] as $page){if($page['page_id']===$page_id){$selected=$page;}}foreach($command['bundle']['pages'] as $page){if($page['page_id']===$page_id){$payload=$page;}}
 if($selected===null||$payload===null||$selected['operation']!=='create'||$selected['path']==='/'||$selected['post_id']!==null){throw new Exception('Exact non-overwriting create required.');}
 $inventory=anka_publication_inventory();$parent_path=substr($selected['path'],0,strrpos($selected['path'],'/'));$parent_id=0;
 foreach($inventory['posts'] as $post){if($post['path']===$selected['path']||$post['managed_page_id']===$page_id){throw new Exception('New page collides with an existing post.');}if($parent_path!==''&&$post['path']===$parent_path&&$post['post_type']==='page'&&$post['post_status']==='publish'){$parent_id=$post['post_id'];}}
 if($parent_path!==''&&$parent_id===0){throw new Exception('Exact new page parent unavailable.');}
 $writing=$stored;$writing['phase']='page-row-writing';$writing['active_page_id']=$page_id;if(!anka_publication_option_cas($key,$stored,$writing)){throw new Exception('Original create admission changed.');}
 $id=wp_insert_post(wp_slash(array('post_type'=>'page','post_status'=>'publish','post_title'=>$payload['title'],'post_content'=>$payload['post_content'],'post_name'=>basename($selected['path']),'post_parent'=>$parent_id,'post_author'=>get_current_user_id())),true);
 if(is_wp_error($id)||!is_int($id)||$id<1){throw new Exception('New page creation outcome unavailable.');}
 clean_post_cache($id);$post=get_post($id);$result=anka_publication_post($id);
 if($result['path']!==$selected['path']||$post->post_title!==$payload['title']||$post->post_content!==$payload['post_content']||$result['managed_page_id']!==null){throw new Exception('New page path or exact body differs; original outcome requires recovery.');}
 $written=$writing;$written['phase']='page-row-written';$written['row_result']=$result;if(!anka_publication_option_cas($key,$writing,$written)){throw new Exception('Original created page receipt changed.');}return $result;
}
function anka_publication_finish_page($command,$page_id) {
 $identity=anka_publication_journal_identity($command);$key='anka_publication_request_'.$identity['request_id'];$stored=anka_publication_option_read($key);$backup=anka_publication_backup_read($command);
 if(is_wp_error(anka_publication_permission())||($stored['identity']??null)!==$identity||($stored['status']??null)!=='pending'||($stored['phase']??null)!=='page-row-written'||($stored['active_page_id']??null)!==$page_id||anka_publication_option_read('anka_publication_active_command')!==$identity||$backup===null){throw new Exception('Original completed row required before managed metadata.');}
 $original=null;$payload=null;foreach($backup['snapshot']['posts'] as $page){if($page['page_id']===$page_id){$original=$page;}}foreach($command['bundle']['pages'] as $page){if($page['page_id']===$page_id){$payload=$page;}}
 $id=$stored['row_result']['post_id'];clean_post_cache($id);if(anka_publication_post($id)!==$stored['row_result']){throw new Exception('Page changed before managed metadata.');}
 $desired=array('_wp_page_template'=>array('default'),'_anka_meta_description'=>array($payload['meta_description']),'_anka_publication_page_id'=>array($page_id));
 foreach($desired as $meta=>$values){anka_publication_meta_cas($id,$meta,$original['before']['meta'][$meta]??array(),$values);}
 clean_post_cache($id);$inspection=anka_publication_post($id);global $wpdb;$row=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d",$id),ARRAY_A);
 $next=$stored;$next['phase']='executing';unset($next['active_page_id'],$next['row_result']);$next['completed_pages'][]=array('page_id'=>$page_id,'post_id'=>$id,'inspection'=>$inspection,'row'=>$row,'meta'=>$desired);
 if(!anka_publication_option_cas($key,$stored,$next)){throw new Exception('Original managed page receipt changed.');}return $inspection;
}
function anka_publication_receipt_projection($stored,$request_id) {
 if($stored===null){return array('request_id'=>$request_id,'status'=>'missing');}
 $i=$stored['identity'];$out=array('request_id'=>$i['request_id'],'status'=>$stored['status'],'kind'=>$i['kind'],'command_id'=>$i['command_id'],'review_sha256'=>$i['review_sha256']);
 if($stored['status']==='succeeded'){$out['head']=$stored['result']['head'];$out['backup_snapshot_sha256']=$stored['backup_snapshot_sha256'];}return $out;
}
function anka_publication_execute($command) {
 if(is_wp_error(anka_publication_permission())){throw new Exception('Publication execution authority required.');}
 $identity=anka_publication_journal_identity($command);if($identity['kind']!=='publication'){throw new Exception('Exact publication command required.');}
 $prior=anka_publication_option_read('anka_publication_request_'.$identity['request_id']);if($prior!==null){if(($prior['identity']??null)!==$identity){throw new Exception('Original request payload differs.');}return anka_publication_receipt_projection($prior,$identity['request_id']);}
 anka_publication_dispatch_window($command);anka_publication_preflight($command);if(!anka_publication_journal_claim($command)){throw new Exception('Original publication outcome requires read-only recovery.');}
 anka_publication_backup_prepare($command);if(!anka_publication_journal_begin_execute($command)){throw new Exception('Original publication already crossed execution.');}
 $backup=anka_publication_backup_read($command);$theme=null;if($command['review_snapshot']['theme_change']['mode']==='replace'){$theme=anka_publication_theme_materialize($command);}
 global $wpdb;$ids=array();$transaction=false;
 try{
  anka_publication_transaction_begin();$transaction=true;anka_publication_cache_clear();anka_publication_preflight($command);
  $pages=$command['review_snapshot']['pages'];usort($pages,static function($a,$b){return substr_count($a['path'],'/')<=>substr_count($b['path'],'/');});
  foreach($pages as $page){$row=$page['operation']==='replace'?anka_publication_replace_row($command,$page['page_id']):anka_publication_create_row($command,$page['page_id']);$ids[]=$row['post_id'];anka_publication_finish_page($command,$page['page_id']);}
  $key='anka_publication_request_'.$identity['request_id'];$stored=anka_publication_option_read($key);$completed=$stored['completed_pages']??array();$current=anka_publication_inventory();$by_id=array();foreach($completed as $page){$by_id[$page['post_id']]=$page;}
  foreach($current['posts'] as $post){
   if(isset($by_id[$post['post_id']])){if($post!==$by_id[$post['post_id']]['inspection']){throw new Exception('Written page changed before settlement.');}continue;}
   $old=null;foreach($backup['snapshot']['inventory']['posts'] as $candidate){if($candidate['post_id']===$post['post_id']){$old=$candidate;}}
   if($old!==$post){throw new Exception('Unselected post changed during publication.');}
  }
  $creates=count(array_filter($pages,static function($p){return $p['operation']==='create';}));if(count($current['posts'])!==count($backup['snapshot']['inventory']['posts'])+$creates||count($completed)!==count($pages)){throw new Exception('Complete publication inventory differs.');}
  if($theme!==null){
   if(anka_publication_theme()!==$backup['snapshot']['inventory']['theme_sha256']||anka_publication_theme_read($command)!==$theme){throw new Exception('Reviewed theme changed before activation.');}
   if(anka_publication_option_read('theme_mods_'.$theme['stylesheet'])!==null){throw new Exception('New theme already has unreviewed settings.');}
   switch_theme($theme['stylesheet']);anka_publication_finish_theme_switch();remove_theme_mods();anka_publication_cache_clear($ids);
  }
  if(anka_publication_theme()!==$command['bundle']['theme']['theme_sha256']){throw new Exception('Exact active compiled theme not verified.');}
  foreach($backup['snapshot']['settings'] as $setting=>$value){if(get_option($setting)!==$value){throw new Exception('Site settings changed during publication.');}}
  $old_head=$backup['snapshot']['inventory']['head'];$head=anka_publication_option_read('anka_publication_head');if($head!==$old_head){throw new Exception('Original publication head changed.');}
  if($old_head===null){if(!add_option('anka_publication_head',$identity['request_id'],'',false)){throw new Exception('Original publication head admission changed.');}}
  elseif(!anka_publication_option_cas('anka_publication_head',$old_head,$identity['request_id'])){throw new Exception('Original publication head comparison failed.');}
  anka_publication_cache_clear($ids);$result=anka_publication_inventory();$terminal=$stored;$terminal['status']='succeeded';$terminal['phase']='complete';$terminal['result']=$result;$terminal['retained_theme_sha256']=anka_publication_theme($backup['snapshot']['theme']['stylesheet']);
  if(!anka_publication_option_cas($key,$stored,$terminal)||!anka_publication_lock_release($identity)){throw new Exception('Original terminal publication journal comparison failed.');}
  if($wpdb->query('COMMIT')===false){throw new Exception('Original publication commit outcome uncertain.');}$transaction=false;anka_publication_cache_clear($ids);
  return anka_publication_receipt_projection($terminal,$identity['request_id']);
 }catch(Throwable $error){if($transaction){$wpdb->query('ROLLBACK');}anka_publication_cache_clear($ids);throw $error;}
}


function anka_publication_original_backup($identity) {
 $backup=anka_publication_option_read('anka_publication_backup_'.$identity['request_id']);
 if(!is_array($backup)||($backup['snapshot']['identity']??null)!==$identity||!hash_equals($backup['sha256']??'',anka_publication_digest((object)$backup['snapshot']))){throw new Exception('Original private rollback backup unavailable.');}return $backup;
}
function anka_publication_rollback_context($command) {
 if(is_wp_error(anka_publication_permission())){throw new Exception('Rollback authority required.');}
 $identity=anka_publication_journal_identity($command);$review=$command['review_snapshot']??null;
 if($identity['kind']!=='rollback'||!is_array($review)||!hash_equals($identity['review_sha256'],anka_publication_digest((object)$review))||($review['target']['site_id']??null)!==ANKA_PUBLICATION_SITE_ID||($review['target']['origin']??null)!==untrailingslashit(home_url())){throw new Exception('Exact original rollback review required.');}
 $retained=$review['retained']??array();$request=$retained['published_head']??null;if(!anka_publication_uuid($request)){throw new Exception('Original publication head required.');}
 $publication=anka_publication_option_read('anka_publication_request_'.$request);
 if(($publication['status']??null)!=='succeeded'||($publication['identity']['kind']??null)!=='publication'||($publication['identity']['command_id']??null)!==($retained['publication_id']??null)){throw new Exception('Original successful publication required.');}
 $backup=anka_publication_original_backup($publication['identity']);$b=$backup['snapshot'];
 if(($retained['backup_snapshot_sha256']??null)!==$backup['sha256']||($review['scope']??null)!==$b['scope']||($retained['scope']??null)!==$b['scope']||($review['target']['target_id']??null)!==$b['target_id']||($retained['target_id']??null)!==$b['target_id']||($retained['site_id']??null)!==ANKA_PUBLICATION_SITE_ID||($retained['origin']??null)!==untrailingslashit(home_url())){throw new Exception('Rollback target or original private backup differs.');}
 $inventory=anka_publication_inventory();if($inventory['head']!==$request||($review['inspection']['inventory_sha256']??null)!==$inventory['inventory_sha256']||($retained['published_theme_sha256']??null)!==$inventory['theme_sha256']||$publication['result']['theme_sha256']!==$inventory['theme_sha256']){throw new Exception('Publication head or current rollback inventory changed.');}
 $expected=array();foreach($publication['completed_pages'] as $page){$operation=null;foreach($b['posts'] as $original){if($original['page_id']===$page['page_id']){$operation=$original['operation'];}}$expected[]=array('page_id'=>$page['page_id'],'post_id'=>$page['post_id'],'revision'=>$page['inspection']['revision'],'sha256'=>$page['inspection']['sha256'],'operation'=>$operation);clean_post_cache($page['post_id']);if(anka_publication_post($page['post_id'])!==$page['inspection']){throw new Exception('Published page changed; rollback denied.');}}
 $retained_posts=$retained['posts']??array();usort($expected,static function($a,$b){return strcmp($a['page_id'],$b['page_id']);});usort($retained_posts,static function($a,$b){return strcmp($a['page_id'],$b['page_id']);});
 if(anka_publication_digest($retained_posts)!==anka_publication_digest($expected)){throw new Exception('Exact complete retained rollback pages required.');}
 $change=$review['theme_change']??null;$affected=array();foreach($inventory['posts'] as $post){$affected[]=array('post_id'=>$post['post_id'],'revision'=>$post['revision'],'sha256'=>$post['sha256']);}
 if(!is_array($change)||($change['mode']??null)!=='restore'||($change['sitewide_impact_acknowledged']??null)!==true||($change['expected_sha256']??null)!==$inventory['theme_sha256']||($change['reviewed_sha256']??null)!==$b['inventory']['theme_sha256']||($change['affected_posts']??null)!==$affected){throw new Exception('Explicit complete rollback theme impact review required.');}
 if(anka_publication_theme($b['theme']['stylesheet'])!==$publication['retained_theme_sha256']){throw new Exception('Original retained theme changed since publication.');}
 return array('identity'=>$identity,'publication'=>$publication,'backup'=>$backup,'inventory'=>$inventory);
}
function anka_publication_restore_row($before,$desired,$revision) {
 global $wpdb;$columns=array('ID','post_author','post_date','post_date_gmt','post_content','post_title','post_excerpt','post_status','comment_status','ping_status','post_password','post_name','to_ping','pinged','post_modified','post_modified_gmt','post_content_filtered','post_parent','guid','menu_order','post_type','post_mime_type','comment_count');
 $a=array_keys($before);sort($a);$e=$columns;sort($e);if($a!==$e){throw new Exception('Unsupported rollback page schema.');}
 $keys=array('post_title','post_content','post_excerpt','post_status','post_name','post_parent');$set=array();$args=array();foreach($keys as $key){$set[]="`$key`=%s";$args[]=(string)$desired[$key];}$set[]='post_modified=%s';$args[]=current_time('mysql');$set[]='post_modified_gmt=%s';$args[]=current_time('mysql',true);
 $where=array();foreach($columns as $column){$where[]="HEX(CAST(`$column` AS CHAR))=HEX(%s)";$args[]=(string)$before[$column];}$args[]=$before['ID'];$args[]=$revision;
 $sql="UPDATE {$wpdb->posts} SET ".implode(',',$set).' WHERE '.implode(' AND ',$where)." AND COALESCE((SELECT latest FROM (SELECT post_parent,MAX(ID) AS latest FROM {$wpdb->posts} WHERE post_type='revision' AND post_status='inherit' GROUP BY post_parent) AS anka_versions WHERE post_parent=%d),ID)=%d";
 $affected=$wpdb->query($wpdb->prepare($sql,$args));$assigned=array_intersect_key($desired,array_fill_keys($keys,true));$assigned['post_modified']=$args[count($keys)];$assigned['post_modified_gmt']=$args[count($keys)+1];anka_publication_verify_row_update($affected,$before,$assigned,$revision);
 $id=(int)$before['ID'];clean_post_cache($id);$post=get_post($id);$old=new WP_Post((object)$before);wp_transition_post_status($post->post_status,$old->post_status,$post);do_action('edit_post_page',$id,$post);do_action('edit_post',$id,$post);do_action('post_updated',$id,$post,$old);do_action('save_post_page',$id,$post,true);do_action('save_post',$id,$post,true);do_action('wp_insert_post',$id,$post,true);wp_after_insert_post($post,true,$old);
 clean_post_cache($id);$post=get_post($id);foreach($keys as $key){if((string)$post->$key!==(string)$desired[$key]){throw new Exception('Rollback row changed during lifecycle.');}}return $id;
}
function anka_publication_rollback($command) {
 $identity=anka_publication_journal_identity($command);if(is_wp_error(anka_publication_permission())||$identity['kind']!=='rollback'){throw new Exception('Original rollback authority required.');}
 $prior=anka_publication_option_read('anka_publication_request_'.$identity['request_id']);if($prior!==null){if(($prior['identity']??null)!==$identity){throw new Exception('Original rollback request differs.');}return anka_publication_receipt_projection($prior,$identity['request_id']);}
 anka_publication_dispatch_window($command);$context=anka_publication_rollback_context($command);if(!anka_publication_journal_claim($command)){throw new Exception('Original rollback admission uncertain.');}
 $key='anka_publication_request_'.$identity['request_id'];$stored=anka_publication_option_read($key);$executing=$stored;$executing['phase']='executing';$executing['backup_snapshot_sha256']=$context['backup']['sha256'];$executing['publication_request_id']=$context['publication']['identity']['request_id'];$executing['before_inventory']=$context['inventory'];
 if(!anka_publication_option_cas($key,$stored,$executing)){throw new Exception('Original rollback execution admission changed.');}
 global $wpdb;$transaction=false;$ids=array();
 try{
  anka_publication_transaction_begin();$transaction=true;anka_publication_cache_clear();$context=anka_publication_rollback_context($command);$backup=$context['backup'];$publication=$context['publication'];$restored=array();
  // Reverse child-first so newly created hierarchies remain recoverable in trash.
  $pages=array_reverse($publication['completed_pages']);
  foreach($pages as $page){
   $id=$page['post_id'];$ids[]=$id;$current=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d",$id),ARRAY_A);if($current!==$page['row']){throw new Exception('Published row changed before rollback.');}
   $original=null;foreach($backup['snapshot']['posts'] as $candidate){if($candidate['page_id']===$page['page_id']){$original=$candidate;}}
   $desired=$original['operation']==='replace'?$original['before']['fields']:$current;if($original['operation']==='create'){$desired['post_status']='trash';}
   anka_publication_restore_row($current,$desired,$page['inspection']['revision']);
   foreach($page['meta'] as $meta=>$values){anka_publication_meta_cas($id,$meta,$values,$original['before']['meta'][$meta]??array());}
   $restored[]=array('page_id'=>$page['page_id'],'post_id'=>$id,'operation'=>$original['operation']==='create'?'trashed_created':'restored_original');
  }
  $theme=$backup['snapshot']['theme'];if(get_stylesheet()!==$theme['stylesheet']){switch_theme($theme['stylesheet']);anka_publication_finish_theme_switch();}
  if($theme['mods']===null){delete_option('theme_mods_'.$theme['stylesheet']);}else{update_option('theme_mods_'.$theme['stylesheet'],$theme['mods'],false);}
  if($theme['sidebars']===null){delete_option('sidebars_widgets');}else{update_option('sidebars_widgets',$theme['sidebars']);}
  anka_publication_cache_clear($ids);if(get_stylesheet()!==$theme['stylesheet']||get_template()!==$theme['template']||anka_publication_theme()!==$backup['snapshot']['inventory']['theme_sha256']){throw new Exception('Exact original theme not restored.');}
  foreach($backup['snapshot']['settings'] as $setting=>$value){if(get_option($setting)!==$value){throw new Exception('Original site settings changed during rollback.');}}
  $inventory=anka_publication_inventory();$selected=array_fill_keys($ids,true);foreach($context['inventory']['posts'] as $old){if(isset($selected[$old['post_id']])){continue;}$found=null;foreach($inventory['posts'] as $post){if($post['post_id']===$old['post_id']){$found=$post;}}if($found!==$old){throw new Exception('Unselected post changed during rollback.');}}
  $creates=count(array_filter($backup['snapshot']['posts'],static function($p){return $p['operation']==='create';}));if(count($inventory['posts'])!==count($context['inventory']['posts'])-$creates){throw new Exception('Complete rollback inventory differs.');}
  if(!anka_publication_option_cas('anka_publication_head',$publication['identity']['request_id'],$identity['request_id'])){throw new Exception('Original rollback head comparison failed.');}
  anka_publication_cache_clear($ids);$terminal=$executing;$terminal['status']='succeeded';$terminal['phase']='complete';$terminal['result']=anka_publication_inventory();$terminal['restored_pages']=$restored;
  if(!anka_publication_option_cas($key,$executing,$terminal)||!anka_publication_lock_release($identity)){throw new Exception('Original rollback settlement comparison failed.');}
  if($wpdb->query('COMMIT')===false){throw new Exception('Original rollback commit outcome uncertain.');}$transaction=false;anka_publication_cache_clear($ids);return anka_publication_receipt_projection($terminal,$identity['request_id']);
 }catch(Throwable $error){if($transaction){$wpdb->query('ROLLBACK');}anka_publication_cache_clear($ids);throw $error;}
}

add_action('rest_api_init',static function(){
 foreach(array('identity','inventory') as $route){
  register_rest_route('anka-publish/v1','/'.$route,array('methods'=>'GET','permission_callback'=>'anka_publication_permission','callback'=>static function()use($route){
   try{$data=$route==='identity'?anka_publication_identity():array('identity'=>anka_publication_identity(),'inventory'=>anka_publication_inventory());$response=new WP_REST_Response($data);$response->header('Cache-Control','private, no-store, max-age=0');return $response;}
   catch(Throwable $error){return new WP_Error('anka_publication_inspection','Exact bounded production inspection unavailable.',array('status'=>409));}
  }));
 }

 register_rest_route('anka-publish/v1','/requests/(?P<request_id>[0-9a-fA-F-]{36})',array('methods'=>'GET','permission_callback'=>'anka_publication_permission','callback'=>static function($request){
  $id=$request['request_id'];if(!anka_publication_uuid($id)){return new WP_Error('anka_publication_request','Exact original request required.',array('status'=>400));}
  $stored=anka_publication_option_read('anka_publication_request_'.$id);
  if($stored===null){$lock=anka_publication_option_read('anka_publication_active_command');if(is_array($lock)&&($lock['request_id']??null)===$id){$stored=array('identity'=>$lock,'status'=>'uncertain');}}
  $data=anka_publication_receipt_projection($stored,$id);$data['identity']=anka_publication_identity();
  if(($stored['status']??null)==='succeeded'){
   $data['state']=array('inventory'=>$stored['result']);
   if($stored['identity']['kind']==='publication'){
    $backup=anka_publication_original_backup($stored['identity']);$b=$backup['snapshot'];$posts=array();foreach($stored['completed_pages'] as $page){$operation=null;foreach($b['posts'] as $original){if($original['page_id']===$page['page_id']){$operation=$original['operation'];}}$posts[]=array('page_id'=>$page['page_id'],'post_id'=>$page['post_id'],'revision'=>$page['inspection']['revision'],'sha256'=>$page['inspection']['sha256'],'operation'=>$operation);}
    $data['rollback']=array('publication_id'=>$stored['identity']['command_id'],'scope'=>$b['scope'],'target_id'=>$b['target_id'],'site_id'=>ANKA_PUBLICATION_SITE_ID,'origin'=>untrailingslashit(home_url()),'published_head'=>$id,'published_theme_sha256'=>$stored['result']['theme_sha256'],'backup_snapshot_sha256'=>$backup['sha256'],'posts'=>$posts,'original_theme_sha256'=>$b['inventory']['theme_sha256']);
   }
  }
  $response=new WP_REST_Response($data);$response->header('Cache-Control','private, no-store, max-age=0');return $response;
 }));
 foreach(array('publish'=>'publication','rollback'=>'rollback') as $route=>$kind){register_rest_route('anka-publish/v1','/'.$route,array('methods'=>'POST','permission_callback'=>'anka_publication_permission','callback'=>static function($request)use($kind){
  try{if(strlen($request->get_body())>6291456){throw new Exception('Bounded original command required.');}$command=json_decode($request->get_body(),true,512,JSON_THROW_ON_ERROR);if(($command['kind']??null)!==$kind){throw new Exception('Exact command kind required.');}$data=$kind==='publication'?anka_publication_execute($command):anka_publication_rollback($command);$response=new WP_REST_Response($data);$response->header('Cache-Control','private, no-store, max-age=0');return $response;}
  catch(Throwable $error){return new WP_Error('anka_publication_uncertain','Original outcome requires read-only recovery; no execution is retried.',array('status'=>409));}
 }));}

});
