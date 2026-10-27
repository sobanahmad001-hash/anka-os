<?php
/**
 * Plugin Name: Anka Staging Receiver
 * Description: Authenticated immutable core-block previews on an explicitly isolated staging WordPress site. No publication or theme activation.
 * Version: 1.0.0
 */
if (!defined('ABSPATH')) { exit; }
define('ANKA_STAGE_PROTOCOL', 'anka-stage-v1');
function anka_stage_length($value) { return preg_match_all('/./us',$value,$matches); }
function anka_stage_uuid($value) { return is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value); }
function anka_stage_permission() {
 if (wp_get_environment_type() !== 'staging' || !defined('ANKA_STAGING_SITE_ID') || !anka_stage_uuid(ANKA_STAGING_SITE_ID)) { return new WP_Error('anka_stage_environment', 'Explicit staging environment and site identity required.', array('status'=>403)); }
 if (get_bloginfo('version')!=='7.1.3'||PHP_MAJOR_VERSION!==8||PHP_MINOR_VERSION!==3) { return new WP_Error('anka_stage_runtime','Reviewed WordPress 7.1.3 / PHP 8.3 runtime required.',array('status'=>403)); }
 if (!current_user_can('anka_stage_packages')) { return new WP_Error('anka_stage_capability', 'The staging receiver capability is required.', array('status'=>403)); }
 if (!preg_match('~^https://[a-z0-9.-]+$~i', untrailingslashit(home_url()))) { return new WP_Error('anka_stage_origin', 'A canonical HTTPS staging origin is required.', array('status'=>403)); }
 return true;
}
register_activation_hook(__FILE__, static function () { add_role('anka_staging_agent', 'Anka Staging Agent', array('read'=>true,'anka_stage_packages'=>true)); });
function anka_stage_identity() { return array('protocol'=>ANKA_STAGE_PROTOCOL,'wordpress_version'=>get_bloginfo('version'),'php_version'=>PHP_VERSION,'compiler'=>'anka-native-block-v1','environment'=>'staging','site_id'=>ANKA_STAGING_SITE_ID,'base_url'=>untrailingslashit(home_url()),'published'=>false); }
function anka_stage_canonical($value) {
 if (is_object($value)) { $value=get_object_vars($value); ksort($value, SORT_STRING); foreach ($value as $key=>$item) { $value[$key]=anka_stage_canonical($item); } return (object)$value; }
 if (is_array($value)) { return array_map('anka_stage_canonical',$value); }
 return $value;
}
function anka_stage_json($value) { return json_encode($value, JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_LINE_TERMINATORS); }
function anka_stage_scope($scope) {
 if (!is_object($scope)) { throw new Exception('Exact registered page scope required.'); }
 foreach (array('organization_id','project_id','engagement_id','page_id') as $key) { if (!isset($scope->$key)||!anka_stage_uuid($scope->$key)) { throw new Exception('Exact page scope required.'); } }
 $keys=array_keys(get_object_vars($scope));sort($keys);$expected=array('engagement_id','organization_id','page_id','page_key','project_id');
 if ($keys!==$expected||!is_string($scope->page_key)||trim($scope->page_key)!==$scope->page_key||strlen($scope->page_key)<1||anka_stage_length($scope->page_key)>1208||preg_match('/[\x00-\x1f\x7f]/',$scope->page_key)) { throw new Exception('Exact canonical page key required; keys are not URL paths.'); }
 return $scope;
}
function anka_stage_head_key($scope,$path=null) { return 'anka_stage_head_'.hash('sha256',implode(':',array($scope->organization_id,$scope->project_id,$scope->engagement_id,$path===null?$scope->page_id:$path))); }
function anka_stage_history($scope,$path=null) {
 if ($path!==null) { $page_id=anka_stage_read_once('anka_stage_path_'.hash('sha256',implode(':',array($scope->organization_id,$scope->project_id,$scope->engagement_id,$path))));if (!$page_id) { return array(null,array()); }$scope=clone $scope;$scope->page_id=$page_id; }
 global $wpdb; $raw=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",anka_stage_head_key($scope)));
 $list=$raw===null?array():json_decode($raw,true);
 if (!is_array($list)||count($list)>500) { throw new Exception('Bounded retained staging history required.'); }
 return array($raw,$list);
}
function anka_stage_insert_once($name,$value) {
 global $wpdb;$previous=$wpdb->suppress_errors(true);
 $result=$wpdb->query($wpdb->prepare("INSERT INTO {$wpdb->options} (option_name,option_value,autoload) VALUES (%s,%s,'no')",$name,maybe_serialize($value)));
 $wpdb->suppress_errors($previous);return $result===1;
}
function anka_stage_read_once($name) {
 global $wpdb;$value=$wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",$name));return $value===null?false:maybe_unserialize($value);
}
function anka_stage_record($id) { if (!anka_stage_uuid($id)) { return false; } return anka_stage_read_once('anka_stage_request_'.$id); }
function anka_stage_receipt($id) {
 $record=anka_stage_record($id);$identity=anka_stage_identity();
 if (!$record) { return array_merge($identity,array('request_id'=>$id,'status'=>'missing')); }
 $command=$record['command'];list($raw,$history)=anka_stage_history($command->scope);
 $head=count($history)?$history[count($history)-1]:null;
 $status=in_array($id,$history,true)?'staged':($head!==$command->expected_head?'conflict':'pending');
 return array_merge($identity,array('request_id'=>$id,'page_id'=>$command->scope->page_id,'package_sha256'=>$command->package_sha256,'status'=>$status,'preview_url'=>$status==='staged'?untrailingslashit(home_url()).'/?anka_staging_preview='.$id:null,'unresolved_paths'=>$record['unresolved_paths']));
}
function anka_stage_safe_markup($html,$rendered=true) {
 if (!is_string($html)||preg_match('~<\?(?:php|=)|<(?:script|iframe|form|object|embed|svg|math|base|meta|link|style|img|input|video|audio)\b|\bon[a-z]+\s*=|\b(?:src|href)\s*=\s*["\x27](?:https?:|//|javascript:|data:)~i',$html)) { throw new Exception('Only escaped native block markup is accepted.'); }
 preg_match_all('~</?([a-z][a-z0-9-]*)\b~i',$html,$tags);
 foreach ($tags[1] as $tag) { if (!in_array(strtolower($tag),array('a','div','h1','h2','h3','h4','h5','h6','header','footer','main','nav','section','p','span','ul','ol','li','hr'),true)) { throw new Exception('Unsupported native markup element.'); } }
 $allowed=array('core/group','core/columns','core/column','core/heading','core/paragraph','core/buttons','core/button','core/list','core/list-item','core/separator','core/spacer','core/html');if (!$rendered) { $allowed=array_merge($allowed,array('core/template-part','core/post-content','core/post-title')); }
 preg_match_all('~\b(?:src|href)\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\s>]+))~i',$html,$links,PREG_SET_ORDER);
 foreach ($links as $link) { $value=html_entity_decode(isset($link[1])&&$link[1]!==''?$link[1]:(isset($link[2])&&$link[2]!==''?$link[2]:($link[3]??'')),ENT_QUOTES|ENT_HTML5,'UTF-8');if (!preg_match('~^(?:#[a-z0-9_-]*|/(?!/)[a-z0-9/_#?=&%-]*)$~i',$value)) { throw new Exception('Only reviewed local links are accepted.'); } }
 $check=static function ($blocks) use (&$check,$allowed,$rendered) { foreach ($blocks as $block) { foreach (array_keys($block['attrs']) as $key) { if (!in_array($key,array_merge(array('tagName','anchor','className','level'),$rendered?array():array('slug','area')),true)) { throw new Exception('Unreviewed dynamic block attributes are not accepted.'); } } if ($block['blockName']===null) { if (trim($block['innerHTML'])!=='') { throw new Exception('Unwrapped markup is not accepted.'); } } elseif (!in_array($block['blockName'],$allowed,true)) { throw new Exception('Unsupported executable block.'); } if (!empty($block['innerBlocks'])) { $check($block['innerBlocks']); } } };
 $check(parse_blocks($html));
}
function anka_stage_validate($command) {
 if (!is_object($command)) { throw new Exception('Exact staging command required.'); }
 $keys=array('page_path','protocol','request_id','site_id','scope','expected_head','package_sha256','files','file_hashes','created_at','command_sha256');
 $actual=array_keys(get_object_vars($command));sort($keys);sort($actual);if ($actual!==$keys) { throw new Exception('Unsupported staging command fields.'); }
 if ($command->protocol!==ANKA_STAGE_PROTOCOL||$command->site_id!==ANKA_STAGING_SITE_ID||!anka_stage_uuid($command->request_id)||($command->expected_head!==null&&!anka_stage_uuid($command->expected_head))||!is_string($command->package_sha256)||!preg_match('/^[a-f0-9]{64}$/',$command->package_sha256)) { throw new Exception('Exact staging target and package required.'); }
 anka_stage_scope($command->scope);
 if (!is_string($command->page_path)||trim($command->page_path)!==$command->page_path||strlen($command->page_path)<1||anka_stage_length($command->page_path)>1200||preg_match('/[?#\x00-\x1f\x7f]/',$command->page_path)||array_intersect(explode('/',$command->page_path),array('.','..'))) { throw new Exception('Exact approved page path required.'); }
 if (!is_string($command->created_at)||strtotime($command->created_at)===false||strtotime($command->created_at)>time()+60||time()>=strtotime($command->created_at)+600) { throw new Exception('Original staging dispatch window expired.'); }
 $copy=clone $command;unset($copy->command_sha256);
 if (!is_string($command->command_sha256)||!hash_equals(hash('sha256',anka_stage_json(anka_stage_canonical($copy))),$command->command_sha256)) { throw new Exception('Original staging command checksum differs.'); }
 if (!is_object($command->files)||!is_object($command->file_hashes)) { throw new Exception('Exact native file manifest required.'); }
 $files=get_object_vars($command->files);$hashes=get_object_vars($command->file_hashes);$paths=array_keys($files);sort($paths);$expected=array('anka-page.json','functions.php','parts/footer.html','parts/header.html','source-manifest.json','style.css','templates/index.html','theme.json');$templates=array_values(preg_grep('~^templates/anka-(home|service|location|article|about|contact)\.html$~',$paths));
 if (count($paths)!==9||count($templates)!==1||count($hashes)!==9) { throw new Exception('Only the fixed nine native files are accepted.'); }
 $expected[]=$templates[0];sort($expected);if ($paths!==$expected) { throw new Exception('Unsafe native file path.'); }
 $size=0;foreach ($files as $path=>$text) { if (!is_string($text)||strpos($text,"\0")!==false||!isset($hashes[$path])||!is_string($hashes[$path])||!hash_equals(hash('sha256',$text),$hashes[$path])) { throw new Exception('Native file bytes or checksum differs.'); } $size+=strlen($text);if (substr($path,-5)==='.html') { anka_stage_safe_markup($text,strpos($path,'templates/')!==0); } }
 if ($size>1048576||hash('sha256',$files['functions.php'])!=='9972bb43ba67ce4d199bf7c989733e9069f7b0436706919e370a9fae6d09ec7e'||preg_match('~@import|url\s*\(|expression\s*\(|<~i',$files['style.css'].$files['theme.json'])) { throw new Exception('Unsupported native runtime or stylesheet.'); }
 $page=json_decode($files['anka-page.json']);$manifest=json_decode($files['source-manifest.json']);$theme=json_decode($files['theme.json']);
 if (!is_object($page)||!is_object($theme)||$theme->version!==3||!is_object($manifest)||$manifest->compiler!=='anka-native-block-v1'||$page->page_id!==$command->scope->page_id||$page->page_key!==$command->scope->page_key||anka_stage_json(anka_stage_canonical($manifest->scope))!==anka_stage_json(anka_stage_canonical($command->scope))) { throw new Exception('Native page and package scope differ.'); }
 anka_stage_safe_markup($page->post_content);
 return $command;
}
function anka_stage_link_bindings($command) {
 $page=json_decode($command->files->{'anka-page.json'});$html=$command->files->{'parts/header.html'}.$page->post_content.$command->files->{'parts/footer.html'};$bindings=array();$missing=array();
 preg_match_all('~href=["\x27](/(?!/)[^"\x27]*)["\x27]~i',$html,$matches);
 foreach (array_unique($matches[1]) as $href) {
  $path=trim((string)parse_url($href,PHP_URL_PATH),'/');$fragment=parse_url($href,PHP_URL_FRAGMENT);$target=null;
  if ($path===$command->page_path) { $target=$command->request_id; }
  elseif ($path!==''&&strlen($path)<=1200) { list($raw,$history)=anka_stage_history($command->scope,$path);if (count($history)) { $target=$history[count($history)-1]; } }
  if ($target) { $bindings[$href]=untrailingslashit(home_url()).'/?anka_staging_preview='.$target.($fragment?'#'.$fragment:''); } else { $missing[]=$href; }
 }
 return array($bindings,array_values(array_unique($missing)));
}
function anka_stage_deploy($request) {
 try {
  if (strlen($request->get_body())>2097152) { throw new Exception('Staging command exceeds bound.'); }
  $command=json_decode($request->get_body());anka_stage_validate($command);$id=$command->request_id;$old=anka_stage_record($id);
  if ($old) { if (!hash_equals($old['command']->command_sha256,$command->command_sha256)) { return new WP_Error('anka_stage_conflict','Original request owns different inputs.',array('status'=>409)); } return anka_stage_receipt($id); }
  $path_key='anka_stage_path_'.hash('sha256',implode(':',array($command->scope->organization_id,$command->scope->project_id,$command->scope->engagement_id,$command->page_path)));
  anka_stage_insert_once($path_key,$command->scope->page_id);
  if (anka_stage_read_once($path_key)!==$command->scope->page_id) { throw new Exception('A staging path cannot replace another canonical page.'); }
  list($bindings,$missing)=anka_stage_link_bindings($command);
  $record=array('command'=>$command,'link_bindings'=>$bindings,'unresolved_paths'=>$missing);
  if (!anka_stage_insert_once('anka_stage_request_'.$id,$record)) { return anka_stage_receipt($id); }
  $key=anka_stage_head_key($command->scope);anka_stage_insert_once($key,'[]');list($raw,$history)=anka_stage_history($command->scope);$head=count($history)?$history[count($history)-1]:null;
  if ($head!==$command->expected_head||count($history)>=500||time()>=strtotime($command->created_at)+600) { return anka_stage_receipt($id); }
  $history[]=$id;$next=anka_stage_json($history);global $wpdb;
  // One compare-and-swap appends history. No theme/page writes, deletion or automatic retry.
  $wpdb->query($wpdb->prepare("UPDATE {$wpdb->options} SET option_value=%s WHERE option_name=%s AND option_value=%s",$next,$key,$raw));wp_cache_delete($key,'options');
  return anka_stage_receipt($id);
 } catch (Exception $e) { return new WP_Error('anka_stage_validation',$e->getMessage(),array('status'=>400)); }
}
add_action('rest_api_init',static function () {
 $base=array('permission_callback'=>'anka_stage_permission');
 register_rest_route('anka-stage/v1','/identity',$base+array('methods'=>'GET','callback'=>'anka_stage_identity'));
 register_rest_route('anka-stage/v1','/head',$base+array('methods'=>'GET','callback'=>static function ($r) {
  try { $scope=(object)array('organization_id'=>$r['organization_id'],'project_id'=>$r['project_id'],'engagement_id'=>$r['engagement_id'],'page_id'=>$r['page_id'],'page_key'=>$r['page_key']);anka_stage_scope($scope);list($raw,$history)=anka_stage_history($scope);$head=count($history)?$history[count($history)-1]:null;
   if ($head) { $record=anka_stage_record($head);if (!$record||$record['command']->scope->page_id!==$scope->page_id) { throw new Exception('Registered page identity changed.'); } }
   return anka_stage_identity()+array('head'=>$head,'page_id'=>$scope->page_id);
  } catch (Exception $e) { return new WP_Error('anka_stage_scope',$e->getMessage(),array('status'=>409)); }
 }));
 register_rest_route('anka-stage/v1','/deploy',$base+array('methods'=>'POST','callback'=>'anka_stage_deploy'));
 register_rest_route('anka-stage/v1','/requests/(?P<id>[0-9a-f-]+)',$base+array('methods'=>'GET','callback'=>static function ($r) { return anka_stage_receipt($r['id']); }));
});
// Application Passwords remain scoped to the authenticated receiver/preview API.
add_filter('application_password_is_api_request',static function ($api) { return $api||isset($_GET['anka_staging_preview']); });
add_action('template_redirect',static function () {
 if (!isset($_GET['anka_staging_preview'])) { return; }
 $permission=anka_stage_permission();if (is_wp_error($permission)) { status_header(403);header('Cache-Control: private, no-store');echo 'Sign in to this staging WordPress site with the staging receiver capability.';exit; }
 $id=sanitize_text_field(wp_unslash($_GET['anka_staging_preview']));$receipt=anka_stage_receipt($id);if ($receipt['status']!=='staged') { status_header(404);header('Cache-Control: private, no-store');exit; }
 $record=anka_stage_record($id);$command=$record['command'];$files=$command->files;$page=json_decode($files->{'anka-page.json'});$theme=json_decode($files->{'theme.json'},true);
 $filter=static function ($data) use ($theme) { return new WP_Theme_JSON_Data($theme,'theme'); };
 add_filter('wp_theme_json_data_theme',$filter,99);WP_Theme_JSON_Resolver::clean_cached_data();
 $main='<!-- wp:group {"tagName":"main","anchor":"main"} --><main id="main" class="wp-block-group">'.$page->post_content.'</main><!-- /wp:group -->';
 $content=do_blocks($files->{'parts/header.html'}.$main.$files->{'parts/footer.html'});
 foreach ($record['link_bindings'] as $href=>$url) { $content=str_replace(array('href="'.$href.'"',"href='".$href."'"),'href="'.esc_url($url).'"',$content); }
 $core=file_get_contents(ABSPATH.WPINC.'/css/dist/block-library/style.min.css');$styles=$core."\n".wp_get_global_stylesheet()."\n".$files->{'style.css'};
 header('Content-Type: text/html; charset=UTF-8');header('Cache-Control: private, no-store');header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'");header('X-Content-Type-Options: nosniff');header('X-Robots-Tag: noindex, nofollow, noarchive');
 $styles=str_ireplace('</style','\\3c /style',$styles);
 echo '<!doctype html><html lang="'.esc_attr(get_bloginfo('language')).'"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="anka-staging-request" content="'.esc_attr($id).'"><meta name="anka-staging-site" content="'.esc_attr(ANKA_STAGING_SITE_ID).'"><meta name="anka-package-sha256" content="'.esc_attr($command->package_sha256).'"><meta name="description" content="'.esc_attr($page->meta_description).'"><title>'.esc_html($page->title).'</title><style>'.$styles.'</style></head><body><a class="skip" href="#main">Skip to content</a>';
 if (count($record['unresolved_paths'])) { echo '<aside role="status">Staging link review needed: '.esc_html(implode(', ',$record['unresolved_paths'])).'. No client publication has occurred.</aside>'; }
 echo $content;echo '</body></html>';exit;
},0);
