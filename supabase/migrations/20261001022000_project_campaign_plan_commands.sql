-- Project campaign draft commands reuse the canonical immutable plan writer.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$declare r record;begin
 for r in select * from (values
 ('public.save_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,uuid,uuid,jsonb,text,uuid,uuid)','476a4ba06e09196b0da916f81f71a3ef'),
 ('public.save_marketing_campaign_plan_draft_with_budget(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,numeric,text,uuid,uuid,jsonb,text,uuid,uuid)','7f61ffd57bf14cb10fcbe71940af1005'),
 ('private.assert_mb04b_campaign_context(uuid,uuid,uuid,uuid)','64ceeea41d3f7d4459514c51130659ab'),
 ('private.lock_mb04b_campaign_context(uuid,uuid,uuid,uuid,uuid[])','4e422f8c730ee19d4181750e32da42ca'),
 ('private.campaign_asset_write_authorized(uuid,uuid)','0e5d5adb9725d9c984d6ba8ddb5f41eb'),
 ('private.website_read_authorized(uuid,uuid)','339ae8372edf7afa3115655da7a2255f'),
 ('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)','033f6c233c35b8c2641716b861a63cd2'),
 ('private.website_valid_url(text)','fcb30f53dec1b0d8b2b66edb196eeede'),
 ('private.reject_pipeline_template_mutation()','8c3f3ac7f15e91b22826b54ac3b3c2cc')) v(signature,hash)
 loop if md5(replace(pg_get_functiondef(r.signature::regprocedure),chr(13),'')) is distinct from r.hash then raise exception 'Exact campaign plan prerequisite changed: %',r.signature using errcode='55000';end if;end loop;
 if (select md5(prosrc) from pg_proc where oid='private.p7_assignment_authority(uuid,uuid,text,uuid)'::regprocedure) is distinct from '0e2dbef44ce9c734f375116a4169e394' then raise exception 'Exact Marketing authority changed' using errcode='55000';end if;
end $$;
create table public.project_campaign_plan_links(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),project_id uuid not null references public.projects(id),
 engagement_id uuid not null references public.engagements(id),campaign_id uuid not null references public.marketing_campaigns(id),brand_id uuid not null references public.brands(id),
 plan_version_id uuid not null unique references public.marketing_campaign_plan_versions(id),marketing_service_id uuid not null references public.engagement_services(id),owner_id uuid references auth.users(id),
 strategy_version_ids uuid[] not null check(cardinality(strategy_version_ids)<=20 and array_position(strategy_version_ids,null) is null),
 scope_snapshot jsonb not null check(jsonb_typeof(scope_snapshot)='object' and octet_length(scope_snapshot::text)<=65536),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(id,organization_id)
);
create index campaign_plan_link_scope_idx on public.project_campaign_plan_links(organization_id,project_id,campaign_id,created_at desc,id);
create index campaign_plan_link_project_idx on public.project_campaign_plan_links(project_id);
create index campaign_plan_link_campaign_idx on public.project_campaign_plan_links(campaign_id);
create index campaign_plan_link_creator_idx on public.project_campaign_plan_links(created_by);
create index campaign_plan_link_engagement_idx on public.project_campaign_plan_links(engagement_id);
create index campaign_plan_link_service_idx on public.project_campaign_plan_links(marketing_service_id);
create index campaign_plan_link_owner_idx on public.project_campaign_plan_links(owner_id);
create index campaign_plan_link_brand_idx on public.project_campaign_plan_links(brand_id);
create table public.project_campaign_plan_commands(
 organization_id uuid not null references public.organizations(id),request_id uuid not null,project_id uuid not null references public.projects(id),campaign_id uuid not null references public.marketing_campaigns(id),
 actor_id uuid not null references auth.users(id),payload_checksum text not null check(payload_checksum~'^[0-9a-f]{64}$'),
 receipt jsonb not null check(jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=131072),created_at timestamptz not null default clock_timestamp(),primary key(organization_id,request_id)
);
create index campaign_plan_command_scope_idx on public.project_campaign_plan_commands(organization_id,project_id,campaign_id);
create index campaign_plan_command_project_idx on public.project_campaign_plan_commands(project_id);
create index campaign_plan_command_campaign_idx on public.project_campaign_plan_commands(campaign_id);
create index campaign_plan_command_actor_idx on public.project_campaign_plan_commands(actor_id);
do $$declare t text;begin foreach t in array array['project_campaign_plan_links','project_campaign_plan_commands'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger %I before update or delete on public.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);
 end loop;end $$;
