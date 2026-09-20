-- Extends the local N3 discussion fixture; it does not model an installed schema.
alter table public.tasks add column row_version bigint not null default 1;
alter table public.tasks add column department_id text;
alter table public.tasks add column user_id uuid;
alter table public.tasks add column assigned_to uuid;
alter table public.tasks add column completion_evidence text not null default '';
grant select on public.tasks to service_role;
create function private.n1c_can_assign_department(uuid,uuid,text,uuid) returns boolean
language sql stable as $$ select exists(select 1 from public.organization_memberships m
  where m.organization_id=$1 and m.user_id=$4 and m.status='active' and m.role='system_owner') $$;
create function private.n1c_set_actor(uuid) returns void language plpgsql as $$
begin
  if current_setting('role',true)<>'service_role' or auth.uid() is not null then
    raise exception 'Trusted service actor context required.' using errcode='42501'; end if;
  perform set_config('anka.n1c_actor',$1::text,true);
end; $$;
create function public.transition_p5_project_task(uuid,uuid,bigint,text,text,uuid) returns public.tasks
language plpgsql security invoker set search_path='' as $$
declare target public.tasks%rowtype;
begin
  if nullif(current_setting('anka.n1c_actor',true),'')::uuid is distinct from $6 then
    raise exception 'Task transition actor context missing.' using errcode='42501'; end if;
  select * into target from public.tasks where id=$2 and organization_id=$1 and archived_at is null for update;
  if not found or (private.n1c_can_assign_department($1,target.project_id,target.department_id,$6)
    or target.user_id=$6 or target.assigned_to=$6) is not true then
    raise exception 'Scoped task action authority required.' using errcode='42501'; end if;
  if target.row_version<>$3 then raise exception 'Stale task version.' using errcode='40001'; end if;
  if $4='done' and trim(coalesce($5,''))='' then
    raise exception 'Completion evidence required.' using errcode='23514'; end if;
  update public.tasks set status=$4,row_version=row_version+1 where id=$2 returning * into target;
  return target;
end; $$;
insert into public.tasks(id,organization_id,project_id,status,row_version,department_id,user_id,assigned_to)
values('b0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001','backlog',1,'design','10000000-0000-4000-8000-000000000002',null),
 ('b0000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000010','backlog',1,'design','10000000-0000-4000-8000-000000000005',null);
