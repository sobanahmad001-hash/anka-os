-- Anka Sphere OS - Phase 2 / Migration 6 (20260825060000)
-- Align the legacy profile display fields with the four canonical departments.
--
-- Authorization remains in organization_memberships. Profile metadata is used
-- for display and navigation only and never grants organization access.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.profiles
  drop constraint if exists profiles_department_check,
  drop constraint if exists profiles_role_check;

update public.profiles
set department = 'development'
where department is null
   or department not in ('content', 'design', 'development', 'marketing');

update public.profiles
set role = 'member'
where role is null
   or role not in ('admin', 'department_head', 'executive', 'member', 'intern');

alter table public.profiles
  alter column department set default 'development',
  alter column department set not null,
  alter column role set default 'member',
  alter column role set not null,
  add constraint profiles_department_check
    check (department in ('content', 'design', 'development', 'marketing')),
  add constraint profiles_role_check
    check (role in ('admin', 'department_head', 'executive', 'member', 'intern'));

-- New authentication identities receive a display profile only. A secure
-- administrator action must separately create organization_memberships;
-- editable user metadata can never grant team authorization.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_department text;
begin
  requested_department := new.raw_user_meta_data ->> 'department';

  if requested_department is null
     or requested_department not in ('content', 'design', 'development', 'marketing') then
    requested_department := 'development';
  end if;

  insert into public.profiles (id, full_name, department, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    requested_department,
    'member'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;
grant execute on function public.handle_new_user()
  to service_role;

commit;
