-- Rollback-only verification for MB04B.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

create temporary table mb04b_checks(name text primary key, passed boolean not null) on commit drop;
insert into mb04b_checks values
('schema_and_rls',false),('service_only_functions',false),('planning_budget_saved',false),
('budget_pair_required',false),('nonfinite_budget_denied',false),('duplicate_exact_copy',false),
('duplicate_replay_same_result',false),('duplicate_key_conflict_denied',false),
('review_exact_plan_and_brief_version',false),('review_pending_not_approved',false),
('review_replay_same_result',false),('review_key_conflict_denied',false),
('later_plan_preserves_submission',false),('stale_submission_denied',false),
('null_department_denied',false),('inactive_service_replay_denied',false),
('cross_organization_denied',false),('generic_two_approver_unchanged',false),
('no_execution_side_effects',false);

update mb04b_checks set passed=
  to_regclass('public.marketing_campaign_plan_budgets') is not null
  and to_regclass('public.marketing_campaign_plan_duplicate_requests') is not null
  and to_regclass('public.marketing_campaign_plan_review_submissions') is not null
  and (select relrowsecurity from pg_class where oid='public.marketing_campaign_plan_budgets'::regclass)
  and (select relrowsecurity from pg_class where oid='public.marketing_campaign_plan_duplicate_requests'::regclass)
  and (select relrowsecurity from pg_class where oid='public.marketing_campaign_plan_review_submissions'::regclass)
where name='schema_and_rls';

update mb04b_checks set passed=
  not has_function_privilege('anon','public.duplicate_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid)','execute')
  and not has_function_privilege('authenticated','public.duplicate_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid)','execute')
  and has_function_privilege('service_role','public.duplicate_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid)','execute')
  and not has_function_privilege('authenticated','public.submit_marketing_campaign_plan_review(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid[],uuid,text,uuid)','execute')
  and has_function_privilege('service_role','public.submit_marketing_campaign_plan_review(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid[],uuid,text,uuid)','execute')
  and not (select prosecdef from pg_proc where oid='public.submit_marketing_campaign_plan_review(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid[],uuid,text,uuid)'::regprocedure)
where name='service_only_functions';

do $$
declare
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); owner uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid(); null_dept uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid(); brand uuid:=gen_random_uuid(); engagement uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid(); campaign uuid:=gen_random_uuid();
  base jsonb; duplicate_one jsonb; duplicate_two jsonb; submission_one jsonb; submission_two jsonb; later jsonb;
  base_id uuid; duplicate_id uuid; later_id uuid; duplicate_key uuid:=gen_random_uuid(); review_key uuid:=gen_random_uuid(); rejected boolean; work_before bigint;
