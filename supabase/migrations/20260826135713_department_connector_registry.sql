-- Anka Sphere OS - Department connector registry
-- Extends the secure gateway with department-scoped connections and OpenAI.

begin;

alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in (
    'github', 'figma', 'wordpress', 'openai',
    'google_analytics', 'google_search_console', 'google_ads'
  ));

alter table public.integration_events
  drop constraint if exists integration_events_provider_check;
alter table public.integration_events
  add constraint integration_events_provider_check
  check (provider in (
    'github', 'figma', 'wordpress', 'openai',
    'google_analytics', 'google_search_console', 'google_ads'
  ));

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  where con.conrelid = 'public.integration_connections'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%secret_name%ANKA_GITHUB_%';

  if constraint_name is not null then
    execute format('alter table public.integration_connections drop constraint %I', constraint_name);
  end if;
end
$$;

alter table public.integration_connections
  add constraint integration_connections_secret_name_check
  check (
    secret_name is null
    or (
      secret_name ~ '^ANKA_[A-Z0-9_]+$'
      and (
        (provider = 'github' and secret_name like 'ANKA_GITHUB_%')
        or (provider = 'figma' and secret_name like 'ANKA_FIGMA_%')
        or (provider = 'wordpress' and secret_name like 'ANKA_WORDPRESS_%')
        or (provider = 'openai' and secret_name like 'ANKA_OPENAI_%')
      )
    )
  );

alter table public.integration_connections
  add constraint integration_connections_id_organization_unique
  unique (id, organization_id);

create table public.integration_connection_departments (
  connection_id uuid not null,
  organization_id uuid not null,
  department_id text not null
    references public.departments(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (connection_id, department_id),
  foreign key (connection_id, organization_id)
    references public.integration_connections(id, organization_id) on delete cascade
);

create index idx_integration_connection_departments_org_department
  on public.integration_connection_departments(organization_id, department_id);

alter table public.integration_connection_departments enable row level security;

create policy "Team can read department connector mappings"
  on public.integration_connection_departments for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.integration_connection_departments from anon, authenticated;
grant select on public.integration_connection_departments to authenticated;
grant all on public.integration_connection_departments to service_role;

insert into public.integration_connection_departments (
  connection_id,
  organization_id,
  department_id,
  created_by
)
select
  connection.id,
  connection.organization_id,
  case connection.provider
    when 'figma' then 'design'
    else 'development'
  end,
  connection.created_by
from public.integration_connections connection
where connection.provider in ('github', 'figma', 'wordpress')
on conflict (connection_id, department_id) do nothing;

commit;
