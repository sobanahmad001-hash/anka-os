-- Read-only bounded exact page editor context. No work creation, assignment or external writes.
begin;
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('private.website_approved_source(uuid,uuid,uuid)')),chr(13),'')) is distinct from '8fbd479e8c1a8ab7b665196d1d1987a4' then raise exception 'Exact website source prerequisite differs' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.website_write_authorized(uuid,uuid)')),chr(13),'')) is distinct from 'b226456548a2ce582df254e367fe7ef0' then raise exception 'Exact website editor authority prerequisite differs' using errcode='55000';end if;
end;$$;
create function public.get_project_website_page_editor(p_organization_id uuid,p_project_id uuid,p_page_id uuid,p_architecture_version_id uuid,p_query text default '',p_work_offset integer default 0,p_seo_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source jsonb;identity jsonb;original_page jsonb;page public.project_website_pages;revision public.project_website_page_revisions;link public.project_website_page_seo_links;work_rows jsonb;seo_rows jsonb;work_more boolean;seo_more boolean;result jsonb;begin
 perform private.website_write_authorized(p_organization_id,p_project_id);
 if p_query is null or length(p_query)>120 or p_work_offset is null or p_seo_offset is null or p_limit is null or p_work_offset not between 0 and 10000 or p_seo_offset not between 0 and 10000 or p_limit not between 1 and 50 then raise exception 'Bounded page editor lookup required' using errcode='22023';end if;
 source:=private.website_approved_source(p_organization_id,p_project_id,p_architecture_version_id);
 select * into page from public.project_website_pages where id=p_page_id and organization_id=p_organization_id and project_id=p_project_id;
 select value into identity from jsonb_array_elements(source->'pages') where value->>'page_key'=page.page_key;
 if page.id is null or identity is null or page.architecture_artifact_id is distinct from (source->'reference'->>'artifact_id')::uuid or page.engagement_id is distinct from (source->>'engagement_id')::uuid or page.brand_id is distinct from (source->>'brand_id')::uuid then raise exception 'Exact registered page and approved project/brand source required' using errcode='42501';end if;
 select content->'pages'->((identity->>'position')::int-1) into original_page from public.artifact_versions where id=p_architecture_version_id and organization_id=p_organization_id;
 select * into revision from public.project_website_page_revisions where page_id=page.id and organization_id=p_organization_id order by revision_number desc limit 1;
 select * into link from public.project_website_page_seo_links where page_id=page.id and organization_id=p_organization_id order by link_number desc limit 1;
 with eligible as(
  select w.id,w.title,w.assignee_id,w.due_date,w.row_version,w.linked_page_key,w.linked_page_path
  from public.work_items w join public.artifacts a on a.id=w.linked_artifact_id and a.organization_id=w.organization_id and a.project_id=w.project_id and a.engagement_id=w.engagement_id and a.brand_id=w.brand_id and a.artifact_type='content'
  where w.organization_id=p_organization_id and w.project_id=p_project_id and w.engagement_id=page.engagement_id and w.brand_id=page.brand_id and w.department_id='content' and w.deleted_at is null
   and coalesce(w.linked_page_key=page.page_key or case when w.linked_page_key is null and w.linked_page_path is not null then page.page_key='legacy:'||private.normalize_content_page_path(w.linked_page_path) and private.normalize_content_page_path(w.linked_page_path)=page.initial_path else false end,false)
   and (p_query='' or w.id::text=p_query or position(lower(p_query) in lower(w.title))>0)
  order by w.id offset p_work_offset limit p_limit+1
 )select coalesce(jsonb_agg(to_jsonb(e)-'ordinal' order by e.id) filter(where ordinal<=p_limit),'[]'),count(*)>p_limit into work_rows,work_more from(select eligible.*,row_number()over(order by id)ordinal from eligible)e;
 with eligible as(
  select target.id,target.page_url,target.page_type from public.tracked_pages target
  where target.organization_id=p_organization_id and target.brand_id=page.brand_id and (p_query='' or target.id::text=p_query or position(lower(p_query) in lower(target.page_url))>0)
   and not exists(select 1 from public.project_website_pages other join lateral(select l.tracked_page_id from public.project_website_page_seo_links l where l.page_id=other.id and l.organization_id=p_organization_id order by link_number desc limit 1) current_link on true where other.project_id=p_project_id and other.organization_id=p_organization_id and other.id<>page.id and current_link.tracked_page_id=target.id)
  order by target.id offset p_seo_offset limit p_limit+1
 )select coalesce(jsonb_agg(to_jsonb(e)-'ordinal' order by e.id) filter(where ordinal<=p_limit),'[]'),count(*)>p_limit into seo_rows,seo_more from(select eligible.*,row_number()over(order by id)ordinal from eligible)e;
 result:=jsonb_build_object('page',to_jsonb(page),'reference',source->'reference','planned_path',identity->>'path','source_page',original_page,'operations',case when revision.id is null then null else to_jsonb(revision) end,'expected_revision',coalesce(revision.revision_number,0),'seo_link',case when link.id is null then null else to_jsonb(link) end,'expected_link_number',coalesce(link.link_number,0),'work_candidates',jsonb_build_object('items',work_rows,'offset',p_work_offset,'has_more',work_more),'seo_candidates',jsonb_build_object('items',seo_rows,'offset',p_seo_offset,'has_more',seo_more));
 if octet_length(result::text)>131072 then raise exception 'Exact page editor context exceeds response bound; choose smaller source or lookup page size' using errcode='22023';end if;
 return result;
end;$$;
revoke all on function public.get_project_website_page_editor(uuid,uuid,uuid,uuid,text,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_project_website_page_editor(uuid,uuid,uuid,uuid,text,integer,integer,integer) to authenticated;
commit;