create function private.campaign_plan_input(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare k text;r jsonb;d date;channels text[];ids uuid[];begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>32768 or (select count(*) from jsonb_object_keys(p_input))<>17 or not p_input ?& array['title','objective','channels','starts_on','ends_on','audience','landing_page_url','planned_budget','currency_code','approved_message_version_id','measurement_plan_version_id','creative_requirements','change_summary','source_plan_version_id','marketing_service_id','owner_id','strategy_version_ids'] then raise exception 'Exact bounded campaign draft fields required' using errcode='22023';end if;
 foreach k in array array['title','objective','audience','change_summary'] loop if jsonb_typeof(p_input->k)<>'string' then raise exception 'Campaign text must be strings' using errcode='22023';end if;end loop;
 if length(trim(p_input->>'title')) not between 1 and 180 or length(trim(p_input->>'objective')) not between 1 and 4000 or length(p_input->>'audience')>4000 or length(p_input->>'change_summary')>1000 then raise exception 'Campaign text outside canonical bounds' using errcode='22023';end if;
 foreach k in array array['starts_on','ends_on'] loop
 if p_input->k<>'null'::jsonb then if jsonb_typeof(p_input->k)<>'string' or p_input->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Explicit ISO date or unknown required' using errcode='22023';end if;d:=(p_input->>k)::date;if not isfinite(d) then raise exception 'Finite campaign date required' using errcode='22023';end if;end if;end loop;
 if (p_input->>'ends_on')::date<(p_input->>'starts_on')::date then raise exception 'End date precedes start' using errcode='22023';end if;
 if jsonb_typeof(p_input->'channels')<>'array' or jsonb_array_length(p_input->'channels') not between 1 and 20 or exists(select 1 from jsonb_array_elements(p_input->'channels') v where jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and 120) then raise exception 'Bounded named channels required' using errcode='22023';end if;
 select array_agg(value) into channels from jsonb_array_elements_text(p_input->'channels');if cardinality(channels)<>(select count(distinct trim(value)) from unnest(channels) value) then raise exception 'Duplicate channels require reconciliation' using errcode='22023';end if;
 if p_input->'landing_page_url'<>'null'::jsonb and (jsonb_typeof(p_input->'landing_page_url')<>'string' or not private.website_valid_url(p_input->>'landing_page_url') or length(p_input->>'landing_page_url')>2000) then raise exception 'Safe canonical landing URL required' using errcode='22023';end if;
 if (p_input->'planned_budget'='null'::jsonb) is distinct from (p_input->'currency_code'='null'::jsonb) or (p_input->'planned_budget'<>'null'::jsonb and (jsonb_typeof(p_input->'planned_budget')<>'number' or (p_input->>'planned_budget')::numeric<0 or jsonb_typeof(p_input->'currency_code')<>'string' or p_input->>'currency_code' !~ '^[A-Z]{3}$')) then raise exception 'Finite nonnegative planning budget and currency required together' using errcode='22023';end if;
 foreach k in array array['approved_message_version_id','measurement_plan_version_id','source_plan_version_id','owner_id','marketing_service_id'] loop
 if p_input->k<>'null'::jsonb then if jsonb_typeof(p_input->k)<>'string' then raise exception 'Exact UUID or unknown required' using errcode='22023';end if;perform (p_input->>k)::uuid;end if;end loop;
 if p_input->'marketing_service_id'='null'::jsonb then raise exception 'Exact Marketing service required' using errcode='22023';end if;
 if jsonb_typeof(p_input->'strategy_version_ids')<>'array' or jsonb_array_length(p_input->'strategy_version_ids')>20 or exists(select 1 from jsonb_array_elements(p_input->'strategy_version_ids') v where jsonb_typeof(v)<>'string') then raise exception 'Bounded exact strategy versions required' using errcode='22023';end if;
 select coalesce(array_agg(value::uuid),array[]::uuid[]) into ids from jsonb_array_elements_text(p_input->'strategy_version_ids');if cardinality(ids)<>(select count(distinct value) from unnest(ids) value) then raise exception 'Duplicate strategy reference' using errcode='22023';end if;
 if jsonb_typeof(p_input->'creative_requirements')<>'array' or jsonb_array_length(p_input->'creative_requirements')>100 then raise exception 'Canonical creative requirements required' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_input->'creative_requirements') loop
 if jsonb_typeof(r)<>'object' or (select count(*) from jsonb_object_keys(r))<>4 or not r ?& array['format','intended_placement','message_version_id','due_date'] or jsonb_typeof(r->'format')<>'string' or jsonb_typeof(r->'intended_placement')<>'string' or length(trim(r->>'format')) not between 1 and 240 or length(trim(r->>'intended_placement')) not between 1 and 500 then raise exception 'Exact creative requirement fields required' using errcode='22023';end if;
 if r->'message_version_id'<>'null'::jsonb then if jsonb_typeof(r->'message_version_id')<>'string' then raise exception 'Exact creative message UUID required' using errcode='22023';end if;perform (r->>'message_version_id')::uuid;end if;
 if r->'due_date'<>'null'::jsonb then if jsonb_typeof(r->'due_date')<>'string' or r->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'ISO creative due date required' using errcode='22023';end if;d:=(r->>'due_date')::date;end if;
 end loop;return p_input;
