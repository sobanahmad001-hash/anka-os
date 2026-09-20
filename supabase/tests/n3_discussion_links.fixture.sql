alter table public.tasks add column title text not null default 'Project task';
alter table public.deliverables add column title text not null default 'Deliverable';
create table public.files(id uuid primary key,organization_id uuid not null,project_id uuid not null,
 file_name text not null,archived_at timestamptz);
create table public.deliverable_versions(id uuid primary key,organization_id uuid not null,
 project_id uuid not null,deliverable_id uuid not null,version_number integer not null,
 title text not null,withdrawn_at timestamptz);
insert into public.files values
 ('f0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001','Approved brief.pdf',null),
 ('f0000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000010','Other private.pdf',null);
insert into public.deliverables(id,organization_id,project_id,title) values
 ('c0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001','Brand guide');
insert into public.deliverable_versions values
 ('c1000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
  2,'Brand guide v2',null);
