create table private.gsc_property_bindings (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null unique,
 connection_id uuid not null references public.integration_connections,site text not null,revision integer not null,
 foreign key(project_id,organization_id) references public.projects(id,organization_id)
);
revoke all on private.gsc_property_bindings from public,anon,authenticated,service_role;
create function private.gsc_choices(p_org uuid,p_project uuid)
returns table(connection uuid,site text,label text) language sql stable security definer set search_path='' as $$
 select c.id,c.public_config->>'site_url',c.display_name from public.integration_connections c
 join public.integration_oauth_credentials k on k.connection_id=c.id and k.organization_id=c.organization_id and k.provider=c.provider
 where c.organization_id=p_org and c.provider='google_search_console' and c.status='verified' and c.archived_at is null
 and c.public_config->>'site_url' is not null and 'https://www.googleapis.com/auth/webmasters.readonly'=any(k.granted_scopes)
 and exists(select from public.integration_connection_departments d where d.connection_id=c.id and d.department_id in ('development','marketing'))
 and (not exists(select from public.integration_connection_engagements m where m.connection_id=c.id)
 or exists(select from public.integration_connection_engagements m join public.engagements e on e.id=m.engagement_id
 where m.connection_id=c.id and e.organization_id=p_org and e.project_id=p_project and e.status in ('planning','active')))
$$;
revoke all on function private.gsc_choices(uuid,uuid) from public,anon,authenticated;
create function public.gsc_settings(p_org uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;b private.gsc_property_bindings; choices jsonb;
begin
 s:=public.work_drive_settings(p_org,p_project);
 select * into b from private.gsc_property_bindings where project_id=p_project and organization_id=p_org;
 if (s->>'manage')::boolean and exists(select from public.organization_memberships where organization_id=p_org and user_id=auth.uid() and status='active' and role in ('system_owner','operations_admin','executive')) then
 select jsonb_agg(to_jsonb(c) order by label) into choices from private.gsc_choices(p_org,p_project)c;
 end if;
 return jsonb_build_object('binding',b.id,'site',b.site,'revision',coalesce(b.revision,0),'choices',coalesce(choices,'[]'));
end;$$;
create function public.gsc_bind(p_org uuid,p_project uuid,p_connection uuid,p_site text,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_project::text,81));
 settings:=public.gsc_settings(p_org,p_project);
 if (settings->>'revision')::int<>p_revision or not exists(select from jsonb_array_elements(settings->'choices') c where c->>'connection'=p_connection::text and c->>'site'=p_site)
 then raise exception 'Project property or permission changed';end if;
 insert into private.gsc_property_bindings(organization_id,project_id,connection_id,site,revision) values(p_org,p_project,p_connection,p_site,1)
 on conflict(project_id) do update set connection_id=excluded.connection_id,site=excluded.site,revision=private.gsc_property_bindings.revision+1
 where (private.gsc_property_bindings.connection_id,private.gsc_property_bindings.site) is distinct from (excluded.connection_id,excluded.site);
 return public.gsc_settings(p_org,p_project);
