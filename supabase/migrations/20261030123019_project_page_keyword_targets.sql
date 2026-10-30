-- Explicit planned targeting of stable pages. No tracked keyword/ranking/provider mutation.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
create table private.project_page_keyword_target_revisions(
 organization_id uuid not null references public.organizations(id),project_id uuid not null references public.projects(id),page_id uuid not null references public.project_website_pages(id),
 revision bigint not null check(revision>0),strategy_version_id uuid not null references public.artifact_versions(id),
 source_checksum text not null check(source_checksum~'^[0-9a-f]{64}$'),targets jsonb not null check(jsonb_typeof(targets)='array' and jsonb_array_length(targets)<=200),
 actor_id uuid not null references auth.users(id),request_id uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(page_id,revision)
);
create index project_page_keyword_target_project on private.project_page_keyword_target_revisions(organization_id,project_id);
create index project_page_keyword_target_source on private.project_page_keyword_target_revisions(strategy_version_id);
create table private.project_page_keyword_target_commands(
 organization_id uuid not null references public.organizations(id),project_id uuid not null references public.projects(id),page_id uuid not null references public.project_website_pages(id),actor_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(organization_id,actor_id,request_id)
);
create index project_page_keyword_command_project on private.project_page_keyword_target_commands(project_id,page_id);
do $$declare t text;begin
 foreach t in array array['project_page_keyword_target_revisions','project_page_keyword_target_commands'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_keyword_target before update or delete on private.%I for each row execute function private.n1b_preserve_receipt()',t);
 end loop;
end;$$;

create function private.page_keyword_scope(p_org uuid,p_project uuid,p_page uuid,p_write boolean) returns public.project_website_pages
language plpgsql security definer set search_path='' as $$
declare page public.project_website_pages;begin
 perform private.n1c_require_scope(p_org,p_project,auth.uid());
 select * into page from public.project_website_pages where id=p_page and organization_id=p_org and project_id=p_project for share;
 if not found then raise exception 'Exact registered project page required' using errcode='42501';end if;
 if p_write and private.n1c_can_assign_department(p_org,p_project,'content',auth.uid()) is not true then raise exception 'Current project manager, admin or participating Content head required' using errcode='42501';end if;
 return page;
end;$$;

create function public.read_project_page_keyword_targets(p_organization_id uuid,p_project_id uuid,p_page_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare history jsonb;begin
 perform private.page_keyword_scope(p_organization_id,p_project_id,p_page_id,false);
 select coalesce(jsonb_agg(to_jsonb(r) order by revision desc),'[]') into history from (select * from private.project_page_keyword_target_revisions where organization_id=p_organization_id and project_id=p_project_id and page_id=p_page_id order by revision desc limit 50) r;
 return jsonb_build_object('page_id',p_page_id,'revision',coalesce((history->0->>'revision')::bigint,0),'current',history->0,'history',history,'history_limit',50,'measurement_kind','planned_target');
end;$$;

create function public.get_project_page_keyword_source(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_strategy_version_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare page public.project_website_pages;v public.artifact_versions;begin
 page:=private.page_keyword_scope(p_organization_id,p_project_id,p_page_id,false);
 select av.* into v from public.artifact_versions av join public.artifacts ar on ar.id=av.artifact_id and ar.organization_id=av.organization_id
 where av.id=p_strategy_version_id and av.organization_id=p_organization_id and ar.project_id=p_project_id and ar.engagement_id=page.engagement_id and ar.brand_id=page.brand_id and ar.artifact_type='keyword_strategy' for share of ar,av;
 if not found then raise exception 'Exact same-project keyword source required' using errcode='42501';end if;
 perform private.require_pipeline_approved_artifact(p_organization_id,p_project_id,p_strategy_version_id,'keyword_strategy',null);
 if v.content_checksum is distinct from encode(sha256(convert_to(v.content::text,'UTF8')),'hex') or jsonb_typeof(v.content->'keywords') is distinct from 'array' or jsonb_array_length(v.content->'keywords')>2000 or octet_length(v.content::text)>524288 then raise exception 'Bounded exact keyword source unavailable' using errcode='55000';end if;
 return jsonb_build_object('strategy_version_id',v.id,'source_checksum',v.content_checksum,'keywords',v.content->'keywords','measurement_kind','planned_target');
end;$$;

create function public.review_project_page_keyword_targets(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_expected_revision bigint,p_strategy_version_id uuid,p_source_checksum text,p_targets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare page public.project_website_pages;v public.artifact_versions;a public.artifacts;target jsonb;keyword jsonb;draft jsonb;resolved jsonb:='[]';current_revision bigint;idx integer;cluster text;role text;before_record private.project_page_keyword_target_revisions;
begin
 page:=private.page_keyword_scope(p_organization_id,p_project_id,p_page_id,true);
 select x.* into a from public.artifacts x join public.artifact_versions av on av.artifact_id=x.id and av.organization_id=x.organization_id where av.id=p_strategy_version_id and av.organization_id=p_organization_id and x.project_id=p_project_id and x.engagement_id=page.engagement_id and x.brand_id=page.brand_id and x.artifact_type='keyword_strategy' for share of x,av;
 if not found then raise exception 'Same-page-scope exact keyword strategy required' using errcode='42501';end if;
 perform private.require_pipeline_approved_artifact(p_organization_id,p_project_id,p_strategy_version_id,'keyword_strategy',null);
 select * into v from public.artifact_versions where id=p_strategy_version_id and organization_id=p_organization_id for share;
 if v.content_checksum is distinct from p_source_checksum or v.content_checksum is distinct from encode(sha256(convert_to(v.content::text,'UTF8')),'hex') then raise exception 'Exact saved strategy source changed' using errcode='40001';end if;
 if jsonb_typeof(v.content->'keywords') is distinct from 'array' or jsonb_array_length(v.content->'keywords')>2000 then raise exception 'Bounded canonical keyword source required' using errcode='22023';end if;
 if p_targets is null or jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets)>200 then raise exception 'Review up to two hundred exact keyword targets' using errcode='22023';end if;
 for target in select value from jsonb_array_elements(p_targets) loop
 if jsonb_typeof(target)<>'object' or (select count(*) from jsonb_object_keys(target))<>3 or not target ?& array['keyword_index','role','cluster'] or jsonb_typeof(target->'keyword_index')<>'number' or (target->>'keyword_index')!~'^[0-9]+$' or jsonb_typeof(target->'cluster')<>'string' or not coalesce(target->>'role' in ('primary','supporting'),false) then raise exception 'Exact keyword index, cluster and explicit primary/supporting role required' using errcode='22023';end if;
 idx:=(target->>'keyword_index')::integer;role:=target->>'role';cluster:=target->>'cluster';keyword:=v.content->'keywords'->idx;
 if keyword is null or jsonb_typeof(keyword)<>'object' or length(btrim(coalesce(keyword->>'term','')))=0 or length(cluster) not between 1 and 240 or cluster<>btrim(cluster) or cluster~'[[:cntrl:]]' then raise exception 'Existing exact keyword and bounded explicit cluster required' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(resolved) r where (r->>'keyword_index')::integer=idx or (r->'source'->>'term'=keyword->>'term' and coalesce(r->'source'->>'locale','')=coalesce(keyword->>'locale',''))) then raise exception 'A source term/locale is targeted only once per page' using errcode='22023';end if;
 if role='primary' and exists(select 1 from jsonb_array_elements(resolved) r where r->>'role'='primary' and coalesce(r->'source'->>'locale','')=coalesce(keyword->>'locale','')) then raise exception 'One primary target per page and exact source locale' using errcode='22023';end if;
 resolved:=resolved||jsonb_build_array(jsonb_build_object('keyword_index',idx,'role',role,'cluster',cluster,'source',keyword));
 end loop;
 select coalesce(max(revision),0) into current_revision from private.project_page_keyword_target_revisions where page_id=p_page_id and organization_id=p_organization_id and project_id=p_project_id;
 if p_expected_revision is distinct from current_revision then raise exception 'Page targeting changed; review current revision' using errcode='40001';end if;
 select * into before_record from private.project_page_keyword_target_revisions where page_id=p_page_id and organization_id=p_organization_id and project_id=p_project_id and revision=current_revision;
 draft:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'page_id',p_page_id,'expected_revision',current_revision,'before_targets',coalesce(before_record.targets,'[]'),'before_strategy_version_id',before_record.strategy_version_id,'strategy_version_id',v.id,'source_checksum',v.content_checksum,'targets',resolved,'measurement_kind','planned_target');
 if octet_length(draft::text)>524288 then raise exception 'Target review exceeds bounded size' using errcode='22023';end if;
 return jsonb_build_object('draft',draft,'review_sha256',encode(sha256(convert_to(draft::text,'UTF8')),'hex'));
end;$$;

create function public.save_project_page_keyword_targets(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_expected_revision bigint,p_strategy_version_id uuid,p_source_checksum text,p_targets jsonb,p_review_sha256 text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();payload jsonb;old private.project_page_keyword_target_commands;review jsonb;saved private.project_page_keyword_target_revisions;begin
 perform 1 from public.projects where id=p_project_id and organization_id=p_organization_id and archived_at is null for update;
 perform private.page_keyword_scope(p_organization_id,p_project_id,p_page_id,true);
 if p_request_id is null or p_review_sha256 is null then raise exception 'Exact original keyword request and review required' using errcode='22023';end if;
 payload:=jsonb_build_object('project_id',p_project_id,'page_id',p_page_id,'revision',p_expected_revision,'strategy',p_strategy_version_id,'checksum',p_source_checksum,'targets',p_targets,'review',p_review_sha256);
 perform pg_advisory_xact_lock(hashtextextended('page-keyword:'||p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 select * into old from private.project_page_keyword_target_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then if old.payload is distinct from payload then raise exception 'Original keyword request retains its exact payload' using errcode='23505';end if;return old.result;end if;
 review:=public.review_project_page_keyword_targets(p_organization_id,p_project_id,p_page_id,p_expected_revision,p_strategy_version_id,p_source_checksum,p_targets);
 if review->>'review_sha256'<>p_review_sha256 then raise exception 'Keyword target review changed' using errcode='40001';end if;
 insert into private.project_page_keyword_target_revisions(organization_id,project_id,page_id,revision,strategy_version_id,source_checksum,targets,actor_id,request_id) values(p_organization_id,p_project_id,p_page_id,p_expected_revision+1,p_strategy_version_id,p_source_checksum,review->'draft'->'targets',actor,p_request_id) returning * into saved;
 insert into private.project_page_keyword_target_commands(organization_id,project_id,page_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,p_page_id,actor,p_request_id,payload,to_jsonb(saved));return to_jsonb(saved);
end;$$;

create function public.recover_project_page_keyword_targets(p_organization_id uuid,p_project_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare command private.project_page_keyword_target_commands;begin
 perform private.n1c_require_scope(p_organization_id,p_project_id,auth.uid());
 select * into command from private.project_page_keyword_target_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=auth.uid() and request_id=p_request_id;
 if not found then return jsonb_build_object('status','not_found');end if;
 perform private.page_keyword_scope(p_organization_id,p_project_id,command.page_id,false);
 return jsonb_build_object('status','applied','original_result',command.result);
end;$$;
revoke all on function private.page_keyword_scope(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_project_page_keyword_source(uuid,uuid,uuid,uuid),public.read_project_page_keyword_targets(uuid,uuid,uuid),public.review_project_page_keyword_targets(uuid,uuid,uuid,bigint,uuid,text,jsonb),public.save_project_page_keyword_targets(uuid,uuid,uuid,bigint,uuid,text,jsonb,text,uuid),public.recover_project_page_keyword_targets(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_project_page_keyword_source(uuid,uuid,uuid,uuid),public.read_project_page_keyword_targets(uuid,uuid,uuid),public.review_project_page_keyword_targets(uuid,uuid,uuid,bigint,uuid,text,jsonb),public.save_project_page_keyword_targets(uuid,uuid,uuid,bigint,uuid,text,jsonb,text,uuid),public.recover_project_page_keyword_targets(uuid,uuid,uuid) to authenticated;
commit;
