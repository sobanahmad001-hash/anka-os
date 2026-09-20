do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key, deleted_at timestamptz);
create table public.organizations(id uuid primary key, status text not null);
create table public.organization_memberships(
 organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 member_kind text not null, status text not null, role text not null, primary key(organization_id,user_id));
create table public.profiles(id uuid primary key references auth.users(id),full_name text);
create table public.clients(id uuid primary key,organization_id uuid not null references public.organizations(id),name text);
create table public.agency_clients(id uuid primary key,organization_id uuid not null,canonical_client_id uuid not null,name text);
create table public.brands(id uuid primary key,organization_id uuid not null,client_id uuid not null,name text,status text not null);
create table public.projects(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 client_id uuid,name text not null,description text not null default '',engagement_type text not null,
 status text not null default 'planning',owner_id uuid,start_date date,due_date date,
 scope_statement text not null default '',exclusions text not null default '',portal_visible boolean not null default false,
 archived_at timestamptz,unique(id,organization_id));
create table public.engagements(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,client_id uuid not null,brand_id uuid not null,
 project_id uuid not null,legacy_project_id uuid not null,name text not null,engagement_type text not null,
 objective text not null,status text not null,lead_owner_id uuid,start_date date,target_date date,created_by uuid not null);
create table public.project_manager_bindings(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,user_id uuid not null,project_id uuid not null,
 source text not null,source_details jsonb not null,status text not null default 'active');
create function private.n1b_preserve_receipt() returns trigger language plpgsql as $$
begin raise exception 'Immutable receipt.' using errcode='42501'; end; $$;
create function private.n1b_require_admin(p_org uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('n1b-admin:'||p_org::text,0));
 perform 1 from public.organizations where id=p_org and status='active' for share;
 if not found then raise exception 'Active organization admin required.' using errcode='42501'; end if;
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=actor
  and status='active' and member_kind='team' and role in ('system_owner','operations_admin') for share;
 if not found then raise exception 'Active organization admin required.' using errcode='42501'; end if;
 return actor;
end; $$;
create function public.create_internal_project_setup(uuid,uuid,text,text,uuid,date,date,text,text,jsonb)
returns jsonb language sql as $$ select '{}'::jsonb $$;
revoke all on function public.create_internal_project_setup(uuid,uuid,text,text,uuid,date,date,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_internal_project_setup(uuid,uuid,text,text,uuid,date,date,text,text,jsonb) to authenticated;
create function public.get_internal_project_setup_options(uuid) returns jsonb language sql as ' select ''{}''::jsonb ';
create function private.can_select_internal_project_owner(uuid,uuid,text) returns boolean language sql as ' select false ';
revoke all on function public.get_internal_project_setup_options(uuid), private.can_select_internal_project_owner(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_internal_project_setup_options(uuid), private.can_select_internal_project_owner(uuid,uuid,text) to authenticated;
create function public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)
returns uuid language sql as 'select null::uuid';
create function public.compose_engagement_from_pipeline_template(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)
returns jsonb language sql as 'select ''{}''::jsonb';
revoke all on function public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb),
 public.compose_engagement_from_pipeline_template(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.compose_engagement(uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb),
 public.compose_engagement_from_pipeline_template(uuid,uuid,uuid,text,uuid,uuid,text,text,uuid[],uuid,jsonb,date,date,text,jsonb)
 to authenticated;
alter table public.projects enable row level security;
create policy "Team can create projects" on public.projects for insert to authenticated with check(true);
create policy "Team can update projects" on public.projects for update to authenticated using(true) with check(true);
create policy "Team can read projects" on public.projects for select to authenticated using(true);
alter table public.organization_memberships enable row level security;
create policy n1_self_read on public.organization_memberships for select to authenticated using(user_id=auth.uid());
alter table public.project_manager_bindings enable row level security;
create policy n1_pm_self_read on public.project_manager_bindings for select to authenticated using(user_id=auth.uid());
grant usage on schema public,auth,private to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.organization_memberships,public.organizations,public.clients,public.agency_clients,
 public.brands,public.engagements,public.project_manager_bindings,public.profiles to authenticated;
grant select,insert,update on public.projects to authenticated;
insert into public.organizations values
 ('00000000-0000-4000-8000-000000000001','active'),
 ('00000000-0000-4000-8000-000000000002','active');
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003'),
 ('10000000-0000-4000-8000-000000000004'),
 ('10000000-0000-4000-8000-000000000005');
insert into public.organization_memberships values
 ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','team','active','system_owner'),
 ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','team','active','contributor'),
 ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','team','active','department_manager'),
 ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','team','active','project_owner'),
 ('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005','team','active','operations_admin');
insert into public.profiles values
 ('10000000-0000-4000-8000-000000000001','Owner'),
 ('10000000-0000-4000-8000-000000000002','Contributor'),
 ('10000000-0000-4000-8000-000000000003','Head'),
 ('10000000-0000-4000-8000-000000000004','Project manager'),
 ('10000000-0000-4000-8000-000000000005','Other admin');
insert into public.clients values('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Client A');
insert into public.agency_clients values('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Client A');
insert into public.brands values('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Brand A','active');
