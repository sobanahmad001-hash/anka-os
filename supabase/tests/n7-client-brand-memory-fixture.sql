create table public.agency_clients(
 id uuid primary key,organization_id uuid not null,status text not null
);
create table public.brands(
 id uuid primary key,organization_id uuid not null,client_id uuid not null,status text not null
);
create table public.engagements(
 id uuid primary key,organization_id uuid not null,project_id uuid not null,
 client_id uuid not null,brand_id uuid not null,status text not null
);
insert into public.agency_clients values
 ('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','active'),
 ('22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','active');
insert into public.brands values
 ('11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active'),
 ('22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active'),
 ('33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active');
insert into public.projects values
 ('11111111-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111',null),
 ('22222222-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111',null),
 ('33333333-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111',null);
insert into public.engagements values
 ('11111111-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active'),
 ('22222222-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','11111111-cccc-4ccc-8ccc-cccccccccccc','11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active'),
 ('33333333-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','22222222-cccc-4ccc-8ccc-cccccccccccc','11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active'),
 ('44444444-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','33333333-cccc-4ccc-8ccc-cccccccccccc','22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active');
insert into public.comments values
 ('11111111-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555','project',
  '55555555-5555-4555-8555-555555555555','internal_only','Client approved new brand terminology');
