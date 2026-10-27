-- W2: immutable project site settings and native source bindings to existing page-design attempts.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('private.website_approved_source(uuid,uuid,uuid)')),chr(13),'')) is distinct from '8fbd479e8c1a8ab7b665196d1d1987a4' or md5(replace(pg_get_functiondef(to_regprocedure('private.normalize_content_page_path(text)')),chr(13),'')) is distinct from '50c931d3b9a4f18092884332f6654b53' or md5(replace(pg_get_functiondef(to_regprocedure('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)')),chr(13),'')) is distinct from '033f6c233c35b8c2641716b861a63cd2' then raise exception 'Exact Website source prerequisites differ' using errcode='55000';end if;
end;$$;

alter table public.website_page_designs add column native_input_checksum text check(native_input_checksum is null or native_input_checksum~'^[0-9a-f]{64}$');
create table private.website_site_versions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,
 version_number integer not null check(version_number>0),parent_version_id uuid references private.website_site_versions(id),
 identity_version_id uuid,site jsonb not null check(jsonb_typeof(site)='object' and octet_length(site::text)<=32768),
 request_id uuid not null,request_sha256 text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,project_id,version_number),unique(organization_id,created_by,request_id),unique(id,organization_id),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id),
 foreign key(identity_version_id,organization_id) references public.artifact_versions(id,organization_id)
);
create table private.website_native_bindings(
 design_id uuid primary key,organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,page_id uuid not null,
 parent_design_id uuid references private.website_native_bindings(design_id),version_number integer not null check(version_number>0),
 site_version_id uuid not null,architecture_version_id uuid not null,content_version_id uuid not null,brief_version_id uuid not null,
 manifest jsonb not null check(jsonb_typeof(manifest)='object' and octet_length(manifest::text)<=262144),
 request_id uuid not null,request_sha256 text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,page_id,version_number),unique(organization_id,created_by,request_id),
 foreign key(design_id,organization_id) references public.website_page_designs(id,organization_id),
 foreign key(page_id,organization_id) references public.project_website_pages(id,organization_id),
 foreign key(site_version_id,organization_id) references private.website_site_versions(id,organization_id),
 foreign key(architecture_version_id,organization_id) references public.artifact_versions(id,organization_id),
 foreign key(content_version_id,organization_id) references public.artifact_versions(id,organization_id),
 foreign key(brief_version_id,organization_id) references public.design_creative_brief_versions(id,organization_id)
);
-- Same-org page FK plus transaction-level exact project/engagement/brand validation below.
create index website_native_project on private.website_native_bindings(organization_id,project_id,page_id,version_number desc);
create index website_native_content on private.website_native_bindings(content_version_id,organization_id);
create index website_native_brief on private.website_native_bindings(brief_version_id,organization_id);
create index website_native_site on private.website_native_bindings(site_version_id,organization_id);
create index website_native_architecture on private.website_native_bindings(architecture_version_id,organization_id);
create index website_site_identity on private.website_site_versions(identity_version_id,organization_id);
create index website_site_parent on private.website_site_versions(parent_version_id);
create index website_site_actor on private.website_site_versions(created_by);
create index website_site_engagement on private.website_site_versions(engagement_id,project_id,organization_id);
create index website_native_parent on private.website_native_bindings(parent_design_id);
create index website_native_page on private.website_native_bindings(page_id,organization_id);
create index website_native_actor on private.website_native_bindings(created_by);
alter table private.website_site_versions enable row level security;alter table private.website_native_bindings enable row level security;
revoke all on private.website_site_versions,private.website_native_bindings from public,anon,authenticated,service_role;
create function private.website_native_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Website source versions are immutable' using errcode='55000';end;$$;
create trigger website_native_attempt_immutable before update or delete on public.website_page_designs for each row when (old.native_input_checksum is not null) execute function private.website_native_immutable();
create trigger website_site_immutable before update or delete on private.website_site_versions for each row execute function private.website_native_immutable();
create trigger website_binding_immutable before update or delete on private.website_native_bindings for each row execute function private.website_native_immutable();
create function private.website_native_actor(p_org uuid,p_project uuid,p_engagement uuid,p_actor uuid,p_write boolean) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.projects where id=p_project and organization_id=p_org and (not p_write or archived_at is null) for share;
 if not found then raise exception 'Current unarchived project required' using errcode='42501';end if;
 perform 1 from public.engagements where id=p_engagement and project_id=p_project and organization_id=p_org and status in ('planning','active') for share;
 if not found then raise exception 'Exact active engagement required' using errcode='42501';end if;
 perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id where o.id=p_org and o.status='active' and m.user_id=p_actor and m.status='active' and m.member_kind='team' and (not p_write or m.role in ('system_owner','operations_admin','executive') or m.department_id='design') for share of o,m;
 if not found then raise exception 'Current Website Design authority required' using errcode='42501';end if;
 if p_write then
  perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id where es.organization_id=p_org and es.engagement_id=p_engagement and es.status='active' and sc.department_id='design' and sc.is_active for share of es,sc;
  if not found then raise exception 'Active Design service required' using errcode='42501';end if;
 end if;
