\set ON_ERROR_STOP on
begin;
\ir pipeline_stage_contracts.fixture.sql
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999902","role":"authenticated"}',true);
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';preset uuid:='99999999-9999-4999-8999-999999997102';actor uuid:='99999999-9999-4999-8999-999999999902';
 contract jsonb:='{"optional":true,"output_label":"Approved launch article","reuse_allowed":true,"artifact_type":"content","output_type":"blog_article","required_inputs":[{"key":"audience","label":"Intended audience","kind":"manual"},{"key":"source","label":"Approved article","kind":"approved_artifact","artifact_type":"content","output_type":"blog_article"}]}';
 steps jsonb;request uuid:=gen_random_uuid();saved jsonb;replayed jsonb;row public.pipeline_execution_definitions;invalid jsonb;begin
 if not private.valid_pipeline_stage_contract(contract) then raise exception 'Valid contract rejected';end if;raise notice 'PASS exact declared contract';
 for invalid in select value from jsonb_array_elements(jsonb_build_array(
  contract||'{"optional":"true"}',contract||'{"reuse_allowed":null}',contract||'{"provider":"invented"}',contract||'{"output_label":""}',contract||'{"output_type":"bad type"}',
  contract||'{"required_inputs":[{"key":"a","label":"A","kind":"manual","actor_id":"spoof"}]}',contract||'{"required_inputs":[{"key":"a","label":"A","kind":"manual"},{"key":"a","label":"B","kind":"manual"}]}',
  contract||'{"required_inputs":[{"key":"a","label":"A","kind":"approved_artifact"}]}',contract||'{"required_inputs":null}',contract||'{"artifact_type":"private_chat"}',contract||'{"reuse_allowed":false}',
  contract||jsonb_build_object('required_inputs',(select jsonb_agg(jsonb_build_object('key','a'||n,'label','A','kind','manual')) from generate_series(1,9)n))
 )) loop
  if private.valid_pipeline_stage_contract(invalid) is distinct from false then raise exception 'Unsupported/coerced contract accepted: %',invalid;end if;raise notice 'PASS invalid declared contract';
 end loop;
 steps:=jsonb_build_array(jsonb_build_object('key','launch_article','label','Launch article','kind','human','department_id','content','service_id','99999999-9999-4999-8999-999999999976','depends_on','[]'::jsonb,'stage_contract',contract));
 saved:=public.create_pipeline_execution_definition(org,preset,request,'Native stage definition',steps);
 select * into row from public.pipeline_execution_definitions where id=(saved->>'definition_id')::uuid;
 if row.steps is distinct from steps or row.steps_sha256<>encode(sha256(convert_to(steps::text,'UTF8')),'hex') then raise exception 'Exact metadata/hash missing';end if;raise notice 'PASS immutable full published-stage input';
 replayed:=public.create_pipeline_execution_definition(org,preset,request,'Native stage definition',steps);
 if replayed->>'definition_id'<>saved->>'definition_id' or replayed->>'idempotent_replay'<>'true' then raise exception 'Original replay changed';end if;raise notice 'PASS one exact definition replay';
 begin perform public.create_pipeline_execution_definition(org,preset,request,'Native stage definition',jsonb_set(steps,'{0,stage_contract,optional}','false'));raise exception 'Changed metadata replay accepted';exception when unique_violation then raise notice 'PASS changed declaration identity denied';end;
 begin perform public.create_pipeline_execution_definition(org,preset,gen_random_uuid(),'Invalid gate',jsonb_set(steps,'{0,kind}','"approval_gate"'));raise exception 'Reused approval accepted';exception when invalid_parameter_value then raise notice 'PASS approval gate cannot reuse';end;
 begin update public.pipeline_execution_definitions set steps='[]' where id=row.id;raise exception 'Immutable metadata changed';exception when sqlstate '55000' then raise notice 'PASS immutable definition';end;
 begin perform public.publish_pipeline_execution_definition(row.id);raise exception 'Missing head accepted';exception when insufficient_privilege then raise notice 'PASS unchanged current head publication gate';end;
 update public.organization_memberships set status='suspended' where organization_id=org and user_id=actor;
 begin perform public.create_pipeline_execution_definition(org,preset,gen_random_uuid(),'Inactive author',steps);raise exception 'Inactive author accepted';exception when insufficient_privilege then raise notice 'PASS current author membership gate';end;
 update public.organization_memberships set status='active',role='contributor' where organization_id=org and user_id=actor;
 begin perform public.create_pipeline_execution_definition(org,preset,gen_random_uuid(),'Contributor author',steps);raise exception 'Contributor author accepted';exception when insufficient_privilege then raise notice 'PASS author role gate';end;
 if has_function_privilege('authenticated','private.valid_pipeline_stage_contract(jsonb)','EXECUTE') or has_function_privilege('anon','public.create_pipeline_execution_definition(uuid,uuid,uuid,text,jsonb)','EXECUTE') then raise exception 'Stage grants widened';end if;raise notice 'PASS exact grants';
end;$$;
rollback;
