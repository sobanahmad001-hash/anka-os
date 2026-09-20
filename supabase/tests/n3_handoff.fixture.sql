-- Local canonical request shape for focused N3 checks, not installed-schema acceptance.
create table public.workstreams(
  id uuid primary key,organization_id uuid not null,project_id uuid not null,
  name text not null,status text not null
);
create table public.requests(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null,
  requesting_workstream_id uuid,receiving_workstream_id uuid,request_type text not null,
  request_origin text not null,title text not null,requested_output text not null,
  acceptance_criteria text not null default '',priority text not null default 'medium',
  status text not null default 'submitted',visibility text not null default 'internal_only',
  requested_by uuid not null,owner_id uuid,required_by date,created_at timestamptz not null default now()
);
alter table public.requests enable row level security;
create policy fixture_team_requests on public.requests to authenticated
  using(public.is_team_organization_member(organization_id))
  with check(public.is_team_organization_member(organization_id));
grant select,insert,update,delete on public.requests to authenticated;
insert into public.workstreams values
 ('d0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001','Design','active'),
 ('d0000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001','Development','active'),
 ('d0000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000010','Other team','active');
