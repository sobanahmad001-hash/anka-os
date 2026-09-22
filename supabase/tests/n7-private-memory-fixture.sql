create table public.design_private_experiment_jobs(
  id uuid primary key,organization_id uuid not null,owner_id uuid not null,
  status text not null,prompt text not null
);
insert into public.design_private_experiment_jobs values
 ('aaaaaaaa-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','succeeded','Explore high-contrast layout directions'),
 ('bbbbbbbb-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '44444444-4444-4444-8444-444444444444','succeeded','Other owner private work');