end;$$;
create function private.website_native_identity(p_org uuid,p_engagement uuid,p_identity uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.artifact_versions v join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id join public.engagements e on e.id=p_engagement and e.organization_id=p_org
 where v.id=p_identity and v.organization_id=p_org and a.artifact_type='design_system' and a.brand_id=e.brand_id and (select ap.decision from public.artifact_approvals ap where ap.organization_id=p_org and ap.artifact_version_id=v.id and ap.artifact_id=a.id order by ap.approved_at desc,ap.id desc limit 1)='approved' and coalesce((select rq.status from public.artifact_approval_requests rq where rq.organization_id=p_org and rq.artifact_version_id=v.id order by rq.created_at desc,rq.id desc limit 1),'completed')='completed' for share of v,a,e;
 if not found then raise exception 'Exact approved brand identity version required' using errcode='42501';end if;
end;$$;
create function private.website_native_source(p_org uuid,p_project uuid,p_engagement uuid,p_actor uuid,p_page uuid,p_architecture uuid,p_content uuid,p_brief uuid,p_site uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ar jsonb;pg public.project_website_pages;cv public.artifact_versions;ca public.artifacts;bv public.design_creative_brief_versions;b public.design_creative_briefs;sv private.website_site_versions;cp jsonb;identity jsonb;result jsonb;begin
 perform private.website_native_actor(p_org,p_project,p_engagement,p_actor,false);
 ar:=private.website_approved_source(p_org,p_project,p_architecture);
 select * into pg from public.project_website_pages where id=p_page and organization_id=p_org and project_id=p_project and engagement_id=p_engagement for share;
 select value into identity from jsonb_array_elements(ar->'pages') where value->>'page_key'=pg.page_key;
 if pg.id is null or identity is null or pg.architecture_artifact_id is distinct from (ar->'reference'->>'artifact_id')::uuid or pg.engagement_id is distinct from (ar->>'engagement_id')::uuid or pg.brand_id is distinct from (ar->>'brand_id')::uuid then raise exception 'Exact registered architecture page required' using errcode='42501';end if;
 select * into cv from public.artifact_versions where id=p_content and organization_id=p_org for share;
 select * into ca from public.artifacts where id=cv.artifact_id and organization_id=p_org for share;
 if ca.id is null or ca.artifact_type<>'content' or ca.project_id is distinct from p_project or ca.engagement_id is distinct from p_engagement or ca.brand_id is distinct from pg.brand_id or encode(sha256(convert_to(cv.content::text,'UTF8')),'hex') is distinct from cv.content_checksum then raise exception 'Exact project Content version required' using errcode='42501';end if;
 if jsonb_typeof(cv.content->'pages') is distinct from 'array' then raise exception 'Page copy required' using errcode='22023';end if;
 if (select count(*) from jsonb_array_elements(cv.content->'pages') x where private.normalize_content_page_path(x->>'page_path')=identity->>'path')<>1 then raise exception 'One exact Content page required' using errcode='22023';end if;
 select value into cp from jsonb_array_elements(cv.content->'pages') where private.normalize_content_page_path(value->>'page_path')=identity->>'path';
 if cp?'page_key' and cp->>'page_key' is distinct from pg.page_key then raise exception 'Content page key differs' using errcode='22023';end if;
 select * into bv from public.design_creative_brief_versions where id=p_brief and organization_id=p_org for share;
 select * into b from public.design_creative_briefs where id=bv.creative_brief_id and organization_id=p_org for share;
 if b.id is null or b.visibility<>'official' or b.engagement_id is distinct from p_engagement or b.brand_id is distinct from pg.brand_id or b.frozen_version_id is distinct from p_brief or b.current_version_id is distinct from p_brief or bv.validation_snapshot->>'valid' is distinct from 'true' or bv.content->>'output_type' is distinct from 'website' then raise exception 'Current confirmed Website brief required' using errcode='42501';end if;
 perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id and sc.organization_id=es.organization_id where es.id=b.engagement_service_id and es.organization_id=p_org and es.engagement_id=p_engagement and es.status='active' and sc.department_id='design' and sc.is_active and sc.slug in ('website_ux_ui','setup_design_unique_page_ui_layout','setup_design_wireframe','setup_design_responsive_design_adaptation') for share of es,sc;
 if not found then raise exception 'Selected active Website layout service required' using errcode='42501';end if;
 select * into sv from private.website_site_versions where id=p_site and organization_id=p_org and project_id=p_project and engagement_id=p_engagement;
 if sv.id is null then raise exception 'Exact project site settings required' using errcode='42501';end if;
 if sv.identity_version_id is not null then perform private.website_native_identity(p_org,p_engagement,sv.identity_version_id);end if;
 result:=jsonb_build_object('scope',jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',p_engagement,'page_id',p_page,'page_key',pg.page_key),'architecture',ar->'reference','page',identity,'content_version',jsonb_build_object('id',cv.id,'content_checksum',cv.content_checksum),'content_page',cp,'brief_version',jsonb_build_object('id',bv.id,'content_checksum',bv.content_checksum),'brief_revision',b.revision,'site_version',to_jsonb(sv),'architecture_head',(select id from public.artifact_versions where artifact_id=(ar->'reference'->>'artifact_id')::uuid and organization_id=p_org order by version_number desc limit 1),'content_head',(select id from public.artifact_versions where artifact_id=ca.id and organization_id=p_org order by version_number desc limit 1),'site_head',(select id from private.website_site_versions where project_id=p_project and organization_id=p_org order by version_number desc limit 1),'design_head',(select design_id from private.website_native_bindings where page_id=p_page and organization_id=p_org order by version_number desc limit 1));
 if octet_length(result::text)>262144 then raise exception 'Source context exceeds bound; resolve in Content without truncation' using errcode='22023';end if;
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
create function public.get_website_native_source(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_page_id uuid,p_architecture_version_id uuid,p_content_version_id uuid,p_brief_version_id uuid,p_site_version_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.website_native_source(p_organization_id,p_project_id,p_engagement_id,auth.uid(),p_page_id,p_architecture_version_id,p_content_version_id,p_brief_version_id,p_site_version_id)$$;
create function public.get_website_native_workspace(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_page_id uuid default null,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 perform private.website_native_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),false);
 result:=jsonb_build_object('sites',(select coalesce(jsonb_agg(to_jsonb(x) order by version_number desc),'[]') from(select * from private.website_site_versions where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and (p_request_id is null or request_id=p_request_id and created_by=auth.uid()) order by version_number desc limit 20)x),'designs',(select coalesce(jsonb_agg(to_jsonb(x) order by version_number desc),'[]') from(select b.design_id,b.organization_id,b.project_id,b.engagement_id,b.page_id,b.parent_design_id,b.version_number,b.site_version_id,b.architecture_version_id,b.content_version_id,b.brief_version_id,b.request_id,b.created_by,b.created_at,b.manifest->'content'->>'title' as title,b.manifest->'layout' as layout,d.status,array_remove(array[case when b.content_version_id is distinct from (select av.id from public.artifact_versions av where av.organization_id=b.organization_id and av.artifact_id=(select artifact_id from public.artifact_versions where id=b.content_version_id and organization_id=b.organization_id) order by av.version_number desc limit 1) then 'Content' end,case when b.architecture_version_id is distinct from (select av.id from public.artifact_versions av where av.organization_id=b.organization_id and av.artifact_id=(select artifact_id from public.artifact_versions where id=b.architecture_version_id and organization_id=b.organization_id) order by av.version_number desc limit 1) then 'Architecture' end,case when b.site_version_id is distinct from (select sv.id from private.website_site_versions sv where sv.project_id=b.project_id and sv.organization_id=b.organization_id order by version_number desc limit 1) then 'Site settings' end,case when not exists(select 1 from public.design_creative_briefs br where br.organization_id=b.organization_id and br.current_version_id=b.brief_version_id and br.frozen_version_id=b.brief_version_id) then 'Brief' end],null) as stale_sources from private.website_native_bindings b join public.website_page_designs d on d.id=b.design_id and d.organization_id=b.organization_id where b.organization_id=p_organization_id and b.project_id=p_project_id and b.engagement_id=p_engagement_id and (p_page_id is null or b.page_id=p_page_id) and (p_request_id is null or b.request_id=p_request_id and b.created_by=auth.uid()) order by b.created_at desc limit 10)x));
 if octet_length(result::text)>1048576 then raise exception 'Workspace response exceeds bound; choose one page' using errcode='22023';end if;return result;
end;$$;
create function public.get_website_native_design(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_design_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 perform private.website_native_actor(p_organization_id,p_project_id,p_engagement_id,auth.uid(),false);
 select to_jsonb(b)||jsonb_build_object('html_content',d.html_content,'css_content',d.css_content,'status',d.status) into result from private.website_native_bindings b join public.website_page_designs d on d.id=b.design_id and d.organization_id=b.organization_id where b.design_id=p_design_id and b.organization_id=p_organization_id and b.project_id=p_project_id and b.engagement_id=p_engagement_id;
 if result is null then raise exception 'Exact saved project Website draft required' using errcode='42501';end if;
 if octet_length(result::text)>1048576 then raise exception 'Saved draft exceeds bounded response' using errcode='22023';end if;return result;
end;$$;
create function public.save_website_native_site(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_version_id uuid,p_identity_version_id uuid,p_site jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.website_site_versions;head private.website_site_versions;digest text;begin
 perform pg_advisory_xact_lock(hashtextextended('website-native:'||p_organization_id::text||':'||p_project_id::text,0));
 perform private.website_native_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id,true);
 if p_request_id is null or jsonb_typeof(p_site) is distinct from 'object' or octet_length(p_site::text)>32768 then raise exception 'Bounded exact site request required' using errcode='22023';end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('project',p_project_id,'engagement',p_engagement_id,'expected',p_expected_version_id,'identity',p_identity_version_id,'site',p_site)::text,'UTF8')),'hex');
 select * into existing from private.website_site_versions where organization_id=p_organization_id and created_by=p_actor_id and request_id=p_request_id;
 if found then if existing.request_sha256<>digest then raise exception 'Changed original site request' using errcode='23505';end if;return to_jsonb(existing);end if;
 select * into head from private.website_site_versions where organization_id=p_organization_id and project_id=p_project_id order by version_number desc limit 1;
 if head.id is distinct from p_expected_version_id then raise exception 'Site settings changed; review current version' using errcode='40001';end if;
 if p_identity_version_id is not null then perform private.website_native_identity(p_organization_id,p_engagement_id,p_identity_version_id);end if;
 insert into private.website_site_versions(organization_id,project_id,engagement_id,version_number,parent_version_id,identity_version_id,site,request_id,request_sha256,created_by) values(p_organization_id,p_project_id,p_engagement_id,coalesce(head.version_number,0)+1,head.id,p_identity_version_id,p_site,p_request_id,digest,p_actor_id) returning * into existing;return to_jsonb(existing);
end;$$;
create function public.save_website_native_design(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_request_id uuid,p_direction_version_id uuid,p_architecture_approval_id uuid,p_review_sha256 text,p_manifest jsonb,p_html text,p_css text) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.website_native_bindings;ctx jsonb;digest text;direction public.design_direction_versions;session public.design_workshop_sessions;brief public.design_creative_briefs;page uuid;design uuid;session_id uuid;direction_id uuid;brief_version public.design_creative_brief_versions;provenance jsonb;direction_content jsonb;direction_sha text;begin
 perform pg_advisory_xact_lock(hashtextextended('website-native:'||p_organization_id::text||':'||p_project_id::text,0));
 perform private.website_native_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id,true);
 if p_request_id is null or jsonb_typeof(p_manifest) is distinct from 'object' or octet_length(p_manifest::text)>262144 or length(p_html) not between 1 and 500000 or length(p_css) not between 1 and 200000 or p_html is null or p_css is null then raise exception 'Bounded compiled design request required' using errcode='22023';end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('project',p_project_id,'engagement',p_engagement_id,'direction',p_direction_version_id,'approval',p_architecture_approval_id,'review',p_review_sha256,'manifest',p_manifest,'html',p_html,'css',p_css)::text,'UTF8')),'hex');
 select * into existing from private.website_native_bindings where organization_id=p_organization_id and created_by=p_actor_id and request_id=p_request_id;
 if found then if existing.request_sha256<>digest then raise exception 'Changed original design request' using errcode='23505';end if;return to_jsonb(existing);end if;
 if p_manifest->'scope'->>'organization_id' is distinct from p_organization_id::text or p_manifest->'scope'->>'project_id' is distinct from p_project_id::text or p_manifest->'scope'->>'engagement_id' is distinct from p_engagement_id::text then raise exception 'Manifest scope differs' using errcode='42501';end if;
 page:=(p_manifest->'scope'->>'page_id')::uuid;
 ctx:=private.website_native_source(p_organization_id,p_project_id,p_engagement_id,p_actor_id,page,(p_manifest->'sources'->'architecture'->>'version_id')::uuid,(p_manifest->'sources'->'content'->>'version_id')::uuid,(p_manifest->'sources'->'brief'->>'version_id')::uuid,(p_manifest->'sources'->'site_system'->>'version_id')::uuid);
 if ctx->>'review_sha256' is distinct from p_review_sha256 or ctx->'architecture'->>'approval_id' is distinct from p_architecture_approval_id::text or ctx->'scope' is distinct from p_manifest->'scope' or ctx->'site_version'->'site' is distinct from p_manifest->'site' or p_manifest->'sources'->'architecture'->>'checksum' is distinct from ctx->'architecture'->>'content_checksum' or p_manifest->'sources'->'content'->>'checksum' is distinct from ctx->'content_version'->>'content_checksum' or p_manifest->'sources'->'brief'->>'checksum' is distinct from ctx->'brief_version'->>'content_checksum' or p_manifest->'sources'->'site_system'->>'checksum' is distinct from ctx->'site_version'->>'request_sha256' then raise exception 'Source context changed; review again' using errcode='40001';end if;
 select * into brief_version from public.design_creative_brief_versions where id=(p_manifest->'sources'->'brief'->>'version_id')::uuid and organization_id=p_organization_id;
 select * into brief from public.design_creative_briefs where id=brief_version.creative_brief_id and organization_id=p_organization_id;
 select v.* into direction from public.design_direction_versions v join public.design_directions d on d.id=v.direction_id and d.organization_id=v.organization_id join public.design_workshop_sessions ss on ss.id=d.session_id and ss.organization_id=d.organization_id where v.organization_id=p_organization_id and v.creative_brief_version_id=brief_version.id and not v.is_experimental and ss.engagement_id=p_engagement_id and ss.engagement_service_id=brief.engagement_service_id and ss.output_family='website_design' and (p_direction_version_id is null or v.id=p_direction_version_id) order by v.created_at desc,v.id desc limit 1 for share of v,d,ss;
 if direction.id is null and p_direction_version_id is not null then raise exception 'Exact confirmed Website direction required' using errcode='42501';end if;
 if direction.id is null then
  provenance:=jsonb_build_object('mode','native_website_draft','creative_brief_id',brief.id,'creative_brief_version_id',brief_version.id,'creative_brief_checksum',brief_version.content_checksum);
  direction_content:=brief_version.content||jsonb_build_object('provenance',provenance,'draft_kind','native_website_direction');direction_sha:=encode(sha256(convert_to(direction_content::text,'UTF8')),'hex');
  insert into public.design_workshop_sessions(organization_id,engagement_id,brand_id,engagement_service_id,project_task_id,engagement_work_item_id,output_family,output_brief,designer_instructions,context_manifest,context_checksum,created_by) values(p_organization_id,p_engagement_id,brief.brand_id,brief.engagement_service_id,brief.project_task_id,brief.engagement_work_item_id,'website_design',brief_version.content,coalesce(brief_version.content->>'instructions',''),provenance,encode(sha256(convert_to(provenance::text,'UTF8')),'hex'),p_actor_id) returning id into session_id;
  insert into public.design_directions(organization_id,session_id,direction_slot) values(p_organization_id,session_id,1) returning id into direction_id;
  insert into public.design_direction_versions(organization_id,direction_id,version_number,content,content_checksum,distinctness_signature,created_by,creative_brief_version_id) values(p_organization_id,direction_id,1,direction_content,direction_sha,direction_sha,p_actor_id,brief_version.id) returning * into direction;
 end if;
 if p_html~*'<script\y|<iframe\y|<object\y|<embed\y|javascript\s*:|\son[a-z]+\s*=' or p_css~*'@import|url\s*\(' then raise exception 'Executable or remote code is not accepted' using errcode='22023';end if;
 insert into public.website_page_designs(organization_id,design_direction_version_id,slug,html_content,css_content,status,created_by,native_input_checksum) values(p_organization_id,direction.id,ctx->'page'->>'path',p_html,p_css,'draft',p_actor_id,encode(sha256(convert_to(p_manifest::text,'UTF8')),'hex')) returning id into design;
 insert into private.website_native_bindings(design_id,organization_id,project_id,engagement_id,page_id,parent_design_id,version_number,site_version_id,architecture_version_id,content_version_id,brief_version_id,manifest,request_id,request_sha256,created_by) values(design,p_organization_id,p_project_id,p_engagement_id,page,nullif(ctx->>'design_head','')::uuid,coalesce((select max(version_number) from private.website_native_bindings where page_id=page and organization_id=p_organization_id),0)+1,(p_manifest->'sources'->'site_system'->>'version_id')::uuid,(p_manifest->'sources'->'architecture'->>'version_id')::uuid,(p_manifest->'sources'->'content'->>'version_id')::uuid,direction.creative_brief_version_id,p_manifest,p_request_id,digest,p_actor_id) returning * into existing;
 return to_jsonb(existing);
end;$$;
revoke all on function private.website_native_immutable(),private.website_native_actor(uuid,uuid,uuid,uuid,boolean),private.website_native_identity(uuid,uuid,uuid),private.website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_website_native_design(uuid,uuid,uuid,uuid),public.get_website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.get_website_native_workspace(uuid,uuid,uuid,uuid,uuid),public.save_website_native_site(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb),public.save_website_native_design(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_website_native_design(uuid,uuid,uuid,uuid),public.get_website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.get_website_native_workspace(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.save_website_native_site(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb),public.save_website_native_design(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text) to service_role;
commit;
