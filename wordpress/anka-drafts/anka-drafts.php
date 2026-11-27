<?php
/**
 * Plugin Name: Anka Editable Staging Drafts (candidate)
 * Description: Explicitly scoped native-block drafts. No publication or theme changes.
 * Version: 0.1.0
 */
if (!defined('ABSPATH')) { exit; }

// Deployment must supply ANKA_DRAFT_SCOPE as [organization_id, project_id, site_id]
// and ANKA_DRAFT_ADOPTIONS as [canonical-card-key => existing draft page ID].
// Dedicated WP application-password user needs only read + anka_edit_staging_drafts.
// No role/capability or adoption is provisioned automatically by this plugin.
function anka_draft_uuid($v) { return is_string($v) && preg_match('/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D', $v); }
function anka_draft_canonical($v) {
 if (is_array($v)) { if (!array_is_list($v)) { ksort($v, SORT_STRING); } foreach ($v as $k=>$x) { $v[$k]=anka_draft_canonical($x); } }
 return $v;
}
function anka_draft_hash($v) { return hash('sha256', json_encode(anka_draft_canonical($v), JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_LINE_TERMINATORS|JSON_THROW_ON_ERROR)); }
function anka_draft_permission() {
 if (wp_get_environment_type()!=='staging' || !defined('ANKA_DRAFT_SCOPE') || !defined('ANKA_DRAFT_ADOPTIONS') || !current_user_can('anka_edit_staging_drafts')) { return new WP_Error('denied','Explicit staging grant required',array('status'=>403)); }
 // This endpoint uses WP application-password authentication, never an unverified bearer.
 if (!rest_get_authenticated_app_password()) { return new WP_Error('denied','Dedicated application password required',array('status'=>403)); }
 return true;
}
function anka_draft_scope($s) {
 $keys=is_array($s)?array_keys($s):array();sort($keys);
 if ($keys!==array('card_id','card_kind','organization_id','project_id') || !in_array($s['card_kind'],array('project_task','engagement_work_item'),true)) { throw new Exception('Exact card scope required'); }
 foreach (array('organization_id','project_id','card_id') as $k) { if (!anka_draft_uuid($s[$k])) { throw new Exception('UUID scope required'); } }
 if ($s['organization_id']!==ANKA_DRAFT_SCOPE['organization_id'] || $s['project_id']!==ANKA_DRAFT_SCOPE['project_id']) { throw new Exception('Other project denied'); }
 return $s['organization_id'].':'.$s['project_id'].':'.$s['card_kind'].':'.$s['card_id'];
}
function anka_draft_install() {
 global $wpdb;
 // Separate transactional journal; unique card and request keys survive process restarts.
 $wpdb->query("CREATE TABLE IF NOT EXISTS {$wpdb->prefix}anka_draft_bindings (card_key varchar(180) NOT NULL PRIMARY KEY,post_id bigint unsigned NOT NULL UNIQUE) ENGINE=InnoDB");
 $wpdb->query("CREATE TABLE IF NOT EXISTS {$wpdb->prefix}anka_draft_receipts (request_id char(36) NOT NULL PRIMARY KEY, command_sha char(64) NOT NULL, receipt longtext NOT NULL) ENGINE=InnoDB");
}
register_activation_hook(__FILE__,'anka_draft_install');
function anka_draft_blocks($blocks) {
 if (!is_string($blocks) || strlen($blocks)>160000 || !has_blocks($blocks)) { throw new Exception('Native blocks required'); }
 $allowed=array('core/group','core/columns','core/column','core/heading','core/paragraph','core/buttons','core/button','core/separator','core/spacer','core/list','core/list-item');
 $walk=function($nodes) use (&$walk,$allowed) {
  foreach ($nodes as $b) {
   if ($b['blockName']===null && trim($b['innerHTML'])==='') { continue; }
   if (!in_array($b['blockName'],$allowed,true)) { throw new Exception('Unsupported or dynamic block'); }
   if (isset($b['attrs']['metadata']['bindings']) || isset($b['attrs']['ref']) || isset($b['attrs']['lock'])) { throw new Exception('External bindings and locks unavailable'); }
   $walk($b['innerBlocks']);
  }
 };
 $walk(parse_blocks($blocks));
 // Strictly reject rather than silently sanitizing executable or external embeds.
 if (preg_match('/<(script|iframe|object|embed|form|input|style|link|svg)\b|\son[a-z]+\s*=|javascript\s*:|data\s*:|url\s*\(/i',$blocks) || wp_kses_post($blocks)!==$blocks) { throw new Exception('Unsafe block markup'); }
}
function anka_draft_snapshot($post,$scope) {
 if (!$post || $post->post_type!=='page' || $post->post_status!=='draft') { throw new Exception('Only an existing draft page is writable'); }
 $origin=untrailingslashit(home_url());
 if (!preg_match('~^https://[a-z0-9.-]+$~D',$origin)) { throw new Exception('HTTPS canonical staging origin required'); }
 $version=anka_draft_hash(array('title'=>$post->post_title,'blocks'=>$post->post_content,'status'=>$post->post_status,'modified'=>$post->post_modified_gmt));
 return array('scope'=>$scope,'site_id'=>ANKA_DRAFT_SCOPE['site_id'],'origin'=>$origin,'post_id'=>(int)$post->ID,'status'=>'draft','title'=>$post->post_title,'blocks'=>$post->post_content,'version'=>$version,'editor_url'=>$origin.'/wp-admin/post.php?post='.$post->ID.'&action=edit');
}
function anka_draft_handle($request,$save) {
 global $wpdb;
 $transaction=false;$lock=null;$post_id=0;
 try {
  if (strlen($request->get_body())>200000) { throw new Exception('Request too large'); }
  $x=$request->get_json_params();$keys=is_array($x)?array_keys($x):array();sort($keys);
  $expected=$save?array('blocks','change_summary','expected_version','request_id','scope','title'):array('scope');
  if ($keys!==$expected) { throw new Exception('Exact request required'); }
  $card=anka_draft_scope($x['scope']);
  if ($save) {
   if (!anka_draft_uuid($x['request_id']) || !is_string($x['title']) || trim($x['title'])==='' || mb_strlen($x['title'])>240 || !is_string($x['change_summary']) || trim($x['change_summary'])==='' || mb_strlen($x['change_summary'])>1000) { throw new Exception('Bounded supplied title and change summary required'); }
   if ($x['expected_version']!==null && (!is_string($x['expected_version']) || !preg_match('/^[a-f0-9]{64}$/D',$x['expected_version']))) { throw new Exception('Current version required'); }
   anka_draft_blocks($x['blocks']);$sha=anka_draft_hash($x);
  }
  $tables=array($wpdb->posts,$wpdb->postmeta,$wpdb->prefix.'anka_draft_bindings',$wpdb->prefix.'anka_draft_receipts');
  foreach ($tables as $table) {
   $engine=$wpdb->get_var($wpdb->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s',$table));
   if ($engine!=='InnoDB') { throw new Exception('Transactional storage required'); }
  }
  $lock='anka-draft-'.hash('sha256',$card);
  // MySQL lock names are bounded to 64 bytes.
  $lock=substr($lock,0,64);
  if ((string)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,5)',$lock))!=='1') { throw new Exception('Draft busy; retain request'); }
  if ($wpdb->query('START TRANSACTION')===false) { throw new Exception('Transaction unavailable'); }$transaction=true;
  $binding=$wpdb->prefix.'anka_draft_bindings';$journal=$wpdb->prefix.'anka_draft_receipts';
  $post_id=(int)$wpdb->get_var($wpdb->prepare("SELECT post_id FROM $binding WHERE card_key=%s FOR UPDATE",$card));
  $adopt=ANKA_DRAFT_ADOPTIONS[$card]??null;
  if (!$post_id && $adopt!==null) {
   $post_id=(int)$adopt;
   $row=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d FOR UPDATE",$post_id));
   anka_draft_snapshot($row,$x['scope']);
   if ($save && $wpdb->insert($binding,array('card_key'=>$card,'post_id'=>$post_id))!==1) { throw new Exception('Draft already bound'); }
  }
  if ($save) {
   $prior=$wpdb->get_row($wpdb->prepare("SELECT command_sha,receipt FROM $journal WHERE request_id=%s",$x['request_id']));
   if ($prior) {
    if (!hash_equals($prior->command_sha,$sha)) { throw new Exception('Request payload conflict'); }
    $receipt=json_decode($prior->receipt,true,512,JSON_THROW_ON_ERROR);
    if ($receipt['post_id']!==$post_id || $receipt['scope']!==$x['scope']) { throw new Exception('Receipt scope conflict'); }
    // Return historical verified receipt even if a newer edit exists; never resave it.
    $wpdb->query('COMMIT');$transaction=false;return $receipt;
   }
  }
  if ($post_id) {
   $row=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d FOR UPDATE",$post_id));
   $before=anka_draft_snapshot($row,$x['scope']);
   if ($save && $x['expected_version']!==$before['version']) { throw new Exception('Concurrent edit: reopen current draft'); }
  } elseif (!$save || $x['expected_version']!==null) { throw new Exception('No bound draft; create requires null version'); }
  if (!$save) { $wpdb->query('COMMIT');$transaction=false;return $before; }
  $args=array('post_type'=>'page','post_status'=>'draft','post_title'=>$x['title'],'post_content'=>$x['blocks']);
  if ($post_id) { $args['ID']=$post_id; }
  $saved=wp_insert_post(wp_slash($args),true);
  if (is_wp_error($saved) || !$saved) { throw new Exception('Draft write failed'); }$post_id=(int)$saved;
  if (!$wpdb->get_var($wpdb->prepare("SELECT post_id FROM $binding WHERE card_key=%s",$card)) && $wpdb->insert($binding,array('card_key'=>$card,'post_id'=>$post_id))!==1) { throw new Exception('Binding conflict'); }
  clean_post_cache($post_id);
  $row=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d",$post_id));
  $receipt=anka_draft_snapshot($row,$x['scope']);
  if ($receipt['title']!==$x['title'] || $receipt['blocks']!==$x['blocks']) { throw new Exception('WordPress altered supplied blocks'); }
  // Use the public revision API; a no-op may reuse an exact existing revision.
  wp_save_post_revision($post_id);
  $revision=0;
  foreach (wp_get_post_revisions($post_id,array('posts_per_page'=>1)) as $r) {
   if ($r->post_title===$x['title'] && $r->post_content===$x['blocks']) { $revision=(int)$r->ID; }
  }
  if (!$revision) { throw new Exception('Verified revision unavailable'); }
  $receipt+=array('request_id'=>$x['request_id'],'command_sha256'=>$sha,'revision_id'=>(int)$revision,'change_summary'=>$x['change_summary']);
  if ($wpdb->insert($journal,array('request_id'=>$x['request_id'],'command_sha'=>$sha,'receipt'=>wp_json_encode($receipt)))!==1) { throw new Exception('Receipt conflict'); }
  if ($wpdb->query('COMMIT')===false) { throw new Exception('Uncertain commit; retain request'); }$transaction=false;
  return $receipt;
 } catch (Throwable $e) {
  if ($transaction) { $wpdb->query('ROLLBACK'); }
  if ($post_id) { clean_post_cache($post_id); }
  return new WP_Error('anka_draft_failed',$e->getMessage(),array('status'=>409));
 } finally { if ($lock!==null) { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)',$lock)); } }
}
add_action('rest_api_init',static function() {
 foreach (array('read'=>false,'save'=>true) as $path=>$save) {
  register_rest_route('anka-drafts/v1','/'.$path,array('methods'=>'POST','permission_callback'=>'anka_draft_permission','callback'=>static function($r) use ($save) { return anka_draft_handle($r,$save); }));
 }
});
