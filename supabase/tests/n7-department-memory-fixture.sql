create table public.departments(id text primary key);
insert into public.departments values ('design'),('content');
alter table public.organization_memberships add column department_id text;
update public.organization_memberships set department_id='design'
  where user_id='22222222-2222-4222-8222-222222222222';
create table public.project_department_participation(
  organization_id uuid not null,project_id uuid not null,department_id text not null,status text not null
);
insert into public.project_department_participation values
 ('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','design','active');
insert into public.comments values
 ('aaaaaaaa-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555','project',
  '55555555-5555-4555-8555-555555555555','internal_only','Reusable visual QA method');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select public.propose_project_ai_memory(
 '11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555',
 'bbbbbbbb-3333-4333-8333-333333333333','aaaaaaaa-3333-4333-8333-333333333333',
 'Check visual hierarchy on each variant');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select public.review_project_ai_memory(
 '11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555',
 'bbbbbbbb-3333-4333-8333-333333333333','cccccccc-3333-4333-8333-333333333333',
 'confirm','Verified project source');
