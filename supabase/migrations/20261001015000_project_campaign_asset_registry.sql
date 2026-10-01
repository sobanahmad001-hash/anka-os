-- AD2: explicit shared canonical campaign sources/variants, with no new work,
-- assignments, approval, publication, provider or spend authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $$ begin
 if (select md5(prosrc) from pg_proc where oid='private.p7_assignment_authority(uuid,uuid,text,uuid)'::regprocedure) is distinct from '0e2dbef44ce9c734f375116a4169e394'
 or (select md5(prosrc) from pg_proc where oid='private.n1e_org_authority(uuid,uuid,uuid)'::regprocedure) is distinct from 'f62c0fe02b7bd9bcea653eef67074f12'
 or (select md5(prosrc) from pg_proc where oid='private.n1e_exact_project_manager(uuid,uuid,uuid)'::regprocedure) is distinct from '4ec5a0c9e1b39ae7cb355333be82b215'
 or (select md5(prosrc) from pg_proc where oid='private.n1e_department_head(uuid,uuid,text,uuid)'::regprocedure) is distinct from '11da14e00954fba787469db539566712'
 or (select md5(prosrc) from pg_proc where oid='private.is_active_pipeline_team_member(uuid)'::regprocedure) is distinct from '0086b96c891eab246432459644fa3051'
 or (select md5(prosrc) from pg_proc where oid='private.reject_pipeline_template_mutation()'::regprocedure) is distinct from 'e92e564d284492c95b668f6645defa25'
 or (select md5(prosrc) from pg_proc where oid='private.n1c_require_scope(uuid,uuid,uuid)'::regprocedure) is distinct from '9e992a3676cefb89791ff27ba12fb389'
 or md5(replace(pg_get_functiondef('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)'::regprocedure),chr(13),'')) is distinct from '033f6c233c35b8c2641716b861a63cd2' then
 raise exception 'Exact campaign authority/source prerequisites changed' using errcode='55000';end if;