end $$;
create function private.campaign_plan_source(p_org uuid,p_project uuid,p_engagement uuid,p_brand uuid,p_version uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$declare a public.artifacts%rowtype;v public.artifact_versions%rowtype;ref jsonb;begin
 select ar.* into a from public.artifact_versions av join public.artifacts ar on ar.id=av.artifact_id and ar.organization_id=av.organization_id where av.id=p_version and av.organization_id=p_org and ar.project_id=p_project and ar.engagement_id=p_engagement and ar.brand_id=p_brand;
 if not found or not (p_kind='message' and a.artifact_type in ('campaign_messaging','scripts') or p_kind='measurement' and a.artifact_type='measurement_plan' or p_kind='strategy' and a.artifact_type in ('audience','channel_strategy','keyword_strategy')) then raise exception 'Exact same-project campaign source required' using errcode='42501';end if;
 ref:=private.require_pipeline_approved_artifact(p_org,p_project,p_version,a.artifact_type,null);
 select * into v from public.artifact_versions where id=p_version and organization_id=p_org;
 if v.content_checksum is distinct from encode(sha256(convert_to(v.content::text,'UTF8')),'hex') then raise exception 'Canonical campaign source checksum changed' using errcode='55000';end if;
 return jsonb_build_object('version_id',v.id,'artifact_id',a.id,'artifact_type',a.artifact_type,'title',a.title,'version_number',v.version_number,'content_checksum',v.content_checksum,'approval',ref);
end $$;
create function private.campaign_plan_review(p_org uuid,p_project uuid,p_engagement uuid,p_campaign uuid,p_expected uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.engagements%rowtype;c public.marketing_campaigns%rowtype;service record;owner record;latest uuid;source uuid;kind text;sources jsonb:='[]';refs jsonb;input jsonb;snapshot jsonb;reasons jsonb:='[]';result jsonb;
begin
 input:=private.campaign_plan_input(p_input);perform private.campaign_asset_write_authorized(p_org,p_project);
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_campaign::text||':campaign_plan',0));
 perform private.lock_mb04b_campaign_context(p_org,p_engagement,p_campaign,auth.uid());
 select * into e from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project and status in ('planning','active') for share;
 if not found then raise exception 'Active exact project engagement required' using errcode='42501';end if;
 select * into c from public.marketing_campaigns where id=p_campaign and organization_id=p_org and engagement_id=e.id and brand_id=e.brand_id and status<>'cancelled' for share;
 if not found then raise exception 'Exact current campaign required' using errcode='42501';end if;
 select id into latest from public.marketing_campaign_plan_versions where organization_id=p_org and campaign_id=p_campaign order by version_number desc limit 1;
 if latest is distinct from p_expected then raise exception 'Canonical campaign plan changed; reload before review' using errcode='40001';end if;
 if input->'source_plan_version_id'<>'null'::jsonb and not exists(select 1 from public.marketing_campaign_plan_versions where id=(input->>'source_plan_version_id')::uuid and organization_id=p_org and campaign_id=p_campaign and engagement_id=e.id and brand_id=e.brand_id) then raise exception 'Exact same-campaign source plan required' using errcode='42501';end if;
 select es.id,es.service_id,es.status,es.owner_id,es.target_date,es.activated_by,es.activated_at,sc.name,sc.department_id,sc.is_active into service from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id where es.id=(input->>'marketing_service_id')::uuid and es.organization_id=p_org and es.engagement_id=e.id and es.status='active' and sc.is_active and sc.department_id='marketing' for share of es,sc;
 if not found then raise exception 'Exact current Marketing service required' using errcode='42501';end if;
 if input->'owner_id'<>'null'::jsonb then
 select id,user_id,role,department_id,status,member_kind into owner from public.organization_memberships where organization_id=p_org and user_id=(input->>'owner_id')::uuid and member_kind='team' and status='active' for share;
 if not found then raise exception 'Existing active Team campaign owner required' using errcode='42501';end if;
 else reasons:=reasons||jsonb_build_array('campaign_owner_missing');end if;
 -- Lock exact source versions in one stable order; no latest artifact selection or copied content.
 for source,kind in select distinct version_id,source_kind from (
 select (input->>'approved_message_version_id')::uuid version_id,'message' source_kind union all
 select (input->>'measurement_plan_version_id')::uuid,'measurement' union all
 select value::uuid,'strategy' from jsonb_array_elements_text(input->'strategy_version_ids') union all
 select (value->>'message_version_id')::uuid,'message' from jsonb_array_elements(input->'creative_requirements')) q where version_id is not null order by version_id,source_kind loop
 refs:=private.campaign_plan_source(p_org,p_project,e.id,e.brand_id,source,kind);sources:=sources||jsonb_build_array(refs||jsonb_build_object('usage',kind));end loop;
 if input->'approved_message_version_id'='null'::jsonb then reasons:=reasons||jsonb_build_array('approved_message_missing');end if;
 if input->'measurement_plan_version_id'='null'::jsonb then reasons:=reasons||jsonb_build_array('approved_measurement_plan_missing');end if;
 if jsonb_array_length(input->'strategy_version_ids')=0 then reasons:=reasons||jsonb_build_array('approved_audience_strategy_missing');end if;
 if input->'starts_on'='null'::jsonb or input->'ends_on'='null'::jsonb then reasons:=reasons||jsonb_build_array('campaign_dates_incomplete');end if;
 snapshot:=jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',e.id,'campaign_id',c.id,'brand_id',e.brand_id,'actor_id',auth.uid(),'expected_latest_version_id',p_expected,'campaign_status',c.status,'service',to_jsonb(service),'owner',case when input->'owner_id'='null'::jsonb then null else to_jsonb(owner) end,'sources',sources,'blocking_reasons',reasons,'approval_state','draft','ready_to_publish',false,'external_write_authorized',false);
 if octet_length(snapshot::text)>65536 then raise exception 'Campaign source review exceeds bounded response' using errcode='22023';end if;
 result:=jsonb_build_object('input',input,'snapshot',snapshot);
 return result||jsonb_build_object('review_checksum',encode(sha256(convert_to(result::text,'UTF8')),'hex'),'zero_write',true);
