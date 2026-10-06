-- Explicit opt-in; empty state keeps every Workshop off. No existing grant changes.
create table private.workshop_execution_settings (
 organization_id uuid not null references public.organizations(id),
 project_id uuid not null references public.projects(id),
 engagement_id uuid not null references public.engagements(id),
 department_id text not null check (department_id in ('content','design','marketing')),
 enabled boolean not null default false,
 revision uuid not null default gen_random_uuid(),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key (organization_id,project_id,engagement_id,department_id)
);
alter table private.workshop_execution_settings enable row level security;
revoke all on private.workshop_execution_settings from public,anon,authenticated,service_role;
grant select,insert,update on private.workshop_execution_settings to service_role;
create table private.workshop_execution_receipts (
 organization_id uuid not null, actor_id uuid not null, request_id uuid not null,
 project_id uuid not null, engagement_id uuid not null,
 command jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key (organization_id,actor_id,request_id)
);
alter table private.workshop_execution_receipts enable row level security;
revoke all on private.workshop_execution_receipts from public,anon,authenticated,service_role;
grant select,insert on private.workshop_execution_receipts to service_role;
create trigger workshop_execution_receipts_immutable before update or delete on private.workshop_execution_receipts
for each row execute function private.reject_pipeline_template_mutation();

create function public.get_workshop_execution_settings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare mapping jsonb; workshops jsonb; states jsonb;
begin
 mapping := public.get_workshop_model_mappings(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 perform 1 from private.workshop_execution_settings s where s.organization_id=p_organization_id and s.project_id=p_project_id and s.engagement_id=p_engagement_id order by s.department_id for share;
 select coalesce(jsonb_agg(jsonb_build_object('department_id',d,'enabled',coalesce(s.enabled,false),
  'eligible',exists(select 1 from jsonb_array_elements(mapping->'candidates') c where c->>'department_id'=d and c->>'linked'='true')) order by d),'[]')
 into workshops from unnest(array['content','design','marketing']) d left join private.workshop_execution_settings s
 on s.organization_id=p_organization_id and s.project_id=p_project_id and s.engagement_id=p_engagement_id and s.department_id=d;
 select coalesce(jsonb_agg(jsonb_build_object('department_id',s.department_id,'revision',s.revision,'enabled',s.enabled) order by s.department_id),'[]') into states
 from private.workshop_execution_settings s where s.organization_id=p_organization_id and s.project_id=p_project_id and s.engagement_id=p_engagement_id;
 return jsonb_build_object('schema_version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,
  'project_name',mapping->>'project_name','workshops',workshops,'token',md5((mapping->>'token')||states::text));
end;$$;

create function public.save_workshop_execution_settings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_token text,p_selections jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb; receipt private.workshop_execution_receipts; command jsonb; result jsonb; row jsonb; selections jsonb;
begin
 perform private.workshop_mapping_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 if p_request_id is null or p_expected_token is null or p_expected_token !~ '^[0-9a-f]{32}$' or p_selections is null or jsonb_typeof(p_selections)<>'array' then
  raise exception 'Reviewed activation command required.' using errcode='22023'; end if;
 if jsonb_array_length(p_selections) not between 1 and 3 then raise exception 'Bounded activation selection required.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_selections) v where jsonb_typeof(v)<>'object' or coalesce(v->>'department_id','') not in ('content','design','marketing') or jsonb_typeof(v->'enabled') is distinct from 'boolean')
 or (select count(distinct v->>'department_id') from jsonb_array_elements(p_selections) v)<>jsonb_array_length(p_selections) then
  raise exception 'Unique explicit Workshop settings required.' using errcode='22023'; end if;
 select jsonb_agg(jsonb_build_object('department_id',v->>'department_id','enabled',v->'enabled') order by v->>'department_id') into selections from jsonb_array_elements(p_selections) v;
 command:=jsonb_build_object('project_id',p_project_id,'engagement_id',p_engagement_id,'expected_token',p_expected_token,'selections',selections);
 perform pg_advisory_xact_lock(hashtextextended('workshop-execution-request:'||p_organization_id::text||':'||p_actor_id::text||':'||p_request_id::text,0));
 select * into receipt from private.workshop_execution_receipts where organization_id=p_organization_id and actor_id=p_actor_id and request_id=p_request_id;
 if found then
  if receipt.command<>command then raise exception 'Request identity conflicts.' using errcode='40001'; end if;
  return receipt.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('workshop-execution:'||p_organization_id::text||':'||p_engagement_id::text,0));
 snapshot:=public.get_workshop_execution_settings(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 if snapshot->>'token'<>p_expected_token then raise exception 'Activation review changed.' using errcode='40001'; end if;
 for row in select value from jsonb_array_elements(selections) loop
  if (row->>'enabled')::boolean and not exists(select 1 from jsonb_array_elements(snapshot->'workshops') w where w->>'department_id'=row->>'department_id' and w->>'eligible'='true') then
   raise exception 'Current linked approved model and active service required.' using errcode='23514'; end if;
  insert into private.workshop_execution_settings(organization_id,project_id,engagement_id,department_id,enabled,updated_by)
  values(p_organization_id,p_project_id,p_engagement_id,row->>'department_id',(row->>'enabled')::boolean,p_actor_id)
  on conflict(organization_id,project_id,engagement_id,department_id) do update set enabled=excluded.enabled,revision=gen_random_uuid(),updated_by=excluded.updated_by,updated_at=now();
 end loop;
 result:=jsonb_build_object('schema_version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'request_id',p_request_id,'persisted',true,'selections',selections);
 insert into private.workshop_execution_receipts(organization_id,actor_id,request_id,project_id,engagement_id,command,result)
 values(p_organization_id,p_actor_id,p_request_id,p_project_id,p_engagement_id,command,result);
 return result;
end;$$;

create function public.recover_workshop_execution_settings(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform private.workshop_mapping_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 select r.result into result from private.workshop_execution_receipts r where r.organization_id=p_organization_id and r.actor_id=p_actor_id and r.request_id=p_request_id and r.project_id=p_project_id and r.engagement_id=p_engagement_id;
 return result;
end;$$;

create function public.get_workshop_execution_readiness(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_department_id text,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare enabled boolean:=false;
begin
 -- A read never grants authority; dispatch rechecks all contribution/model authority.
 if exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id and o.status='active'
 join public.projects p on p.id=p_project_id and p.organization_id=m.organization_id and p.archived_at is null
 join public.engagements e on e.id=p_engagement_id and e.project_id=p.id and e.organization_id=m.organization_id and e.status='active'
 join public.engagement_services s on s.engagement_id=e.id and s.organization_id=m.organization_id and s.status='active'
 join public.service_catalog c on c.id=s.service_id and c.department_id=p_department_id
 where m.organization_id=p_organization_id and m.user_id=p_actor_id and m.member_kind='team' and m.status='active'
 and (m.department_id=p_department_id or m.role in ('system_owner','operations_admin','executive'))) then
  select coalesce(s.enabled,false) into enabled from private.workshop_execution_settings s
  where s.organization_id=p_organization_id and s.project_id=p_project_id and s.engagement_id=p_engagement_id and s.department_id=p_department_id;
 end if;
 return jsonb_build_object('schema_version',1,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'department_id',p_department_id,'enabled',coalesce(enabled,false));
end;$$;

-- The existing one-use claim inserts this row only after its original authority
-- checks. A failed trigger rolls back its mark-dispatched and claim atomically.
-- FOR SHARE serializes against opt-out UPDATE through commit; no accounting body changes.
create function private.guard_workshop_execution_claim() returns trigger language plpgsql security invoker set search_path='' as $$
declare conversation public.department_chat_conversations;
begin
 select * into conversation from public.department_chat_conversations c where c.id=new.conversation_id and c.organization_id=new.organization_id;
 if not found then raise exception 'Workshop context unavailable.' using errcode='42501'; end if;
 perform 1 from private.workshop_execution_settings s where s.organization_id=new.organization_id and s.project_id=conversation.project_id and s.engagement_id=conversation.engagement_id and s.department_id=conversation.department_id and s.enabled for share;
 if not found then raise exception 'Workshop execution is off for this scope.' using errcode='42501'; end if;
 return new;
end;$$;
create trigger require_workshop_execution_opt_in before insert on private.workshop_chat_dispatch_claims for each row execute function private.guard_workshop_execution_claim();
revoke all on function private.guard_workshop_execution_claim() from public,anon,authenticated,service_role;
revoke all on function public.get_workshop_execution_settings(uuid,uuid,uuid,uuid),public.save_workshop_execution_settings(uuid,uuid,uuid,uuid,uuid,text,jsonb),public.recover_workshop_execution_settings(uuid,uuid,uuid,uuid,uuid),public.get_workshop_execution_readiness(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_workshop_execution_settings(uuid,uuid,uuid,uuid),public.save_workshop_execution_settings(uuid,uuid,uuid,uuid,uuid,text,jsonb),public.recover_workshop_execution_settings(uuid,uuid,uuid,uuid,uuid),public.get_workshop_execution_readiness(uuid,uuid,uuid,text,uuid) to service_role;