end $$;
create table public.project_campaign_assets(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,brand_id uuid not null,
 source_kind text not null check(source_kind in ('artifact_version','deliverable_version')),
 source_root_id uuid not null,source_version_id uuid not null,artifact_root_id uuid,artifact_version_id uuid,deliverable_root_id uuid,deliverable_version_id uuid,source_reference_checksum text not null check(source_reference_checksum~'^[a-f0-9]{64}$'),
 source_descriptor jsonb not null check(jsonb_typeof(source_descriptor)='object'),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
 foreign key(brand_id,organization_id) references public.brands(id,organization_id) on delete restrict,
 foreign key(artifact_root_id,organization_id) references public.artifacts(id,organization_id) on delete restrict,
 foreign key(artifact_root_id,artifact_version_id,organization_id) references public.artifact_versions(artifact_id,id,organization_id) on delete restrict,
 foreign key(deliverable_version_id,deliverable_root_id,project_id,organization_id) references public.deliverable_versions(id,deliverable_id,project_id,organization_id) on delete restrict,
 check((source_kind='artifact_version' and artifact_root_id is not null and artifact_version_id is not null and artifact_root_id=source_root_id and artifact_version_id=source_version_id and deliverable_root_id is null and deliverable_version_id is null) or (source_kind='deliverable_version' and deliverable_root_id is not null and deliverable_version_id is not null and deliverable_root_id=source_root_id and deliverable_version_id=source_version_id and artifact_root_id is null and artifact_version_id is null)),
 unique(id,organization_id),unique(id,project_id,organization_id),unique(organization_id,project_id,brand_id,source_kind,source_version_id)
);
create table public.project_campaign_asset_links(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,asset_id uuid not null,
 campaign_id uuid not null,plan_version_id uuid not null,marketing_service_id uuid not null,
 linked_by uuid not null references auth.users(id) on delete restrict,linked_at timestamptz not null default now(),
 foreign key(asset_id,project_id,organization_id) references public.project_campaign_assets(id,project_id,organization_id) on delete restrict,
 foreign key(campaign_id,organization_id) references public.marketing_campaigns(id,organization_id) on delete restrict,
 foreign key(plan_version_id,organization_id) references public.marketing_campaign_plan_versions(id,organization_id) on delete restrict,
 foreign key(marketing_service_id,organization_id) references public.engagement_services(id,organization_id) on delete restrict,
 unique(organization_id,asset_id,campaign_id,plan_version_id,marketing_service_id)
);
create table public.project_campaign_asset_variants(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,asset_id uuid not null,
 label text not null check(length(label) between 1 and 240),source_kind text not null check(source_kind in ('artifact_version','deliverable_version')),
 source_root_id uuid not null,source_version_id uuid not null,artifact_root_id uuid,artifact_version_id uuid,deliverable_root_id uuid,deliverable_version_id uuid,source_reference_checksum text not null check(source_reference_checksum~'^[a-f0-9]{64}$'),
 source_descriptor jsonb not null check(jsonb_typeof(source_descriptor)='object'),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 foreign key(asset_id,project_id,organization_id) references public.project_campaign_assets(id,project_id,organization_id) on delete restrict,
 foreign key(artifact_root_id,organization_id) references public.artifacts(id,organization_id) on delete restrict,
 foreign key(artifact_root_id,artifact_version_id,organization_id) references public.artifact_versions(artifact_id,id,organization_id) on delete restrict,
 foreign key(deliverable_version_id,deliverable_root_id,project_id,organization_id) references public.deliverable_versions(id,deliverable_id,project_id,organization_id) on delete restrict,
 check((source_kind='artifact_version' and artifact_root_id is not null and artifact_version_id is not null and artifact_root_id=source_root_id and artifact_version_id=source_version_id and deliverable_root_id is null and deliverable_version_id is null) or (source_kind='deliverable_version' and deliverable_root_id is not null and deliverable_version_id is not null and deliverable_root_id=source_root_id and deliverable_version_id=source_version_id and artifact_root_id is null and artifact_version_id is null)),
 unique(id,asset_id,project_id,organization_id),unique(organization_id,asset_id,source_kind,source_version_id,label)
);
create table public.project_campaign_asset_commands(
 organization_id uuid not null,project_id uuid not null,request_id uuid not null,command_kind text not null check(command_kind in ('register_asset','register_variant')),
 input_checksum text not null check(input_checksum~'^[a-f0-9]{64}$'),result jsonb not null,
 actor_id uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 primary key(organization_id,request_id),foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create index project_campaign_assets_artifact_version_idx on public.project_campaign_assets(artifact_root_id,artifact_version_id,organization_id) where artifact_version_id is not null;
create index project_campaign_assets_deliverable_version_idx on public.project_campaign_assets(deliverable_version_id,deliverable_root_id,project_id,organization_id) where deliverable_version_id is not null;
create index project_campaign_asset_variants_artifact_version_idx on public.project_campaign_asset_variants(artifact_root_id,artifact_version_id,organization_id) where artifact_version_id is not null;
create index project_campaign_asset_variants_deliverable_version_idx on public.project_campaign_asset_variants(deliverable_version_id,deliverable_root_id,project_id,organization_id) where deliverable_version_id is not null;
create index project_campaign_assets_brand_idx on public.project_campaign_assets(organization_id,project_id,brand_id,created_at desc,id);
create index project_campaign_asset_links_campaign_idx on public.project_campaign_asset_links(organization_id,project_id,campaign_id,linked_at desc,id);
create index project_campaign_asset_links_plan_idx on public.project_campaign_asset_links(organization_id,plan_version_id);
create index project_campaign_asset_links_service_idx on public.project_campaign_asset_links(organization_id,marketing_service_id);
create index project_campaign_asset_variants_page_idx on public.project_campaign_asset_variants(organization_id,project_id,asset_id,created_at desc,id);
create index project_campaign_asset_commands_project_idx on public.project_campaign_asset_commands(organization_id,project_id,actor_id,created_at desc);
do $$ declare t text;begin
 foreach t in array array['project_campaign_assets','project_campaign_asset_links','project_campaign_asset_variants','project_campaign_asset_commands'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create trigger %I before update or delete on public.%I for each row execute function private.reject_pipeline_template_mutation()',t||'_immutable',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 if t<>'project_campaign_asset_commands' then
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy %I on public.%I for select to authenticated using(private.is_active_pipeline_team_member(%I.organization_id) and exists(select 1 from public.projects p where p.id=%I.project_id and p.organization_id=%I.organization_id))',t||'_project_team_read',t,t,t,t);
 end if;
 end loop;
end $$;
create function private.campaign_asset_write_authorized(p_org uuid,p_project uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_org is null or p_project is null then raise exception 'Authenticated exact project required' using errcode='42501';end if;
 -- Project first, exclusively: native writers cannot deadlock by upgrading a shared project lock.
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found or not private.p7_assignment_authority(p_org,p_project,'marketing',auth.uid()) then raise exception 'Existing exact-project Marketing authority required' using errcode='42501';end if;
end $$;
create function private.campaign_asset_context(p_org uuid,p_project uuid,p_campaign uuid,p_plan uuid,p_service uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.marketing_campaigns%rowtype;e public.engagements%rowtype;v public.marketing_campaign_plan_versions%rowtype;
begin
 select * into c from public.marketing_campaigns where id=p_campaign and organization_id=p_org for share;
 if not found or c.status='cancelled' then raise exception 'Current exact campaign unavailable' using errcode='42501';end if;
 select * into e from public.engagements where id=c.engagement_id and organization_id=p_org and project_id=p_project and brand_id=c.brand_id and status in ('planning','active') for share;
 if not found then raise exception 'Active same-project campaign engagement unavailable' using errcode='42501';end if;
 select * into v from public.marketing_campaign_plan_versions where id=p_plan and organization_id=p_org and campaign_id=c.id and engagement_id=e.id and brand_id=e.brand_id for share;
 if not found then raise exception 'Exact immutable campaign plan unavailable' using errcode='55000';end if;
 perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id
 where es.id=p_service and es.organization_id=p_org and es.engagement_id=e.id and es.status='active' and sc.department_id='marketing' and sc.is_active for share of es,sc;
 if not found then raise exception 'Active exact Marketing service unavailable' using errcode='42501';end if;
 return jsonb_build_object('campaign_id',c.id,'plan_version_id',v.id,'plan_version_number',v.version_number,'engagement_id',e.id,'brand_id',e.brand_id,'marketing_service_id',p_service);
end $$;
create function private.campaign_asset_source(p_org uuid,p_project uuid,p_brand uuid,p_kind text,p_version uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.artifacts%rowtype;v public.artifact_versions%rowtype;approved jsonb;e public.engagements%rowtype;
 dv public.deliverable_versions%rowtype;d public.deliverables%rowtype;release_id uuid;client_approval_id uuid;feature_enabled boolean;descriptor jsonb;f public.files%rowtype;
begin
 if p_version is null or p_kind is null or p_kind not in ('artifact_version','deliverable_version') then raise exception 'Exact supported canonical source required' using errcode='22023';end if;
 if p_kind='artifact_version' then
 select ar.* into a from public.artifact_versions av join public.artifacts ar on ar.id=av.artifact_id and ar.organization_id=av.organization_id where av.id=p_version and av.organization_id=p_org and ar.project_id=p_project and ar.brand_id=p_brand;
 if not found or a.artifact_type not in ('content','scripts','campaign_messaging','social_graphics','page_mockups','brand_identity','design_direction') then raise exception 'Same-project canonical source unavailable' using errcode='55000';end if;
 select * into v from public.artifact_versions where id=p_version and organization_id=p_org;
 approved:=private.require_pipeline_approved_artifact(p_org,p_project,p_version,a.artifact_type,case when a.artifact_type='content' then v.content->>'output_type' else null end);
 select * into v from public.artifact_versions where id=p_version and organization_id=p_org;
 select * into e from public.engagements where id=a.engagement_id and organization_id=p_org and project_id=p_project and brand_id=p_brand and status in ('planning','active') for share;
 if not found or v.content_checksum is distinct from encode(sha256(convert_to(v.content::text,'UTF8')),'hex') then raise exception 'Source engagement or checksum changed' using errcode='55000';end if;
 descriptor:=jsonb_build_object('kind',p_kind,'root_id',a.id,'version_id',v.id,'version_number',v.version_number,'organization_id',p_org,'project_id',p_project,'brand_id',p_brand,'engagement_id',a.engagement_id,'title',a.title,'artifact_type',a.artifact_type,'output_type',v.content->>'output_type','content_checksum',v.content_checksum,'approval_state','approved','approval',approved);
 else
 select * into dv from public.deliverable_versions where id=p_version and organization_id=p_org and project_id=p_project for share;
 if not found then raise exception 'Exact governed deliverable version unavailable' using errcode='55000';end if;
 select * into d from public.deliverables where id=dv.deliverable_id and organization_id=p_org and project_id=p_project and archived_at is null and status not in ('withdrawn','archived') for share;
 if not found or dv.file_id is null or dv.withdrawn_at is not null or dv.review_status not in ('client_reviewing','client_approved','delivered_published') then raise exception 'Governed source is not released and usable' using errcode='55000';end if;
 perform 1 from public.workstreams where id=d.workstream_id and organization_id=p_org and project_id=p_project and status='active' for share;
 if not found then raise exception 'Source workstream unavailable' using errcode='42501';end if;
 select id into release_id from public.deliverable_lifecycle_events where organization_id=p_org and project_id=p_project and deliverable_version_id=dv.id and event_type='released' order by occurred_at,id limit 1;
 if release_id is null or not exists(select 1 from public.deliverable_pm_confirmations where organization_id=p_org and deliverable_version_id=dv.id) then raise exception 'Exact governed release/PM confirmation unavailable' using errcode='55000';end if;
 select coalesce((settings->>'client_approvals_enabled')::boolean,false) into feature_enabled from public.organizations where id=p_org and status='active';
 select id into client_approval_id from public.approvals where organization_id=p_org and deliverable_version_id=dv.id and approval_type='client_approval' and decision='approved' order by decided_at,id limit 1;
 if dv.client_approval_required and feature_enabled and client_approval_id is null then raise exception 'Exact client approval unavailable' using errcode='55000';end if;
 select * into f from public.files where id=dv.file_id and organization_id=p_org and project_id=p_project and archived_at is null for share;
 if not found then raise exception 'Exact canonical file unavailable' using errcode='55000';end if;
 descriptor:=jsonb_build_object('kind',p_kind,'root_id',d.id,'version_id',dv.id,'version_number',dv.version_number,'organization_id',p_org,'project_id',p_project,'brand_id',p_brand,'title',dv.title,'deliverable_type',d.deliverable_type,'file_id',dv.file_id,'file_name',f.file_name,'file_mime_type',f.mime_type,'file_size_bytes',f.size_bytes,'file_checksum',f.checksum,'preview_metadata',dv.preview_metadata,'approval_state','approved','release_event_id',release_id,'client_approval_id',client_approval_id);
 end if;
 if octet_length(convert_to(descriptor::text,'UTF8'))>131072 then raise exception 'Canonical reference exceeds bounded review size' using errcode='22023';end if;
 return descriptor||jsonb_build_object('reference_checksum',encode(sha256(convert_to(descriptor::text,'UTF8')),'hex'));
end $$;
create function private.campaign_asset_preview(p_org uuid,p_project uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;s jsonb;original jsonb;asset public.project_campaign_assets%rowtype;existing_id uuid;variant_id uuid;result jsonb;k text;variant_label text;
begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or (select count(*) from jsonb_object_keys(p_input))<>8
 or not p_input ?& array['command_kind','campaign_id','plan_version_id','marketing_service_id','source_kind','source_version_id','asset_id','label'] then raise exception 'Complete named canonical registration fields required' using errcode='22023';end if;
 k:=p_input->>'command_kind';variant_label:=p_input->>'label';
 if k is null or k not in ('register_asset','register_variant') or jsonb_typeof(p_input->'command_kind')<>'string' or jsonb_typeof(p_input->'source_kind')<>'string'
 or jsonb_typeof(p_input->'campaign_id')<>'string' or jsonb_typeof(p_input->'plan_version_id')<>'string' or jsonb_typeof(p_input->'marketing_service_id')<>'string' or jsonb_typeof(p_input->'source_version_id')<>'string'
 or (k='register_asset' and (p_input->'asset_id'<>'null'::jsonb or p_input->'label'<>'null'::jsonb))
 or (k='register_variant' and (jsonb_typeof(p_input->'asset_id')<>'string' or jsonb_typeof(p_input->'label')<>'string' or variant_label is distinct from trim(variant_label) or length(variant_label) not between 1 and 240 or variant_label~'[[:cntrl:]]')) then raise exception 'Exact asset/variant registration values required' using errcode='22023';end if;
 if exists(select 1 from jsonb_each_text(p_input) x where x.key in ('campaign_id','plan_version_id','marketing_service_id','source_version_id','asset_id') and x.value is not null and x.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'Canonical identifiers must be exact UUIDs' using errcode='22023';end if;
 begin
 c:=private.campaign_asset_context(p_org,p_project,(p_input->>'campaign_id')::uuid,(p_input->>'plan_version_id')::uuid,(p_input->>'marketing_service_id')::uuid);
 s:=private.campaign_asset_source(p_org,p_project,(c->>'brand_id')::uuid,p_input->>'source_kind',(p_input->>'source_version_id')::uuid);
 if k='register_variant' then
 select * into asset from public.project_campaign_assets where id=(p_input->>'asset_id')::uuid and organization_id=p_org and project_id=p_project and brand_id=(c->>'brand_id')::uuid for share;
 if not found or not exists(select 1 from public.project_campaign_asset_links where asset_id=asset.id and organization_id=p_org and project_id=p_project and campaign_id=(c->>'campaign_id')::uuid and plan_version_id=(c->>'plan_version_id')::uuid and marketing_service_id=(c->>'marketing_service_id')::uuid) then raise exception 'Original same-campaign exact-plan shared asset required' using errcode='55000';end if;
 original:=private.campaign_asset_source(p_org,p_project,asset.brand_id,asset.source_kind,asset.source_version_id);
 if original->>'reference_checksum' is distinct from asset.source_reference_checksum then raise exception 'Original approved asset reference changed' using errcode='55000';end if;
 select id into variant_id from public.project_campaign_asset_variants where organization_id=p_org and asset_id=asset.id and source_kind=s->>'kind' and source_version_id=(s->>'version_id')::uuid and project_campaign_asset_variants.label=variant_label;
 else
 select id into existing_id from public.project_campaign_assets where organization_id=p_org and project_id=p_project and brand_id=(c->>'brand_id')::uuid and source_kind=s->>'kind' and source_version_id=(s->>'version_id')::uuid;
 end if;
 exception when invalid_text_representation then raise exception 'Canonical identifiers must be exact UUIDs' using errcode='22023';end;
 result:=jsonb_build_object('command_kind',k,'context',c,'source',s,'asset_id',coalesce(asset.id,existing_id),'existing_variant_id',variant_id,'label',variant_label);
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end $$;
create function public.preview_project_campaign_asset(p_organization_id uuid,p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.campaign_asset_write_authorized(p_organization_id,p_project_id);return private.campaign_asset_preview(p_organization_id,p_project_id,p_input);end $$;
create function public.confirm_project_campaign_asset(p_organization_id uuid,p_project_id uuid,p_input jsonb,p_review_sha256 text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
<<command>>
declare prior public.project_campaign_asset_commands%rowtype;preview jsonb;c jsonb;s jsonb;digest text;asset_id uuid;variant_id uuid;result jsonb;
begin
 perform private.campaign_asset_write_authorized(p_organization_id,p_project_id);
 if p_request_id is null or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' then raise exception 'Original request and reviewed checksum required' using errcode='22023';end if;
 preview:=private.campaign_asset_preview(p_organization_id,p_project_id,p_input);c:=preview->'context';s:=preview->'source';
 digest:=encode(sha256(convert_to(jsonb_build_object('input',p_input,'review_sha256',p_review_sha256)::text,'UTF8')),'hex');
 select * into prior from public.project_campaign_asset_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then
 if prior.actor_id is distinct from auth.uid() or prior.project_id is distinct from p_project_id or prior.input_checksum is distinct from digest or prior.command_kind is distinct from p_input->>'command_kind' then raise exception 'Original request used with different actor/context/payload' using errcode='23505';end if;
 return prior.result||jsonb_build_object('replayed',true);
 end if;
 if preview->>'review_sha256' is distinct from p_review_sha256 then raise exception 'Canonical registration review changed; review again' using errcode='40001';end if;
 asset_id:=(preview->>'asset_id')::uuid;
 if p_input->>'command_kind'='register_asset' then
 if asset_id is null then
 insert into public.project_campaign_assets(organization_id,project_id,brand_id,source_kind,source_root_id,source_version_id,artifact_root_id,artifact_version_id,deliverable_root_id,deliverable_version_id,source_reference_checksum,source_descriptor,created_by)
 values(p_organization_id,p_project_id,(c->>'brand_id')::uuid,s->>'kind',(s->>'root_id')::uuid,(s->>'version_id')::uuid,case when s->>'kind'='artifact_version' then (s->>'root_id')::uuid end,case when s->>'kind'='artifact_version' then (s->>'version_id')::uuid end,case when s->>'kind'='deliverable_version' then (s->>'root_id')::uuid end,case when s->>'kind'='deliverable_version' then (s->>'version_id')::uuid end,s->>'reference_checksum',s,auth.uid()) returning id into asset_id;
 end if;
 insert into public.project_campaign_asset_links(organization_id,project_id,asset_id,campaign_id,plan_version_id,marketing_service_id,linked_by)
 select p_organization_id,p_project_id,command.asset_id,(c->>'campaign_id')::uuid,(c->>'plan_version_id')::uuid,(c->>'marketing_service_id')::uuid,auth.uid()
 where not exists(select 1 from public.project_campaign_asset_links l where l.organization_id=p_organization_id and l.asset_id=command.asset_id and l.campaign_id=(c->>'campaign_id')::uuid and l.plan_version_id=(c->>'plan_version_id')::uuid and l.marketing_service_id=(c->>'marketing_service_id')::uuid);
 else
 variant_id:=(preview->>'existing_variant_id')::uuid;
 if variant_id is null then
 insert into public.project_campaign_asset_variants(organization_id,project_id,asset_id,label,source_kind,source_root_id,source_version_id,artifact_root_id,artifact_version_id,deliverable_root_id,deliverable_version_id,source_reference_checksum,source_descriptor,created_by)
 values(p_organization_id,p_project_id,asset_id,p_input->>'label',s->>'kind',(s->>'root_id')::uuid,(s->>'version_id')::uuid,case when s->>'kind'='artifact_version' then (s->>'root_id')::uuid end,case when s->>'kind'='artifact_version' then (s->>'version_id')::uuid end,case when s->>'kind'='deliverable_version' then (s->>'root_id')::uuid end,case when s->>'kind'='deliverable_version' then (s->>'version_id')::uuid end,s->>'reference_checksum',s,auth.uid()) returning id into variant_id;
 end if;
 end if;
 result:=jsonb_build_object('asset_id',asset_id,'variant_id',variant_id,'source_version_id',s->>'version_id','campaign_id',c->>'campaign_id','plan_version_id',c->>'plan_version_id','replayed',false);
 insert into public.project_campaign_asset_commands(organization_id,project_id,request_id,command_kind,input_checksum,result,actor_id)
 values(p_organization_id,p_project_id,p_request_id,p_input->>'command_kind',digest,result,auth.uid());
 return result;
end $$;
create function public.get_project_campaign_asset_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin perform private.campaign_asset_write_authorized(p_organization_id,p_project_id);
 select jsonb_build_object('command_kind',c.command_kind,'input_checksum',c.input_checksum,'result',c.result) into result from public.project_campaign_asset_commands c where c.organization_id=p_organization_id and c.project_id=p_project_id and c.request_id=p_request_id and c.actor_id=auth.uid();return result;
end $$;
create function public.list_project_campaign_assets(p_organization_id uuid,p_project_id uuid,p_campaign_id uuid,p_plan_version_id uuid,p_marketing_service_id uuid,p_asset_id uuid default null,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c record;asset public.project_campaign_assets%rowtype;r record;rows jsonb:='[]';source jsonb;source_state text;parent_state text;reason text;total bigint;matching bigint;seen integer:=0;result jsonb;
begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_query is null or length(p_query)>120 or p_query~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Bounded exact campaign paging required' using errcode='22023';end if;
 select mc.id campaign_id,mc.brand_id,e.id engagement_id,e.status engagement_status,mc.status campaign_status,v.id plan_version_id,v.version_number,es.id marketing_service_id,es.status service_status,sc.is_active catalog_active,p.archived_at into c
 from public.marketing_campaigns mc join public.engagements e on e.id=mc.engagement_id and e.organization_id=mc.organization_id and e.brand_id=mc.brand_id and e.project_id=p_project_id
 join public.projects p on p.id=e.project_id and p.organization_id=e.organization_id
 join public.marketing_campaign_plan_versions v on v.id=p_plan_version_id and v.organization_id=mc.organization_id and v.campaign_id=mc.id and v.engagement_id=e.id and v.brand_id=e.brand_id
 join public.engagement_services es on es.id=p_marketing_service_id and es.organization_id=mc.organization_id and es.engagement_id=e.id
 join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id and sc.department_id='marketing'
 where mc.id=p_campaign_id and mc.organization_id=p_organization_id for share of mc,e,p,v,es,sc;
 if not found then raise exception 'Exact same-project campaign/plan/Marketing service unavailable' using errcode='42501';end if;
 if p_asset_id is not null then
 select * into asset from public.project_campaign_assets a where a.id=p_asset_id and a.organization_id=p_organization_id and a.project_id=p_project_id and a.brand_id=c.brand_id
 and exists(select 1 from public.project_campaign_asset_links l where l.asset_id=a.id and l.organization_id=a.organization_id and l.project_id=a.project_id and l.campaign_id=c.campaign_id and l.plan_version_id=c.plan_version_id and l.marketing_service_id=c.marketing_service_id) for share;
 if not found then raise exception 'Exact linked shared asset unavailable' using errcode='42501';end if;
 parent_state:='available';
 if c.archived_at is not null then parent_state:='archived';else
 begin
 source:=private.campaign_asset_source(p_organization_id,p_project_id,asset.brand_id,asset.source_kind,asset.source_version_id);
 if source->>'reference_checksum' is distinct from asset.source_reference_checksum then parent_state:='changed';end if;
 exception when sqlstate '42501' or sqlstate '55000' or sqlstate '22023' then parent_state:='unavailable';end;
 end if;
 end if;
 if p_asset_id is null then
 select count(*),count(*) filter(where lower(a.source_descriptor->>'title') like '%'||lower(p_query)||'%' or a.id::text=p_query) into total,matching from public.project_campaign_assets a where a.organization_id=p_organization_id and a.project_id=p_project_id and a.brand_id=c.brand_id
 and exists(select 1 from public.project_campaign_asset_links l where l.asset_id=a.id and l.organization_id=a.organization_id and l.project_id=a.project_id and l.campaign_id=c.campaign_id and l.plan_version_id=c.plan_version_id and l.marketing_service_id=c.marketing_service_id);
 else
 select count(*),count(*) filter(where lower(v.label) like '%'||lower(p_query)||'%' or v.id::text=p_query) into total,matching from public.project_campaign_asset_variants v where v.organization_id=p_organization_id and v.project_id=p_project_id and v.asset_id=p_asset_id;
 end if;
 for r in
 select a.id,a.brand_id,a.source_kind,a.source_root_id,a.source_version_id,a.source_reference_checksum,a.source_descriptor,to_jsonb(a) stored_record from public.project_campaign_assets a
 where p_asset_id is null and a.organization_id=p_organization_id and a.project_id=p_project_id and a.brand_id=c.brand_id and (lower(a.source_descriptor->>'title') like '%'||lower(p_query)||'%' or a.id::text=p_query)
 and exists(select 1 from public.project_campaign_asset_links l where l.asset_id=a.id and l.organization_id=a.organization_id and l.project_id=a.project_id and l.campaign_id=c.campaign_id and l.plan_version_id=c.plan_version_id and l.marketing_service_id=c.marketing_service_id)
 union all
 select v.id,asset.brand_id,v.source_kind,v.source_root_id,v.source_version_id,v.source_reference_checksum,v.source_descriptor,to_jsonb(v) stored_record from public.project_campaign_asset_variants v
 where p_asset_id is not null and v.organization_id=p_organization_id and v.project_id=p_project_id and v.asset_id=p_asset_id and (lower(v.label) like '%'||lower(p_query)||'%' or v.id::text=p_query)
 order by id offset p_offset limit p_limit+1
 loop
 seen:=seen+1;if seen>p_limit then exit;end if;source:=null;reason:=null;source_state:='available';
 if c.archived_at is not null then source_state:='archived';reason:='Archived project; retained reference only';else
 begin
 source:=private.campaign_asset_source(p_organization_id,p_project_id,r.brand_id,r.source_kind,r.source_version_id);
 if source->>'reference_checksum' is distinct from r.source_reference_checksum then source_state:='changed';reason:='Approved canonical reference changed';end if;
 exception when sqlstate '42501' or sqlstate '55000' or sqlstate '22023' then source_state:='unavailable';reason:='Exact approved canonical source unavailable';end;
 end if;
 rows:=rows||jsonb_build_array(jsonb_build_object('record',r.stored_record,'source_state',source_state,'source_reason',reason,'current_source',source,'parent_source_state',parent_state));
 end loop;
 result:=jsonb_build_object('context',to_jsonb(c),'asset',case when p_asset_id is null then null else to_jsonb(asset) end,'items',rows,'total',total,'matching_total',matching,'offset',p_offset,'has_more',seen>p_limit);
 if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'Exact campaign reference page exceeds bounded response size' using errcode='22023';end if;
 return result;
end $$;
revoke all on function public.list_project_campaign_assets(uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_project_campaign_assets(uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer) to authenticated;
revoke all on function private.campaign_asset_write_authorized(uuid,uuid),private.campaign_asset_context(uuid,uuid,uuid,uuid,uuid),private.campaign_asset_source(uuid,uuid,uuid,text,uuid),private.campaign_asset_preview(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.preview_project_campaign_asset(uuid,uuid,jsonb),public.confirm_project_campaign_asset(uuid,uuid,jsonb,text,uuid),public.get_project_campaign_asset_operation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_project_campaign_asset(uuid,uuid,jsonb),public.confirm_project_campaign_asset(uuid,uuid,jsonb,text,uuid),public.get_project_campaign_asset_operation(uuid,uuid,uuid) to authenticated;
comment on table public.project_campaign_assets is 'Immutable exact shared canonical source identity. No source work, assignment, approval, provider or publishing operation.';
comment on table public.project_campaign_asset_variants is 'Explicit exact canonical variant linked to the shared source; no generated or copied media.';
commit;
