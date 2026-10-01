-- AD3: project-scoped companions to existing connector/engagement mappings.
-- Reporting only; credentials and legacy connector policies remain unchanged.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('private.validate_engagement_canonical_ownership()'::regprocedure),chr(13),'')) is distinct from 'de8a6a6585a1d7ea5e721b429bd5f163'
 or md5(replace(pg_get_functiondef('private.website_write_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from 'b226456548a2ce582df254e367fe7ef0'
 or md5(replace(pg_get_functiondef('private.website_read_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '339ae8372edf7afa3115655da7a2255f'
 or (select md5(prosrc) from pg_proc where oid='private.is_active_pipeline_team_member(uuid)'::regprocedure) is distinct from '0086b96c891eab246432459644fa3051'
 or (select md5(prosrc) from pg_proc where oid='private.reject_pipeline_template_mutation()'::regprocedure) is distinct from 'e92e564d284492c95b668f6645defa25' then raise exception 'Exact reporting scope/authority prerequisites changed' using errcode='55000';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='integration_oauth_credentials' and column_name='granted_scopes' and udt_name='_text')
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='meta_connections' and column_name='token_expires_at' and udt_name='timestamptz') then raise exception 'Installed reporting credential schema changed' using errcode='55000';end if;
end $$;
create table public.project_reporting_bindings(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,client_id uuid not null,agency_client_id uuid not null,
 engagement_id uuid not null,brand_id uuid not null,connection_id uuid not null,department_id text not null check(department_id in ('website','marketing')),
 resource_kind text not null check(resource_kind in ('ga4_property','gsc_site','google_ads_customer','meta_facebook_page','meta_instagram_account')),
 resource_key text not null check(length(resource_key) between 1 and 2048),permitted_operations text[] not null check(permitted_operations=array['reporting_read']::text[]),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
 foreign key(client_id,organization_id) references public.clients(id,organization_id) on delete restrict,
 foreign key(agency_client_id,client_id,organization_id) references public.agency_clients(id,canonical_client_id,organization_id) on delete restrict,
 foreign key(engagement_id,organization_id) references public.engagements(id,organization_id) on delete restrict,
 foreign key(brand_id,organization_id) references public.brands(id,organization_id) on delete restrict,
 foreign key(connection_id,organization_id) references public.integration_connections(id,organization_id) on delete restrict,
 unique(id,project_id,organization_id),unique(organization_id,project_id,engagement_id,department_id,connection_id,resource_kind,resource_key)
);
create table public.project_reporting_binding_revisions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,binding_id uuid not null,revision_number integer not null check(revision_number>0),
 state text not null check(state in ('enabled','paused','revoked')),context_checksum text not null check(context_checksum~'^[a-f0-9]{64}$'),context_snapshot jsonb not null check(jsonb_typeof(context_snapshot)='object'),
 changed_by uuid not null references auth.users(id) on delete restrict,changed_at timestamptz not null default now(),
 foreign key(binding_id,project_id,organization_id) references public.project_reporting_bindings(id,project_id,organization_id) on delete restrict,
 unique(binding_id,revision_number)
);
create table public.project_reporting_binding_commands(
 organization_id uuid not null,project_id uuid not null,request_id uuid not null,input_checksum text not null check(input_checksum~'^[a-f0-9]{64}$'),result jsonb not null,
 actor_id uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),primary key(organization_id,request_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create index project_reporting_bindings_project_idx on public.project_reporting_bindings(organization_id,project_id,created_at desc,id);
create index project_reporting_bindings_connection_idx on public.project_reporting_bindings(connection_id,organization_id);
create index project_reporting_bindings_engagement_idx on public.project_reporting_bindings(engagement_id,organization_id);
create index project_reporting_bindings_agency_client_idx on public.project_reporting_bindings(agency_client_id,client_id,organization_id);
create index project_reporting_bindings_client_idx on public.project_reporting_bindings(client_id,organization_id);
create index project_reporting_bindings_brand_idx on public.project_reporting_bindings(brand_id,organization_id);
create index project_reporting_binding_commands_actor_idx on public.project_reporting_binding_commands(organization_id,project_id,actor_id,created_at desc);
do $$declare t text;begin
 foreach t in array array['project_reporting_bindings','project_reporting_binding_revisions','project_reporting_binding_commands'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create trigger %I before update or delete on public.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 -- Access only through bounded RPCs. Historical rows never expose raw connector config/credentials.
 end loop;
end $$;
create function private.reporting_resource_provider(p_kind text,p_key text)
returns text language plpgsql immutable set search_path='' as $$
begin
 if p_kind is null or p_key is null or length(p_key) not between 1 and 2048 or p_key~'[[:space:][:cntrl:]\\]' then raise exception 'Explicit bounded reporting resource required' using errcode='22023';end if;
 case p_kind
 when 'ga4_property' then if p_key!~'^[0-9]{4,20}$' then raise exception 'Exact GA4 property required' using errcode='22023';end if;return 'google_analytics';
 when 'google_ads_customer' then if p_key!~'^[0-9]{10}$' then raise exception 'Exact Google Ads customer required' using errcode='22023';end if;return 'google_ads';
 when 'meta_facebook_page','meta_instagram_account' then if p_key!~'^[0-9]{4,30}$' then raise exception 'Exact Meta account required' using errcode='22023';end if;return 'meta';
 when 'gsc_site' then
 if p_key like 'sc-domain:%' then
 if p_key!~'^sc-domain:[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' or p_key like '%..%' then raise exception 'Exact GSC domain required' using errcode='22023';end if;
 elsif p_key!~'^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?/[^?#[:space:]\\]*$' or p_key~*'%(2e|2f|5c)' or p_key~'/\.{1,2}(/|$)' then raise exception 'Exact safe GSC URL required' using errcode='22023';end if;
 return 'google_search_console';
 else raise exception 'Unsupported reporting resource' using errcode='22023';end case;
end $$;
create function private.project_reporting_context(p_org uuid,p_project uuid,p_engagement uuid,p_department text,p_connection uuid,p_kind text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.projects%rowtype;e public.engagements%rowtype;ac public.agency_clients%rowtype;b public.brands%rowtype;c public.integration_connections%rowtype;m public.integration_connection_engagements%rowtype;
 provider text;selected_key text;grant_scope text;credential_state text:='unavailable';grant_state text:='unobserved';credential_revision timestamptz;mapping_identity text;scope_granted boolean:=false;result jsonb;mc_brand uuid;
begin
 provider:=private.reporting_resource_provider(p_kind,p_key);
 if p_department is null or p_department not in ('website','marketing') then raise exception 'Exact supported mapping department required' using errcode='22023';end if;
 select * into p from public.projects where id=p_project and organization_id=p_org for share;
 select * into e from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project for share;
 if not found or p.client_id is null then raise exception 'Current exact project/client/engagement ownership unavailable' using errcode='42501';end if;
 -- Engagement and brand use the existing agency-client alias; Project owns the canonical client.
 select * into ac from public.agency_clients where id=e.client_id and organization_id=p_org and canonical_client_id=p.client_id and status='active' for share;
 if not found then raise exception 'Exact existing agency/canonical client bridge unavailable' using errcode='42501';end if;
 select * into b from public.brands where id=e.brand_id and organization_id=p_org and client_id=ac.id for share;
 if not found then raise exception 'Current exact owning-client brand unavailable' using errcode='42501';end if;
 perform 1 from public.clients where id=p.client_id and organization_id=p_org and status='active' for share;
 if not found then raise exception 'Current owning client unavailable' using errcode='42501';end if;
 select * into c from public.integration_connections where id=p_connection and organization_id=p_org for share;
 if not found or c.provider<>provider then raise exception 'Exact existing connector/provider unavailable' using errcode='42501';end if;
 select * into m from public.integration_connection_engagements where connection_id=c.id and organization_id=p_org and engagement_id=e.id and department_id=p_department for share;
 if not found then raise exception 'Current exact connector engagement mapping unavailable' using errcode='42501';end if;
 mapping_identity:=encode(sha256(convert_to(jsonb_build_array(m.connection_id,m.organization_id,m.engagement_id,m.department_id,m.created_by,m.created_at)::text,'UTF8')),'hex');
 selected_key:=case p_kind when 'ga4_property' then c.public_config->>'property_id' when 'gsc_site' then c.public_config->>'site_url' when 'google_ads_customer' then c.public_config->>'customer_id' when 'meta_facebook_page' then c.public_config->>'facebook_page_id' when 'meta_instagram_account' then c.public_config->>'instagram_account_id' end;
 if provider='meta' then
 -- Existing Meta public_config.granted_scopes is the REQUESTED constant, never an observed permission receipt.
 select brand_id,connected_at,case when token_expires_at is null then 'expiry_unknown' when token_expires_at<=now() then 'expired' else 'available' end into mc_brand,credential_revision,credential_state from public.meta_connections where integration_connection_id=c.id and organization_id=p_org and (case p_kind when 'meta_facebook_page' then facebook_page_id else instagram_account_id end)=p_key for share;
 if not found or mc_brand is distinct from e.brand_id then credential_state:='unavailable';credential_revision:=null;end if;
 else
 grant_scope:=case provider when 'google_analytics' then 'https://www.googleapis.com/auth/analytics.readonly' when 'google_search_console' then 'https://www.googleapis.com/auth/webmasters.readonly' when 'google_ads' then 'https://www.googleapis.com/auth/adwords' end;
 -- Only observed server-side scopes and freshness booleans; never select/return credential bytes.
 select updated_at,case when access_token_expires_at is null then 'expiry_unknown' when access_token_expires_at<=now() then 'expired' else 'available' end,grant_scope=any(granted_scopes) into credential_revision,credential_state,scope_granted from public.integration_oauth_credentials where connection_id=c.id and organization_id=p_org and integration_oauth_credentials.provider=c.provider for share;
 if found then grant_state:='observed';else credential_state:='unavailable';scope_granted:=false;end if;
 end if;
 result:=jsonb_build_object('organization_id',p_org,'project_id',p_project,'client_id',p.client_id,'agency_client_id',ac.id,'engagement_id',e.id,'brand_id',e.brand_id,'department_id',p_department,'connection_id',c.id,'provider',provider,'resource_kind',p_kind,'resource_key',p_key,'selected_resource_matches',coalesce(selected_key=p_key,false),'connection_status',c.status,'connection_archived',c.archived_at is not null,'project_archived',p.archived_at is not null,'engagement_active',e.status in ('planning','active'),'mapping_identity',mapping_identity,'credential_revision',credential_revision,'credential_state',credential_state,'grant_provenance',grant_state,'reporting_scope_granted',coalesce(scope_granted,false),'provider_resource_verified',false,'permitted_operations',jsonb_build_array('reporting_read'),'external_write_authorized',false);
 return result||jsonb_build_object('context_checksum',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end $$;
create function private.project_reporting_preview(p_org uuid,p_project uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;binding public.project_reporting_bindings%rowtype;revision integer:=0;checksum text;engagement uuid;connection uuid;binding_id uuid;expected integer;
begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>9 or not(p_input ?& array['binding_id','expected_revision','engagement_id','department_id','connection_id','resource_kind','resource_key','permitted_operations','state'])
 or jsonb_typeof(p_input->'expected_revision')<>'number' or (p_input->>'expected_revision')!~'^[0-9]{1,10}$' or (p_input->>'expected_revision')::numeric>2147483646
 or jsonb_typeof(p_input->'engagement_id')<>'string' or (p_input->>'engagement_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 or jsonb_typeof(p_input->'connection_id')<>'string' or (p_input->>'connection_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 or p_input->'permitted_operations'<>'["reporting_read"]'::jsonb or coalesce(p_input->>'state','') not in ('enabled','paused','revoked')
 or (p_input->'binding_id'<>'null'::jsonb and (jsonb_typeof(p_input->'binding_id')<>'string' or (p_input->>'binding_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')) then raise exception 'Complete named reporting-only binding required' using errcode='22023';end if;
 engagement:=(p_input->>'engagement_id')::uuid;connection:=(p_input->>'connection_id')::uuid;binding_id:=(p_input->>'binding_id')::uuid;expected:=(p_input->>'expected_revision')::integer;
 if (binding_id is null)<>(expected=0) then raise exception 'Explicit original binding revision required' using errcode='22023';end if;
 if binding_id is null then
 context:=private.project_reporting_context(p_org,p_project,engagement,p_input->>'department_id',connection,p_input->>'resource_kind',p_input->>'resource_key');
 select * into binding from public.project_reporting_bindings where organization_id=p_org and project_id=p_project and engagement_id=engagement and department_id=p_input->>'department_id' and connection_id=connection and resource_kind=p_input->>'resource_kind' and resource_key=p_input->>'resource_key';
 if found then raise exception 'Existing resource binding requires its exact identity and revision' using errcode='40001';end if;
 else
 select * into binding from public.project_reporting_bindings where id=binding_id and project_id=p_project and organization_id=p_org for share;
 if not found or binding.engagement_id<>engagement or binding.connection_id<>connection or binding.department_id<>p_input->>'department_id' or binding.resource_kind<>p_input->>'resource_kind' or binding.resource_key<>p_input->>'resource_key' then raise exception 'Exact original reporting binding scope required' using errcode='42501';end if;
 select max(r.revision_number) into revision from public.project_reporting_binding_revisions r where r.binding_id=binding.id;
 if revision is distinct from expected then raise exception 'Reporting binding revision changed' using errcode='40001';end if;
 if p_input->>'state'='enabled' then
 context:=private.project_reporting_context(p_org,p_project,engagement,p_input->>'department_id',connection,p_input->>'resource_kind',p_input->>'resource_key');
 if binding.client_id::text<>context->>'client_id' or binding.agency_client_id::text<>context->>'agency_client_id' or binding.brand_id::text<>context->>'brand_id' then raise exception 'Original owning client/brand changed' using errcode='42501';end if;
 else
 -- Revocation remains possible after mapping removal/credential disconnect or ownership change.
 -- It never enables reading: preserve the original bounded snapshot with an explicit revocation marker.
 select r.context_snapshot into context from public.project_reporting_binding_revisions r where r.binding_id=binding.id and r.revision_number=revision;
 context:=context||jsonb_build_object('revocation_only',true,'reporting_ready',false);
 context:=context||jsonb_build_object('context_checksum',encode(sha256(convert_to((context-'context_checksum')::text,'UTF8')),'hex'));
 end if;
 end if;
 if p_input->>'state'='enabled' and (context->>'selected_resource_matches' is distinct from 'true' or context->>'connection_archived'='true' or context->>'connection_status' not in ('configured','authorizing','verified') or context->>'engagement_active'<>'true') then raise exception 'Current exact selected reporting resource unavailable' using errcode='42501';end if;
 checksum:=encode(sha256(convert_to(jsonb_build_object('input',p_input,'context',context,'expected_revision',revision)::text,'UTF8')),'hex');
 return jsonb_build_object('input',p_input,'context',context,'expected_revision',revision,'review_sha256',checksum,'zero_writes',true,'reporting_ready',false,'acceptance','Provider resource access remains pending verification');
end $$;
create function public.preview_project_reporting_binding(p_organization_id uuid,p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.website_write_authorized(p_organization_id,p_project_id);
 return private.project_reporting_preview(p_organization_id,p_project_id,p_input);
end $$;
create function public.confirm_project_reporting_binding(p_organization_id uuid,p_project_id uuid,p_input jsonb,p_review_sha256 text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare review jsonb;prior public.project_reporting_binding_commands%rowtype;checksum text;binding_id uuid;revision integer;result jsonb;context jsonb;
begin
 perform private.website_write_authorized(p_organization_id,p_project_id);
 if p_request_id is null or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' then raise exception 'Original request and exact reviewed checksum required' using errcode='22023';end if;
 checksum:=encode(sha256(convert_to(jsonb_build_object('input',p_input,'review',p_review_sha256)::text,'UTF8')),'hex');
 select * into prior from public.project_reporting_binding_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then
 if prior.actor_id<>auth.uid() or prior.project_id<>p_project_id then raise exception 'Original actor/context required' using errcode='42501';end if;
 if prior.input_checksum<>checksum then raise exception 'Original request payload changed' using errcode='23505';end if;
 -- Recovery is an old receipt, never a renewed permission grant. Current authority remains mandatory.
 return prior.result||jsonb_build_object('replayed',true);
 end if;
 review:=private.project_reporting_preview(p_organization_id,p_project_id,p_input);
 if review->>'review_sha256'<>p_review_sha256 then raise exception 'Reporting review context changed' using errcode='40001';end if;
 context:=review->'context';binding_id:=(p_input->>'binding_id')::uuid;revision:=(review->>'expected_revision')::integer+1;
 if binding_id is null then
 insert into public.project_reporting_bindings(organization_id,project_id,client_id,agency_client_id,engagement_id,brand_id,connection_id,department_id,resource_kind,resource_key,permitted_operations,created_by)
 values(p_organization_id,p_project_id,(context->>'client_id')::uuid,(context->>'agency_client_id')::uuid,(context->>'engagement_id')::uuid,(context->>'brand_id')::uuid,(context->>'connection_id')::uuid,p_input->>'department_id',p_input->>'resource_kind',p_input->>'resource_key',array['reporting_read'],auth.uid()) returning id into binding_id;
 end if;
 insert into public.project_reporting_binding_revisions(organization_id,project_id,binding_id,revision_number,state,context_checksum,context_snapshot,changed_by)
 values(p_organization_id,p_project_id,binding_id,revision,p_input->>'state',context->>'context_checksum',context,auth.uid());
 result:=jsonb_build_object('binding_id',binding_id,'revision_number',revision,'state',p_input->>'state','reporting_ready',false,'external_write_authorized',false);
 insert into public.project_reporting_binding_commands(organization_id,project_id,request_id,input_checksum,result,actor_id) values(p_organization_id,p_project_id,p_request_id,checksum,result,auth.uid());
 return result||jsonb_build_object('replayed',false);
end $$;
create function public.get_project_reporting_binding_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 perform private.website_write_authorized(p_organization_id,p_project_id);
 if p_request_id is null then raise exception 'Original request required' using errcode='22023';end if;
 select jsonb_build_object('request_id',request_id,'result',c.result,'created_at',created_at) into result from public.project_reporting_binding_commands c where organization_id=p_organization_id and project_id=p_project_id and request_id=p_request_id and actor_id=auth.uid();
 return result;
end $$;
create function public.list_project_reporting_bindings(p_organization_id uuid,p_project_id uuid,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare total bigint;matching bigint;items jsonb:='[]';row record;context jsonb;reason text;revision record;result jsonb;
begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_query is null or length(p_query)>120 or p_query~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded resource paging required' using errcode='22023';end if;
 select count(*) into total from public.project_reporting_bindings where organization_id=p_organization_id and project_id=p_project_id;
 select count(*) into matching from public.project_reporting_bindings where organization_id=p_organization_id and project_id=p_project_id and (p_query='' or strpos(lower(resource_key||' '||resource_kind),lower(p_query))>0);
 for row in select * from public.project_reporting_bindings where organization_id=p_organization_id and project_id=p_project_id and (p_query='' or strpos(lower(resource_key||' '||resource_kind),lower(p_query))>0) order by created_at desc,id limit p_limit offset p_offset loop
 select * into revision from public.project_reporting_binding_revisions where binding_id=row.id order by revision_number desc limit 1;
 context:=null;reason:=null;
 begin
 context:=private.project_reporting_context(p_organization_id,p_project_id,row.engagement_id,row.department_id,row.connection_id,row.resource_kind,row.resource_key);
 if context->>'client_id'<>row.client_id::text or context->>'agency_client_id'<>row.agency_client_id::text or context->>'brand_id'<>row.brand_id::text then reason:='owning_context_changed';
 elsif revision.state<>'enabled' then reason:='binding_'||revision.state;
 elsif context->>'context_checksum'<>revision.context_checksum then reason:='binding_context_changed';
 elsif context->>'project_archived'='true' or context->>'engagement_active'<>'true' or context->>'connection_archived'='true' or context->>'connection_status'<>'verified' or context->>'selected_resource_matches' is distinct from 'true' then reason:='current_resource_unavailable';
 elsif context->>'credential_state'<>'available' then reason:='credential_'||(context->>'credential_state');
 elsif context->>'grant_provenance'<>'observed' or context->>'reporting_scope_granted'<>'true' then reason:='observed_reporting_grant_missing';
 else reason:='resource_access_verification_pending';end if;
 exception when sqlstate '42501' or sqlstate '22023' then reason:='binding_context_unavailable';end;
 items:=items||jsonb_build_array(jsonb_build_object('binding',to_jsonb(row),'revision_number',revision.revision_number,'state',revision.state,'context_checksum',revision.context_checksum,'current_context',context,'reporting_ready',false,'reason',reason,'external_write_authorized',false));
 end loop;
 result:=jsonb_build_object('items',items,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching);
 if octet_length(result::text)>131072 then raise exception 'Resource list exceeds whole bounded result' using errcode='22023';end if;
 return result;
end $$;
create function private.project_reporting_candidates(p_org uuid,p_project uuid,p_engagement uuid,p_department text)
returns table(connection_id uuid,provider text,display_name text,resource_kind text,resource_key text) language sql stable security definer set search_path='' as $$
 select c.id,c.provider,c.display_name,r.kind,r.key from public.integration_connection_engagements m
 join public.integration_connections c on c.id=m.connection_id and c.organization_id=m.organization_id
 join public.engagements e on e.id=m.engagement_id and e.organization_id=m.organization_id and e.project_id=p_project
 cross join lateral(values
 ('ga4_property',case when c.provider='google_analytics' then c.public_config->>'property_id' end,'google_analytics'),
 ('gsc_site',case when c.provider='google_search_console' then c.public_config->>'site_url' end,'google_search_console'),
 ('google_ads_customer',case when c.provider='google_ads' then c.public_config->>'customer_id' end,'google_ads'),
 ('meta_facebook_page',case when c.provider='meta' then c.public_config->>'facebook_page_id' end,'meta'),
 ('meta_instagram_account',case when c.provider='meta' then c.public_config->>'instagram_account_id' end,'meta')) r(kind,key,provider)
 where m.organization_id=p_org and m.engagement_id=p_engagement and m.department_id=p_department and c.provider=r.provider;
$$;
create function public.list_project_reporting_resource_candidates(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_department_id text,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare total bigint;matching bigint;items jsonb:='[]';row record;context jsonb;reason text;result jsonb;
begin
 perform private.website_write_authorized(p_organization_id,p_project_id);
 if p_engagement_id is null or p_department_id is null or p_department_id not in ('website','marketing') or p_query is null or length(p_query)>120 or p_query~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded exact resource mapping lookup required' using errcode='22023';end if;
 perform 1 from public.engagements e join public.projects p on p.id=e.project_id and p.organization_id=e.organization_id
 join public.agency_clients ac on ac.id=e.client_id and ac.organization_id=e.organization_id and ac.canonical_client_id=p.client_id and ac.status='active'
 join public.brands b on b.id=e.brand_id and b.organization_id=e.organization_id and b.client_id=ac.id
 join public.clients c on c.id=p.client_id and c.organization_id=p.organization_id and c.status='active'
 where e.id=p_engagement_id and e.organization_id=p_organization_id and e.project_id=p_project_id;
 if not found then raise exception 'Exact current owning project/client engagement required' using errcode='42501';end if;
 select count(*) into total from private.project_reporting_candidates(p_organization_id,p_project_id,p_engagement_id,p_department_id);
 select count(*) into matching from private.project_reporting_candidates(p_organization_id,p_project_id,p_engagement_id,p_department_id) where p_query='' or strpos(lower(display_name||' '||provider||' '||coalesce(resource_key,'')),lower(p_query))>0;
 for row in select * from private.project_reporting_candidates(p_organization_id,p_project_id,p_engagement_id,p_department_id) where p_query='' or strpos(lower(display_name||' '||provider||' '||coalesce(resource_key,'')),lower(p_query))>0 order by connection_id,resource_kind limit p_limit offset p_offset loop
 context:=null;reason:=null;
 begin
 context:=private.project_reporting_context(p_organization_id,p_project_id,p_engagement_id,p_department_id,row.connection_id,row.resource_kind,row.resource_key);
 if context->>'connection_archived'='true' or context->>'connection_status' not in ('configured','authorizing','verified') or context->>'engagement_active'<>'true' then reason:='current_resource_unavailable';end if;
 exception when sqlstate '42501' or sqlstate '22023' then reason:='selected_resource_unavailable';end;
 items:=items||jsonb_build_array(jsonb_build_object('connection_id',row.connection_id,'provider',row.provider,'display_name',row.display_name,'resource_kind',row.resource_kind,'resource_key',row.resource_key,'context',context,'available_for_binding',reason is null,'reason',reason,'provider_resource_verified',false,'external_write_authorized',false));
 end loop;
 result:=jsonb_build_object('items',items,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching);
 if octet_length(result::text)>131072 then raise exception 'Resource candidates exceed whole bounded result' using errcode='22023';end if;
 return result;
end $$;
create function public.get_project_reporting_binding_history(p_organization_id uuid,p_project_id uuid,p_binding_id uuid,p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$declare total bigint;items jsonb;result jsonb;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_binding_id is null or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded exact binding history required' using errcode='22023';end if;
 perform 1 from public.project_reporting_bindings where id=p_binding_id and project_id=p_project_id and organization_id=p_organization_id;
 if not found then raise exception 'Exact project reporting binding unavailable' using errcode='42501';end if;
 select count(*) into total from public.project_reporting_binding_revisions where binding_id=p_binding_id and organization_id=p_organization_id and project_id=p_project_id;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.revision_number desc),'[]'::jsonb) into items from(select * from public.project_reporting_binding_revisions where binding_id=p_binding_id and organization_id=p_organization_id and project_id=p_project_id order by revision_number desc limit p_limit offset p_offset) r;
 result:=jsonb_build_object('items',items,'total',total,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<total);
 if octet_length(result::text)>131072 then raise exception 'Binding history exceeds whole bounded result' using errcode='22023';end if;
 return result;
end $$;
do $$declare f record;begin
 for f in select p.oid,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname in ('reporting_resource_provider','project_reporting_context','project_reporting_preview','project_reporting_candidates')) or (n.nspname='public' and p.proname in ('preview_project_reporting_binding','confirm_project_reporting_binding','get_project_reporting_binding_operation','list_project_reporting_bindings','list_project_reporting_resource_candidates','get_project_reporting_binding_history')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
 if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
 end loop;
end $$;
commit;
