-- LOCAL SYNTHETIC ONLY. Loaded by scripts/verify-ret4-local.mjs, never a migration.
create or replace function private.ret4_fixture(p_name text, p_offset integer default -1, p_optin boolean default true)
returns jsonb language plpgsql set search_path='' as $$
declare
 org uuid := '44444444-4444-4444-8444-444444444444';
 machine uuid := gen_random_uuid(); owner_id uuid := gen_random_uuid(); lead uuid := gen_random_uuid();
 client uuid; agency uuid; brand uuid; project uuid; engagement uuid; catalog uuid; service uuid;
 plan public.recurring_work_plans; ver public.recurring_work_plan_versions;
 due timestamptz := date_trunc('minute',clock_timestamp()) + make_interval(mins=>p_offset);
 period date; schedule jsonb; templates jsonb;
begin
 period := (due at time zone 'UTC')::date;
 insert into auth.users(id) values(machine),(owner_id),(lead);
 insert into private.recurring_scheduler_principals(actor_id,organization_id,enabled) values(machine,org,true);
 insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status)
 values(org,owner_id,'team','contributor','content','active'),(org,lead,'team','project_owner','content','active');
 insert into public.clients(name,company,owner_id,organization_id) values(p_name,'RET4 synthetic',lead,org) returning id into client;
 insert into public.agency_clients(organization_id,legacy_client_id,canonical_client_id,name,owner_id,created_by)
 values(org,client,client,p_name,lead,owner_id) returning id into agency;
 insert into public.brands(organization_id,client_id,name,is_default,created_by) values(org,agency,p_name,true,owner_id) returning id into brand;
 insert into public.projects(name,department_id,status,owner_id,organization_id,client_id,engagement_type)
 values(p_name,'content','active',lead,org,client,'retainer') returning id into project;
 insert into public.engagements(organization_id,client_id,brand_id,legacy_project_id,project_id,name,engagement_type,status,lead_owner_id,created_by)
 values(org,agency,brand,project,project,p_name,'retainer','active',lead,owner_id) returning id into engagement;
 insert into public.service_catalog(organization_id,department_id,slug,name) values(org,'content','ret4_'||replace(machine::text,'-',''),p_name) returning id into catalog;
 insert into public.engagement_services(organization_id,engagement_id,service_id,owner_id,status,activated_by)
 values(org,engagement,catalog,owner_id,'active',owner_id) returning id into service;
 templates := jsonb_build_array(
 jsonb_build_object('template_key','first_item','title','RET4 first','default_assignee_id',owner_id,'start_offset_days',0,'due_offset_days',2,'position',0),
 jsonb_build_object('template_key','second_item','title','RET4 second','default_assignee_id',lead,'start_offset_days',1,'due_offset_days',3,'position',1));
 schedule := case when p_optin then jsonb_build_object('scheduler',jsonb_build_object('enabled',true,'local_time',to_char(due at time zone 'UTC','HH24:MI'),'policy','ret4_v1')) else '{}'::jsonb end;
 plan := public.create_recurring_work_plan(service,p_name,'Synthetic verifier','weekly','UTC',period,null,schedule,templates,owner_id);
 select * into strict ver from public.recurring_work_plan_versions where plan_id=plan.id;
 -- Historical approvals only in this synthetic fixture; production approvals remain immutable.
 insert into public.recurring_work_plan_version_approvals(organization_id,plan_id,plan_version_id,approved_by,approved_at)
 values(org,plan.id,ver.id,lead,due-interval '1 hour');
 update public.recurring_work_plans set status='approved',approved_version_id=ver.id where id=plan.id;
 perform public.transition_recurring_work_plan(plan.id,'active','','',lead);
 update public.recurring_work_plans set status_changed_at=due-interval '30 minutes' where id=plan.id;
 return jsonb_build_object('org',org,'machine',machine,'owner',owner_id,'lead',lead,'project',project,'engagement',engagement,'catalog',catalog,'service',service,'plan',plan.id,'version',ver.id,'period',period,'due',due,'templates',templates,'schedule',schedule);
end;
$$;
revoke all on function private.ret4_fixture(text,integer,boolean) from public,anon,authenticated,service_role;
