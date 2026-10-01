\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999902","role":"authenticated"}',true);
\ir pipeline_stage_fulfilment.fixture.sql
create function pg_temp.input_error(p_sql text,p_code text,p_label text) returns void language plpgsql as $$begin
 begin execute p_sql;raise exception 'Expected denial was missing: %',p_label;exception when others then if sqlstate<>p_code then raise exception 'Wrong denial for %: % %',p_label,sqlstate,sqlerrm;end if;end;raise notice 'PASS %',p_label;end;$$;
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';eng uuid:='99999999-9999-4999-8999-999999999975';actor uuid:='99999999-9999-4999-8999-999999999902';project uuid:='99999999-9999-4999-8999-999999999974';
 def uuid:=gen_random_uuid();pub uuid:=gen_random_uuid();grp uuid;cfg uuid;impact jsonb;intent uuid;plan jsonb;job public.ai_execution_jobs;step public.ai_execution_configured_steps;reused public.ai_execution_configured_steps;ctx jsonb;version uuid;large uuid;second_group uuid;steps jsonb;value jsonb;
 decisions jsonb:='[{"key":"article_source","action":"reuse","artifact_version_id":"99999999-9999-4999-8999-999999997111"},{"key":"page_copy","action":"run","quantity":1,"inputs":[{"key":"audience","value":"Startup owners"},{"key":"article","artifact_version_id":"99999999-9999-4999-8999-999999997111"}]},{"key":"extra_proof","action":"omit","reason":"Existing approved source supplies evidence"}]';begin
 select d.steps into steps from public.pipeline_execution_definitions d where id='99999999-9999-4999-8999-999999997120';
 steps:=jsonb_set(jsonb_set(steps,'{1,kind}','"ai_assisted"'),'{1,stage_contract,required_inputs}','[{"key":"audience","label":"Target audience","kind":"manual"},{"key":"article","label":"Approved source article","kind":"approved_artifact","artifact_type":"content","output_type":"blog_article"}]');
 insert into public.pipeline_execution_definitions(id,organization_id,preset_publication_id,version_number,request_id,request_sha256,name,steps,steps_sha256,created_by) values(def,org,'99999999-9999-4999-8999-999999997102',(select max(version_number)+1 from public.pipeline_execution_definitions where preset_publication_id='99999999-9999-4999-8999-999999997102'),gen_random_uuid(),repeat('a',64),'Synthetic AI input definition; not human publication acceptance',steps,encode(sha256(convert_to(steps::text,'UTF8')),'hex'),actor);
 insert into public.pipeline_execution_publications(id,organization_id,definition_id,published_by) values(pub,org,def,actor);
 grp:=(public.create_project_pipeline_group(org,eng,'99999999-9999-4999-8999-999999997102','website','AI input context '||gen_random_uuid(),gen_random_uuid())->'group'->>'id')::uuid;
 cfg:=(public.create_reviewed_project_pipeline_configuration(org,eng,pub,grp,gen_random_uuid(),decisions,1000)->>'configuration_id')::uuid;
 impact:=public.preview_project_pipeline_activation(org,cfg);perform public.activate_project_pipeline_configuration(org,cfg,gen_random_uuid(),impact->>'impact_token_sha256',true);
 intent:=(public.start_project_pipeline_group_run(org,eng,gen_random_uuid(),grp,'{}')->>'run_intent_id')::uuid;
 insert into public.pipeline_run_intent_reviews(organization_id,run_intent_id,request_id,request_sha256,decision,reason,reviewed_by) values(org,intent,gen_random_uuid(),repeat('a',64),'accepted_for_planning','Synthetic materialization prerequisite; not distinct-human acceptance',actor);
 plan:=public.plan_manual_pipeline_run(org,intent,gen_random_uuid(),array['99999999-9999-4999-8999-999999997130'::uuid]);
 select * into job from public.ai_execution_jobs where run_plan_id=(plan->>'run_plan_id')::uuid;
 select * into step from public.ai_execution_configured_steps where job_id=job.id and step_key='page_copy';select * into reused from public.ai_execution_configured_steps where job_id=job.id and step_key='article_source';
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',org,job.id,step.id,actor),'42501','no source content before exact input acknowledgement');
 perform pg_temp.input_error(format('select public.approve_pipeline_ai_job_inputs(%L,%L,%L,true)',org,job.id,gen_random_uuid()),'42501','actual acknowledgement still requires distinct planning reviewer');
 -- Synthetic prerequisite isolates the source read contract; it is not human consent acceptance.
 insert into public.ai_execution_input_approvals(organization_id,job_id,request_id,request_sha256,job_input_sha256,work_sha256,approved_by,approved_scope) values(org,job.id,gen_random_uuid(),repeat('a',64),job.input_sha256,plan->>'work_sha256',actor,'configured_text_ai');
 ctx:=public.get_pipeline_ai_step_input_context(org,job.id,step.id,actor);
 if ctx->'manual_values' is distinct from '[{"key":"audience","label":"Target audience","value":"Startup owners"}]'::jsonb or jsonb_array_length(ctx->'approved_sources')<>1 or ctx->'approved_sources'->0->'reference'->>'artifact_version_id'<>'99999999-9999-4999-8999-999999997111' or ctx->>'step_key'<>'page_copy' then raise exception 'Exact stage inputs changed';end if;raise notice 'PASS exact reviewed manual and canonical source inputs only';
 if ctx->'approved_sources'->0->'content'->>'body'<>'Existing approved launch article' or ctx::text like '%Later unapproved draft%' then raise exception 'Canonical original content changed or latest substituted';end if;raise notice 'PASS canonical source content and original checksum without later drafts';
 if ctx->'approved_sources'->0->'reference'->>'content_checksum'<>encode(sha256(convert_to((ctx->'approved_sources'->0->'content')::text,'UTF8')),'hex') or ctx->>'stage_review_sha256' is distinct from (select input_manifest->'stage_review'->>'review_sha256' from public.pipeline_run_intents where id=intent) then raise exception 'Canonical checksum/receipt identity changed';end if;raise notice 'PASS exact content checksum and frozen review identity';
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',org,job.id,reused.id,actor),'42501','reused step cannot resolve regeneration inputs');
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',org,job.id,step.id,gen_random_uuid()),'42501','foreign actor source access denied');
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',gen_random_uuid(),job.id,step.id,actor),'42501','foreign organization source access denied');
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',org,job.id,gen_random_uuid(),actor),'42501','unrelated step source access denied');
 update public.organization_memberships set status='suspended' where organization_id=org and user_id=actor;
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',org,job.id,step.id,actor),'42501','current revoked membership blocks source bytes');
 update public.organization_memberships set status='active' where organization_id=org and user_id=actor;
 update public.projects set archived_at=now() where id=project;
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',org,job.id,step.id,actor),'42501','archived project blocks source bytes');
 update public.projects set archived_at=null where id=project;
 begin
 insert into public.artifact_approval_requests(organization_id,artifact_version_id,approval_policy,status,requested_by) values(org,'99999999-9999-4999-8999-999999997111','parallel','pending',actor);
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',org,job.id,step.id,actor),'55000','changed governed source cannot provide bytes');
 raise exception 'Rollback synthetic negative state' using errcode='P0002';exception when no_data_found then null;end;
 -- Fresh immutable approved source that forbids AI use; the configuration must reject it.
 version:=gen_random_uuid();value:='{"schema_version":2,"output_type":"blog_article","body":"No AI permitted"}';
 insert into public.artifact_versions(id,organization_id,artifact_id,version_number,parent_version_id,content,content_checksum,change_summary,ai_use_allowed,data_classification,created_by) values(version,org,'99999999-9999-4999-8999-999999997110',(select max(version_number)+1 from public.artifact_versions where artifact_id='99999999-9999-4999-8999-999999997110'),'99999999-9999-4999-8999-999999997111',value,encode(sha256(convert_to(value::text,'UTF8')),'hex'),'Synthetic AI-use denial fixture',false,'internal',actor);
 insert into public.artifact_approvals(organization_id,artifact_id,artifact_version_id,engagement_id,decision,notes,approved_by) values(org,'99999999-9999-4999-8999-999999997110',version,eng,'approved','Synthetic typed-source prerequisite',actor);
 perform pg_temp.input_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,pub,grp,gen_random_uuid(),jsonb_set(decisions,'{1,inputs,1,artifact_version_id}',to_jsonb(version::text))),'42501','approved source without AI permission cannot enter generating stage');
 -- Oversized exact source is rejected whole, never silently truncated.
 large:=gen_random_uuid();value:=jsonb_build_object('schema_version',2,'output_type','blog_article','body',repeat('x',24500));
 insert into public.artifact_versions(id,organization_id,artifact_id,version_number,parent_version_id,content,content_checksum,change_summary,ai_use_allowed,data_classification,created_by) values(large,org,'99999999-9999-4999-8999-999999997110',(select max(version_number)+1 from public.artifact_versions where artifact_id='99999999-9999-4999-8999-999999997110'),'99999999-9999-4999-8999-999999997111',value,encode(sha256(convert_to(value::text,'UTF8')),'hex'),'Synthetic bounded-source fixture',true,'internal',actor);
 insert into public.artifact_approvals(organization_id,artifact_id,artifact_version_id,engagement_id,decision,notes,approved_by) values(org,'99999999-9999-4999-8999-999999997110',large,eng,'approved','Synthetic typed-source prerequisite',actor);
 second_group:=(public.create_project_pipeline_group(org,eng,'99999999-9999-4999-8999-999999997102','website','Oversize source '||gen_random_uuid(),gen_random_uuid())->'group'->>'id')::uuid;
 cfg:=(public.create_reviewed_project_pipeline_configuration(org,eng,pub,second_group,gen_random_uuid(),jsonb_set(decisions,'{1,inputs,1,artifact_version_id}',to_jsonb(large::text)),1000)->>'configuration_id')::uuid;
 impact:=public.preview_project_pipeline_activation(org,cfg);perform public.activate_project_pipeline_configuration(org,cfg,gen_random_uuid(),impact->>'impact_token_sha256',true);intent:=(public.start_project_pipeline_group_run(org,eng,gen_random_uuid(),second_group,'{}')->>'run_intent_id')::uuid;
 insert into public.pipeline_run_intent_reviews(organization_id,run_intent_id,request_id,request_sha256,decision,reason,reviewed_by) values(org,intent,gen_random_uuid(),repeat('a',64),'accepted_for_planning','Synthetic read-bound prerequisite only',actor);
 plan:=public.plan_manual_pipeline_run(org,intent,gen_random_uuid(),array['99999999-9999-4999-8999-999999997130'::uuid]);select * into job from public.ai_execution_jobs where run_plan_id=(plan->>'run_plan_id')::uuid;select * into step from public.ai_execution_configured_steps where job_id=job.id and step_key='page_copy';
 insert into public.ai_execution_input_approvals(organization_id,job_id,request_id,request_sha256,job_input_sha256,work_sha256,approved_by,approved_scope) values(org,job.id,gen_random_uuid(),repeat('a',64),job.input_sha256,plan->>'work_sha256',actor,'configured_text_ai');
 perform pg_temp.input_error(format('select public.get_pipeline_ai_step_input_context(%L,%L,%L,%L)',org,job.id,step.id,actor),'22023','oversized canonical source is denied without truncation');
 if has_function_privilege('authenticated','public.get_pipeline_ai_step_input_context(uuid,uuid,uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.get_pipeline_ai_step_input_context(uuid,uuid,uuid,uuid)','EXECUTE') or not has_function_privilege('service_role','public.get_pipeline_ai_step_input_context(uuid,uuid,uuid,uuid)','EXECUTE') then raise exception 'Input resolver authority widened';end if;raise notice 'PASS service-only bounded resolver grant';
 if exists(select 1 from private.ai_execution_step_budget_reservations where job_id=job.id) then raise exception 'Read-only resolution reserved budget';end if;raise notice 'PASS no budget/provider side effects';
end;$$;
rollback;
