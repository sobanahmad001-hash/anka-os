-- Minimal recurring parents over the existing N1-C fixture; localhost synthetic only.
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
insert into auth.users(id) select distinct user_id from public.organization_memberships;
insert into auth.users(id) values(pg_temp.id('machine'));
alter table public.engagements add column status text not null default 'active';
alter table public.engagements add column engagement_type text not null default 'retainer';
alter table public.engagements add constraint fixture_engagement_scope unique(id,project_id,organization_id);
create table public.service_catalog(id uuid primary key,organization_id uuid not null,department_id text not null,is_active boolean not null default true);
create table public.engagement_services(id uuid primary key,organization_id uuid not null,engagement_id uuid not null,service_id uuid not null,owner_id uuid not null,status text not null default 'active');
grant select,update(is_active) on public.service_catalog to service_role;
grant select,update(status) on public.engagement_services to service_role;
alter table public.engagement_events add constraint engagement_events_event_type_check check(true);
alter table public.work_items drop column recurring_occurrence_id,drop column recurring_plan_id,drop column recurring_plan_version_id,drop column recurring_template_key;
alter table public.work_items add constraint work_items_created_via_check check(true);
create function public.is_team_organization_member(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships where organization_id=org and user_id=auth.uid() and member_kind='team' and status='active');
$$;
revoke all on function public.is_team_organization_member(uuid) from public,anon;
grant execute on function public.is_team_organization_member(uuid) to authenticated,service_role;
insert into public.service_catalog values(pg_temp.id('catalog'),pg_temp.id('org-a'),'design',true);
insert into public.engagement_services values(pg_temp.id('service'),pg_temp.id('org-a'),pg_temp.id('eng-1'),pg_temp.id('catalog'),pg_temp.id('bob'),'active');