end $$;
create function public.preview_project_campaign_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_campaign_id uuid,p_expected_latest_version_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin return private.campaign_plan_review(p_organization_id,p_project_id,p_engagement_id,p_campaign_id,p_expected_latest_version_id,p_input);end $$;
create function public.confirm_project_campaign_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_campaign_id uuid,p_expected_latest_version_id uuid,p_input jsonb,p_review_checksum text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.project_campaign_plan_commands%rowtype;payload text;review jsonb;saved jsonb;link public.project_campaign_plan_links%rowtype;receipt jsonb;begin
 if p_request_id is null or p_review_checksum is null or p_review_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Original UUID and exact review required' using errcode='22023';end if;
 perform private.campaign_plan_input(p_input);perform private.campaign_asset_write_authorized(p_organization_id,p_project_id);
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':campaign-plan-command:'||p_request_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'campaign_id',p_campaign_id,'expected_latest_version_id',p_expected_latest_version_id,'input',p_input,'review_checksum',p_review_checksum)::text,'UTF8')),'hex');
 select * into prior from public.project_campaign_plan_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_campaign_id::text||':campaign_plan',0));
 perform private.lock_mb04b_campaign_context(p_organization_id,p_engagement_id,p_campaign_id,auth.uid());
 if prior.actor_id is distinct from auth.uid() or prior.project_id is distinct from p_project_id or prior.campaign_id is distinct from p_campaign_id or prior.payload_checksum is distinct from payload then raise exception 'Original campaign operation identity/payload conflict' using errcode='23505';end if;
 return prior.receipt;end if;
 review:=private.campaign_plan_review(p_organization_id,p_project_id,p_engagement_id,p_campaign_id,p_expected_latest_version_id,p_input);
 if review->>'review_checksum' is distinct from p_review_checksum then raise exception 'Campaign plan review changed; review again' using errcode='40001';end if;
 saved:=public.save_marketing_campaign_plan_draft_with_budget(p_organization_id,p_engagement_id,p_campaign_id,p_expected_latest_version_id,
 p_input->>'title',p_input->>'objective',array(select jsonb_array_elements_text(p_input->'channels')),(p_input->>'starts_on')::date,(p_input->>'ends_on')::date,
 p_input->>'audience',p_input->>'landing_page_url',(p_input->>'planned_budget')::numeric,p_input->>'currency_code',(p_input->>'approved_message_version_id')::uuid,(p_input->>'measurement_plan_version_id')::uuid,p_input->'creative_requirements',p_input->>'change_summary',(p_input->>'source_plan_version_id')::uuid,auth.uid());
 insert into public.project_campaign_plan_links(organization_id,project_id,engagement_id,campaign_id,brand_id,plan_version_id,marketing_service_id,owner_id,strategy_version_ids,scope_snapshot,created_by)
 values(p_organization_id,p_project_id,p_engagement_id,p_campaign_id,(saved->>'brand_id')::uuid,(saved->>'id')::uuid,(p_input->>'marketing_service_id')::uuid,(p_input->>'owner_id')::uuid,array(select value::uuid from jsonb_array_elements_text(p_input->'strategy_version_ids')),review->'snapshot',auth.uid()) returning * into link;
 receipt:=jsonb_build_object('request_id',p_request_id,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'campaign_id',p_campaign_id,'actor_id',auth.uid(),'plan',saved,'links',to_jsonb(link),'approval_state','draft','ready_to_publish',false,'external_write_authorized',false);
 if octet_length(receipt::text)>131072 then raise exception 'Campaign receipt exceeds bounded response' using errcode='22023';end if;
 insert into public.project_campaign_plan_commands(organization_id,request_id,project_id,campaign_id,actor_id,payload_checksum,receipt) values(p_organization_id,p_request_id,p_project_id,p_campaign_id,auth.uid(),payload,receipt);return receipt;
