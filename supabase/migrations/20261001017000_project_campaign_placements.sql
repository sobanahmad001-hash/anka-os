-- AD2/B5 internal placements; no publishing, spend, assignments or copied sources.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if (select md5(prosrc) from pg_proc where oid='private.p7_assignment_authority(uuid,uuid,text,uuid)'::regprocedure) is distinct from '0e2dbef44ce9c734f375116a4169e394'
 or (select md5(prosrc) from pg_proc where oid='private.n1e_org_authority(uuid,uuid,uuid)'::regprocedure) is distinct from 'f62c0fe02b7bd9bcea653eef67074f12'
 or (select md5(prosrc) from pg_proc where oid='private.n1e_exact_project_manager(uuid,uuid,uuid)'::regprocedure) is distinct from '4ec5a0c9e1b39ae7cb355333be82b215'
 or (select md5(prosrc) from pg_proc where oid='private.n1e_department_head(uuid,uuid,text,uuid)'::regprocedure) is distinct from '11da14e00954fba787469db539566712'
 or (select md5(prosrc) from pg_proc where oid='private.n1c_require_scope(uuid,uuid,uuid)'::regprocedure) is distinct from '9e992a3676cefb89791ff27ba12fb389'
 or (select md5(prosrc) from pg_proc where oid='private.is_active_pipeline_team_member(uuid)'::regprocedure) is distinct from '0086b96c891eab246432459644fa3051'
 or (select md5(prosrc) from pg_proc where oid='private.reject_pipeline_template_mutation()'::regprocedure) is distinct from 'e92e564d284492c95b668f6645defa25'
 or md5(replace(pg_get_functiondef('private.website_read_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '339ae8372edf7afa3115655da7a2255f'
 or md5(replace(pg_get_functiondef('private.validate_engagement_canonical_ownership()'::regprocedure),chr(13),'')) is distinct from 'de8a6a6585a1d7ea5e721b429bd5f163'
 or md5(replace(pg_get_functiondef('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)'::regprocedure),chr(13),'')) is distinct from '033f6c233c35b8c2641716b861a63cd2'
 or md5(replace(pg_get_functiondef('private.campaign_asset_write_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '0e5d5adb9725d9c984d6ba8ddb5f41eb'
 or md5(replace(pg_get_functiondef('private.campaign_asset_context(uuid,uuid,uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '26564702664ead60dcbf84d84289305f'
 or md5(replace(pg_get_functiondef('private.campaign_asset_source(uuid,uuid,uuid,text,uuid)'::regprocedure),chr(13),'')) is distinct from 'f4811900ded59d458496e64f74a799ae'
 or md5(replace(pg_get_functiondef('private.project_reporting_context(uuid,uuid,uuid,text,uuid,text,text)'::regprocedure),chr(13),'')) is distinct from '51a3895ccca2b26cee458e0a58890a55' then raise exception 'Exact shared-source/resource prerequisites changed' using errcode='55000';end if;
end $$;
create table public.project_campaign_placements(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,campaign_id uuid not null,asset_id uuid not null,
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
 foreign key(campaign_id,organization_id) references public.marketing_campaigns(id,organization_id) on delete restrict,
 foreign key(asset_id,project_id,organization_id) references public.project_campaign_assets(id,project_id,organization_id) on delete restrict,
 unique(id,asset_id,project_id,organization_id)
);
create table public.project_campaign_placement_revisions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,placement_id uuid not null,asset_id uuid not null,revision_number integer not null check(revision_number>0),
 variant_id uuid,plan_version_id uuid not null,marketing_service_id uuid not null,account_binding_id uuid,project_task_id uuid,engagement_work_item_id uuid,
 channel text not null check(length(channel) between 1 and 120),mode text not null check(mode in ('organic','paid')),scheduled_at timestamptz,time_zone text,
 publication_state text not null check(publication_state in ('draft','planned','paused','cancelled','recorded_published')),data jsonb not null check(jsonb_typeof(data)='object'),reference_snapshot jsonb not null check(jsonb_typeof(reference_snapshot)='object'),
 changed_by uuid not null references auth.users(id) on delete restrict,changed_at timestamptz not null default now(),
 foreign key(placement_id,asset_id,project_id,organization_id) references public.project_campaign_placements(id,asset_id,project_id,organization_id) on delete restrict,
 foreign key(variant_id,asset_id,project_id,organization_id) references public.project_campaign_asset_variants(id,asset_id,project_id,organization_id) on delete restrict,
 foreign key(plan_version_id,organization_id) references public.marketing_campaign_plan_versions(id,organization_id) on delete restrict,
 foreign key(marketing_service_id,organization_id) references public.engagement_services(id,organization_id) on delete restrict,
 foreign key(account_binding_id,project_id,organization_id) references public.project_reporting_bindings(id,project_id,organization_id) on delete restrict,
 foreign key(project_task_id,organization_id) references public.tasks(id,organization_id) on delete restrict,
 foreign key(engagement_work_item_id,organization_id) references public.work_items(id,organization_id) on delete restrict,
 check(project_task_id is null or engagement_work_item_id is null),check((scheduled_at is null)=(time_zone is null)),unique(placement_id,revision_number)
);
create table public.project_campaign_placement_commands(
 organization_id uuid not null,project_id uuid not null,request_id uuid not null,input_checksum text not null check(input_checksum~'^[a-f0-9]{64}$'),result jsonb not null,
 actor_id uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),primary key(organization_id,request_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create index project_campaign_placements_campaign_idx on public.project_campaign_placements(organization_id,project_id,campaign_id,created_at desc,id);
create index project_campaign_placements_asset_idx on public.project_campaign_placements(asset_id,project_id,organization_id);
create index project_campaign_placement_revisions_calendar_idx on public.project_campaign_placement_revisions(organization_id,project_id,scheduled_at,placement_id,revision_number desc);
create index project_campaign_placement_revisions_variant_idx on public.project_campaign_placement_revisions(variant_id,asset_id,project_id,organization_id) where variant_id is not null;
create index project_campaign_placement_revisions_plan_idx on public.project_campaign_placement_revisions(plan_version_id,organization_id);
create index project_campaign_placement_revisions_service_idx on public.project_campaign_placement_revisions(marketing_service_id,organization_id);
create index project_campaign_placement_revisions_account_idx on public.project_campaign_placement_revisions(account_binding_id,project_id,organization_id) where account_binding_id is not null;
create index project_campaign_placement_revisions_task_idx on public.project_campaign_placement_revisions(project_task_id,organization_id) where project_task_id is not null;
create index project_campaign_placement_revisions_work_idx on public.project_campaign_placement_revisions(engagement_work_item_id,organization_id) where engagement_work_item_id is not null;
create index project_campaign_placement_commands_actor_idx on public.project_campaign_placement_commands(organization_id,project_id,actor_id,created_at desc);
do $$declare t text;begin
 foreach t in array array['project_campaign_placements','project_campaign_placement_revisions','project_campaign_placement_commands'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create trigger %I before update or delete on public.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create function private.campaign_placement_url(p_value jsonb)
returns text language plpgsql immutable set search_path='' as $$declare value text:=p_value#>>'{}';begin
 if p_value='null'::jsonb then return null;end if;
 if p_value is null or jsonb_typeof(p_value)<>'string' or length(value)>2048 or value~'[[:space:][:cntrl:]\\]' or value!~'^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]\\]*)?$' or value~*'/([.]|%2e){1,2}(/|$)' then raise exception 'Exact HTTP(S) URL without credentials/traversal required' using errcode='22023';end if;return value;
end $$;
create function private.campaign_placement_input(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$declare key text;instant timestamptz;value jsonb;kind text;begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>14 or not p_input ?& array['asset_id','variant_id','campaign_plan_version_id','marketing_service_id','channel','account_binding_id','mode','scheduled_at','time_zone','cta','external_id','recorded_url','publication_state','contribution'] then raise exception 'Complete named placement fields required' using errcode='22023';end if;
 foreach key in array array['asset_id','variant_id','campaign_plan_version_id','marketing_service_id','account_binding_id'] loop
 value:=p_input->key;
 if value='null'::jsonb and key in ('variant_id','account_binding_id') then continue;end if;
 if jsonb_typeof(value)<>'string' or (p_input->>key)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Exact existing placement identifiers required' using errcode='22023';end if;
 end loop;
 if coalesce(p_input->>'mode','') not in ('organic','paid') or coalesce(p_input->>'publication_state','') not in ('draft','planned','paused','cancelled','recorded_published') or jsonb_typeof(p_input->'channel')<>'string' or length(p_input->>'channel') not between 1 and 120 or p_input->>'channel' is distinct from trim(p_input->>'channel') or p_input->>'channel'~'[[:cntrl:]]' then raise exception 'Explicit bounded placement channel/mode/state required' using errcode='22023';end if;
 if jsonb_typeof(p_input->'cta')<>'object' or (select count(*) from jsonb_object_keys(p_input->'cta'))<>2 or not (p_input->'cta') ?& array['label','url'] or jsonb_typeof(p_input#>'{cta,label}')<>'string' or length(p_input#>>'{cta,label}')>240 or p_input#>>'{cta,label}' is distinct from trim(p_input#>>'{cta,label}') or p_input#>>'{cta,label}'~'[[:cntrl:]]' then raise exception 'Exact bounded call to action required' using errcode='22023';end if;
 perform private.campaign_placement_url(p_input#>'{cta,url}');perform private.campaign_placement_url(p_input->'recorded_url');
 if p_input->'external_id'<>'null'::jsonb and (jsonb_typeof(p_input->'external_id')<>'string' or length(p_input->>'external_id') not between 1 and 500 or p_input->>'external_id' is distinct from trim(p_input->>'external_id') or p_input->>'external_id'~'[[:cntrl:]]') then raise exception 'Bounded recorded external identifier required' using errcode='22023';end if;
 if p_input->>'publication_state'='recorded_published' and p_input->'external_id'='null'::jsonb and p_input->'recorded_url'='null'::jsonb then raise exception 'Manually recorded publication requires exact external ID or URL' using errcode='22023';end if;
 if p_input->'scheduled_at'='null'::jsonb and p_input->'time_zone'='null'::jsonb then null;
 else
 if jsonb_typeof(p_input->'scheduled_at')<>'string' or (p_input->>'scheduled_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{3})?Z$' or jsonb_typeof(p_input->'time_zone')<>'string' or length(p_input->>'time_zone') not between 1 and 120 or not exists(select 1 from pg_timezone_names where name=p_input->>'time_zone') then raise exception 'Explicit UTC instant and supported IANA timezone required' using errcode='22023';end if;
 begin instant:=(p_input->>'scheduled_at')::timestamptz;exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Actual calendar instant required' using errcode='22023';end;
 if to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>substring(p_input->>'scheduled_at',1,19) then raise exception 'Actual calendar instant required' using errcode='22023';end if;
 end if;
 if p_input->'contribution'<>'null'::jsonb then
 value:=p_input->'contribution';kind:=value->>'kind';
 if jsonb_typeof(value)<>'object' or (select count(*) from jsonb_object_keys(value))<>2 or not value ?& array['kind','id'] or coalesce(kind,'') not in ('project_task','engagement_work_item') or jsonb_typeof(value->'id')<>'string' or (value->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Exact existing Project Task or Engagement Work Item reference required' using errcode='22023';end if;
 end if;
 return p_input;
end $$;
create function private.campaign_placement_reference(p_org uuid,p_project uuid,p_campaign uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;asset public.project_campaign_assets%rowtype;variant public.project_campaign_asset_variants%rowtype;source jsonb;variant_source jsonb;account public.project_reporting_bindings%rowtype;account_revision public.project_reporting_binding_revisions%rowtype;account_context jsonb;contribution jsonb;task public.tasks%rowtype;work public.work_items%rowtype;reasons jsonb:='[]';
begin
 context:=private.campaign_asset_context(p_org,p_project,p_campaign,(p_input->>'campaign_plan_version_id')::uuid,(p_input->>'marketing_service_id')::uuid);
 select * into asset from public.project_campaign_assets where id=(p_input->>'asset_id')::uuid and organization_id=p_org and project_id=p_project and brand_id=(context->>'brand_id')::uuid for share;
 if not found or not exists(select 1 from public.project_campaign_asset_links where asset_id=asset.id and organization_id=p_org and project_id=p_project and campaign_id=p_campaign and plan_version_id=(p_input->>'campaign_plan_version_id')::uuid and marketing_service_id=(p_input->>'marketing_service_id')::uuid) then raise exception 'Exact shared asset/campaign/plan/service link required' using errcode='42501';end if;
 source:=private.campaign_asset_source(p_org,p_project,asset.brand_id,asset.source_kind,asset.source_version_id);
 if source->>'reference_checksum' is distinct from asset.source_reference_checksum then raise exception 'Original canonical asset reference changed' using errcode='55000';end if;
 if p_input->'variant_id'<>'null'::jsonb then
 select * into variant from public.project_campaign_asset_variants where id=(p_input->>'variant_id')::uuid and asset_id=asset.id and organization_id=p_org and project_id=p_project for share;
 if not found then raise exception 'Exact variant of this shared canonical source required' using errcode='42501';end if;
 variant_source:=private.campaign_asset_source(p_org,p_project,asset.brand_id,variant.source_kind,variant.source_version_id);
 if variant_source->>'reference_checksum' is distinct from variant.source_reference_checksum then raise exception 'Variant canonical approval reference changed' using errcode='55000';end if;
 end if;
 if p_input->'account_binding_id'='null'::jsonb then reasons:=reasons||jsonb_build_array('account_binding_missing');
 else
 select * into account from public.project_reporting_bindings where id=(p_input->>'account_binding_id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=(context->>'engagement_id')::uuid and brand_id=asset.brand_id for share;
 if not found then raise exception 'Exact current-project/client/engagement resource binding required' using errcode='42501';end if;
 select * into account_revision from public.project_reporting_binding_revisions where binding_id=account.id order by revision_number desc limit 1;
 begin
 account_context:=private.project_reporting_context(p_org,p_project,account.engagement_id,account.department_id,account.connection_id,account.resource_kind,account.resource_key);
 if account.client_id::text is distinct from account_context->>'client_id' or account.agency_client_id::text is distinct from account_context->>'agency_client_id' or account_revision.state<>'enabled' or account_context->>'context_checksum' is distinct from account_revision.context_checksum then reasons:=reasons||jsonb_build_array('account_binding_unavailable');else reasons:=reasons||jsonb_build_array('resource_access_verification_pending');end if;
 exception when sqlstate '42501' or sqlstate '22023' then reasons:=reasons||jsonb_build_array('account_binding_unavailable');end;
 end if;
 if p_input#>>'{contribution,kind}'='project_task' then
 select * into task from public.tasks where id=(p_input#>>'{contribution,id}')::uuid and organization_id=p_org and project_id=p_project and archived_at is null for share;
 if not found then raise exception 'Existing same-project Project Task required' using errcode='42501';end if;
 contribution:=jsonb_build_object('kind','project_task','id',task.id,'row_version',task.row_version,'assignee_id',task.assigned_to,'due_date',task.due_date,'status',task.status);
 elsif p_input#>>'{contribution,kind}'='engagement_work_item' then
 select * into work from public.work_items where id=(p_input#>>'{contribution,id}')::uuid and organization_id=p_org and project_id=p_project and engagement_id=(context->>'engagement_id')::uuid and brand_id=asset.brand_id and deleted_at is null for share;
 if not found then raise exception 'Existing same-project/engagement Work Item required' using errcode='42501';end if;
 contribution:=jsonb_build_object('kind','engagement_work_item','id',work.id,'row_version',work.row_version,'assignee_id',work.assignee_id,'due_date',work.due_date,'status',work.status);
 end if;
 return jsonb_build_object('context',context,'source',source,'variant',variant_source,'account_revision',account_revision.revision_number,'account_context',account_context,'contribution',contribution,'internal_ready',false,'blocking_reasons',reasons,'external_write_authorized',false);
end $$;
create function private.campaign_placement_preview(p_org uuid,p_project uuid,p_campaign uuid,p_placement uuid,p_expected integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$declare original public.project_campaign_placements%rowtype;revision integer:=0;reference jsonb;result jsonb;previous public.project_campaign_placement_revisions%rowtype;begin
 perform private.campaign_placement_input(p_input);
 if p_campaign is null or p_expected is null or p_expected not between 0 and 2147483646 or (p_placement is null)<>(p_expected=0) then raise exception 'Exact campaign and original placement revision required' using errcode='22023';end if;
 if p_placement is not null then
 select * into original from public.project_campaign_placements where id=p_placement and organization_id=p_org and project_id=p_project and campaign_id=p_campaign and asset_id=(p_input->>'asset_id')::uuid for share;
 if not found then raise exception 'Original exact campaign/shared source identity required' using errcode='42501';end if;
 select max(revision_number) into revision from public.project_campaign_placement_revisions where placement_id=original.id;
 if revision is distinct from p_expected then raise exception 'Placement revision changed' using errcode='40001';end if;
 end if;
 if p_placement is not null and p_input->>'publication_state' in ('paused','cancelled') then
 select * into previous from public.project_campaign_placement_revisions where placement_id=original.id and revision_number=revision;
 if (p_input-'publication_state') is distinct from (previous.data-'publication_state') then raise exception 'Pausing/cancelling changes only the current planning state' using errcode='22023';end if;
 -- Current exact project authority may stop an existing plan after source/account withdrawal.
 -- Keep original source evidence historical, never renewed approval/provider authority.
 reference:=previous.reference_snapshot||jsonb_build_object('planning_state_only',true,'internal_ready',false,'external_write_authorized',false,'blocking_reasons',jsonb_build_array('placement_'||(p_input->>'publication_state')));
 else reference:=private.campaign_placement_reference(p_org,p_project,p_campaign,p_input);end if;
 result:=jsonb_build_object('campaign_id',p_campaign,'placement_id',p_placement,'expected_revision',revision,'input',p_input,'reference',reference,'zero_writes',true);
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end $$;
create function public.preview_project_campaign_placement(p_organization_id uuid,p_project_id uuid,p_campaign_id uuid,p_placement_id uuid,p_expected_revision integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.campaign_asset_write_authorized(p_organization_id,p_project_id);
 return private.campaign_placement_preview(p_organization_id,p_project_id,p_campaign_id,p_placement_id,p_expected_revision,p_input);
end $$;
create function public.confirm_project_campaign_placement(p_organization_id uuid,p_project_id uuid,p_campaign_id uuid,p_placement_id uuid,p_expected_revision integer,p_input jsonb,p_review_sha256 text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.project_campaign_placement_commands%rowtype;review jsonb;checksum text;placement_id uuid:=p_placement_id;revision integer;result jsonb;
begin
 perform private.campaign_asset_write_authorized(p_organization_id,p_project_id);
 if p_request_id is null or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' then raise exception 'Original request and exact reviewed checksum required' using errcode='22023';end if;
 checksum:=encode(sha256(convert_to(jsonb_build_object('campaign',p_campaign_id,'placement',p_placement_id,'expected',p_expected_revision,'input',p_input,'review',p_review_sha256)::text,'UTF8')),'hex');
 select * into prior from public.project_campaign_placement_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then
 if prior.actor_id<>auth.uid() or prior.project_id<>p_project_id then raise exception 'Original actor/project required' using errcode='42501';end if;
 if prior.input_checksum<>checksum then raise exception 'Original placement request changed' using errcode='23505';end if;
 return prior.result||jsonb_build_object('replayed',true);
 end if;
 review:=private.campaign_placement_preview(p_organization_id,p_project_id,p_campaign_id,p_placement_id,p_expected_revision,p_input);
 if review->>'review_sha256'<>p_review_sha256 then raise exception 'Exact placement review context changed' using errcode='40001';end if;
 if placement_id is null then insert into public.project_campaign_placements(organization_id,project_id,campaign_id,asset_id,created_by) values(p_organization_id,p_project_id,p_campaign_id,(p_input->>'asset_id')::uuid,auth.uid()) returning id into placement_id;end if;
 revision:=p_expected_revision+1;
 insert into public.project_campaign_placement_revisions(organization_id,project_id,placement_id,asset_id,revision_number,variant_id,plan_version_id,marketing_service_id,account_binding_id,project_task_id,engagement_work_item_id,channel,mode,scheduled_at,time_zone,publication_state,data,reference_snapshot,changed_by)
 values(p_organization_id,p_project_id,placement_id,(p_input->>'asset_id')::uuid,revision,(p_input->>'variant_id')::uuid,(p_input->>'campaign_plan_version_id')::uuid,(p_input->>'marketing_service_id')::uuid,(p_input->>'account_binding_id')::uuid,case when p_input#>>'{contribution,kind}'='project_task' then (p_input#>>'{contribution,id}')::uuid end,case when p_input#>>'{contribution,kind}'='engagement_work_item' then (p_input#>>'{contribution,id}')::uuid end,p_input->>'channel',p_input->>'mode',(p_input->>'scheduled_at')::timestamptz,p_input->>'time_zone',p_input->>'publication_state',p_input,review->'reference',auth.uid());
 result:=jsonb_build_object('placement_id',placement_id,'revision_number',revision,'asset_id',p_input->>'asset_id','variant_id',p_input->>'variant_id','publication_state',p_input->>'publication_state','internal_ready',false,'blocking_reasons',review#>'{reference,blocking_reasons}','external_write_authorized',false);
 insert into public.project_campaign_placement_commands(organization_id,project_id,request_id,input_checksum,result,actor_id) values(p_organization_id,p_project_id,p_request_id,checksum,result,auth.uid());
 return result||jsonb_build_object('replayed',false);
end $$;
create function public.get_project_campaign_placement_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 perform private.campaign_asset_write_authorized(p_organization_id,p_project_id);
 if p_request_id is null then raise exception 'Original placement request required' using errcode='22023';end if;
 select jsonb_build_object('request_id',request_id,'result',c.result,'created_at',created_at) into result from public.project_campaign_placement_commands c where organization_id=p_organization_id and project_id=p_project_id and request_id=p_request_id and actor_id=auth.uid();return result;
end $$;
create function public.list_project_campaign_placements(p_organization_id uuid,p_project_id uuid,p_campaign_id uuid default null,p_channel text default '',p_mode text default '',p_publication_state text default '',p_account_binding_id uuid default null,p_start_at timestamptz default null,p_end_at timestamptz default null,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare total bigint;matching bigint;items jsonb:='[]';row record;reference jsonb;reason text;contribution jsonb;result jsonb;project_zone text;
begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_channel is null or length(p_channel)>120 or p_channel~'[[:cntrl:]]' or p_mode is null or p_mode not in ('','organic','paid') or p_publication_state is null or p_publication_state not in ('','draft','planned','paused','cancelled','recorded_published') or p_query is null or length(p_query)>120 or p_query~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 or (p_start_at is null)<>(p_end_at is null) or (p_start_at is not null and (not isfinite(p_start_at) or not isfinite(p_end_at) or p_end_at<=p_start_at or p_end_at-p_start_at>interval '93 days')) then raise exception 'Explicit bounded current placement/calendar filters required' using errcode='22023';end if;
 select planning_timezone into project_zone from public.projects where id=p_project_id and organization_id=p_organization_id;
 select count(*) into total from public.project_campaign_placements where organization_id=p_organization_id and project_id=p_project_id;
 select count(*) into matching from public.project_campaign_placements p join lateral(select * from public.project_campaign_placement_revisions where placement_id=p.id order by revision_number desc limit 1) r on true
 where p.organization_id=p_organization_id and p.project_id=p_project_id and (p_campaign_id is null or p.campaign_id=p_campaign_id) and (p_channel='' or r.channel=p_channel) and (p_mode='' or r.mode=p_mode) and (p_publication_state='' or r.publication_state=p_publication_state) and (p_account_binding_id is null or r.account_binding_id=p_account_binding_id) and (p_start_at is null or (r.scheduled_at>=p_start_at and r.scheduled_at<p_end_at)) and (p_query='' or strpos(lower(r.channel||' '||coalesce(r.data->>'external_id','')||' '||coalesce(r.data#>>'{cta,label}','')),lower(p_query))>0);
 for row in select p.id,p.campaign_id,p.asset_id,p.created_at,r.id revision_id,r.revision_number,r.data,r.reference_snapshot,r.scheduled_at,r.project_task_id,r.engagement_work_item_id from public.project_campaign_placements p join lateral(select * from public.project_campaign_placement_revisions where placement_id=p.id order by revision_number desc limit 1) r on true
 where p.organization_id=p_organization_id and p.project_id=p_project_id and (p_campaign_id is null or p.campaign_id=p_campaign_id) and (p_channel='' or r.channel=p_channel) and (p_mode='' or r.mode=p_mode) and (p_publication_state='' or r.publication_state=p_publication_state) and (p_account_binding_id is null or r.account_binding_id=p_account_binding_id) and (p_start_at is null or (r.scheduled_at>=p_start_at and r.scheduled_at<p_end_at)) and (p_query='' or strpos(lower(r.channel||' '||coalesce(r.data->>'external_id','')||' '||coalesce(r.data#>>'{cta,label}','')),lower(p_query))>0)
 order by r.scheduled_at asc nulls last,p.created_at desc,p.id limit p_limit offset p_offset loop
 reference:=null;reason:=null;contribution:=null;
 begin reference:=private.campaign_placement_reference(p_organization_id,p_project_id,row.campaign_id,row.data);
 exception when sqlstate '42501' or sqlstate '55000' or sqlstate '22023' then reason:='canonical_source_or_context_unavailable';end;
 if row.project_task_id is not null then
 select jsonb_build_object('kind','project_task','id',t.id,'title',t.title,'assignee_id',t.assigned_to,'due_date',t.due_date,'status',t.status,'row_version',t.row_version) into contribution from public.tasks t where id=row.project_task_id and organization_id=p_organization_id and project_id=p_project_id and archived_at is null;
 elsif row.engagement_work_item_id is not null then
 select jsonb_build_object('kind','engagement_work_item','id',w.id,'title',w.title,'assignee_id',w.assignee_id,'due_date',w.due_date,'status',w.status,'row_version',w.row_version) into contribution from public.work_items w where id=row.engagement_work_item_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=(row.reference_snapshot#>>'{context,engagement_id}')::uuid and brand_id=(row.reference_snapshot#>>'{context,brand_id}')::uuid and deleted_at is null;
 end if;
 items:=items||jsonb_build_array(jsonb_build_object('placement_id',row.id,'campaign_id',row.campaign_id,'asset_id',row.asset_id,'revision_id',row.revision_id,'revision_number',row.revision_number,'data',row.data,'original_reference',row.reference_snapshot,'current_reference',reference,'current_contribution',contribution,'contribution_available',(row.project_task_id is null and row.engagement_work_item_id is null) or contribution is not null,'reason',reason,'internal_ready',false,'external_write_authorized',false));
 end loop;
 result:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'project_time_zone',project_zone,'items',items,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<matching,'start_at',p_start_at,'end_at',p_end_at);
 if octet_length(result::text)>131072 then raise exception 'Placement calendar exceeds whole bounded result' using errcode='22023';end if;return result;
end $$;
create function public.get_project_campaign_placement_history(p_organization_id uuid,p_project_id uuid,p_placement_id uuid,p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$declare total bigint;items jsonb;result jsonb;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_placement_id is null or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded exact placement history required' using errcode='22023';end if;
 perform 1 from public.project_campaign_placements where id=p_placement_id and project_id=p_project_id and organization_id=p_organization_id;
 if not found then raise exception 'Exact same-project placement required' using errcode='42501';end if;
 select count(*) into total from public.project_campaign_placement_revisions where placement_id=p_placement_id and organization_id=p_organization_id and project_id=p_project_id;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.revision_number desc),'[]'::jsonb) into items from(select * from public.project_campaign_placement_revisions where placement_id=p_placement_id and organization_id=p_organization_id and project_id=p_project_id order by revision_number desc limit p_limit offset p_offset) r;
 result:=jsonb_build_object('items',items,'total',total,'offset',p_offset,'has_more',p_offset+jsonb_array_length(items)<total);
 if octet_length(result::text)>131072 then raise exception 'Placement history exceeds whole bounded result' using errcode='22023';end if;return result;
end $$;
do $$declare f record;begin
 for f in select p.oid,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname in ('campaign_placement_url','campaign_placement_input','campaign_placement_reference','campaign_placement_preview')) or (n.nspname='public' and p.proname in ('preview_project_campaign_placement','confirm_project_campaign_placement','get_project_campaign_placement_operation','list_project_campaign_placements','get_project_campaign_placement_history')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.oid::regprocedure);end if;
 end loop;
end $$;
commit;