begin
  insert into auth.users(id) values(owner),(manager),(null_dept),(outsider);
  insert into public.organizations(id,name,slug,status) values(org,'MB04B verifier','mb04b-'||replace(org::text,'-',''),'active'),(other_org,'MB04B other','mb04b-other-'||replace(other_org::text,'-',''),'active');
  insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values
    (org,owner,'team','system_owner',null,'active'),(org,manager,'team','department_manager','marketing','active'),
    (org,null_dept,'team','contributor',null,'active'),(other_org,outsider,'team','system_owner',null,'active');
  insert into public.agency_clients(id,organization_id,name,created_by) values(client_id,org,'MB04B client',owner);
  insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values(brand,org,client_id,'MB04B brand',true,owner);
  insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by) values(engagement,org,client_id,brand,'MB04B engagement','active',owner);
  insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values(service_id,org,'marketing','mb04b_verifier','MB04B verifier',true);
  insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values(org,engagement,service_id,'active',owner);
  insert into public.marketing_campaigns(id,organization_id,engagement_id,brand_id,name,planned_channels,planned_budget,currency_code,created_by,updated_by) values(campaign,org,engagement,brand,'MB04B campaign',array['email'],777,'GBP',owner,owner);
  select count(*) into work_before from public.work_items;

  select public.save_marketing_campaign_plan_draft_with_budget(org,engagement,campaign,null,'Plan one','Qualified demand',array['Email'],date '2026-09-13',date '2026-10-13','Audience','https://example.com',1250.50,'EUR',null,null,jsonb_build_array(jsonb_build_object('format','Static image','intended_placement','Homepage','due_date','2026-09-20')),'initial',null,owner) into base;
  base_id:=(base->>'id')::uuid;
  update mb04b_checks set passed=(base->>'planned_budget')::numeric=1250.50 and base->>'currency_code'='EUR' and exists(select 1 from public.marketing_campaign_plan_budgets where plan_version_id=base_id and planned_budget=1250.50 and currency_code='EUR') where name='planning_budget_saved';

  rejected:=false; begin perform public.save_marketing_campaign_plan_draft_with_budget(org,engagement,campaign,base_id,'Invalid','x',array['Email'],null,null,'','',10,null,null,null,'[]','',null,owner); exception when others then rejected:=sqlerrm like '%provided together%'; end;
  update mb04b_checks set passed=rejected and (select count(*)=1 from public.marketing_campaign_plan_versions where campaign_id=campaign) where name='budget_pair_required';
  rejected:=false; begin perform public.save_marketing_campaign_plan_draft_with_budget(org,engagement,campaign,base_id,'Invalid','x',array['Email'],null,null,'','', 'Infinity'::numeric,'USD',null,null,'[]','',null,owner); exception when others then rejected:=sqlerrm like '%finite%'; end;
  update mb04b_checks set passed=rejected and (select count(*)=1 from public.marketing_campaign_plan_versions where campaign_id=campaign) where name='nonfinite_budget_denied';

  select public.duplicate_marketing_campaign_plan_draft(org,engagement,campaign,base_id,base_id,duplicate_key,repeat('a',64),owner) into duplicate_one;
  duplicate_id:=(duplicate_one->>'id')::uuid;
  select public.duplicate_marketing_campaign_plan_draft(org,engagement,campaign,base_id,base_id,duplicate_key,repeat('9',64),owner) into duplicate_two;
  update mb04b_checks set passed=(duplicate_one->>'source_plan_version_id')::uuid=base_id and (duplicate_one->>'planned_budget')::numeric=1250.50 and exists(select 1 from public.marketing_campaign_plan_creative_requirements where plan_version_id=duplicate_id and format='Static image') where name='duplicate_exact_copy';
  update mb04b_checks set passed=(duplicate_two->>'id')::uuid=duplicate_id and (duplicate_two->>'replayed')::boolean and (select count(*)=2 from public.marketing_campaign_plan_versions where campaign_id=campaign) where name='duplicate_replay_same_result';
  rejected:=false; begin perform public.duplicate_marketing_campaign_plan_draft(org,engagement,campaign,base_id,duplicate_id,duplicate_key,repeat('9',64),owner); exception when unique_violation then rejected:=true; end;
  update mb04b_checks set passed=rejected and (select count(*)=2 from public.marketing_campaign_plan_versions where campaign_id=campaign) where name='duplicate_key_conflict_denied';

  select public.submit_marketing_campaign_plan_review(org,engagement,campaign,duplicate_id,duplicate_id,null,'parallel',array[manager],review_key,repeat('c',64),owner) into submission_one;
  select public.submit_marketing_campaign_plan_review(org,engagement,campaign,duplicate_id,duplicate_id,null,'parallel',array[manager],review_key,repeat('9',64),owner) into submission_two;
  update mb04b_checks set passed=exists(select 1 from public.marketing_campaign_plan_review_submissions s join public.artifact_versions av on av.id=s.artifact_version_id where s.id=(submission_one->>'id')::uuid and s.plan_version_id=duplicate_id and av.content#>>'{campaign_plan_source,plan_version_id}'=duplicate_id::text and av.content#>>'{campaign_plan_source,currency_code}'='EUR') where name='review_exact_plan_and_brief_version';
  update mb04b_checks set passed=exists(select 1 from public.artifact_approval_requests r join public.marketing_campaign_plan_review_submissions s on s.approval_request_id=r.id where s.id=(submission_one->>'id')::uuid and r.status='pending') and exists(select 1 from public.artifact_approval_signoffs so join public.marketing_campaign_plan_review_submissions s on s.approval_request_id=so.request_id where s.id=(submission_one->>'id')::uuid and so.required_approver_id=manager) and not exists(select 1 from public.artifact_approvals a join public.marketing_campaign_plan_review_submissions s on s.artifact_version_id=a.artifact_version_id where s.id=(submission_one->>'id')::uuid) where name='review_pending_not_approved';
  update mb04b_checks set passed=(submission_two->>'id')::uuid=(submission_one->>'id')::uuid and (submission_two->>'replayed')::boolean and (select count(*)=1 from public.marketing_campaign_plan_review_submissions where campaign_id=campaign) where name='review_replay_same_result';
  rejected:=false; begin perform public.submit_marketing_campaign_plan_review(org,engagement,campaign,duplicate_id,duplicate_id,null,'sequential',array[manager],review_key,repeat('9',64),owner); exception when unique_violation then rejected:=true; end;
  update mb04b_checks set passed=rejected where name='review_key_conflict_denied';

  select public.save_marketing_campaign_plan_draft_with_budget(org,engagement,campaign,duplicate_id,'Plan three','Later draft',array['Search'],null,null,'','',null,null,null,null,'[]','later',null,owner) into later;
  later_id:=(later->>'id')::uuid;
  update mb04b_checks set passed=exists(select 1 from public.marketing_campaign_plan_review_submissions s join public.artifact_versions av on av.id=s.artifact_version_id where s.plan_version_id=duplicate_id and av.content#>>'{campaign_plan_source,plan_version_id}'=duplicate_id::text) and not exists(select 1 from public.artifact_approvals where artifact_version_id=later_id) where name='later_plan_preserves_submission';
  rejected:=false; begin perform public.submit_marketing_campaign_plan_review(org,engagement,campaign,duplicate_id,later_id,(select artifact_version_id from public.marketing_campaign_plan_review_submissions where id=(submission_one->>'id')::uuid),'parallel',array[manager],gen_random_uuid(),repeat('e',64),owner); exception when serialization_failure then rejected:=true; end;
  update mb04b_checks set passed=rejected where name='stale_submission_denied';

  rejected:=false; begin perform public.duplicate_marketing_campaign_plan_draft(org,engagement,campaign,base_id,later_id,gen_random_uuid(),repeat('f',64),null_dept); exception when others then rejected:=sqlerrm like '%Marketing department access required%'; end;
  update mb04b_checks set passed=rejected where name='null_department_denied';
  update public.service_catalog set is_active=false where id=service_id and organization_id=org;
  rejected:=false; begin perform public.duplicate_marketing_campaign_plan_draft(org,engagement,campaign,base_id,base_id,duplicate_key,repeat('a',64),owner); exception when others then rejected:=sqlerrm like '%Active Marketing engagement required%'; end;
  update mb04b_checks set passed=rejected where name='inactive_service_replay_denied';
  update public.service_catalog set is_active=true where id=service_id and organization_id=org;
  rejected:=false; begin perform public.duplicate_marketing_campaign_plan_draft(other_org,engagement,campaign,base_id,later_id,gen_random_uuid(),repeat('1',64),outsider); exception when others then rejected:=true; end;
  update mb04b_checks set passed=rejected where name='cross_organization_denied';

  update mb04b_checks set passed=position('cardinality(p_required_approver_ids) < 2' in pg_get_functiondef('public.create_artifact_approval_request(uuid,text,uuid[],uuid)'::regprocedure))>0 where name='generic_two_approver_unchanged';
  update mb04b_checks set passed=(select count(*) from public.work_items)=work_before and not exists(select 1 from public.artifact_approvals a join public.marketing_campaign_plan_review_submissions s on s.artifact_version_id=a.artifact_version_id where s.campaign_id=campaign) and (select planned_budget=777 and currency_code='GBP' from public.marketing_campaigns where id=campaign) where name='no_execution_side_effects';
end $$;

select jsonb_object_agg(name,passed order by name) as mb04b_verification from mb04b_checks;
do $$ declare failed text; begin select string_agg(name,', ' order by name) into failed from mb04b_checks where not passed; if failed is not null then raise exception 'MB04B verification failed: %',failed; end if; end $$;
select 'PASS' as mb04b_final_result;
rollback;
