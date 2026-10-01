-- Version-bound manual page checks. No provider checks, publication, assignment or legacy rewrites.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef('private.n6_project_configuration_authorized(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'b5005c1ed90d7fe6cf8acc091c1cfb81'
 or md5(replace(pg_get_functiondef('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)'::regprocedure),chr(13),''))<>'033f6c233c35b8c2641716b861a63cd2'
 or md5(replace(pg_get_functiondef('private.is_active_pipeline_team_member(uuid)'::regprocedure),chr(13),''))<>'343b6bdc249b149d02bca6055a770441'
 or md5(replace(pg_get_functiondef('private.website_architecture_pages(jsonb)'::regprocedure),chr(13),''))<>'7f2d4ed56e5cea6c722502823ec536ae'
 or md5(replace(pg_get_functiondef('private.website_write_authorized(uuid,uuid)'::regprocedure),chr(13),''))<>'b226456548a2ce582df254e367fe7ef0'
 or md5(replace(pg_get_functiondef('private.website_read_authorized(uuid,uuid)'::regprocedure),chr(13),''))<>'339ae8372edf7afa3115655da7a2255f'
 or md5(replace(pg_get_functiondef('private.website_approved_source(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'8fbd479e8c1a8ab7b665196d1d1987a4'
 or md5(replace(pg_get_functiondef('private.website_seo_context(uuid,uuid,uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'e75a4b7bb0d9bce2f432dfee8c8cec9d'
 or md5(replace(pg_get_functiondef('private.website_valid_url(text)'::regprocedure),chr(13),''))<>'fcb30f53dec1b0d8b2b66edb196eeede'
 or md5(replace(pg_get_functiondef('private.reject_pipeline_template_mutation()'::regprocedure),chr(13),''))<>'8c3f3ac7f15e91b22826b54ac3b3c2cc' then raise exception 'Exact version-check prerequisites changed' using errcode='55000';end if;
end $$;
create table public.project_website_version_checks(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,brand_id uuid not null,page_id uuid not null,
 architecture_artifact_id uuid not null,architecture_version_id uuid not null,architecture_approval_id uuid not null,architecture_checksum text not null check(architecture_checksum~'^[0-9a-f]{64}$'),
 implementation_revision_id uuid,seo_link_id uuid,tracked_page_id uuid,scope_snapshot jsonb not null check(jsonb_typeof(scope_snapshot)='object' and octet_length(scope_snapshot::text)<=32768),scope_checksum text not null check(scope_checksum~'^[0-9a-f]{64}$'),
 checked_at timestamptz not null check(isfinite(checked_at)),evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=32768),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),unique(id,organization_id),
 foreign key(page_id,project_id,brand_id,organization_id) references public.project_website_pages(id,project_id,brand_id,organization_id) on delete restrict,
 foreign key(architecture_artifact_id,architecture_version_id,organization_id) references public.artifact_versions(artifact_id,id,organization_id) on delete restrict,
 foreign key(architecture_approval_id,organization_id) references public.artifact_approvals(id,organization_id) on delete restrict,
 foreign key(implementation_revision_id,organization_id) references public.project_website_page_revisions(id,organization_id) on delete restrict,
 foreign key(seo_link_id,organization_id) references public.project_website_page_seo_links(id,organization_id) on delete restrict,
 foreign key(tracked_page_id,brand_id,organization_id) references public.tracked_pages(id,brand_id,organization_id) on delete restrict
);
create index website_version_check_page_idx on public.project_website_version_checks(page_id,project_id,organization_id,created_at desc,id);
create index website_version_check_source_idx on public.project_website_version_checks(architecture_artifact_id,architecture_version_id,organization_id);
create index website_version_check_approval_idx on public.project_website_version_checks(architecture_approval_id,organization_id);
create index website_version_check_revision_idx on public.project_website_version_checks(implementation_revision_id,organization_id);
create index website_version_check_link_idx on public.project_website_version_checks(seo_link_id,organization_id);
create index website_version_check_tracked_idx on public.project_website_version_checks(tracked_page_id,brand_id,organization_id);
create table public.project_website_check_commands(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,request_id uuid not null,request_sha256 text not null check(request_sha256~'^[0-9a-f]{64}$'),
 result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=65536),created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),unique(organization_id,request_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create index website_check_command_project_idx on public.project_website_check_commands(project_id,organization_id);
do $$declare name text;begin
 foreach name in array array['project_website_version_checks','project_website_check_commands'] loop
 execute format('alter table public.%I enable row level security',name);execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
 execute format('create trigger immutable_website_check before update or delete on public.%I for each row execute function private.reject_pipeline_template_mutation()',name);
 end loop;
end $$;
create function private.website_check_snapshot(p_org uuid,p_project uuid,p_page uuid,p_version uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;source jsonb;revision public.project_website_page_revisions%rowtype;link public.project_website_page_seo_links%rowtype;j jsonb;begin
 c:=private.website_seo_context(p_org,p_project,p_page,p_version,null);
 if c->>'source_state'<>'available' then raise exception 'Exact current approved architecture page required' using errcode='42501';end if;
 source:=private.website_approved_source(p_org,p_project,p_version);
 select * into revision from public.project_website_page_revisions where organization_id=p_org and project_id=p_project and page_id=p_page order by revision_number desc limit 1;
 select * into link from public.project_website_page_seo_links where organization_id=p_org and project_id=p_project and page_id=p_page order by link_number desc limit 1;
 j:=jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',c->'engagement_id','brand_id',c->'brand_id','page_id',p_page,'page_key',c->'page_key','initial_path',c->'initial_path','architecture_version_id',p_version,'reference',source->'reference','planned_page_checksum',encode(sha256(convert_to((c->'planned_page')::text,'UTF8')),'hex'),'implementation',case when revision.id is null then null else to_jsonb(revision) end,'seo_link',case when link.id is null then null else to_jsonb(link) end,'tracked_page',c->'tracked_page');
 if octet_length(j::text)>32768 then raise exception 'Exact page check context exceeds bounds' using errcode='22023';end if;
 return j;
end $$;
create function private.website_validate_check_evidence(p_evidence jsonb,p_checked_at timestamptz)
returns void language plpgsql set search_path='' as $$
declare item jsonb;key text;begin
 if p_checked_at is null or not isfinite(p_checked_at) or p_checked_at>clock_timestamp() or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>32768
 or not p_evidence ?& array['indexed','schema_valid','mobile_score','desktop_score','notes','evidence_url','findings'] or (select count(*) from jsonb_object_keys(p_evidence))<>7 then raise exception 'Exact bounded manual evidence and past observation time required' using errcode='22023';end if;
 foreach key in array array['indexed','schema_valid'] loop
 if jsonb_typeof(p_evidence->key) not in ('boolean','null') then raise exception 'Choose boolean or explicit unknown check values' using errcode='22023';end if;end loop;
 foreach key in array array['mobile_score','desktop_score'] loop
 if jsonb_typeof(p_evidence->key) not in ('number','null') then raise exception 'Score must be explicit unknown or between 0 and 100' using errcode='22023';end if;
 if jsonb_typeof(p_evidence->key)='number' and (p_evidence->>key)::numeric not between 0 and 100 then raise exception 'Score must be between 0 and 100' using errcode='22023';end if;end loop;
 if jsonb_typeof(p_evidence->'notes') is distinct from 'string' or length(p_evidence->>'notes')>4000 or jsonb_typeof(p_evidence->'evidence_url') not in ('string','null') or not private.website_valid_url(p_evidence->>'evidence_url') or jsonb_typeof(p_evidence->'findings') is distinct from 'array' or jsonb_array_length(p_evidence->'findings')>25 then raise exception 'Bounded notes/evidence URL/page findings required' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_evidence->'findings') loop
 if jsonb_typeof(item) is distinct from 'object' or not item ?& array['category','severity','description','evidence'] or (select count(*) from jsonb_object_keys(item))<>4 or item->>'category' not in ('indexing','schema','performance','content','technical') or item->>'severity' not in ('info','warning','critical') or jsonb_typeof(item->'category') is distinct from 'string' or jsonb_typeof(item->'severity') is distinct from 'string' or jsonb_typeof(item->'description') is distinct from 'string' or length(btrim(item->>'description')) not between 1 and 1000 or jsonb_typeof(item->'evidence') is distinct from 'string' or length(item->>'evidence')>2000 then raise exception 'Each manual finding needs exact page-scoped category/severity/description/evidence' using errcode='22023';end if;end loop;
 if p_evidence->>'notes'='' and p_evidence->'evidence_url'='null'::jsonb and jsonb_array_length(p_evidence->'findings')=0 then raise exception 'Provide manual evidence notes, a URL or a finding' using errcode='22023';end if;
end $$;
create function public.preview_project_website_version_check(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_architecture_version_id uuid,p_checked_at timestamptz,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;j jsonb;begin
 perform private.website_write_authorized(p_organization_id,p_project_id);perform private.website_validate_check_evidence(p_evidence,p_checked_at);
 snapshot:=private.website_check_snapshot(p_organization_id,p_project_id,p_page_id,p_architecture_version_id);
 j:=jsonb_build_object('scope_snapshot',snapshot,'scope_checksum',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),'checked_at',p_checked_at,'evidence',p_evidence,'source_type','manual','provider_request_made',false);
 return j||jsonb_build_object('review_sha256',encode(sha256(convert_to(j::text,'UTF8')),'hex'));
end $$;

create function public.confirm_project_website_version_check(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_architecture_version_id uuid,p_checked_at timestamptz,p_evidence jsonb,p_review_sha256 text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;prior public.project_website_check_commands%rowtype;sha text;review jsonb;snapshot jsonb;saved public.project_website_version_checks%rowtype;result jsonb;begin
 actor:=private.website_write_authorized(p_organization_id,p_project_id);perform private.website_validate_check_evidence(p_evidence,p_checked_at);
 if p_request_id is null or p_review_sha256 is null or p_review_sha256!~'^[0-9a-f]{64}$' then raise exception 'Exact review checksum and own operation UUID required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':website-check:'||p_request_id::text,0));
 perform private.website_approved_source(p_organization_id,p_project_id,p_architecture_version_id);
 sha:=encode(sha256(convert_to(jsonb_build_object('project',p_project_id,'page',p_page_id,'version',p_architecture_version_id,'checked_at',p_checked_at,'evidence',p_evidence,'review',p_review_sha256)::text,'UTF8')),'hex');
 select * into prior from public.project_website_check_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then
 if prior.created_by<>actor or prior.request_sha256<>sha then raise exception 'Original check operation actor or payload differs' using errcode='23505';end if;
 return prior.result||jsonb_build_object('idempotent_replay',true);end if;
 review:=public.preview_project_website_version_check(p_organization_id,p_project_id,p_page_id,p_architecture_version_id,p_checked_at,p_evidence);
 if review->>'review_sha256' is distinct from p_review_sha256 then raise exception 'Current source/page/link context or evidence changed; review again' using errcode='40001';end if;
 snapshot:=review->'scope_snapshot';
 insert into public.project_website_version_checks(organization_id,project_id,brand_id,page_id,architecture_artifact_id,architecture_version_id,architecture_approval_id,architecture_checksum,implementation_revision_id,seo_link_id,tracked_page_id,scope_snapshot,scope_checksum,checked_at,evidence,created_by)
 values(p_organization_id,p_project_id,(snapshot->>'brand_id')::uuid,p_page_id,(snapshot#>>'{reference,artifact_id}')::uuid,p_architecture_version_id,(snapshot#>>'{reference,approval_id}')::uuid,snapshot#>>'{reference,content_checksum}',(snapshot#>>'{implementation,id}')::uuid,(snapshot#>>'{seo_link,id}')::uuid,(snapshot#>>'{tracked_page,id}')::uuid,snapshot,review->>'scope_checksum',p_checked_at,p_evidence,actor) returning * into saved;
 result:=jsonb_build_object('check',to_jsonb(saved),'source_type','manual','provider_request_made',false,'idempotent_replay',false);
 if octet_length(result::text)>65536 then raise exception 'Version check receipt exceeds bounds' using errcode='22023';end if;
 insert into public.project_website_check_commands(organization_id,project_id,request_id,request_sha256,result,created_by) values(p_organization_id,p_project_id,p_request_id,sha,result,actor);
 return result;
end $$;
create function public.get_project_website_version_check_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_request_id is null then raise exception 'Exact original operation required' using errcode='22023';end if;
 select c.result into result from public.project_website_check_commands c where organization_id=p_organization_id and project_id=p_project_id and request_id=p_request_id and created_by=(select auth.uid());
 return result;
end $$;
create function public.list_project_website_version_checks(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_architecture_version_id uuid,p_query text default '',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;snapshot jsonb;current_sha text;item public.project_website_version_checks%rowtype;rows jsonb:='[]';reasons jsonb;total bigint;matching bigint;j jsonb;begin
 if p_query is null or length(p_query)>120 or p_query~'[[:cntrl:]]' or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Choose bounded check history search and paging' using errcode='22023';end if;
 c:=private.website_seo_context(p_organization_id,p_project_id,p_page_id,p_architecture_version_id,null);
 if c->>'source_state'='available' then snapshot:=private.website_check_snapshot(p_organization_id,p_project_id,p_page_id,p_architecture_version_id);current_sha:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');end if;
 select count(*) into total from public.project_website_version_checks where organization_id=p_organization_id and project_id=p_project_id and page_id=p_page_id;
 select count(*) into matching from public.project_website_version_checks where organization_id=p_organization_id and project_id=p_project_id and page_id=p_page_id and (p_query='' or strpos(lower(evidence->>'notes'),lower(p_query))>0 or exists(select 1 from jsonb_array_elements(evidence->'findings') f where strpos(lower(f->>'description'),lower(p_query))>0));
 for item in select * from public.project_website_version_checks where organization_id=p_organization_id and project_id=p_project_id and page_id=p_page_id and (p_query='' or strpos(lower(evidence->>'notes'),lower(p_query))>0 or exists(select 1 from jsonb_array_elements(evidence->'findings') f where strpos(lower(f->>'description'),lower(p_query))>0)) order by created_at desc,id limit p_limit offset p_offset loop
 reasons:='[]';
 if snapshot is null then reasons:=reasons||jsonb_build_array(c->>'source_state');
 elsif item.architecture_version_id<>p_architecture_version_id then reasons:=reasons||jsonb_build_array('architecture_version_changed');
 else
 if item.scope_checksum<>current_sha then
 if item.scope_snapshot->'implementation' is distinct from snapshot->'implementation' then reasons:=reasons||jsonb_build_array('implementation_changed');end if;
 if item.scope_snapshot->'seo_link' is distinct from snapshot->'seo_link' then reasons:=reasons||jsonb_build_array('seo_link_changed');end if;
 if item.scope_snapshot->'tracked_page' is distinct from snapshot->'tracked_page' then reasons:=reasons||jsonb_build_array('tracked_page_changed');end if;
 if item.scope_snapshot->'reference' is distinct from snapshot->'reference' or item.scope_snapshot->'planned_page_checksum' is distinct from snapshot->'planned_page_checksum' then reasons:=reasons||jsonb_build_array('approved_source_changed');end if;
 if reasons='[]'::jsonb then reasons:=jsonb_build_array('scope_changed');end if;
 end if;
 if item.checked_at<greatest((snapshot#>>'{implementation,created_at}')::timestamptz,(snapshot#>>'{seo_link,created_at}')::timestamptz,(snapshot#>>'{tracked_page,updated_at}')::timestamptz) then reasons:=reasons||jsonb_build_array('observation_predates_current_state');end if;
 end if;
 rows:=rows||jsonb_build_array(jsonb_build_object('check',to_jsonb(item),'source_type','manual','recheck_required',jsonb_array_length(reasons)>0,'recheck_reasons',reasons,'state',case when jsonb_array_length(reasons)>0 then 'recheck_required' else 'current_manual_evidence' end,'provider_verified',false));
 end loop;
 j:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',c->'engagement_id','page_id',p_page_id,'architecture_version_id',p_architecture_version_id,'source_state',c->'source_state','items',rows,'total',total,'matching',matching,'offset',p_offset,'has_more',p_offset+jsonb_array_length(rows)<matching,'provider_request_made',false,'provider_verified',false);
 if octet_length(j::text)>131072 then raise exception 'Check history exceeds whole response bounds' using errcode='22023';end if;return j;
end $$;
revoke all on function private.website_check_snapshot(uuid,uuid,uuid,uuid),private.website_validate_check_evidence(jsonb,timestamptz),public.preview_project_website_version_check(uuid,uuid,uuid,uuid,timestamptz,jsonb),public.confirm_project_website_version_check(uuid,uuid,uuid,uuid,timestamptz,jsonb,text,uuid),public.get_project_website_version_check_operation(uuid,uuid,uuid),public.list_project_website_version_checks(uuid,uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.preview_project_website_version_check(uuid,uuid,uuid,uuid,timestamptz,jsonb),public.confirm_project_website_version_check(uuid,uuid,uuid,uuid,timestamptz,jsonb,text,uuid),public.get_project_website_version_check_operation(uuid,uuid,uuid),public.list_project_website_version_checks(uuid,uuid,uuid,uuid,text,integer,integer) to authenticated;
commit;
