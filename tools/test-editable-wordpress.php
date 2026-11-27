<?php
// Only the disposable Docker fixture invokes this script. No hosted credentials.
define('WP_INSTALLING',true);
$_SERVER['HTTP_HOST']='staging.example.test';
require '/var/www/html/wp-load.php';
require_once ABSPATH.'wp-admin/includes/upgrade.php';
if (!is_blog_installed()) { wp_install('Synthetic draft QA','qa','qa@example.test',false,'','synthetic-local-only'); }
update_option('home','https://staging.example.test');update_option('siteurl','https://staging.example.test');
define('ANKA_DRAFT_SCOPE',array('organization_id'=>'11111111-1111-4111-8111-111111111111','project_id'=>'22222222-2222-4222-8222-222222222222','site_id'=>'33333333-3333-4333-8333-333333333333'));
$scope=array('organization_id'=>ANKA_DRAFT_SCOPE['organization_id'],'project_id'=>ANKA_DRAFT_SCOPE['project_id'],'card_kind'=>'engagement_work_item','card_id'=>'44444444-4444-4444-8444-444444444444');
$key=implode(':',array_values($scope));
define('ANKA_DRAFT_ADOPTIONS',array($key=>3156));
require '/candidate/wordpress/anka-drafts/anka-drafts.php';
anka_draft_install();
wp_set_current_user(1);
wp_get_current_user()->add_cap('anka_edit_staging_drafts');
$GLOBALS['wp_rest_application_password_uuid']='55555555-5555-4555-8555-555555555555';
$checks=0;
function check($ok,$label) { global $checks;if (!$ok) { throw new Exception('FAIL: '.$label); }$checks++;echo "PASS $label\n"; }
function call_draft($data,$save=true) { $r=new WP_REST_Request('POST','/anka-drafts/v1/'.($save?'save':'read'));$r->set_header('Content-Type','application/json');$r->set_body(wp_json_encode($data));return anka_draft_handle($r,$save); }
$blocks='<!-- wp:paragraph --><p>Synthetic fixture — preserve native blocks.</p><!-- /wp:paragraph -->';
$id=get_post(3156)?3156:wp_insert_post(array('import_id'=>3156,'post_type'=>'page','post_status'=>'draft','post_title'=>'Synthetic original','post_content'=>$blocks),true);
check($id===3156,'fixture page 3156');check(anka_draft_permission()===true,'staging dedicated permission');
$read=call_draft(array('scope'=>$scope),false);check(!is_wp_error($read)&&$read['post_id']===3156,'adopt existing page without duplicate');
$command=array('scope'=>$scope,'request_id'=>'66666666-6666-4666-8666-666666666666','expected_version'=>$read['version'],'title'=>'Synthetic revised','blocks'=>$blocks,'change_summary'=>'Synthetic title update only');
$result=call_draft($command);if (is_wp_error($result)) { throw new Exception($result->get_error_message()); }
check($result['post_id']===3156&&$result['status']==='draft'&&$result['revision_id']>0,'same page native draft and real revision');
check(get_post(3156)->post_content===$blocks,'blocks unchanged byte-for-byte');
$count=(int)$wpdb->get_var("SELECT count(*) FROM {$wpdb->posts} WHERE post_type='page'");
$revision_count=count(wp_get_post_revisions(3156));
check(call_draft($command)===$result,'same request recovers original receipt');
check(count(wp_get_post_revisions(3156))===$revision_count,'retry adds no revision');
$changed=$command;$changed['title']='Changed payload';check(is_wp_error(call_draft($changed)),'same request changed payload denied');
$stale=$command;$stale['request_id']='77777777-7777-4777-8777-777777777777';check(is_wp_error(call_draft($stale)),'stale version denied');
wp_update_post(array('ID'=>3156,'post_title'=>'Human concurrent edit'));
check(call_draft($command)===$result && get_post(3156)->post_title==='Human concurrent edit','historical retry preserves later human edit');
$wrong=$command;$wrong['scope']['project_id']='88888888-8888-4888-8888-888888888888';check(is_wp_error(call_draft($wrong)),'other project denied');
$new=$command;$new['scope']['card_id']='99999999-9999-4999-8999-999999999999';$new['request_id']='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';$new['expected_version']=null;
$created=call_draft($new);check(!is_wp_error($created)&&$created['post_id']!==3156,'new card creates one draft');
check(call_draft($new)===$created && (int)$wpdb->get_var("SELECT count(*) FROM {$wpdb->posts} WHERE post_type='page'")===$count+1,'new page retry creates no duplicate');
$bad=$new;$bad['request_id']='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';$bad['scope']['card_id']='cccccccc-cccc-4ccc-8ccc-cccccccccccc';$bad['blocks']='<!-- wp:html --><script>alert(1)</script><!-- /wp:html -->';check(is_wp_error(call_draft($bad)),'executable HTML rejected');
$rollback=$new;$rollback['request_id']='dddddddd-dddd-4ddd-8ddd-dddddddddddd';$rollback['scope']['card_id']='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
$throw=static function() { throw new Exception('Injected after write failure'); };add_action('wp_after_insert_post',$throw);
check(is_wp_error(call_draft($rollback)),'injected post-write failure fails');remove_action('wp_after_insert_post',$throw);
check((int)$wpdb->get_var("SELECT count(*) FROM {$wpdb->posts} WHERE post_type='page'")===$count+1,'transaction rolls back page and binding');
check(!is_wp_error(call_draft($rollback)),'same request succeeds after confirmed rollback');
$GLOBALS['wp_rest_application_password_uuid']=null;check(is_wp_error(anka_draft_permission()),'cookie-only receiver access denied');
echo json_encode(array('checks'=>$checks,'passed'=>true,'wordpress'=>get_bloginfo('version'),'php'=>PHP_VERSION,'production_writes'=>false))."\n";
