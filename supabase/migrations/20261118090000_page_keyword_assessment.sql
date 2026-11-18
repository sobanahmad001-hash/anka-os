create table private.website_keyword_decisions (
 project_id uuid not null references public.projects,page_id uuid not null,query text not null,
 state text not null check(state in ('selected','dismissed','suggested')),revision integer not null,
 primary key(project_id,page_id,query)
);
create table private.website_keyword_decision_events (
 request_id uuid primary key,project_id uuid not null,page_id uuid not null,query text not null,
 actor uuid not null,state text not null,input jsonb not null,created_at timestamptz not null default now()
);
revoke all on private.website_keyword_decisions,private.website_keyword_decision_events from public,anon,authenticated,service_role;
create index gsc_query_overlap on private.gsc_import_rows(run_id,query);
create function public.website_keyword_assessment(p_org uuid,p_project uuid,p_page uuid,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare page_record jsonb; job private.gsc_imports; ctx jsonb; rows jsonb; states jsonb; source jsonb;
begin
 perform private.website_read_authorized(p_org,p_project);
 select x into strict page_record from private.website_inventory_rows(p_org,p_project)x where x->>'id'=p_page::text;
 if p_offset<0 then raise exception 'Invalid offset';end if;
 select jsonb_agg(jsonb_build_object('query',d.query,'state',d.state,'revision',d.revision)) into states from private.website_keyword_decisions d where project_id=p_project and page_id=p_page;
 select s.meta into source from private.website_import_sources s where s.project_id=p_project and s.page_id=p_page limit 1;
 for job in select * from private.gsc_imports where project_id=p_project and phase='done' order by end_date desc,synced_at desc loop
 begin ctx:=private.gsc_active_scope(p_org,p_project,job.binding_id);exception when no_data_found or raise_exception or insufficient_privilege or invalid_parameter_value then continue;end;
 if (ctx->>'revision')::int<>job.revision then continue;end if;
 select jsonb_agg(to_jsonb(t)) into rows from (
 select r.query,r.clicks,r.impressions,r.ctr,r.position,
 (select count(*) from private.gsc_import_rows other where other.run_id=job.id and other.query=r.query and other.page<>r.page) as overlap_count,
 (select jsonb_agg(x) from (select other.page,other.clicks,other.impressions,other.position from private.gsc_import_rows other
 where other.run_id=job.id and other.query=r.query and other.page<>r.page order by other.clicks desc,other.page limit 5)x) as overlaps
 from private.gsc_import_rows r where r.run_id=job.id and r.page=page_record->>'url' and r.query<>'' order by r.clicks desc,r.impressions desc,r.query limit 51 offset p_offset)t;
 return jsonb_build_object('page',page_record,'source',source,'run',job.id,'start',job.start_date,'end',job.end_date,'synced',job.synced_at,'rows',coalesce(rows,'[]'),'decisions',coalesce(states,'[]'));
 end loop;
 return jsonb_build_object('page',page_record,'source',source,'rows','[]'::jsonb,'decisions',coalesce(states,'[]'));
end;$$;
create function public.decide_website_keyword(p_org uuid,p_project uuid,p_page uuid,p_query text,p_state text,p_request uuid,
 p_decision_revision integer,p_page_revision integer,p_role text default null,p_intent text default null,p_locale text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;page_record jsonb; old private.website_keyword_decisions; event private.website_keyword_decision_events;
 payload jsonb:=jsonb_build_array(p_state,p_decision_revision,p_page_revision,p_role,p_intent,p_locale);
 targets jsonb;exists_target boolean; matched boolean:=false;job private.gsc_imports;ctx jsonb;
begin
 actor:=private.website_write_authorized(p_org,p_project);
 perform pg_advisory_xact_lock(hashtextextended(p_project::text||p_page::text,99));
 select x into strict page_record from private.website_inventory_rows(p_org,p_project)x where x->>'id'=p_page::text;
 select * into event from private.website_keyword_decision_events where request_id=p_request;
 if found then
 if event.project_id=p_project and event.page_id=p_page and event.query=p_query and event.actor=actor and event.input=payload then return p_page;end if;
 raise exception 'Decision request conflicts';
 end if;
 if p_request is null or p_state not in ('selected','dismissed','suggested') or p_query is null or length(p_query) not between 1 and 240 then raise exception 'Invalid decision';end if;
 select * into old from private.website_keyword_decisions where project_id=p_project and page_id=p_page and query=p_query;
 if coalesce(old.revision,0) is distinct from p_decision_revision then raise exception 'Decision changed; reload assessment' using errcode='40001';end if;
 for job in select * from private.gsc_imports where project_id=p_project and phase='done' order by end_date desc,synced_at desc loop
 begin ctx:=private.gsc_active_scope(p_org,p_project,job.binding_id);exception when no_data_found or raise_exception or insufficient_privilege or invalid_parameter_value then continue;end;
 if (ctx->>'revision')::int<>job.revision then continue;end if;
 matched:=exists(select from private.gsc_import_rows where run_id=job.id and page=page_record->>'url' and query=p_query);
 exit;
 end loop;
 if not matched and old.query is null then raise exception 'Query evidence unavailable';end if;
 if p_state='selected' then
 if not matched then raise exception 'Query absent from current snapshot';end if;
 if (page_record->>'revision')::int is distinct from p_page_revision then raise exception 'Page changed; reload before accepting' using errcode='40001';end if;
 if p_role not in ('primary','supporting') or coalesce(length(trim(p_intent)),0) not between 1 and 250 or coalesce(length(trim(p_locale)),0) not between 1 and 60 then raise exception 'Confirm role, intent and locale';end if;
 targets:=case when page_record->>'mode'='undecided' then coalesce((select jsonb_agg(jsonb_build_object('query',t->'source'->>'term','intent',coalesce(nullif(t->'source'->>'intent',''),'Unspecified'),'locale',coalesce(nullif(t->'source'->>'locale',''),'Unspecified'),'role',t->>'role')) from jsonb_array_elements(page_record->'sourceTargets')t),'[]') else page_record->'targets' end;
 exists_target:=exists(select from jsonb_array_elements(targets)t where lower(trim(t->>'query'))=lower(trim(p_query)) and lower(trim(t->>'locale'))=lower(trim(p_locale)));
 if exists_target then raise exception 'This query and locale are already assigned; edit existing targets to change its role';end if;
 if p_role='primary' and exists(select from jsonb_array_elements(targets)t where t->>'role'='primary') then raise exception 'A primary target already exists. Accept as supporting or edit existing targets explicitly.';end if;
 targets:=targets||jsonb_build_array(jsonb_build_object('query',p_query,'intent',trim(p_intent),'locale',trim(p_locale),'role',p_role));
 page_record:=page_record||jsonb_build_object('mode','targets','targets',targets);
 perform public.save_website_manual_page(p_org,p_project,p_page,(page_record->>'sourceId')::uuid,p_page_revision,page_record);
 end if;
 insert into private.website_keyword_decisions values(p_project,p_page,p_query,p_state,coalesce(old.revision,0)+1)
 on conflict(project_id,page_id,query) do update set state=excluded.state,revision=excluded.revision;
 insert into private.website_keyword_decision_events values(p_request,p_project,p_page,p_query,actor,p_state,payload,now());
 return p_page;
end;$$;
create function public.website_gsc_url_review(p_org uuid,p_project uuid,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.gsc_imports;ctx jsonb;result jsonb;
begin
 perform private.website_read_authorized(p_org,p_project);
 if p_offset<0 then raise exception 'Invalid offset';end if;
 for job in select * from private.gsc_imports where project_id=p_project and phase='done' order by end_date desc,synced_at desc loop
 begin ctx:=private.gsc_active_scope(p_org,p_project,job.binding_id);exception when no_data_found or raise_exception or insufficient_privilege or invalid_parameter_value then continue;end;
 if (ctx->>'revision')::int<>job.revision then continue;end if;
 with inventory as materialized(select x from private.website_inventory_rows(p_org,p_project)x),
 missing as (select distinct page from private.gsc_import_rows where run_id=job.id except select x->>'url' from inventory),
 paged as (select page from missing order by page limit 51 offset p_offset)
 select jsonb_build_object('total',(select count(*) from missing),'rows',coalesce(jsonb_agg(jsonb_build_object('url',p.page,'observed',e.meta,'observed_at',e.created_at)),'[]'))
 into result from paged p left join lateral(
 select s.meta,j.created_at from private.website_scan_pages s join private.website_scan_jobs j on j.id=s.job_id
 where j.project_id=p_project and s.url=p.page and s.service_observed order by j.created_at desc limit 1)e on true;
 return result;
 end loop;
 return jsonb_build_object('total',0,'rows','[]'::jsonb);
end;$$;
revoke all on function public.website_keyword_assessment(uuid,uuid,uuid,integer),public.decide_website_keyword(uuid,uuid,uuid,text,text,uuid,integer,integer,text,text,text),public.website_gsc_url_review(uuid,uuid,integer) from public,anon;
grant execute on function public.website_keyword_assessment(uuid,uuid,uuid,integer),public.decide_website_keyword(uuid,uuid,uuid,text,text,uuid,integer,integer,text,text,text),public.website_gsc_url_review(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