end;$$;
revoke all on function public.gsc_settings(uuid,uuid),public.gsc_bind(uuid,uuid,uuid,text,integer) from public,anon;
grant execute on function public.gsc_settings(uuid,uuid),public.gsc_bind(uuid,uuid,uuid,text,integer) to authenticated;
create table private.gsc_imports (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects,
 binding_id uuid not null references private.gsc_property_bindings, revision integer not null,
 start_date date not null,end_date date not null check(end_date-start_date=89),
 phase text not null default 'pages' check(phase in ('pages','queries','done')),
 cursor_offset integer not null default 0, synced_at timestamptz,
 unique(binding_id,revision,end_date)
);
create table private.gsc_import_rows (
 run_id uuid not null references private.gsc_imports on delete cascade,page text not null,query text not null,
 clicks bigint not null,impressions bigint not null,ctr double precision not null,position double precision not null,
 row_key text generated always as (md5(page)||md5(query)) stored,
 primary key(run_id,row_key)
);
revoke all on private.gsc_imports,private.gsc_import_rows from public,anon,authenticated,service_role;
create function private.gsc_active_scope(p_org uuid,p_project uuid,p_binding uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b private.gsc_property_bindings;
begin
 select * into strict b from private.gsc_property_bindings where id=p_binding and organization_id=p_org and project_id=p_project;
 if not exists(select from private.gsc_choices(p_org,p_project) c where c.connection=b.connection_id and c.site=b.site) then raise exception 'Refresh the project property binding';end if;
 return jsonb_build_object('connection',b.connection_id,'site',b.site,'revision',b.revision);
end;$$;
revoke all on function private.gsc_active_scope(uuid,uuid,uuid) from public,anon,authenticated;
create function public.gsc_import_progress(p_org uuid,p_project uuid,p_binding uuid,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; job private.gsc_imports;
begin
 perform private.website_read_authorized(p_org,p_project);
 if (public.work_drive_settings(p_org,p_project)->>'manage')::boolean is not true then raise insufficient_privilege; end if;
 ctx:=private.gsc_active_scope(p_org,p_project,p_binding);
 if p_end is distinct from (now() at time zone 'America/Los_Angeles')::date-3 then raise exception 'Invalid import period';end if;
 select * into job from private.gsc_imports where binding_id=p_binding and revision=(ctx->>'revision')::int and phase<>'done' order by end_date desc limit 1;
 if not found then
 insert into private.gsc_imports(project_id,binding_id,revision,start_date,end_date) values(p_project,p_binding,(ctx->>'revision')::int,p_end-89,p_end) on conflict do nothing;
 select * into strict job from private.gsc_imports where binding_id=p_binding and revision=(ctx->>'revision')::int and end_date=p_end;
 end if;
 return ctx||to_jsonb(job);
end;$$;
create function public.commit_gsc_batch(p_org uuid,p_project uuid,p_run uuid,p_phase text,p_offset integer,p_rows jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare job private.gsc_imports;ctx jsonb; n integer:=jsonb_array_length(p_rows);
begin
 select * into strict job from private.gsc_imports where id=p_run and project_id=p_project for update;
 ctx:=private.gsc_active_scope(p_org,p_project,job.binding_id);
 if (ctx->>'revision')::int<>job.revision then raise exception 'Binding changed';end if;
 if job.phase<>p_phase or job.cursor_offset<>p_offset then return job.phase; end if;
 if p_phase not in ('queries','pages') or n>1000 then raise exception 'Invalid batch';end if;
 insert into private.gsc_import_rows(run_id,page,query,clicks,impressions,ctr,position) select job.id,x.* from jsonb_to_recordset(p_rows) as x(page text,query text,clicks bigint,impressions bigint,ctr double precision,position double precision)
 on conflict(run_id,row_key) do update set clicks=excluded.clicks,impressions=excluded.impressions,ctr=excluded.ctr,position=excluded.position;
 update private.gsc_imports set cursor_offset=case when n=1000 then p_offset+n else 0 end,
 phase=case when n=1000 then p_phase when p_phase='pages' then 'queries' else 'done' end,
 synced_at=case when n<1000 and p_phase='queries' then now() end where id=p_run returning phase into job.phase;
 return job.phase;
end;$$;
revoke all on function public.commit_gsc_batch(uuid,uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.commit_gsc_batch(uuid,uuid,uuid,text,integer,jsonb) to service_role;
create function public.gsc_page_performance(p_org uuid,p_project uuid,p_page uuid,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.gsc_imports; address text;ctx jsonb; totals jsonb; queries jsonb;
begin
 perform private.website_read_authorized(p_org,p_project);
 select x->>'url' into strict address from private.website_inventory_rows(p_org,p_project) x where x->>'id'=p_page::text;
 if p_offset<0 then raise exception 'Invalid offset';end if;
 for job in select * from private.gsc_imports where project_id=p_project and phase='done' order by end_date desc,synced_at desc loop
 begin ctx:=private.gsc_active_scope(p_org,p_project,job.binding_id);exception when no_data_found or raise_exception or insufficient_privilege or invalid_parameter_value then continue;end;
 if (ctx->>'revision')::int<>job.revision then continue;end if;
 select to_jsonb(r)-'run_id' into totals from private.gsc_import_rows r where run_id=job.id and page=address and query='';
 select jsonb_agg(to_jsonb(s)) into queries from (select query,clicks,impressions,ctr,position from private.gsc_import_rows where run_id=job.id and page=address and query<>'' order by clicks desc,query limit 51 offset p_offset)s;
 return jsonb_build_object('site',ctx->'site','start',job.start_date,'end',job.end_date,'synced',job.synced_at,'totals',totals,'queries',coalesce(queries,'[]'));
 end loop;
 return null;
end;$$;
revoke all on function public.gsc_import_progress(uuid,uuid,uuid,date),public.gsc_page_performance(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.gsc_import_progress(uuid,uuid,uuid,date),public.gsc_page_performance(uuid,uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
