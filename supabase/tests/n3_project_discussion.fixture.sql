-- Extends the small N2 organization fixture; this is not an installed-schema rehearsal.
create table public.comments(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  entity_type text not null,entity_id uuid not null,content text not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  organization_id uuid not null,project_id uuid,visibility text not null default 'internal_only',
  parent_comment_id uuid references public.comments(id),client_contact_id uuid,anchor jsonb not null default '{}'::jsonb
);
alter table public.comments enable row level security;
create policy "Team can manage comments" on public.comments to authenticated
  using(public.is_team_organization_member(organization_id))
  with check(public.is_team_organization_member(organization_id));
grant select,insert,update,delete on public.comments to authenticated;
create table public.activity_events(id bigint generated always as identity primary key,comment_id uuid not null);
grant select on public.activity_events to authenticated;
create function private.n3_fixture_capture() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.activity_events(comment_id) values(new.id); return new; end; $$;
create trigger fixture_comment_activity after insert on public.comments
  for each row execute function private.n3_fixture_capture();
insert into public.projects(id,organization_id,name,engagement_type,status,owner_id)
 values('90000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002',
 'Other organization project','internal','active','10000000-0000-4000-8000-000000000005');
