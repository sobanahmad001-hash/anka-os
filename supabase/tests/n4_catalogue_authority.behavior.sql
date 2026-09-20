-- Local rollback-only behavior check against a restored schema snapshot.
-- Never execute this fixture on a shared or production database.
begin;
set local statement_timeout = '30s';

do $$
declare
  old_count integer;
  write_count integer;
  delete_grant boolean;
begin
  select count(*) into old_count from pg_policies
  where schemaname = 'public' and tablename = 'service_catalog'
    and policyname = 'Leaders can manage service catalogue';
  if old_count <> 0 then raise exception 'Old executive write policy remains'; end if;
  select count(*) into write_count from pg_policies
  where schemaname = 'public' and tablename = 'service_catalog'
    and policyname in (
      'Active admins can create catalogue services',
      'Active admins can update catalogue services'
    );
  if write_count <> 2 then raise exception 'Owner/admin write policies missing'; end if;
  select has_table_privilege('authenticated', 'public.service_catalog', 'DELETE') into delete_grant;
  if delete_grant then raise exception 'Authenticated catalogue DELETE remains granted'; end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'service_catalog'
      and policyname = 'Team can read service catalogue'
  ) then raise exception 'Team read policy was lost'; end if;
end $$;

insert into auth.users(id) values
('11111111-1111-4111-8111-111111111111'),
('22222222-2222-4222-8222-222222222222'),
('33333333-3333-4333-8333-333333333333'),
('44444444-4444-4444-8444-444444444444');
insert into public.organizations(id,name,slug)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','N4 local fixture','n4-local-fixture');
insert into public.departments(id,name,organization_id)
values ('content','Content','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.organization_memberships(organization_id,user_id,member_kind,role,status)
values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','team','system_owner','active'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','team','operations_admin','active'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','team','executive','active'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','client','operations_admin','active');
insert into public.service_catalog(id,organization_id,department_id,slug,name)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','content','n4_test','Original');

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
update public.service_catalog set name='Owner edited'
where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  if not exists (select 1 from public.service_catalog
    where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and name='Owner edited')
  then raise exception 'Active owner update denied'; end if;
end $$;

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
update public.service_catalog set name='Admin edited'
where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  if not exists (select 1 from public.service_catalog
    where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and name='Admin edited')
  then raise exception 'Active admin update denied'; end if;
end $$;

select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$
declare changed integer;
begin
  update public.service_catalog set name='Executive edited'
  where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Executive updated catalogue'; end if;
  if not exists (select 1 from public.service_catalog
    where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and name='Admin edited')
  then raise exception 'Executive lost read access'; end if;
  begin
    insert into public.service_catalog(organization_id,department_id,slug,name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','content','executive_denied','Denied');
    raise exception 'Executive created catalogue service';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$
declare changed integer;
begin
  update public.service_catalog set name='Client edited'
  where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Client-kind legacy admin updated catalogue'; end if;
end $$;

reset role;
update public.organizations set status='suspended'
where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare changed integer;
begin
  update public.service_catalog set name='Suspended org edited'
  where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Suspended organization updated catalogue'; end if;
end $$;
reset role;
rollback;
