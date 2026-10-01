-- Campaign planning metadata uses the unchanged canonical deliverable version writer.
-- Contributors are version references, never assignments or new approval authority.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('public.create_governed_deliverable_version(uuid,uuid,text,text,uuid,jsonb,boolean,uuid)'::regprocedure),chr(13),'')) is distinct from 'c74367bffa6d147a262435946c20177b'
 or md5(replace(pg_get_functiondef('private.p7_team(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '94fb5e71485592321c328ebe56838d85'
 or md5(replace(pg_get_functiondef('private.enforce_deliverable_version_transition()'::regprocedure),chr(13),'')) is distinct from '6ed3d00b330d8cc5a087767c7fe7f011'
 or md5(replace(pg_get_functiondef('private.p7_guard_deliverable_governance()'::regprocedure),chr(13),'')) is distinct from '7e511c9e31b9991e479c90163294e967'
 or md5(replace(pg_get_functiondef('private.capture_delivery_activity()'::regprocedure),chr(13),'')) is distinct from '207a94abb581df37b3ef4de4370c128d'
 or md5(replace(pg_get_functiondef('private.p7_replay(uuid,uuid,text,uuid,text)'::regprocedure),chr(13),'')) is distinct from '1c794f83e0bb72ca8cecb0a94cdea24c'
 or md5(replace(pg_get_functiondef('private.p7_record(uuid,uuid,text,uuid,text,jsonb)'::regprocedure),chr(13),'')) is distinct from 'c3242850ac3f035e9b900ab70f959e35'
 or md5(replace(pg_get_functiondef('private.reject_pipeline_template_mutation()'::regprocedure),chr(13),'')) is distinct from '8c3f3ac7f15e91b22826b54ac3b3c2cc'
 or md5(replace(pg_get_functiondef('private.campaign_asset_write_authorized(uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '0e5d5adb9725d9c984d6ba8ddb5f41eb'
 or md5(replace(pg_get_functiondef('private.marketing_opportunity_scope(uuid,uuid,uuid,uuid)'::regprocedure),chr(13),'')) is distinct from '89f4f923a1e2215ff19dab79fe37b642' then raise exception 'Exact canonical campaign deliverable prerequisites changed' using errcode='55000';end if;
end $$;
create table public.project_campaign_deliverable_plan_commands(
 organization_id uuid not null references public.organizations(id),request_id uuid not null,project_id uuid not null references public.projects(id),actor_id uuid not null references auth.users(id),payload_checksum text not null check(payload_checksum~'^[a-f0-9]{64}$'),receipt jsonb not null check(jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=131072),created_at timestamptz not null default clock_timestamp(),primary key(organization_id,request_id)
);
create index campaign_deliverable_plan_project_idx on public.project_campaign_deliverable_plan_commands(project_id);
create index campaign_deliverable_plan_actor_idx on public.project_campaign_deliverable_plan_commands(actor_id);
alter table public.project_campaign_deliverable_plan_commands enable row level security;
revoke all on public.project_campaign_deliverable_plan_commands from public,anon,authenticated,service_role;
create trigger campaign_deliverable_plan_receipt_immutable before update or delete on public.project_campaign_deliverable_plan_commands for each row execute function private.reject_pipeline_template_mutation();
-- Internal planning details never enter client-readable canonical preview metadata.
create table public.project_campaign_deliverable_plans(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),project_id uuid not null,engagement_id uuid not null references public.engagements(id),campaign_id uuid not null references public.marketing_campaigns(id),plan_version_id uuid not null references public.marketing_campaign_plan_versions(id),marketing_service_id uuid not null references public.engagement_services(id),deliverable_id uuid not null,deliverable_version_id uuid not null unique,input jsonb not null check(jsonb_typeof(input)='object' and octet_length(input::text)<=24576),scope_snapshot jsonb not null check(jsonb_typeof(scope_snapshot)='object' and octet_length(scope_snapshot::text)<=65536),created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id),foreign key(deliverable_version_id,deliverable_id,project_id,organization_id) references public.deliverable_versions(id,deliverable_id,project_id,organization_id)
);
create index campaign_deliverable_plans_project_idx on public.project_campaign_deliverable_plans(project_id,organization_id);
create index campaign_deliverable_plans_version_fk_idx on public.project_campaign_deliverable_plans(deliverable_version_id,deliverable_id,project_id,organization_id);
create index campaign_deliverable_plans_engagement_idx on public.project_campaign_deliverable_plans(engagement_id);
create index campaign_deliverable_plans_campaign_idx on public.project_campaign_deliverable_plans(campaign_id);
create index campaign_deliverable_plans_plan_idx on public.project_campaign_deliverable_plans(plan_version_id);
create index campaign_deliverable_plans_service_idx on public.project_campaign_deliverable_plans(marketing_service_id);
create index campaign_deliverable_plans_actor_idx on public.project_campaign_deliverable_plans(created_by);
alter table public.project_campaign_deliverable_plans enable row level security;
revoke all on public.project_campaign_deliverable_plans from public,anon,authenticated,service_role;
create trigger campaign_deliverable_plan_immutable before update or delete on public.project_campaign_deliverable_plans for each row execute function private.reject_pipeline_template_mutation();
create function private.campaign_deliverable_plan_input(p_input jsonb) returns jsonb language plpgsql immutable set search_path='' as $$declare k text;due date;begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>24576 or (select count(*) from jsonb_object_keys(p_input))<>10 or not(p_input ?& array['title','brief','format','content_pillar','topic','due_date','contributor_ids','change_summary','source_version_id','client_approval_required']) then raise exception 'Exact bounded deliverable planning fields required' using errcode='22023';end if;
 foreach k in array array['title','brief','format','content_pillar','topic','change_summary'] loop
 if jsonb_typeof(p_input->k) is distinct from 'string' or length(p_input->>k)>(case k when 'title' then 240 when 'brief' then 12000 when 'format' then 240 when 'change_summary' then 1000 else 500 end) or (k in ('title','brief','format') and length(trim(p_input->>k))=0) then raise exception 'Typed bounded % required',k using errcode='22023';end if;end loop;
 if jsonb_typeof(p_input->'client_approval_required') is distinct from 'boolean' or jsonb_typeof(p_input->'contributor_ids') is distinct from 'array' or jsonb_array_length(p_input->'contributor_ids')>20 then raise exception 'Exact contributor references/approval requirement required' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_input->'contributor_ids') v where jsonb_typeof(v)<>'string' or (v#>>'{}') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') or (select count(*)<>count(distinct value::uuid) from jsonb_array_elements_text(p_input->'contributor_ids')) then raise exception 'Distinct exact existing contributor UUIDs required' using errcode='22023';end if;
 if p_input->'source_version_id'<>'null'::jsonb and (jsonb_typeof(p_input->'source_version_id')<>'string' or (p_input->>'source_version_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') then raise exception 'Exact source deliverable version required' using errcode='22023';end if;
 if p_input->'due_date'<>'null'::jsonb then
 if jsonb_typeof(p_input->'due_date')<>'string' or (p_input->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Exact planned version deadline required' using errcode='22023';end if;due:=(p_input->>'due_date')::date;if not isfinite(due) or to_char(due,'YYYY-MM-DD')<>p_input->>'due_date' then raise exception 'Actual planned version deadline required' using errcode='22023';end if;end if;return p_input;
end $$;
create function private.campaign_deliverable_plan_review(p_org uuid,p_project uuid,p_engagement uuid,p_service uuid,p_campaign uuid,p_plan uuid,p_deliverable uuid,p_expected uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$declare context jsonb;c public.marketing_campaigns%rowtype;plan public.marketing_campaign_plan_versions%rowtype;d public.deliverables%rowtype;w public.workstreams%rowtype;source public.deliverable_versions%rowtype;m record;contributor uuid;member record;contributors jsonb:='[]';snapshot jsonb;result jsonb;begin
 perform private.campaign_deliverable_plan_input(p_input);context:=private.marketing_opportunity_scope(p_org,p_project,p_engagement,p_service);
 select * into c from public.marketing_campaigns where id=p_campaign and organization_id=p_org and engagement_id=p_engagement and brand_id=(context->>'brand_id')::uuid and status<>'cancelled' for share;
 if not found then raise exception 'Exact active project campaign required' using errcode='42501';end if;
 select * into plan from public.marketing_campaign_plan_versions where id=p_plan and organization_id=p_org and campaign_id=c.id and engagement_id=p_engagement and brand_id=c.brand_id for share;
 if not found then raise exception 'Explicit exact campaign plan version required' using errcode='42501';end if;
 select * into d from public.deliverables where id=p_deliverable and organization_id=p_org and project_id=p_project and archived_at is null and status not in ('withdrawn','archived') for update;
 if not found then raise exception 'Exact current existing Project deliverable required' using errcode='42501';end if;
 select * into w from public.workstreams where id=d.workstream_id and organization_id=p_org and project_id=p_project and status in ('planned','active') for share;
 if not found then raise exception 'Exact active deliverable workstream required' using errcode='42501';end if;
 select role,department_id into m from public.organization_memberships where organization_id=p_org and user_id=auth.uid() and member_kind='team' and status='active' for share;
 if not private.p7_team(p_org,auth.uid()) or not found or not(m.department_id=w.department_id or m.role in ('system_owner','operations_admin','executive') or (m.role='project_owner' and exists(select 1 from public.projects where id=p_project and organization_id=p_org and owner_id=auth.uid()))) then raise exception 'Unchanged canonical deliverable authoring authority required' using errcode='42501';end if;
 if d.current_version_id is distinct from p_expected then raise exception 'Deliverable current version changed; reload before review' using errcode='40001';end if;
 if p_input->'source_version_id'<>'null'::jsonb then
 select * into source from public.deliverable_versions where id=(p_input->>'source_version_id')::uuid and organization_id=p_org and project_id=p_project and deliverable_id=d.id and withdrawn_at is null for share;
 if not found then raise exception 'Exact unwithdrawn same-deliverable source version required' using errcode='42501';end if;end if;
 for contributor in select value::uuid from jsonb_array_elements_text(p_input->'contributor_ids') order by value::uuid loop
 select id,user_id,role,department_id,member_kind,status into member from public.organization_memberships where organization_id=p_org and user_id=contributor and member_kind='team' and status='active' for share;
 if not found then raise exception 'Existing active same-organization Team contributor required' using errcode='42501';end if;contributors:=contributors||jsonb_build_array(to_jsonb(member));end loop;
 snapshot:=jsonb_build_object('context',context,'campaign',to_jsonb(c),'plan',jsonb_build_object('id',plan.id,'campaign_id',plan.campaign_id,'version_number',plan.version_number,'checksum',encode(sha256(convert_to(to_jsonb(plan)::text,'UTF8')),'hex')),'deliverable',jsonb_build_object('id',d.id,'organization_id',d.organization_id,'project_id',d.project_id,'workstream_id',d.workstream_id,'title',d.title,'status',d.status,'current_version_id',d.current_version_id,'owner_id',d.owner_id,'due_date',d.due_date,'updated_at',d.updated_at),'workstream',to_jsonb(w),'contributors',contributors,'source',case when source.id is null then null else jsonb_build_object('id',source.id,'deliverable_id',source.deliverable_id,'version_number',source.version_number,'file_id',source.file_id,'state_version',source.state_version,'review_status',source.review_status,'checksum',encode(sha256(convert_to(to_jsonb(source)::text,'UTF8')),'hex')) end,'approval_state','unapproved_new_version','ready_to_publish',false,'external_write_authorized',false);
 if octet_length(snapshot::text)>65536 then raise exception 'Deliverable planning snapshot exceeds bounds' using errcode='22023';end if;
 result:=jsonb_build_object('input',p_input,'snapshot',snapshot);return result||jsonb_build_object('zero_write',true,'review_checksum',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end $$;
create function public.preview_project_campaign_deliverable_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_marketing_service_id uuid,p_campaign_id uuid,p_plan_version_id uuid,p_deliverable_id uuid,p_expected_current_version_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin return private.campaign_deliverable_plan_review(p_organization_id,p_project_id,p_engagement_id,p_marketing_service_id,p_campaign_id,p_plan_version_id,p_deliverable_id,p_expected_current_version_id,p_input);end $$;
create function public.confirm_project_campaign_deliverable_plan(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_marketing_service_id uuid,p_campaign_id uuid,p_plan_version_id uuid,p_deliverable_id uuid,p_expected_current_version_id uuid,p_input jsonb,p_review_checksum text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare prior public.project_campaign_deliverable_plan_commands%rowtype;payload text;review jsonb;saved jsonb;version public.deliverable_versions%rowtype;receipt jsonb;metadata jsonb;link public.project_campaign_deliverable_plans%rowtype;begin
 if p_request_id is null or p_review_checksum is null or p_review_checksum !~ '^[a-f0-9]{64}$' then raise exception 'Original UUID and exact reviewed deliverable plan required' using errcode='22023';end if;
 perform private.campaign_deliverable_plan_input(p_input);perform private.marketing_opportunity_scope(p_organization_id,p_project_id,p_engagement_id,p_marketing_service_id);
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':campaign-deliverable-plan-command:'||p_request_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'marketing_service_id',p_marketing_service_id,'campaign_id',p_campaign_id,'plan_version_id',p_plan_version_id,'deliverable_id',p_deliverable_id,'expected_current_version_id',p_expected_current_version_id,'input',p_input,'review_checksum',p_review_checksum)::text,'UTF8')),'hex');
 select * into prior from public.project_campaign_deliverable_plan_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then if prior.actor_id is distinct from auth.uid() or prior.project_id is distinct from p_project_id or prior.payload_checksum is distinct from payload then raise exception 'Original deliverable plan identity/payload conflict' using errcode='23505';end if;return prior.receipt;end if;
 -- Acquire the unchanged P7 UUID lock before the deliverable lock, including Legacy collisions.
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||auth.uid()::text||':create:'||p_request_id::text,0));
 if exists(select 1 from public.deliverable_action_requests where organization_id=p_organization_id and actor_id=auth.uid() and action='create' and request_id=p_request_id) then raise exception 'Original UUID already belongs to a canonical deliverable action' using errcode='23505';end if;
 review:=private.campaign_deliverable_plan_review(p_organization_id,p_project_id,p_engagement_id,p_marketing_service_id,p_campaign_id,p_plan_version_id,p_deliverable_id,p_expected_current_version_id,p_input);
 if review->>'review_checksum' is distinct from p_review_checksum then raise exception 'Deliverable plan references changed; review again' using errcode='40001';end if;
 metadata:='{}'::jsonb;
 if p_input->'source_version_id'<>'null'::jsonb then select preview_metadata into metadata from public.deliverable_versions where id=(p_input->>'source_version_id')::uuid and organization_id=p_organization_id and project_id=p_project_id and deliverable_id=p_deliverable_id;end if;
 if octet_length(metadata::text)>65536 then raise exception 'Canonical deliverable planning metadata exceeds bounds' using errcode='22023';end if;
 saved:=public.create_governed_deliverable_version(p_organization_id,p_deliverable_id,p_input->>'title',p_input->>'change_summary',(review#>>'{snapshot,source,file_id}')::uuid,metadata,(p_input->>'client_approval_required')::boolean,p_request_id);
 select * into version from public.deliverable_versions where id=(saved->>'deliverable_version_id')::uuid and organization_id=p_organization_id and project_id=p_project_id and deliverable_id=p_deliverable_id;
 if not found or version.created_by is distinct from auth.uid() or version.review_status<>'in_production' or version.state_version<>1 or version.preview_metadata is distinct from metadata then raise exception 'Exact new canonical deliverable version receipt changed' using errcode='55000';end if;
 if not exists(select 1 from public.activity_events where organization_id=p_organization_id and project_id=p_project_id and actor_id=auth.uid() and target_id=version.id and target_type='deliverable_versions' and action='deliverable.version_created') then raise exception 'Canonical deliverable activity audit ownership mismatch' using errcode='42501';end if;
 insert into public.project_campaign_deliverable_plans(organization_id,project_id,engagement_id,campaign_id,plan_version_id,marketing_service_id,deliverable_id,deliverable_version_id,input,scope_snapshot,created_by) values(p_organization_id,p_project_id,p_engagement_id,p_campaign_id,p_plan_version_id,p_marketing_service_id,p_deliverable_id,version.id,p_input,review->'snapshot',auth.uid()) returning * into link;
 receipt:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'marketing_service_id',p_marketing_service_id,'campaign_id',p_campaign_id,'plan_version_id',p_plan_version_id,'deliverable_id',p_deliverable_id,'request_id',p_request_id,'actor_id',auth.uid(),'version',to_jsonb(version),'planning',to_jsonb(link),'original_snapshot',review->'snapshot','approval_state','unapproved_new_version','ready_to_publish',false,'external_write_authorized',false,'assignments_changed',false,'provider_verified',false);
 if octet_length(receipt::text)>131072 then raise exception 'Canonical deliverable plan receipt exceeds bounds' using errcode='22023';end if;
 insert into public.project_campaign_deliverable_plan_commands(organization_id,request_id,project_id,actor_id,payload_checksum,receipt) values(p_organization_id,p_request_id,p_project_id,auth.uid(),payload,receipt);return receipt;
end $$;
create function public.get_project_campaign_deliverable_plan_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare receipt jsonb;begin perform private.website_read_authorized(p_organization_id,p_project_id);if p_request_id is null then raise exception 'Original UUID required' using errcode='22023';end if;select c.receipt into receipt from public.project_campaign_deliverable_plan_commands c where organization_id=p_organization_id and project_id=p_project_id and actor_id=auth.uid() and request_id=p_request_id;return receipt;end $$;
revoke all on function private.campaign_deliverable_plan_input(jsonb),private.campaign_deliverable_plan_review(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.preview_project_campaign_deliverable_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb),public.confirm_project_campaign_deliverable_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,uuid),public.get_project_campaign_deliverable_plan_operation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_project_campaign_deliverable_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb),public.confirm_project_campaign_deliverable_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,uuid),public.get_project_campaign_deliverable_plan_operation(uuid,uuid,uuid) to authenticated;
commit;
