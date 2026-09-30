-- Only the owned local clone; reuse its existing synthetic member.
\set ON_ERROR_STOP on
begin;
do $$ begin if current_database() <> 'anka_b1_firstsend_20260930' then raise exception 'Owned local fixture required'; end if; end $$;
insert into public.clients(id,organization_id,name) values ('99999999-9999-4999-8999-999999999971','99999999-9999-4999-8999-999999999901','Atomic chat local client') on conflict(id) do nothing;
insert into public.agency_clients(id,organization_id,legacy_client_id,canonical_client_id,name) values ('99999999-9999-4999-8999-999999999972','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999971','99999999-9999-4999-8999-999999999971','Atomic chat local agency client') on conflict(id) do nothing;
insert into public.brands(id,organization_id,client_id,name) values ('99999999-9999-4999-8999-999999999973','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999972','Atomic chat local brand') on conflict(id) do nothing;
insert into public.projects(id,organization_id,name,engagement_type,client_id) values ('99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999901','Atomic chat local client project','project','99999999-9999-4999-8999-999999999971') on conflict(id) do nothing;
insert into public.engagements(id,organization_id,client_id,brand_id,legacy_project_id,project_id,name,status,created_by) values ('99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999972','99999999-9999-4999-8999-999999999973','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999974','Atomic chat local engagement','active','99999999-9999-4999-8999-999999999902') on conflict(id) do nothing;
insert into public.departments(id,name,organization_id) values ('content','Local Content','99999999-9999-4999-8999-999999999901') on conflict(id) do nothing;
insert into public.service_catalog(id,organization_id,department_id,slug,name) values ('99999999-9999-4999-8999-999999999976','99999999-9999-4999-8999-999999999901','content','atomic_chat_local_service','Atomic chat local service') on conflict(id) do nothing;
insert into public.engagement_services(id,organization_id,engagement_id,service_id,activated_by,status) values ('99999999-9999-4999-8999-999999999977','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999975','99999999-9999-4999-8999-999999999976','99999999-9999-4999-8999-999999999902','active') on conflict(id) do nothing;
commit;
