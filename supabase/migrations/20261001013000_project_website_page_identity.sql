-- AD1: stable planned page identity, canonical source provenance and owned operations.
-- Additive only: no architecture edits, work creation/assignment, provider or publication calls.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('private.n6_project_configuration_authorized(uuid,uuid,uuid)')),chr(13),'')) is distinct from 'b5005c1ed90d7fe6cf8acc091c1cfb81' then raise exception 'Exact project authority prerequisite differs' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)')),chr(13),'')) is distinct from '033f6c233c35b8c2641716b861a63cd2' then raise exception 'Exact approved artifact prerequisite differs' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.normalize_content_page_path(text)')),chr(13),'')) is distinct from '50c931d3b9a4f18092884332f6654b53' then raise exception 'Legacy page normalization prerequisite differs' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.guard_work_item_page_link()')),chr(13),'')) is distinct from '7c56fcf978e767ad152802c71d0fd53d' then raise exception 'Immutable Work Item page link prerequisite differs' using errcode='55000';end if;
end;$$;
create table public.project_website_pages(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,brand_id uuid not null,
 architecture_artifact_id uuid not null,initial_architecture_version_id uuid not null,initial_approval_id uuid not null,
 page_key text not null check(length(page_key) between 1 and 1208 and page_key=btrim(page_key) and page_key!~'[[:cntrl:]]'),
 initial_path text not null check(length(initial_path) between 1 and 1200),created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),unique(project_id,page_key),unique(id,organization_id),unique(id,project_id,brand_id,organization_id),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id) on delete restrict,
 foreign key(brand_id,organization_id) references public.brands(id,organization_id) on delete restrict,
 foreign key(architecture_artifact_id,initial_architecture_version_id,organization_id) references public.artifact_versions(artifact_id,id,organization_id) on delete restrict,
 foreign key(initial_approval_id,organization_id) references public.artifact_approvals(id,organization_id) on delete restrict
);
create index project_website_pages_source_idx on public.project_website_pages(architecture_artifact_id,initial_architecture_version_id,organization_id);
create index project_website_pages_approval_idx on public.project_website_pages(initial_approval_id,organization_id);
create index project_website_pages_engagement_idx on public.project_website_pages(engagement_id,project_id,organization_id);
create index project_website_pages_brand_idx on public.project_website_pages(brand_id,organization_id);
create table public.project_website_page_revisions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,page_id uuid not null,
 revision_number bigint not null check(revision_number>0),architecture_artifact_id uuid not null,architecture_version_id uuid not null,architecture_approval_id uuid not null,
 architecture_checksum text not null check(architecture_checksum~'^[0-9a-f]{64}$'),planned_path text not null,
 planned_url text,recorded_live_url text,redirect_url text,publication_state text not null check(publication_state in ('planned','in_progress','review','ready','published','retired')),
 template text,work_item_id uuid,implementation_notes text not null,qa_evidence text not null,
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),
 unique(page_id,revision_number),unique(id,organization_id),foreign key(page_id,organization_id) references public.project_website_pages(id,organization_id) on delete restrict,
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
 foreign key(architecture_artifact_id,architecture_version_id,organization_id) references public.artifact_versions(artifact_id,id,organization_id) on delete restrict,
 foreign key(architecture_approval_id,organization_id) references public.artifact_approvals(id,organization_id) on delete restrict,
 foreign key(work_item_id,organization_id) references public.work_items(id,organization_id) on delete restrict,
 check(publication_state<>'published' or recorded_live_url is not null),check(redirect_url is null or recorded_live_url is not null),
 check(length(coalesce(template,''))<=160 and length(implementation_notes)<=4000 and length(qa_evidence)<=4000)
);
create index website_page_revision_project_idx on public.project_website_page_revisions(project_id,organization_id);
create index website_page_revision_source_idx on public.project_website_page_revisions(architecture_artifact_id,architecture_version_id,organization_id);
create index website_page_revision_approval_idx on public.project_website_page_revisions(architecture_approval_id,organization_id);
create index website_page_revision_work_idx on public.project_website_page_revisions(work_item_id,organization_id);
create table public.project_website_page_seo_links(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,brand_id uuid not null,page_id uuid not null,
 link_number bigint not null check(link_number>0),tracked_page_id uuid,architecture_artifact_id uuid not null,architecture_version_id uuid not null,architecture_approval_id uuid not null,architecture_checksum text not null check(architecture_checksum~'^[0-9a-f]{64}$'),created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),
 unique(page_id,link_number),unique(id,organization_id),foreign key(page_id,project_id,brand_id,organization_id) references public.project_website_pages(id,project_id,brand_id,organization_id) on delete restrict,
 foreign key(tracked_page_id,brand_id,organization_id) references public.tracked_pages(id,brand_id,organization_id) on delete restrict,
 foreign key(architecture_artifact_id,architecture_version_id,organization_id) references public.artifact_versions(artifact_id,id,organization_id) on delete restrict,
 foreign key(architecture_approval_id,organization_id) references public.artifact_approvals(id,organization_id) on delete restrict
);
create index website_page_seo_target_idx on public.project_website_page_seo_links(tracked_page_id,brand_id,organization_id);
create index website_page_seo_source_idx on public.project_website_page_seo_links(architecture_artifact_id,architecture_version_id,organization_id);
create index website_page_seo_approval_idx on public.project_website_page_seo_links(architecture_approval_id,organization_id);
create index website_page_seo_project_idx on public.project_website_page_seo_links(project_id,organization_id);
create table public.project_website_page_commands(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,request_id uuid not null,
 command_kind text not null check(command_kind in ('register','save_operations','link_seo')),
 request_sha256 text not null check(request_sha256~'^[0-9a-f]{64}$'),result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=32768),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default clock_timestamp(),unique(organization_id,request_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create index website_page_command_project_idx on public.project_website_page_commands(project_id,organization_id);
do $$declare name text;begin
 foreach name in array array['project_website_pages','project_website_page_revisions','project_website_page_seo_links','project_website_page_commands'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select on public.%I to authenticated,service_role',name);
  execute format('create policy "Current team reads exact project website records" on public.%I for select to authenticated using(private.is_active_pipeline_team_member(organization_id) and exists(select 1 from public.projects p where p.id=%I.project_id and p.organization_id=%I.organization_id))',name,name,name);
  execute format('create trigger immutable_website_record before update or delete on public.%I for each row execute function private.reject_pipeline_template_mutation()',name);
 end loop;
end;$$;
create function private.website_architecture_pages(p_content jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare item jsonb;rows jsonb:='[]';path text;key text;parent text;legacy_parent text;seen text[];cursor_key text;begin
 if jsonb_typeof(p_content->'pages') is distinct from 'array' or jsonb_array_length(p_content->'pages') not between 1 and 1000 then raise exception 'Choose an architecture with 1-1000 pages' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_content->'pages') loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'slug') is distinct from 'string' or item->>'slug'~*'^[a-z][a-z0-9+.-]*:' then raise exception 'Canonical page path required' using errcode='22023';end if;
  select string_agg(regexp_replace(lower(btrim(segment)),'[[:space:]]+','-','g'),'/' order by ordinal) into path from unnest(string_to_array(regexp_replace(replace(normalize(btrim(item->>'slug'),NFKC),chr(92),'/'),'/+','/','g'),'/')) with ordinality t(segment,ordinal) where btrim(segment)<>'';
  if path is null or length(path)>1200 or path~'[?#[:cntrl:]]' or exists(select 1 from unnest(string_to_array(path,'/')) s where s in ('.','..')) then raise exception 'Unique valid canonical page path required' using errcode='22023';end if;
  key:=nullif(btrim(item->>'page_key'),'');
  if key is null then
   if private.normalize_content_page_path(item->>'slug') is distinct from path then raise exception 'Legacy normalization differs; explicit approved stable-key reconciliation required' using errcode='55000';end if;
   key:='legacy:'||path;
  end if;
  if length(key)>1208 or key~'[[:cntrl:]]' or exists(select 1 from jsonb_array_elements(rows) r where r->>'page_key'=key or r->>'path'=path)
   or jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title')) not between 1 and 240 or not coalesce(item->>'page_type' in ('hub','service','supporting'),false) then raise exception 'Unique page keys/paths and published title/type required' using errcode='22023';end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('page_key',key,'path',path,'title',item->>'title','page_type',item->>'page_type','parent_page_key',nullif(btrim(item->>'parent_page_key'),''),'parent_slug',nullif(item->>'parent_slug',''),'position',jsonb_array_length(rows)+1));
 end loop;
 -- Resolve all legacy parents before cycle traversal, independent of array ordering.
 for item in select value from jsonb_array_elements(rows) loop
  parent:=item->>'parent_page_key';legacy_parent:=null;
  if item->>'parent_slug' is not null then
   select r->>'page_key' into legacy_parent from jsonb_array_elements(rows) r where r->>'path'=private.normalize_content_page_path(item->>'parent_slug');
   if legacy_parent is null or (parent is not null and parent<>legacy_parent) then raise exception 'Legacy and stable-key parent must resolve to the same exact page' using errcode='22023';end if;
  end if;
  parent:=coalesce(parent,legacy_parent);
  if parent is not null and not exists(select 1 from jsonb_array_elements(rows) r where r->>'page_key'=parent) then raise exception 'Parent page is missing from this exact architecture' using errcode='22023';end if;
  rows:=jsonb_set(rows,array[((item->>'position')::int-1)::text,'parent_page_key'],coalesce(to_jsonb(parent),'null'::jsonb));
 end loop;
 for item in select value from jsonb_array_elements(rows) loop
  seen:=array[item->>'page_key'];cursor_key:=item->>'parent_page_key';
  while cursor_key is not null loop
   if cursor_key=any(seen) then raise exception 'Architecture hierarchy contains a cycle' using errcode='22023';end if;
   seen:=array_append(seen,cursor_key);select r->>'parent_page_key' into cursor_key from jsonb_array_elements(rows) r where r->>'page_key'=cursor_key;
  end loop;
 end loop;
 return rows;
end;$$;
create function private.website_approved_source(p_org uuid,p_project uuid,p_version uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ref jsonb;artifact public.artifacts;engagement public.engagements;version public.artifact_versions;begin
 ref:=private.require_pipeline_approved_artifact(p_org,p_project,p_version,'website_architecture',null);
 select * into artifact from public.artifacts where id=(ref->>'artifact_id')::uuid and organization_id=p_org;
 select * into engagement from public.engagements where id=artifact.engagement_id and organization_id=p_org for share;
 select * into version from public.artifact_versions where id=p_version and organization_id=p_org;
 if engagement.id is null or engagement.project_id is distinct from p_project or artifact.brand_id is distinct from engagement.brand_id or engagement.status not in ('planning','active')
  or encode(sha256(convert_to(version.content::text,'UTF8')),'hex') is distinct from version.content_checksum then raise exception 'Exact same-project/engagement/brand approved architecture required' using errcode='42501';end if;
 return jsonb_build_object('reference',ref,'engagement_id',engagement.id,'brand_id',engagement.brand_id,'pages',private.website_architecture_pages(version.content));
end;$$;
create function private.website_write_authorized(p_org uuid,p_project uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());begin
 -- Exclusive project lock FIRST, avoiding share-lock upgrades across concurrent bulk operations.
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for update;
 if not found or actor is null or not private.n6_project_configuration_authorized(p_org,p_project,actor) then raise exception 'Current exact-project operations/PM authority required' using errcode='42501';end if;
 return actor;
end;$$;
create function private.website_registration_preview(p_org uuid,p_project uuid,p_version uuid,p_keys jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare source jsonb;item jsonb;registered public.project_website_pages;selected jsonb:='[]';key text;result jsonb;begin
 if jsonb_typeof(p_keys) is distinct from 'array' or jsonb_array_length(p_keys) not between 1 and 150 or exists(select 1 from jsonb_array_elements(p_keys) x where jsonb_typeof(x)<>'string')
  or (select count(distinct value) from jsonb_array_elements_text(p_keys))<>jsonb_array_length(p_keys) then raise exception 'Review 1-150 distinct exact page keys' using errcode='22023';end if;
 source:=private.website_approved_source(p_org,p_project,p_version);
 for key in select value from jsonb_array_elements_text(p_keys) loop
  select value into item from jsonb_array_elements(source->'pages') where value->>'page_key'=key;
  if item is null then raise exception 'Selected key is absent from the exact approved architecture' using errcode='22023';end if;
  select * into registered from public.project_website_pages where organization_id=p_org and project_id=p_project and page_key=key;
  if registered.id is not null and (registered.architecture_artifact_id is distinct from (source->'reference'->>'artifact_id')::uuid or registered.engagement_id is distinct from (source->>'engagement_id')::uuid or registered.brand_id is distinct from (source->>'brand_id')::uuid) then raise exception 'A stable page key cannot silently merge another architecture root' using errcode='23505';end if;
  if item->>'parent_page_key' is not null and not (p_keys ? (item->>'parent_page_key')) and not exists(select 1 from public.project_website_pages r where r.organization_id=p_org and r.project_id=p_project and r.architecture_artifact_id=(source->'reference'->>'artifact_id')::uuid and r.page_key=item->>'parent_page_key') then raise exception 'Register the exact parent in this batch or before its child' using errcode='22023';end if;
  selected:=selected||jsonb_build_array(item-'parent_slug'||jsonb_build_object('registered_page_id',registered.id,'initial_path',coalesce(registered.initial_path,item->>'path')));
 end loop;
 result:=jsonb_build_object('organization_id',p_org,'project_id',p_project,'engagement_id',source->>'engagement_id','brand_id',source->>'brand_id','reference',source->'reference','pages',selected);
 return result||jsonb_build_object('review_sha256',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
create function public.preview_project_website_pages(p_organization_id uuid,p_project_id uuid,p_architecture_version_id uuid,p_page_keys jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.website_write_authorized(p_organization_id,p_project_id);
 return private.website_registration_preview(p_organization_id,p_project_id,p_architecture_version_id,p_page_keys);
end;$$;
create function public.register_project_website_pages(p_organization_id uuid,p_project_id uuid,p_architecture_version_id uuid,p_page_keys jsonb,p_review_sha256 text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;prior public.project_website_page_commands;sha text;preview jsonb;item jsonb;page public.project_website_pages;results jsonb:='[]';result jsonb;begin
 actor:=private.website_write_authorized(p_organization_id,p_project_id);
 if p_request_id is null or p_review_sha256 is null then raise exception 'Exact review and operation UUID required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':website:'||p_request_id::text,0));
 sha:=encode(sha256(convert_to(jsonb_build_object('kind','register','project',p_project_id,'version',p_architecture_version_id,'keys',p_page_keys,'review',p_review_sha256)::text,'UTF8')),'hex');
 -- Current exact source is rechecked even during recovery; no latest-version substitution.
 perform private.website_approved_source(p_organization_id,p_project_id,p_architecture_version_id);
 select * into prior from public.project_website_page_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.created_by<>actor or prior.request_sha256<>sha then raise exception 'Original website operation has a different actor or payload' using errcode='23505';end if;
  return prior.result||jsonb_build_object('idempotent_replay',true);
 end if;
 preview:=private.website_registration_preview(p_organization_id,p_project_id,p_architecture_version_id,p_page_keys);
 if preview->>'review_sha256' is distinct from p_review_sha256 then raise exception 'Page registration review changed; preview the exact batch again' using errcode='40001';end if;
 for item in select value from jsonb_array_elements(preview->'pages') loop
  select * into page from public.project_website_pages where organization_id=p_organization_id and project_id=p_project_id and page_key=item->>'page_key';
  if not found then
   insert into public.project_website_pages(organization_id,project_id,engagement_id,brand_id,architecture_artifact_id,initial_architecture_version_id,initial_approval_id,page_key,initial_path,created_by)
   values(p_organization_id,p_project_id,(preview->>'engagement_id')::uuid,(preview->>'brand_id')::uuid,(preview->'reference'->>'artifact_id')::uuid,p_architecture_version_id,(preview->'reference'->>'approval_id')::uuid,item->>'page_key',item->>'path',actor) returning * into page;
  end if;
  results:=results||jsonb_build_array(jsonb_build_object('page_id',page.id,'page_key',page.page_key,'initial_path',page.initial_path));
 end loop;
 result:=jsonb_build_object('pages',results,'source_version_id',p_architecture_version_id,'source_checksum',preview->'reference'->>'content_checksum','source_approval_id',preview->'reference'->>'approval_id','idempotent_replay',false);
 insert into public.project_website_page_commands(organization_id,project_id,request_id,command_kind,request_sha256,result,created_by) values(p_organization_id,p_project_id,p_request_id,'register',sha,result,actor);
 return result;
end;$$;

create function private.website_valid_url(p_value text) returns boolean language sql immutable set search_path='' as $$
 select p_value is null or (length(p_value) between 1 and 2048 and p_value=btrim(p_value) and p_value~'^https?://[^/]+(/.*)?$'
  and p_value!~'[[:space:][:cntrl:]?#]' and position(chr(92) in p_value)=0
  and split_part(split_part(p_value,'://',2),'/',1)~*'^([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(:[0-9]{1,5})?$'
  and case when split_part(split_part(p_value,'://',2),'/',1)~*'^([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(:[0-9]{1,5})?$' then coalesce(substring(split_part(split_part(p_value,'://',2),'/',1) from ':([0-9]+)$')::integer,80) between 1 and 65535 else false end
  and p_value!~*'/(\.|%2e)(\.|%2e)?(/|$)');
$$;
create function private.website_validate_operations(p_value jsonb) returns void language plpgsql set search_path='' as $$
declare name text;begin
 if jsonb_typeof(p_value) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_value))<>8 or p_value-array['planned_url','recorded_live_url','redirect_url','publication_state','template','work_item_id','implementation_notes','qa_evidence']<>'{}'::jsonb
  or not coalesce(p_value->>'publication_state' in ('planned','in_progress','review','ready','published','retired'),false) then raise exception 'Complete named page operation fields required; assignment belongs to canonical work' using errcode='22023';end if;
 foreach name in array array['planned_url','recorded_live_url','redirect_url'] loop
  if jsonb_typeof(p_value->name) not in ('string','null') or not private.website_valid_url(p_value->>name) then raise exception 'Bounded plain absolute HTTP(S) URL without credentials/query/fragment/traversal required' using errcode='22023';end if;
 end loop;
 foreach name in array array['implementation_notes','qa_evidence'] loop
  if jsonb_typeof(p_value->name) is distinct from 'string' or length(p_value->>name)>4000 or p_value->>name<>btrim(p_value->>name) or regexp_replace(p_value->>name,E'[\n\r\t]','','g')~'[[:cntrl:]]' then raise exception 'Bounded plain implementation/QA evidence required' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(p_value->'template') not in ('string','null') or length(coalesce(p_value->>'template',''))>160 or coalesce(p_value->>'template','')<>btrim(coalesce(p_value->>'template','')) or coalesce(p_value->>'template','')~'[[:cntrl:]]'
  or jsonb_typeof(p_value->'work_item_id') not in ('string','null') or (p_value->>'work_item_id' is not null and p_value->>'work_item_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  or (p_value->>'publication_state'='published' and p_value->>'recorded_live_url' is null) or (p_value->>'redirect_url' is not null and p_value->>'recorded_live_url' is null) then raise exception 'Supported template/work and recorded publication/redirect source required' using errcode='22023';end if;
end;$$;
create function public.save_project_website_page_operations(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_architecture_version_id uuid,p_expected_revision bigint,p_operations jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;page public.project_website_pages;source jsonb;item jsonb;work public.work_items;revision public.project_website_page_revisions;prior public.project_website_page_commands;current_number bigint;sha text;result jsonb;begin
 actor:=private.website_write_authorized(p_organization_id,p_project_id);
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Exact operation UUID and expected page revision required' using errcode='22023';end if;
 perform private.website_validate_operations(p_operations);
 source:=private.website_approved_source(p_organization_id,p_project_id,p_architecture_version_id);
 select * into page from public.project_website_pages where id=p_page_id and organization_id=p_organization_id and project_id=p_project_id for update;
 select value into item from jsonb_array_elements(source->'pages') where value->>'page_key'=page.page_key;
 if page.id is null or item is null or page.architecture_artifact_id is distinct from (source->'reference'->>'artifact_id')::uuid or page.engagement_id is distinct from (source->>'engagement_id')::uuid or page.brand_id is distinct from (source->>'brand_id')::uuid then raise exception 'Exact registered page/root/approved source required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':website:'||p_request_id::text,0));
 sha:=encode(sha256(convert_to(jsonb_build_object('kind','save_operations','project',p_project_id,'page',p_page_id,'version',p_architecture_version_id,'expected',p_expected_revision,'operations',p_operations)::text,'UTF8')),'hex');
 select * into prior from public.project_website_page_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.created_by<>actor or prior.request_sha256<>sha then raise exception 'Original page save has a different actor or payload' using errcode='23505';end if;
  return prior.result||jsonb_build_object('idempotent_replay',true);
 end if;
 select coalesce(max(revision_number),0) into current_number from public.project_website_page_revisions where page_id=page.id and organization_id=p_organization_id;
 if current_number<>p_expected_revision then raise exception 'Page operations changed; reload and review current revision' using errcode='40001';end if;
 if p_operations->>'work_item_id' is not null then
  select * into work from public.work_items where id=(p_operations->>'work_item_id')::uuid and organization_id=p_organization_id for share;
  if work.id is null or work.project_id is distinct from p_project_id or work.engagement_id is distinct from page.engagement_id or work.brand_id is distinct from page.brand_id or work.department_id is distinct from 'content' or work.deleted_at is not null
   or not coalesce(work.linked_page_key=page.page_key or case when work.linked_page_key is null and work.linked_page_path is not null then page.page_key='legacy:'||private.normalize_content_page_path(work.linked_page_path) and private.normalize_content_page_path(work.linked_page_path)=page.initial_path else false end,false)
   or not exists(select 1 from public.artifacts a where a.id=work.linked_artifact_id and a.organization_id=p_organization_id and a.project_id=p_project_id and a.engagement_id=page.engagement_id and a.brand_id=page.brand_id and a.artifact_type='content')
   then raise exception 'Link only an existing live same-project Content Work Item with the exact immutable page key/path' using errcode='42501';end if;
 end if;
 insert into public.project_website_page_revisions(organization_id,project_id,page_id,revision_number,architecture_artifact_id,architecture_version_id,architecture_approval_id,architecture_checksum,planned_path,planned_url,recorded_live_url,redirect_url,publication_state,template,work_item_id,implementation_notes,qa_evidence,created_by)
 values(p_organization_id,p_project_id,page.id,current_number+1,page.architecture_artifact_id,p_architecture_version_id,(source->'reference'->>'approval_id')::uuid,source->'reference'->>'content_checksum',item->>'path',p_operations->>'planned_url',p_operations->>'recorded_live_url',p_operations->>'redirect_url',p_operations->>'publication_state',p_operations->>'template',(p_operations->>'work_item_id')::uuid,p_operations->>'implementation_notes',p_operations->>'qa_evidence',actor) returning * into revision;
 result:=jsonb_build_object('page_id',page.id,'revision_id',revision.id,'revision_number',revision.revision_number,'architecture_version_id',revision.architecture_version_id,'idempotent_replay',false);
 insert into public.project_website_page_commands(organization_id,project_id,request_id,command_kind,request_sha256,result,created_by) values(p_organization_id,p_project_id,p_request_id,'save_operations',sha,result,actor);
 return result;
end;$$;
create function public.link_project_website_page_seo(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_architecture_version_id uuid,p_tracked_page_id uuid,p_expected_link_number bigint,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;page public.project_website_pages;source jsonb;prior public.project_website_page_commands;target public.tracked_pages;current_number bigint;link public.project_website_page_seo_links;sha text;result jsonb;begin
 actor:=private.website_write_authorized(p_organization_id,p_project_id);
 if p_request_id is null or p_expected_link_number is null or p_expected_link_number<0 then raise exception 'Exact operation UUID and current SEO link number required' using errcode='22023';end if;
 select * into page from public.project_website_pages where id=p_page_id and organization_id=p_organization_id and project_id=p_project_id for update;
 source:=private.website_approved_source(p_organization_id,p_project_id,p_architecture_version_id);
 if page.id is null or page.architecture_artifact_id is distinct from (source->'reference'->>'artifact_id')::uuid or page.engagement_id is distinct from (source->>'engagement_id')::uuid or page.brand_id is distinct from (source->>'brand_id')::uuid or not exists(select 1 from jsonb_array_elements(source->'pages') x where x->>'page_key'=page.page_key) then raise exception 'Exact registered project page and approved architecture required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':website:'||p_request_id::text,0));
 sha:=encode(sha256(convert_to(jsonb_build_object('kind','link_seo','project',p_project_id,'page',p_page_id,'version',p_architecture_version_id,'target',p_tracked_page_id,'expected',p_expected_link_number)::text,'UTF8')),'hex');
 select * into prior from public.project_website_page_commands where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.created_by<>actor or prior.request_sha256<>sha then raise exception 'Original SEO link has a different actor or payload' using errcode='23505';end if;
  return prior.result||jsonb_build_object('idempotent_replay',true);
 end if;
 select coalesce(max(link_number),0) into current_number from public.project_website_page_seo_links where page_id=page.id and organization_id=p_organization_id;
 if current_number<>p_expected_link_number then raise exception 'SEO link changed; reload before linking' using errcode='40001';end if;
 if p_tracked_page_id is not null then
  select * into target from public.tracked_pages where id=p_tracked_page_id and organization_id=p_organization_id and brand_id=page.brand_id for share;
  if target.id is null then raise exception 'Explicit same-organization/brand SEO target required' using errcode='42501';end if;
  if exists(select 1 from public.project_website_pages other join lateral(select l.tracked_page_id from public.project_website_page_seo_links l where l.page_id=other.id and l.organization_id=p_organization_id order by link_number desc limit 1) active on true where other.project_id=p_project_id and other.organization_id=p_organization_id and other.id<>page.id and active.tracked_page_id=p_tracked_page_id) then raise exception 'This SEO target is already explicitly linked to another project page' using errcode='23505';end if;
 end if;
 insert into public.project_website_page_seo_links(organization_id,project_id,brand_id,page_id,link_number,tracked_page_id,architecture_artifact_id,architecture_version_id,architecture_approval_id,architecture_checksum,created_by) values(p_organization_id,p_project_id,page.brand_id,page.id,current_number+1,p_tracked_page_id,page.architecture_artifact_id,p_architecture_version_id,(source->'reference'->>'approval_id')::uuid,source->'reference'->>'content_checksum',actor) returning * into link;
 result:=jsonb_build_object('page_id',page.id,'link_id',link.id,'link_number',link.link_number,'tracked_page_id',link.tracked_page_id,'architecture_version_id',link.architecture_version_id,'idempotent_replay',false);
 insert into public.project_website_page_commands(organization_id,project_id,request_id,command_kind,request_sha256,result,created_by) values(p_organization_id,p_project_id,p_request_id,'link_seo',sha,result,actor);
 return result;
end;$$;
create function private.website_read_authorized(p_org uuid,p_project uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.projects where id=p_project and organization_id=p_org for share;
 if not found then raise exception 'Exact project required' using errcode='42501';end if;
 perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id where o.id=p_org and o.status='active' and m.user_id=(select auth.uid()) and m.status='active' and m.member_kind='team' for share of o,m;
 if not found then raise exception 'Current active team access required' using errcode='42501';end if;
end;$$;
create function public.list_project_website_pages(p_organization_id uuid,p_project_id uuid,p_architecture_version_id uuid,p_search text default '',p_publication_state text default null,p_parent_page_key text default null,p_offset integer default 0,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare architecture_source jsonb;rows jsonb;counts jsonb;result jsonb;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_offset is null or p_limit is null or p_offset not between 0 and 10000 or p_limit not between 1 and 100 or p_search is null or length(p_search)>240 or (p_publication_state is not null and p_publication_state not in ('planned','in_progress','review','ready','published','retired')) then raise exception 'Bounded explicit website filters required' using errcode='22023';end if;
 architecture_source:=private.website_approved_source(p_organization_id,p_project_id,p_architecture_version_id);
 with exact_pages as(select x.value as source from jsonb_array_elements(architecture_source->'pages') x), resolved as(
  select e.source,p.id as page_id,p.initial_path,to_jsonb(r) as operations,l.tracked_page_id,l.link_number,
   case when w.id is null or w.deleted_at is not null then null else w.assignee_id end as owner_id,case when w.id is null or w.deleted_at is not null then null else w.due_date end as due_date,
   case when r.work_item_id is null then 'unlinked' when w.id is null or w.deleted_at is not null then 'unavailable' else 'current' end as work_state
  from exact_pages e left join public.project_website_pages p on p.organization_id=p_organization_id and p.project_id=p_project_id and p.architecture_artifact_id=(architecture_source->'reference'->>'artifact_id')::uuid and p.page_key=e.source->>'page_key'
  left join lateral(select * from public.project_website_page_revisions rr where rr.page_id=p.id and rr.organization_id=p_organization_id order by revision_number desc limit 1) r on true
  left join lateral(select * from public.project_website_page_seo_links ll where ll.page_id=p.id and ll.organization_id=p_organization_id order by link_number desc limit 1) l on true
  left join public.work_items w on w.id=r.work_item_id and w.organization_id=p_organization_id and w.project_id=p_project_id and w.engagement_id=(architecture_source->>'engagement_id')::uuid and w.brand_id=(architecture_source->>'brand_id')::uuid and w.department_id='content' and coalesce(w.linked_page_key=p.page_key or case when w.linked_page_key is null and w.linked_page_path is not null then p.page_key='legacy:'||private.normalize_content_page_path(w.linked_page_path) and private.normalize_content_page_path(w.linked_page_path)=p.initial_path else false end,false) and exists(select 1 from public.artifacts a where a.id=w.linked_artifact_id and a.organization_id=p_organization_id and a.project_id=p_project_id and a.engagement_id=w.engagement_id and a.brand_id=w.brand_id and a.artifact_type='content')
 ), filtered as(select * from resolved where (p_search='' or position(lower(p_search) in lower((source->>'title')||' '||(source->>'path')||' '||(source->>'page_key')))>0) and (p_publication_state is null or coalesce(operations->>'publication_state','planned')=p_publication_state) and (p_parent_page_key is null or source->>'parent_page_key'=p_parent_page_key))
 select jsonb_build_object('total',count(*),'registered',count(page_id),'planned',count(*) filter(where coalesce(operations->>'publication_state','planned')='planned'),'in_progress',count(*) filter(where operations->>'publication_state'='in_progress'),'review',count(*) filter(where operations->>'publication_state'='review'),'ready',count(*) filter(where operations->>'publication_state'='ready'),'published',count(*) filter(where operations->>'publication_state'='published'),'retired',count(*) filter(where operations->>'publication_state'='retired'),'linked_seo',count(tracked_page_id),'assigned',count(owner_id),'has_deadline',count(due_date),'filtered_total',(select count(*) from filtered)),
 (select coalesce(jsonb_agg(to_jsonb(f) order by (f.source->>'position')::int),'[]') from(select * from filtered order by (source->>'position')::int offset p_offset limit p_limit) f) into counts,rows from resolved;
 result:=jsonb_build_object('reference',architecture_source->'reference','counts',counts,'pages',rows,'offset',p_offset,'limit',p_limit);
 if octet_length(result::text)>131072 then raise exception 'Page response exceeds bound; choose a smaller page size' using errcode='22023';end if;
 return result;
end;$$;
create function public.get_project_website_page_history(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_offset integer default 0,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare page public.project_website_pages;result jsonb;begin
 perform private.website_read_authorized(p_organization_id,p_project_id);
 if p_offset is null or p_limit is null or p_offset not between 0 and 10000 or p_limit not between 1 and 100 then raise exception 'Bounded history page required' using errcode='22023';end if;
 select * into page from public.project_website_pages where id=p_page_id and organization_id=p_organization_id and project_id=p_project_id;
 if page.id is null then raise exception 'Exact registered project page required' using errcode='42501';end if;
 result:=jsonb_build_object('page',to_jsonb(page),'revisions',(select coalesce(jsonb_agg(to_jsonb(r) order by revision_number desc),'[]') from(select * from public.project_website_page_revisions where page_id=page.id and organization_id=p_organization_id order by revision_number desc offset p_offset limit p_limit) r),'seo_links',(select coalesce(jsonb_agg(to_jsonb(l) order by link_number desc),'[]') from(select * from public.project_website_page_seo_links where page_id=page.id and organization_id=p_organization_id order by link_number desc offset p_offset limit p_limit) l));
 if octet_length(result::text)>131072 then raise exception 'History response exceeds bound; choose a smaller page size' using errcode='22023';end if;
 return result;
end;$$;
revoke all on function private.website_valid_url(text),private.website_validate_operations(jsonb),private.website_read_authorized(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_project_website_page_operations(uuid,uuid,uuid,uuid,bigint,jsonb,uuid),public.link_project_website_page_seo(uuid,uuid,uuid,uuid,uuid,bigint,uuid),public.list_project_website_pages(uuid,uuid,uuid,text,text,text,integer,integer),public.get_project_website_page_history(uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_project_website_page_operations(uuid,uuid,uuid,uuid,bigint,jsonb,uuid),public.link_project_website_page_seo(uuid,uuid,uuid,uuid,uuid,bigint,uuid),public.list_project_website_pages(uuid,uuid,uuid,text,text,text,integer,integer),public.get_project_website_page_history(uuid,uuid,uuid,integer,integer) to authenticated;


create function public.get_project_website_page_operation(p_organization_id uuid,p_project_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;command public.project_website_page_commands;begin
 actor:=private.website_write_authorized(p_organization_id,p_project_id);
 select * into command from public.project_website_page_commands where organization_id=p_organization_id and project_id=p_project_id and request_id=p_request_id and created_by=actor;
 if not found then return null;end if;
 return jsonb_build_object('request_id',command.request_id,'command_kind',command.command_kind,'request_sha256',command.request_sha256,'result',command.result);
end;$$;
revoke all on function public.get_project_website_page_operation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_website_page_operation(uuid,uuid,uuid) to authenticated;

-- Private helpers are not callable as an alternative authority path.
revoke all on function private.website_architecture_pages(jsonb),private.website_approved_source(uuid,uuid,uuid),private.website_write_authorized(uuid,uuid),private.website_registration_preview(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.preview_project_website_pages(uuid,uuid,uuid,jsonb),public.register_project_website_pages(uuid,uuid,uuid,jsonb,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_project_website_pages(uuid,uuid,uuid,jsonb),public.register_project_website_pages(uuid,uuid,uuid,jsonb,text,uuid) to authenticated;
commit;
