
insert into public.department_chat_conversations(id,organization_id,project_id,engagement_id,department_id,owner_id,title,context_kind)
values('99999999-9999-4999-8999-999999996810','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999975','content','99999999-9999-4999-8999-999999999902','Scoped activation synthetic claim','department_project');
insert into public.department_chat_messages(id,conversation_id,organization_id,project_id,engagement_id,department_id,owner_id,author_id,role,body,status,client_request_id,sequence)
values('99999999-9999-4999-8999-999999996811','99999999-9999-4999-8999-999999996810','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999974','99999999-9999-4999-8999-999999999975','content','99999999-9999-4999-8999-999999999902','99999999-9999-4999-8999-999999999902','user','Synthetic no-provider dispatch test','pending',gen_random_uuid(),1);
insert into private.ai_execution_step_budget_reservations(id,organization_id,actor_id,cycle_month,max_cost_microusd,status,workshop_chat_message_id,workshop_chat_conversation_id,workshop_chat_model_configuration_id)
values('99999999-9999-4999-8999-999999996812','99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999999902',date_trunc('month',now())::date,1,'reserved','99999999-9999-4999-8999-999999996811','99999999-9999-4999-8999-999999996810','7df6db06-3b72-421f-a3dc-7e45e849481c');
create function pg_temp.claim() returns jsonb language sql as $$select public.claim_workshop_chat_dispatch('99999999-9999-4999-8999-999999999901','99999999-9999-4999-8999-999999996811','99999999-9999-4999-8999-999999999902','99999999-9999-4999-8999-999999996813',repeat('a',64))$$;
select pg_temp.reject('select pg_temp.claim()','42501','actual claim rejected when opted out');
select pg_temp.ok((select provider_dispatched_at is null from public.department_chat_messages where id='99999999-9999-4999-8999-999999996811'),'claim refusal rolls back mark-dispatched');
select pg_temp.ok((select count(*)=0 from private.workshop_chat_dispatch_claims),'no denied claim persisted');
select pg_temp.save(gen_random_uuid(),pg_temp.snapshot()->>'token','[{"department_id":"content","enabled":true}]');
select pg_temp.ok(pg_temp.claim()->>'status'='claimed','actual claim succeeds only opted in');
select pg_temp.ok(pg_temp.claim()->>'must_not_submit'='true','exact claim replay cannot dispatch');
select pg_temp.save(gen_random_uuid(),pg_temp.snapshot()->>'token','[{"department_id":"content","enabled":false}]');
select pg_temp.ok(pg_temp.claim()->>'must_not_submit'='true','already claimed outcome remains recoverable after opt-out');
