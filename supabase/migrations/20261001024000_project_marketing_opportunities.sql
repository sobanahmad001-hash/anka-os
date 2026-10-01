-- Project research observations and reviewed links to existing governed Project Tasks.
-- Reuse canonical backlink targets; never create/copy work, contact sites or submit externally.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if (select md5(string_agg(conname||':'||pg_get_constraintdef(oid),E'\n' order by conname)) from pg_constraint where conrelid='public.backlink_targets'::regclass) is distinct from '82ad00725870d375ecde106a5b3ded7f'
 or (select md5(string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),E'\n' order by ordinal_position)) from information_schema.columns where table_schema='public' and table_name='backlink_targets') is distinct from '7efb01e74254191c5ecd24d2aa06163d'
 or (select md5(string_agg(conname||':'||pg_get_constraintdef(oid),E'\n' order by conname)) from pg_constraint where conrelid='public.tasks'::regclass) is distinct from '3467a3dafcd9b9ea7a476e74ea4724fa'
 or md5(replace(pg_get_functiondef('private.campaign_asset_write_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '0e5d5adb9725d9c984d6ba8ddb5f41eb'
 or md5(replace(pg_get_functiondef('private.website_read_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '339ae8372edf7afa3115655da7a2255f'
 or (select md5(prosrc) from pg_proc where oid='private.p7_assignment_authority(uuid,uuid,text,uuid)'::regprocedure) is distinct from '0e2dbef44ce9c734f375116a4169e394'
 or md5(replace(pg_get_functiondef('private.reject_pipeline_template_mutation()'::regprocedure),chr(13),'')) is distinct from '8c3f3ac7f15e91b22826b54ac3b3c2cc' then raise exception 'Exact opportunity/Task/authority prerequisites changed' using errcode='55000';end if;
end $$;
create table public.project_marketing_opportunities(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),project_id uuid not null references public.projects(id),engagement_id uuid not null references public.engagements(id),brand_id uuid not null references public.brands(id),marketing_service_id uuid not null references public.engagement_services(id),
 original_target_id uuid not null,candidate_kind text not null check(candidate_kind in ('directory','publication')),normalized_site_url text not null check(length(normalized_site_url) between 1 and 2048),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(id,organization_id),unique(organization_id,project_id,candidate_kind,normalized_site_url),
 foreign key(original_target_id,organization_id) references public.backlink_targets(id,organization_id) on delete restrict
);
create index marketing_opportunity_project_idx on public.project_marketing_opportunities(project_id);
create index marketing_opportunity_engagement_idx on public.project_marketing_opportunities(engagement_id);
create index marketing_opportunity_brand_idx on public.project_marketing_opportunities(brand_id);
create index marketing_opportunity_service_idx on public.project_marketing_opportunities(marketing_service_id);
create index marketing_opportunity_target_idx on public.project_marketing_opportunities(original_target_id,organization_id);
create index marketing_opportunity_actor_idx on public.project_marketing_opportunities(created_by);
create table public.project_marketing_opportunity_observations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,candidate_id uuid not null,target_id uuid not null,source_url text not null check(length(source_url) between 1 and 2048),observed_on date not null check(isfinite(observed_on)),notes text not null check(length(notes)<=4000),
 target_snapshot jsonb not null check(jsonb_typeof(target_snapshot)='object' and octet_length(target_snapshot::text)<=32768),target_checksum text not null check(target_checksum~'^[0-9a-f]{64}$'),created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(id,organization_id),
 foreign key(candidate_id,organization_id) references public.project_marketing_opportunities(id,organization_id) on delete restrict,
 foreign key(target_id,organization_id) references public.backlink_targets(id,organization_id) on delete restrict
);
create index marketing_opportunity_observation_candidate_idx on public.project_marketing_opportunity_observations(candidate_id,organization_id,created_at desc,id);
create index marketing_opportunity_observation_target_idx on public.project_marketing_opportunity_observations(target_id,organization_id);
create index marketing_opportunity_observation_actor_idx on public.project_marketing_opportunity_observations(created_by);
create table public.project_marketing_opportunity_task_links(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,candidate_id uuid not null,observation_id uuid not null,task_id uuid not null references public.tasks(id),
 reference_snapshot jsonb not null check(jsonb_typeof(reference_snapshot)='object' and octet_length(reference_snapshot::text)<=65536),created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(candidate_id,task_id),unique(id,organization_id),
 foreign key(candidate_id,organization_id) references public.project_marketing_opportunities(id,organization_id) on delete restrict,
 foreign key(observation_id,organization_id) references public.project_marketing_opportunity_observations(id,organization_id) on delete restrict
);
create index marketing_opportunity_task_idx on public.project_marketing_opportunity_task_links(task_id);
create index marketing_opportunity_task_observation_idx on public.project_marketing_opportunity_task_links(observation_id,organization_id);
create index marketing_opportunity_task_actor_idx on public.project_marketing_opportunity_task_links(created_by);
create table public.project_marketing_opportunity_commands(
 organization_id uuid not null references public.organizations(id),request_id uuid not null,project_id uuid not null references public.projects(id),actor_id uuid not null references auth.users(id),command_kind text not null check(command_kind in ('record_research','link_task')),
 payload_checksum text not null check(payload_checksum~'^[0-9a-f]{64}$'),receipt jsonb not null check(jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=131072),created_at timestamptz not null default clock_timestamp(),primary key(organization_id,request_id)
);
create index marketing_opportunity_command_project_idx on public.project_marketing_opportunity_commands(project_id);
create index marketing_opportunity_command_actor_idx on public.project_marketing_opportunity_commands(actor_id);
do $$declare t text;begin foreach t in array array['project_marketing_opportunities','project_marketing_opportunity_observations','project_marketing_opportunity_task_links','project_marketing_opportunity_commands'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('create trigger %I before update or delete on public.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);end loop;end $$;
create function private.marketing_opportunity_url(p_url text) returns text language plpgsql security definer set search_path='' as $$declare parts text[];port integer;begin
 if p_url is null or length(p_url) not between 1 and 2048 or p_url~'[[:space:]\\]' then raise exception 'Explicit safe HTTP(S) research URL required' using errcode='22023';end if;
 parts:=regexp_match(p_url,'^(https?)://([[:alnum:].-]+)(:([0-9]{1,5}))?(/[^?#[:space:]]*)?([?][^#[:space:]]*)?(#[^[:space:]]*)?$','i');
 if parts is null or parts[2] like '.%' or parts[2] like '%.' or parts[2] like '%..%' then raise exception 'Explicit safe HTTP(S) research URL required' using errcode='22023';end if;
 port:=parts[4]::integer;if port is not null and port not between 1 and 65535 then raise exception 'Valid URL port required' using errcode='22023';end if;
 -- Safe syntactic equivalence only. Keep scheme, path case and query identity; do not infer redirects or provider capability.
 return lower(parts[1])||'://'||lower(parts[2])||case when port is null or lower(parts[1])='https' and port=443 or lower(parts[1])='http' and port=80 then '' else ':'||port::text end||regexp_replace(coalesce(parts[5],''),'/$','')||coalesce(parts[6],'');
end $$;
create function private.marketing_opportunity_input(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare d date;begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>8192 or p_input->>'command_kind' is null then raise exception 'Bounded explicit opportunity command required' using errcode='22023';end if;
 if p_input->>'command_kind'='record_research' then
 if (select count(*) from jsonb_object_keys(p_input))<>6 or not p_input ?& array['command_kind','target_id','candidate_kind','source_url','observed_on','notes'] or p_input->>'candidate_kind' not in ('directory','publication') or jsonb_typeof(p_input->'candidate_kind')<>'string' or jsonb_typeof(p_input->'target_id')<>'string' or jsonb_typeof(p_input->'source_url')<>'string' or jsonb_typeof(p_input->'observed_on')<>'string' or p_input->>'observed_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(p_input->'notes')<>'string' or length(p_input->>'notes')>4000 then raise exception 'Exact candidate/source/date/notes required' using errcode='22023';end if;
 perform (p_input->>'target_id')::uuid;perform private.marketing_opportunity_url(p_input->>'source_url');d:=(p_input->>'observed_on')::date;if not isfinite(d) or d>current_date then raise exception 'Actual research date required' using errcode='22023';end if;
 elsif p_input->>'command_kind'='link_task' then
 if (select count(*) from jsonb_object_keys(p_input))<>4 or not p_input ?& array['command_kind','candidate_id','observation_id','task_id'] or jsonb_typeof(p_input->'candidate_id')<>'string' or jsonb_typeof(p_input->'observation_id')<>'string' or jsonb_typeof(p_input->'task_id')<>'string' then raise exception 'Exact candidate/observation/Project Task required' using errcode='22023';end if;
 perform (p_input->>'candidate_id')::uuid;perform (p_input->>'observation_id')::uuid;perform (p_input->>'task_id')::uuid;
 else raise exception 'Unsupported opportunity command' using errcode='22023';end if;return p_input;
end $$;
create function private.marketing_opportunity_scope(p_org uuid,p_project uuid,p_engagement uuid,p_service uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare e public.engagements%rowtype;service record;begin
 perform private.campaign_asset_write_authorized(p_org,p_project);
 select * into e from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project and status in ('planning','active') for share;
 if not found then raise exception 'Active exact project engagement required' using errcode='42501';end if;
 select es.id,es.service_id,es.status,es.owner_id,es.target_date,es.activated_by,es.activated_at,sc.name into service from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id where es.id=p_service and es.organization_id=p_org and es.engagement_id=e.id and es.status='active' and sc.is_active and sc.department_id='marketing' for share of es,sc;
 if not found then raise exception 'Existing active exact Marketing service required' using errcode='42501';end if;
 return jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',e.id,'brand_id',e.brand_id,'marketing_service_id',p_service,'actor_id',auth.uid(),'service',to_jsonb(service),'external_write_authorized',false);
end $$;
create function private.marketing_opportunity_review(p_org uuid,p_project uuid,p_engagement uuid,p_service uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$declare input jsonb;context jsonb;target public.backlink_targets%rowtype;candidate public.project_marketing_opportunities%rowtype;observation public.project_marketing_opportunity_observations%rowtype;task public.tasks%rowtype;existing_link public.project_marketing_opportunity_task_links%rowtype;original_observation public.project_marketing_opportunity_observations%rowtype;url text;target_json jsonb;reference jsonb;result jsonb;begin
 input:=private.marketing_opportunity_input(p_input);context:=private.marketing_opportunity_scope(p_org,p_project,p_engagement,p_service);
 if input->>'command_kind'='record_research' then
 select * into target from public.backlink_targets where id=(input->>'target_id')::uuid and organization_id=p_org and brand_id=(context->>'brand_id')::uuid for share;
 if not found or target.site_url is null then raise exception 'Existing canonical same-brand target with exact destination URL required' using errcode='42501';end if;
 url:=private.marketing_opportunity_url(target.site_url);
 select * into candidate from public.project_marketing_opportunities where organization_id=p_org and project_id=p_project and candidate_kind=input->>'candidate_kind' and normalized_site_url=url;
 if found and (candidate.engagement_id is distinct from p_engagement or candidate.brand_id::text is distinct from context->>'brand_id' or candidate.marketing_service_id is distinct from p_service) then raise exception 'Existing deduped opportunity scope differs; use its original engagement/service' using errcode='42501';end if;
 target_json:=to_jsonb(target);
 if octet_length(target_json::text)>32768 then raise exception 'Canonical manual target descriptor exceeds bound' using errcode='22023';end if;
 reference:=jsonb_build_object('context',context,'target',target_json,'target_checksum',encode(sha256(convert_to(target_json::text,'UTF8')),'hex'),'normalized_site_url',url,'existing_candidate_id',candidate.id,'existing_original_target_id',candidate.original_target_id,'research_only',true,'provider_verified',false);
 else
 select * into candidate from public.project_marketing_opportunities where id=(input->>'candidate_id')::uuid and organization_id=p_org and project_id=p_project and engagement_id=p_engagement and marketing_service_id=p_service and brand_id=(context->>'brand_id')::uuid for share;
 if not found then raise exception 'Exact current-project/service opportunity required' using errcode='42501';end if;
 select * into observation from public.project_marketing_opportunity_observations where id=(input->>'observation_id')::uuid and candidate_id=candidate.id and organization_id=p_org for share;
 if not found then raise exception 'Explicit original observation/source/date required' using errcode='42501';end if;
 select * into target from public.backlink_targets where id=observation.target_id and organization_id=p_org and brand_id=candidate.brand_id for share;
 if not found or encode(sha256(convert_to(to_jsonb(target)::text,'UTF8')),'hex') is distinct from observation.target_checksum or private.marketing_opportunity_url(target.site_url) is distinct from candidate.normalized_site_url then raise exception 'Current canonical target changed; record reviewed research again' using errcode='40001';end if;
 select * into task from public.tasks where id=(input->>'task_id')::uuid and organization_id=p_org and project_id=p_project and archived_at is null and department_id='marketing' and status<>'cancelled' for share;
 if not found then raise exception 'Existing active same-project Marketing Project Task required; Work Items stay separate' using errcode='42501';end if;
 select * into existing_link from public.project_marketing_opportunity_task_links where candidate_id=candidate.id and task_id=task.id;
 if existing_link.id is not null then select * into original_observation from public.project_marketing_opportunity_observations where id=existing_link.observation_id and organization_id=p_org;end if;
 reference:=jsonb_build_object('context',context,'candidate_id',candidate.id,'observation',to_jsonb(observation),'target',to_jsonb(target),'task',jsonb_build_object('kind','project_task','id',task.id,'organization_id',task.organization_id,'project_id',task.project_id,'title',task.title,'department_id',task.department_id,'row_version',task.row_version,'assignee_id',task.assigned_to,'due_date',task.due_date,'status',task.status),'existing_link_id',existing_link.id,'existing_task_link',case when existing_link.id is null then null else jsonb_build_object('id',existing_link.id,'observation_id',existing_link.observation_id,'created_by',existing_link.created_by,'created_at',existing_link.created_at,'original_task',existing_link.reference_snapshot->'task','original_research',jsonb_build_object('source_url',original_observation.source_url,'observed_on',original_observation.observed_on,'target_checksum',original_observation.target_checksum)) end,'research_only',false,'provider_verified',false,'ready_to_submit',false);
 end if;
 if octet_length(reference::text)>65536 then raise exception 'Opportunity review exceeds bounded reference' using errcode='22023';end if;
 result:=jsonb_build_object('input',input,'reference',reference,'zero_write',true);return result||jsonb_build_object('review_checksum',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end $$;
create function public.preview_project_marketing_opportunity(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_marketing_service_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin return private.marketing_opportunity_review(p_organization_id,p_project_id,p_engagement_id,p_marketing_service_id,p_input);end $$;
create function public.confirm_project_marketing_opportunity(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_marketing_service_id uuid,p_input jsonb,p_review_checksum text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare context jsonb;prior public.project_marketing_opportunity_commands%rowtype;review jsonb;payload text;candidate public.project_marketing_opportunities%rowtype;observation public.project_marketing_opportunity_observations%rowtype;link public.project_marketing_opportunity_task_links%rowtype;receipt jsonb;begin
 if p_request_id is null or p_review_checksum is null or p_review_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Original UUID and exact reviewed research/work link required' using errcode='22023';end if;
 perform private.marketing_opportunity_input(p_input);context:=private.marketing_opportunity_scope(p_organization_id,p_project_id,p_engagement_id,p_marketing_service_id);
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':marketing-opportunity-command:'||p_request_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'marketing_service_id',p_marketing_service_id,'input',p_input,'review_checksum',p_review_checksum)::text,'UTF8')),'hex');
 select * into prior from public.project_marketing_opportunity_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then if prior.actor_id is distinct from auth.uid() or prior.project_id is distinct from p_project_id or prior.command_kind is distinct from p_input->>'command_kind' or prior.payload_checksum is distinct from payload then raise exception 'Original opportunity operation identity/payload conflict' using errcode='23505';end if;return prior.receipt;end if;
 review:=private.marketing_opportunity_review(p_organization_id,p_project_id,p_engagement_id,p_marketing_service_id,p_input);
 if review->>'review_checksum' is distinct from p_review_checksum then raise exception 'Opportunity/work reference changed; review again' using errcode='40001';end if;
 if p_input->>'command_kind'='record_research' then
 if review#>>'{reference,existing_candidate_id}' is null then
 insert into public.project_marketing_opportunities(organization_id,project_id,engagement_id,brand_id,marketing_service_id,original_target_id,candidate_kind,normalized_site_url,created_by)
 values(p_organization_id,p_project_id,p_engagement_id,(context->>'brand_id')::uuid,p_marketing_service_id,(p_input->>'target_id')::uuid,p_input->>'candidate_kind',review#>>'{reference,normalized_site_url}',auth.uid()) returning * into candidate;
 else select * into candidate from public.project_marketing_opportunities where id=(review#>>'{reference,existing_candidate_id}')::uuid;end if;
 insert into public.project_marketing_opportunity_observations(organization_id,candidate_id,target_id,source_url,observed_on,notes,target_snapshot,target_checksum,created_by)
 values(p_organization_id,candidate.id,(p_input->>'target_id')::uuid,p_input->>'source_url',(p_input->>'observed_on')::date,p_input->>'notes',review#>'{reference,target}',review#>>'{reference,target_checksum}',auth.uid()) returning * into observation;
 else
 select * into candidate from public.project_marketing_opportunities where id=(p_input->>'candidate_id')::uuid;
 select * into observation from public.project_marketing_opportunity_observations where id=(p_input->>'observation_id')::uuid;
 if review#>>'{reference,existing_link_id}' is null then
 insert into public.project_marketing_opportunity_task_links(organization_id,candidate_id,observation_id,task_id,reference_snapshot,created_by) values(p_organization_id,candidate.id,observation.id,(p_input->>'task_id')::uuid,review->'reference',auth.uid()) returning * into link;
 else select * into link from public.project_marketing_opportunity_task_links where id=(review#>>'{reference,existing_link_id}')::uuid;select * into observation from public.project_marketing_opportunity_observations where id=link.observation_id and organization_id=p_organization_id;end if;
 end if;
 receipt:=jsonb_build_object('request_id',p_request_id,'command_kind',p_input->>'command_kind','organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'marketing_service_id',p_marketing_service_id,'brand_id',candidate.brand_id,'actor_id',auth.uid(),'deduplicated',case when p_input->>'command_kind'='record_research' then review#>>'{reference,existing_candidate_id}' is not null else review#>>'{reference,existing_link_id}' is not null end,'requested_observation_id',case when p_input->>'command_kind'='link_task' then (p_input->>'observation_id')::uuid else null end,'candidate',to_jsonb(candidate),'observation',to_jsonb(observation),'task_link',case when link.id is null then null else to_jsonb(link) end,'provider_verified',false,'external_write_authorized',false,'work_created',false,'ready_to_submit',false);
 if octet_length(receipt::text)>131072 then raise exception 'Opportunity receipt exceeds whole bound' using errcode='22023';end if;
 insert into public.project_marketing_opportunity_commands(organization_id,request_id,project_id,actor_id,command_kind,payload_checksum,receipt) values(p_organization_id,p_request_id,p_project_id,auth.uid(),p_input->>'command_kind',payload,receipt);return receipt;
end $$;
create function public.get_project_marketing_opportunity_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare receipt jsonb;begin perform private.website_read_authorized(p_organization_id,p_project_id);if p_request_id is null then raise exception 'Original UUID required' using errcode='22023';end if;select c.receipt into receipt from public.project_marketing_opportunity_commands c where organization_id=p_organization_id and project_id=p_project_id and request_id=p_request_id and actor_id=auth.uid();return receipt;end $$;
revoke all on function private.marketing_opportunity_url(text),private.marketing_opportunity_input(jsonb),private.marketing_opportunity_scope(uuid,uuid,uuid,uuid),private.marketing_opportunity_review(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.preview_project_marketing_opportunity(uuid,uuid,uuid,uuid,jsonb),public.confirm_project_marketing_opportunity(uuid,uuid,uuid,uuid,jsonb,text,uuid),public.get_project_marketing_opportunity_operation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_project_marketing_opportunity(uuid,uuid,uuid,uuid,jsonb),public.confirm_project_marketing_opportunity(uuid,uuid,uuid,uuid,jsonb,text,uuid),public.get_project_marketing_opportunity_operation(uuid,uuid,uuid) to authenticated;
commit;
