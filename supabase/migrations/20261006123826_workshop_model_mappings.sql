begin;
set local lock_timeout='5s';
-- Preserve every installed event kind while adding the one additive mapping audit kind.
do $$declare v_check text; begin
 select pg_get_expr(conbin,conrelid) into strict v_check from pg_constraint where conrelid='public.engagement_events'::regclass and conname='engagement_events_event_type_check';
 execute 'alter table public.engagement_events drop constraint engagement_events_event_type_check';
 execute format('alter table public.engagement_events add constraint engagement_events_event_type_check check ((%s) or event_type = %L)',v_check,'workshop_model_mappings_added');
end; $$;
create table private.workshop_model_mapping_receipts (
 organization_id uuid not null references public.organizations(id), actor_id uuid not null references auth.users(id), request_id uuid not null,
 project_id uuid not null references public.projects(id), engagement_id uuid not null references public.engagements(id),
 command jsonb not null, response jsonb not null, created_at timestamptz not null default now(), primary key(organization_id,actor_id,request_id));
alter table private.workshop_model_mapping_receipts enable row level security;
revoke all on private.workshop_model_mapping_receipts from public,anon,authenticated,service_role;
grant select,insert on private.workshop_model_mapping_receipts to service_role;
create function private.workshop_mapping_context(p_org uuid,p_project uuid,p_engagement uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.organizations where id=p_org and status='active' for share;
 if not found then raise exception 'Organization unavailable' using errcode='42501'; end if;
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=p_actor and status='active' and member_kind='team'
 and role in ('system_owner','operations_admin','executive') for share;
 if not found then raise exception 'Leadership required' using errcode='42501'; end if;
 perform 1 from public.projects where id=p_project and organization_id=p_org and status='active' and archived_at is null for share;
 if not found then raise exception 'Project unavailable' using errcode='42501'; end if;
 perform 1 from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project and status='active' for share;
 if not found then raise exception 'Engagement unavailable' using errcode='42501'; end if;
end; $$;
create function public.get_workshop_model_mappings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_rows jsonb; v_services jsonb; v_scope jsonb;
begin
 perform private.workshop_mapping_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 perform 1 from public.engagement_services s join public.service_catalog c on c.id=s.service_id
 where s.organization_id=p_organization_id and s.engagement_id=p_engagement_id order by s.id for share of s,c;
 perform 1 from public.integration_connections c where c.organization_id=p_organization_id and c.provider in ('openai','anthropic','google_gemini') order by c.id for share;
 perform 1 from public.integration_connection_departments d where d.organization_id=p_organization_id order by d.connection_id,d.department_id for share;
 perform 1 from public.department_chat_model_configurations m where m.organization_id=p_organization_id order by m.id for share;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'department_id',c.department_id) order by s.id),'[]') into v_services
 from public.engagement_services s join public.service_catalog c on c.id=s.service_id where s.organization_id=p_organization_id and s.engagement_id=p_engagement_id;
 select coalesce(jsonb_agg(row order by row->>'department_id',row->>'connection_id'),'[]') into v_rows from (
 select jsonb_build_object('connection_id',c.id,'department_id',d.department_id,'display_name',c.display_name,'provider',c.provider,
 'revision',md5(jsonb_build_array(c.updated_at,c.last_checked_at,c.public_config,c.secret_name is not null)::text),
 'models',(select jsonb_agg(jsonb_build_object('id',m.id,'model_id',m.model_id,'verified_at',m.verified_at) order by m.id)
 from public.department_chat_model_configurations m where m.organization_id=p_organization_id and m.connector_connection_id=c.id and m.department_id=d.department_id
 and m.revoked_at is null and (c.public_config->>'model_id'=m.model_id or coalesce(c.public_config->'verified_model_ids','[]') ? m.model_id)),
 'linked',exists(select 1 from public.integration_connection_engagements e where e.organization_id=p_organization_id and e.engagement_id=p_engagement_id
 and e.connection_id=c.id and e.department_id=d.department_id)) row
 from public.integration_connections c join public.integration_connection_departments d on d.connection_id=c.id and d.organization_id=c.organization_id
 where c.organization_id=p_organization_id and c.provider in ('openai','anthropic','google_gemini') and c.status='verified' and c.archived_at is null and c.secret_name is not null
 and d.department_id in ('content','design','marketing')
 and exists(select 1 from public.engagement_services s join public.service_catalog sc on sc.id=s.service_id where s.organization_id=p_organization_id
 and s.engagement_id=p_engagement_id and s.status='active' and sc.department_id=d.department_id)
 and exists(select 1 from public.department_chat_model_configurations m where m.organization_id=p_organization_id and m.connector_connection_id=c.id
 and m.department_id=d.department_id and m.revoked_at is null and (c.public_config->>'model_id'=m.model_id or coalesce(c.public_config->'verified_model_ids','[]') ? m.model_id))
 ) candidates;
 if jsonb_array_length(v_rows)>100 then raise exception 'Too many candidates' using errcode='22023'; end if;
 v_scope:=jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,
 'project_name',(select name from public.projects where id=p_project_id),'candidates',v_rows,'services',v_services);
 return v_scope || jsonb_build_object('schema_version',1,'token',md5(v_scope::text));
