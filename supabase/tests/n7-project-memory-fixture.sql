create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create table public.organizations(id uuid primary key,status text not null);
create table public.projects(
  id uuid primary key,organization_id uuid not null,archived_at timestamptz
);
create table public.organization_memberships(
  organization_id uuid not null,user_id uuid not null,
  member_kind text not null,status text not null,role text not null
);
create table public.comments(
  id uuid primary key,organization_id uuid not null,project_id uuid not null,
  entity_type text not null,entity_id uuid not null,
  visibility text not null,content text not null
);
create function private.n1c_require_scope(p_org uuid,p_project uuid,p_actor uuid)
returns text language plpgsql as $$
declare actor_role text;
begin
  select m.role into actor_role from public.organizations o
    join public.projects p on p.organization_id=o.id
    join public.organization_memberships m on m.organization_id=o.id
    where o.id=p_org and o.status='active' and p.id=p_project
      and p.archived_at is null and m.user_id=p_actor
      and m.member_kind='team' and m.status='active';
  if actor_role is null then
    raise exception 'Active scoped actor required.' using errcode='42501';
  end if;
  return actor_role;
end; $$;
create function private.n1c_can_assign(p_org uuid,p_project uuid,p_actor uuid)
returns boolean language sql as $$
 select private.n1c_require_scope(p_org,p_project,p_actor)
   in ('system_owner','operations_admin');
$$;
insert into auth.users values
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333'),
 ('44444444-4444-4444-8444-444444444444');
insert into public.organizations values
 ('11111111-1111-4111-8111-111111111111','active'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active');
insert into public.projects values
 ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',null),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null);
insert into public.organization_memberships values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','team','active','member'),
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','team','active','system_owner'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','team','active','system_owner');
insert into public.comments values
 ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555','project',
  '55555555-5555-4555-8555-555555555555','internal_only','Approved brief revision'),
 ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555','project',
  '55555555-5555-4555-8555-555555555555','internal_only','Follow-up approved revision'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','project',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','internal_only','Other client confidential');
