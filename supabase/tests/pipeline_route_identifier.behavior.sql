-- Run transactionally against the existing isolated QA clone. Caller installs candidate inside this transaction.
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
do $test$
declare
 org uuid := '99999999-9999-4999-8999-999999999901';
 config uuid; request uuid := gen_random_uuid(); second_request uuid := gen_random_uuid();
 first_result jsonb; replay jsonb; second_result jsonb; rows jsonb; original_revision bigint;
begin
 select id into strict config from public.department_chat_model_configurations
 where connector_connection_id='99999999-9999-4999-8999-999999996910'
 and department_id='content' and revoked_at is null;
 select coalesce(max(revision),0) into original_revision from private.pipeline_ai_text_route_sets where organization_id=org and department_id='content';
 first_result := public.configure_pipeline_ai_text_routes(org,'content',request,array[config]);
 if (first_result->>'revision')::bigint <> original_revision+1 or (first_result->>'route_count')::int <> 1 then raise exception 'first save failed'; end if;
 raise notice 'PASS nonempty save enters model eligibility branch';
 rows := public.list_pipeline_ai_text_route_settings(org);
 if not exists(select 1 from jsonb_array_elements(rows) x where x->>'department_id'='content' and x->'model_configuration_ids'=jsonb_build_array(config)) then raise exception 'readback mismatch'; end if;
 raise notice 'PASS exact stored ordered readback';
 replay := public.configure_pipeline_ai_text_routes(org,'content',request,array[config]);
 if replay->>'route_set_id' <> first_result->>'route_set_id' or replay->>'idempotent_replay' <> 'true' then raise exception 'replay failed'; end if;
 raise notice 'PASS original replay no new revision';
 begin
  perform public.configure_pipeline_ai_text_routes(org,'content',request,'{}'::uuid[]);
  raise exception 'different command accepted';
 exception when unique_violation then raise notice 'PASS different command rejected'; end;
 second_result := public.configure_pipeline_ai_text_routes(org,'content',second_request,'{}'::uuid[]);
 if (second_result->>'revision')::bigint <> original_revision+2 or (second_result->>'route_count')::int <> 0 then raise exception 'clear revision failed'; end if;
 raise notice 'PASS empty route explicit revision';
 begin
  perform public.configure_pipeline_ai_text_routes(org,'design',gen_random_uuid(),array[config]);
  raise exception 'cross department accepted';
 exception when insufficient_privilege then raise notice 'PASS department authority unchanged'; end;
 begin
  perform public.configure_pipeline_ai_text_routes(org,'content',gen_random_uuid(),array[config,config]);
  raise exception 'duplicate accepted';
 exception when invalid_parameter_value then raise notice 'PASS duplicates rejected'; end;
 update public.department_chat_model_configurations set revoked_at=now(), revoked_by='99999999-9999-4999-8999-999999999902' where id=config;
 begin
  perform public.configure_pipeline_ai_text_routes(org,'content',gen_random_uuid(),array[config]);
  raise exception 'revoked accepted';
 exception when insufficient_privilege then raise notice 'PASS revoked approval rejected'; end;
 perform set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999996999',true);
 begin
  perform public.configure_pipeline_ai_text_routes(org,'content',gen_random_uuid(),'{}'::uuid[]);
  raise exception 'unauthorized accepted';
 exception when insufficient_privilege then raise notice 'PASS current actor authority required'; end;
 if has_function_privilege('anon','public.configure_pipeline_ai_text_routes(uuid,text,uuid,uuid[])','execute')
 or has_function_privilege('service_role','public.configure_pipeline_ai_text_routes(uuid,text,uuid,uuid[])','execute')
 or not has_function_privilege('authenticated','public.configure_pipeline_ai_text_routes(uuid,text,uuid,uuid[])','execute')
 then raise exception 'ACL changed'; end if;
 raise notice 'PASS exact execute boundary retained';
end $test$;