end; $$;
create function public.save_workshop_model_mappings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_token text,p_selections jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_snapshot jsonb; v_command jsonb; v_prior private.workshop_model_mapping_receipts; v_item jsonb; v_added jsonb:='[]'; v_response jsonb; v_count integer;
begin
 if p_request_id is null or p_expected_token is null or coalesce(jsonb_typeof(p_selections),'')<>'array' then raise exception 'Complete reviewed command required' using errcode='22023'; end if;
 if jsonb_array_length(p_selections) not between 1 and 30 then raise exception 'Invalid selections' using errcode='22023'; end if;
 for v_item in select value from jsonb_array_elements(p_selections) loop
 if jsonb_typeof(v_item)<>'object' then raise exception 'Invalid selection' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(v_item))<>2 or coalesce(v_item->>'connection_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or coalesce(v_item->>'department_id','') not in ('content','design','marketing') then raise exception 'Invalid selection' using errcode='22023'; end if;
 end loop;
 select jsonb_agg(x order by x->>'department_id',x->>'connection_id') into v_command from (select distinct value x from jsonb_array_elements(p_selections)) q;
 if jsonb_array_length(v_command)<>jsonb_array_length(p_selections) then raise exception 'Duplicate selections' using errcode='22023'; end if;
 v_command:=jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'token',p_expected_token,'selections',v_command);
 perform private.workshop_mapping_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_actor_id::text||p_request_id::text,0));
 select * into v_prior from private.workshop_model_mapping_receipts where organization_id=p_organization_id and actor_id=p_actor_id and request_id=p_request_id;
 if found then
 if v_prior.command<>v_command then raise exception 'Request changed' using errcode='22023'; end if;
 return v_prior.response; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_engagement_id::text,0));
 v_snapshot:=public.get_workshop_model_mappings(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 if v_snapshot->>'token'<>p_expected_token then raise exception 'Review changed' using errcode='40001'; end if;
 for v_item in select value from jsonb_array_elements(v_command->'selections') loop
 if not exists(select 1 from jsonb_array_elements(v_snapshot->'candidates') c where c->>'connection_id'=v_item->>'connection_id' and c->>'department_id'=v_item->>'department_id') then
 raise exception 'Selection unavailable' using errcode='23514'; end if;
 insert into public.integration_connection_engagements(connection_id,organization_id,engagement_id,department_id,created_by)
 values((v_item->>'connection_id')::uuid,p_organization_id,p_engagement_id,v_item->>'department_id',p_actor_id) on conflict do nothing;
 get diagnostics v_count=row_count;
 if v_count=1 then v_added:=v_added||jsonb_build_array(v_item); end if;
 end loop;
 v_response:=jsonb_build_object('schema_version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,
 'request_id',p_request_id,'added',v_added,'selections',v_command->'selections','persisted',true);
 insert into private.workshop_model_mapping_receipts values(p_organization_id,p_actor_id,p_request_id,p_project_id,p_engagement_id,v_command,v_response,now());
 insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload) values(p_organization_id,p_engagement_id,'workshop_model_mappings_added',p_actor_id,v_response);
 return v_response;
end; $$;
create function public.recover_workshop_model_mappings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_result jsonb;
begin
 perform private.workshop_mapping_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 select response into v_result from private.workshop_model_mapping_receipts where organization_id=p_organization_id and actor_id=p_actor_id
 and project_id=p_project_id and engagement_id=p_engagement_id and request_id=p_request_id;
 return v_result;
end; $$;
revoke all on function private.workshop_mapping_context(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.workshop_mapping_context(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.get_workshop_model_mappings(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_workshop_model_mappings(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.save_workshop_model_mappings(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_workshop_model_mappings(uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.recover_workshop_model_mappings(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.recover_workshop_model_mappings(uuid,uuid,uuid,uuid,uuid) to service_role;
commit;