end $$;
create function public.get_project_campaign_plan_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare receipt jsonb;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_request_id is null then raise exception 'Original UUID required' using errcode='22023';end if;
 select c.receipt into receipt from public.project_campaign_plan_commands c where organization_id=p_organization_id and project_id=p_project_id and request_id=p_request_id and actor_id=auth.uid();return receipt;
end $$;
create function public.get_project_campaign_plan_version(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_campaign_id uuid,p_plan_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare v public.marketing_campaign_plan_versions%rowtype;e public.engagements%rowtype;result jsonb;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 select * into e from public.engagements where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id for share;
 if not found then raise exception 'Exact project engagement required' using errcode='42501';end if;
 select * into v from public.marketing_campaign_plan_versions where id=p_plan_version_id and organization_id=p_organization_id and campaign_id=p_campaign_id and engagement_id=e.id and brand_id=e.brand_id;
 if not found then raise exception 'Exact immutable campaign version required' using errcode='42501';end if;
 result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',e.id,'campaign_id',p_campaign_id,'plan',to_jsonb(v),'budget',(select to_jsonb(b) from public.marketing_campaign_plan_budgets b where plan_version_id=v.id and organization_id=p_organization_id),'requirements',coalesce((select jsonb_agg(to_jsonb(r) order by position) from public.marketing_campaign_plan_creative_requirements r where plan_version_id=v.id and organization_id=p_organization_id),'[]'),'links',(select to_jsonb(l) from public.project_campaign_plan_links l where plan_version_id=v.id and organization_id=p_organization_id and project_id=p_project_id),'approval_state','not_evaluated','ready_to_publish',false,'external_write_authorized',false);
 if octet_length(result::text)>131072 then raise exception 'Exact campaign version exceeds whole response bound' using errcode='22023';end if;return result;
end $$;
revoke all on function private.campaign_plan_input(jsonb),private.campaign_plan_source(uuid,uuid,uuid,uuid,uuid,text),private.campaign_plan_review(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.preview_project_campaign_plan(uuid,uuid,uuid,uuid,uuid,jsonb),public.confirm_project_campaign_plan(uuid,uuid,uuid,uuid,uuid,jsonb,text,uuid),public.get_project_campaign_plan_operation(uuid,uuid,uuid),public.get_project_campaign_plan_version(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_project_campaign_plan(uuid,uuid,uuid,uuid,uuid,jsonb),public.confirm_project_campaign_plan(uuid,uuid,uuid,uuid,uuid,jsonb,text,uuid),public.get_project_campaign_plan_operation(uuid,uuid,uuid),public.get_project_campaign_plan_version(uuid,uuid,uuid,uuid,uuid) to authenticated;
commit;
