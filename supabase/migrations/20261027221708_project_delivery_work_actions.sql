begin;
-- Commands retain provenance and original outcomes; work and outputs stay canonical.
create table private.project_work_commands(
 organization_id uuid not null references public.organizations(id),
 project_id uuid not null references public.projects(id),
 actor_id uuid not null references auth.users(id),request_id uuid not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,actor_id,request_id)
);
create index project_work_commands_project on private.project_work_commands(project_id,organization_id);
create index project_work_commands_actor on private.project_work_commands(actor_id);
alter table private.project_work_commands enable row level security;
revoke all on private.project_work_commands from public,anon,authenticated,service_role;
create trigger project_work_commands_immutable before update or delete on private.project_work_commands for each row execute function private.n1b_preserve_receipt();

create function private.project_work_context(p_org uuid,p_project uuid,p_engagement uuid,p_service uuid,p_actor uuid) returns text
language plpgsql security definer set search_path='' as $$
declare department text;
begin
 perform private.n1c_require_scope(p_org,p_project,p_actor);
 perform 1 from public.engagements where id=p_engagement and organization_id=p_org and project_id=p_project and status not in ('completed','cancelled','archived') for share;
 if not found then raise exception 'Current project engagement required' using errcode='42501';end if;
 select c.department_id into department from public.engagement_services s join public.service_catalog c on c.id=s.service_id and c.organization_id=s.organization_id
 where s.id=p_service and s.organization_id=p_org and s.engagement_id=p_engagement and s.status='active' and c.is_active and c.department_id in ('content','marketing','development') for share of s,c;
 if not found then raise exception 'Choose an exact current active Content, Marketing or Development service' using errcode='42501';end if;
 return department;
end;$$;

create function public.apply_project_work_command(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_active_service_id uuid,p_request_id uuid,p_command jsonb,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.n1c_actor(p_actor_id);department text;payload jsonb;receipt private.project_work_commands;item public.work_items;answer jsonb;version_id uuid;artifact_id uuid;
begin
 if actor is null or p_request_id is null then raise exception 'Authenticated reviewed request required' using errcode='42501';end if;
 department:=private.project_work_context(p_organization_id,p_project_id,p_engagement_id,p_active_service_id,actor);
 if jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>24000 then raise exception 'Bounded reviewed work command required' using errcode='22023';end if;
 payload:=jsonb_build_object('project',p_project_id,'engagement',p_engagement_id,'service',p_active_service_id,'command',p_command);
 perform pg_advisory_xact_lock(hashtextextended('project-work:'||p_organization_id::text||':'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.project_work_commands where organization_id=p_organization_id and actor_id=actor and request_id=p_request_id;
 if found then if receipt.payload is distinct from payload then raise exception 'Original request owns another reviewed action' using errcode='23505';end if;return receipt.result;end if;
 if p_command->>'action'='create' then
  if exists(select 1 from jsonb_object_keys(p_command) k where k not in ('action','title','description')) or jsonb_typeof(p_command->'title') is distinct from 'string' or jsonb_typeof(p_command->'description') is distinct from 'string' or length(btrim(p_command->>'title')) not between 1 and 240 or length(p_command->>'description')>20000 then raise exception 'Review a title and brief within the exact limits' using errcode='22023';end if;
  item:=public.save_p5_work_item(p_organization_id,null,p_engagement_id,btrim(p_command->>'title'),p_command->>'description','request','medium','not_started',null,department,null,null,null,null,null,0,null,actor,null,'manual');
 elsif p_command->>'action'='link_content_version' then
  if department<>'content' or exists(select 1 from jsonb_object_keys(p_command) k where k not in ('action','work_item_id','row_version','artifact_version_id')) then raise exception 'Exact Content work and version required' using errcode='22023';end if;
  select * into item from public.work_items where id=(p_command->>'work_item_id')::uuid and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and department_id='content' and deleted_at is null for update;
  if not found then raise exception 'Original Content work unavailable' using errcode='42501';end if;
  if item.status='done' then raise exception 'Completed work retains its output and history' using errcode='40001';end if;
  version_id:=(p_command->>'artifact_version_id')::uuid;
  select a.id into artifact_id from public.artifact_versions v join public.artifacts a on a.id=v.artifact_id and a.organization_id=v.organization_id where v.id=version_id and a.organization_id=p_organization_id and a.engagement_id=p_engagement_id and a.artifact_type='content' for share of a,v;
  if not found then raise exception 'Exact existing project Content version required' using errcode='42501';end if;
  item:=public.save_p5_work_item(p_organization_id,item.id,p_engagement_id,item.title,item.description,item.work_item_type,item.priority,item.status,item.assignee_id,item.department_id,artifact_id,version_id,item.linked_engagement_stage_instance_id,item.start_date,item.due_date,item.position,item.parent_work_item_id,actor,(p_command->>'row_version')::bigint,item.created_via);
 else raise exception 'Unsupported project work action' using errcode='22023';end if;
 answer:=jsonb_build_object('request_id',p_request_id,'organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'work_item',to_jsonb(item));
 insert into private.project_work_commands(organization_id,project_id,actor_id,request_id,payload,result) values(p_organization_id,p_project_id,actor,p_request_id,payload,answer);
 return answer;
end;$$;
create function public.recover_project_work_command(p_organization_id uuid,p_project_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.n2_scope_require_member(p_organization_id,p_project_id,false);
 perform pg_advisory_xact_lock(hashtextextended('project-work:'||p_organization_id::text||':'||auth.uid()::text||':'||p_request_id::text,0));
 return coalesce((select result from private.project_work_commands where organization_id=p_organization_id and project_id=p_project_id and actor_id=auth.uid() and request_id=p_request_id),jsonb_build_object('status','not_applied'));
end;$$;
revoke all on function private.project_work_context(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.apply_project_work_command(uuid,uuid,uuid,uuid,uuid,jsonb,uuid),public.recover_project_work_command(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.apply_project_work_command(uuid,uuid,uuid,uuid,uuid,jsonb,uuid) to service_role;
grant execute on function public.recover_project_work_command(uuid,uuid,uuid) to authenticated;
commit;
