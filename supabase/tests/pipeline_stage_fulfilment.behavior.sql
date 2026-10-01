\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999902',true);
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999902","role":"authenticated"}',true);
\ir pipeline_stage_fulfilment.fixture.sql
create function pg_temp.stage_error(p_sql text,p_code text,p_label text) returns void language plpgsql as $$begin
 begin execute p_sql;raise exception 'Expected denial was missing: %',p_label;exception when others then
 if sqlstate<>p_code then raise exception 'Wrong denial for %: % %',p_label,sqlstate,sqlerrm;end if;end;raise notice 'PASS %',p_label;end;$$;
create function pg_temp.fail_stage_review() returns trigger language plpgsql as $$begin raise exception 'Injected stage receipt failure' using errcode='55000';end;$$;
do $$declare org uuid:='99999999-9999-4999-8999-999999999901';eng uuid:='99999999-9999-4999-8999-999999999975';actor uuid:='99999999-9999-4999-8999-999999999902';publication uuid:='99999999-9999-4999-8999-999999997121';project uuid:='99999999-9999-4999-8999-999999999974';
 decisions jsonb:='[{"key":"article_source","action":"reuse","artifact_version_id":"99999999-9999-4999-8999-999999997111"},{"key":"page_copy","action":"run","quantity":1,"inputs":[{"key":"article","artifact_version_id":"99999999-9999-4999-8999-999999997111"}]},{"key":"extra_proof","action":"omit","reason":"Covered by existing approved source"}]';
 group_id uuid;request uuid:=gen_random_uuid();saved jsonb;replayed jsonb;bad jsonb;config public.project_pipeline_configurations;review public.project_pipeline_stage_reviews;impact jsonb;activation jsonb;intent public.pipeline_run_intents;job public.ai_execution_jobs;step public.ai_execution_configured_steps;plan jsonb;count_before integer;legacy_count integer;begin
 group_id:=(public.create_project_pipeline_group(org,eng,'99999999-9999-4999-8999-999999997102','website','Native fulfilment '||gen_random_uuid(),gen_random_uuid())->'group'->>'id')::uuid;
 -- Strict declared stage choices: no optional/dependency bypass, unapproved substitution or copied scope/actors.
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(decisions,'{2,reason}','""'),jsonb_set(decisions,'{0,action}','"omit"'),jsonb_set(decisions,'{1,inputs}','[]'),jsonb_set(decisions,'{0,actor_id}',to_jsonb(actor)),
  jsonb_set(decisions,'{2,action}','"outside_scope"'),jsonb_set(decisions,'{1,quantity}','0')
 )) loop
  perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,gen_random_uuid(),bad),'22023','strict complete stage decision');
 end loop;
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,gen_random_uuid(),jsonb_set(decisions,'{0,artifact_version_id}','"99999999-9999-4999-8999-999999997113"')),'42501','unapproved exact version denied');
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,gen_random_uuid(),jsonb_set(decisions,'{0,artifact_version_id}','"99999999-9999-4999-8999-999999997114"')),'42501','incompatible approved output denied');
 perform pg_temp.stage_error(format('select private.require_pipeline_approved_artifact(%L,%L,%L,%L,%L)',org,gen_random_uuid(),'99999999-9999-4999-8999-999999997111','content','blog_article'),'42501','foreign project source denied');
 bad:=public.list_project_pipeline_stage_artifacts(org,eng,'',0,1);
 if jsonb_array_length(bad->'artifacts')<>1 or bad->>'has_more'<>'true' then raise exception 'Bounded source page failed';end if;raise notice 'PASS bounded reference-only source search';
 bad:=public.list_project_pipeline_stage_artifacts(org,eng,'99999999-9999-4999-8999-999999997111',0,25);
 if jsonb_array_length(bad->'artifacts')<>1 or bad->'artifacts'->0 ? 'content' then raise exception 'Exact source search copied content or changed identity';end if;raise notice 'PASS exact UUID source lookup without content/history';
 begin
 insert into public.artifact_approval_requests(organization_id,artifact_version_id,approval_policy,status,requested_by) values(org,'99999999-9999-4999-8999-999999997111','parallel','pending',actor);
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,gen_random_uuid(),decisions),'55000','governed pending source denied');
 update public.artifact_approval_requests set status='cancelled' where organization_id=org and artifact_version_id='99999999-9999-4999-8999-999999997111';
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,gen_random_uuid(),decisions),'55000','cancelled governed source denied');
 raise exception 'Rollback the governed negative fixture without reopening terminal history' using errcode='P0002';
 exception when no_data_found then null;end;
 saved:=public.create_reviewed_project_pipeline_configuration(org,eng,publication,group_id,request,decisions,1000);
 select * into config from public.project_pipeline_configurations where id=(saved->>'configuration_id')::uuid;
 select * into review from public.project_pipeline_stage_reviews where configuration_id=config.id;
 if review.decisions is distinct from decisions or jsonb_array_length(review.resolved_artifacts)<>2 or config.selected_steps is distinct from '[{"key":"article_source","quantity":1},{"key":"page_copy","quantity":1}]'::jsonb then raise exception 'Exact stage review/reference/selection changed';end if;raise notice 'PASS exact omissions and two canonical source references';
 if review.resolved_artifacts->0->'reference'->>'artifact_version_id'<>'99999999-9999-4999-8999-999999997111' then raise exception 'Unapproved latest substituted';end if;raise notice 'PASS no latest draft substitution';
 replayed:=public.create_reviewed_project_pipeline_configuration(org,eng,publication,group_id,request,decisions,1000);
 if replayed->>'configuration_id'<>saved->>'configuration_id' or replayed->>'stage_review_id'<>saved->>'stage_review_id' or replayed->>'idempotent_replay'<>'true' then raise exception 'Exact replay changed';end if;raise notice 'PASS one immutable reviewed configuration replay';
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,request,jsonb_set(decisions,'{2,reason}','"Changed omission"')),'23505','changed omission replay denied');
 perform pg_temp.stage_error(format('update public.project_pipeline_stage_reviews set decisions=%L::jsonb where id=%L','[]',review.id),'55000','stage receipt immutable');
 count_before:=(select count(*) from public.project_pipeline_configurations);
 create trigger qa_fail_stage_review before insert on public.project_pipeline_stage_reviews for each row execute function pg_temp.fail_stage_review();
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,gen_random_uuid(),decisions),'55000','forced stage receipt failure rolls back');
 drop trigger qa_fail_stage_review on public.project_pipeline_stage_reviews;
 if (select count(*) from public.project_pipeline_configurations)<>count_before then raise exception 'Failed review leaked configuration';end if;raise notice 'PASS no orphan configuration after receipt failure';
 -- The old request shape still preserves history, but cannot activate declared stages without their reviewed receipt.
 bad:=public.create_project_pipeline_group_configuration(org,eng,publication,group_id,gen_random_uuid(),config.selected_steps,1000);
 perform pg_temp.stage_error(format('select public.preview_project_pipeline_activation(%L,%L)',org,bad->>'configuration_id'),'55000','unreviewed declared stages cannot activate');
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,(select request_id from public.project_pipeline_configurations where id=(bad->>'configuration_id')::uuid),decisions),'23505','historical configuration cannot adopt review');
 -- Create a newer exact reviewed draft because the unchanged activation gate rejects superseded drafts.
 saved:=public.create_reviewed_project_pipeline_configuration(org,eng,publication,group_id,gen_random_uuid(),decisions,1000);select * into config from public.project_pipeline_configurations where id=(saved->>'configuration_id')::uuid;
 select * into review from public.project_pipeline_stage_reviews where configuration_id=config.id;
 impact:=public.preview_project_pipeline_activation(org,config.id);
 if impact->'stage_review'->>'id'<>review.id::text then raise exception 'Impact omitted exact stage review';end if;raise notice 'PASS activation impact includes reviewed stage checksum';
 activation:=public.activate_project_pipeline_configuration(org,config.id,gen_random_uuid(),impact->>'impact_token_sha256',true);
 saved:=public.start_project_pipeline_group_run(org,eng,gen_random_uuid(),group_id,'{}');select * into intent from public.pipeline_run_intents where id=(saved->>'run_intent_id')::uuid;
 if intent.input_manifest->'stage_review' is distinct from private.current_pipeline_stage_review(org,config.id) or saved->>'input_sha256'<>intent.input_sha256 or intent.input_sha256<>encode(sha256(convert_to(intent.input_manifest::text,'UTF8')),'hex') then raise exception 'Exact stage input/returned hash not pinned';end if;raise notice 'PASS run pins reviewed stage sources and returns exact hash';
 perform pg_temp.stage_error(format('select public.review_pipeline_run_intent(%L,%L,%L,%L,%L)',org,intent.id,gen_random_uuid(),'accepted_for_planning',''),'42501','requester cannot self-review');
 -- Synthetic prerequisite only: isolates materialization without inventing a second human/user.
 insert into public.pipeline_run_intent_reviews(organization_id,run_intent_id,request_id,request_sha256,decision,reason,reviewed_by) values(org,intent.id,gen_random_uuid(),repeat('a',64),'accepted_for_planning','Synthetic materialization prerequisite; not human acceptance',actor);
 plan:=public.plan_manual_pipeline_run(org,intent.id,gen_random_uuid(),array['99999999-9999-4999-8999-999999997130'::uuid]);
 select * into job from public.ai_execution_jobs where run_plan_id=(plan->>'run_plan_id')::uuid;
 select * into step from public.ai_execution_configured_steps where job_id=job.id and step_key='article_source';
 if step.reused_artifact_version_id<>'99999999-9999-4999-8999-999999997111' or step.reuse_approval_id<>'99999999-9999-4999-8999-999999997112' or (select status from public.ai_execution_step_progress where configured_step_id=step.id)<>'completed' then raise exception 'Exact reused step not satisfied';end if;raise notice 'PASS materialized reuse retains exact canonical version and original approval';
 if (select count(*) from public.ai_execution_configured_steps where job_id=job.id)<>2 or exists(select 1 from public.ai_execution_configured_steps where job_id=job.id and step_key='extra_proof') then raise exception 'Omitted optional stage materialized';end if;raise notice 'PASS omission creates no configured execution step';
 perform pg_temp.stage_error(format('select private.n6_reserve_step_budget(%L,%L,%L,%L,1000)',org,job.id,step.id,actor),'42501','reused AI stage cannot reserve regeneration budget');
 if exists(select 1 from private.ai_execution_step_budget_reservations where configured_step_id=step.id) then raise exception 'Reused stage spent budget';end if;raise notice 'PASS reused stage has no provider reservation';
 perform pg_temp.stage_error(format('select public.approve_pipeline_ai_job_inputs(%L,%L,%L,true)',org,job.id,gen_random_uuid()),'42501','real input consent still requires a distinct accepted reviewer');
 update public.organization_memberships set status='suspended' where organization_id=org and user_id=actor;
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,request,decisions),'42501','revoked authority denies even exact reviewed replay');
 update public.organization_memberships set status='active' where organization_id=org and user_id=actor;
 update public.projects set archived_at=now() where id=project;
 perform pg_temp.stage_error(format('select public.list_project_pipeline_stage_artifacts(%L,%L)',org,eng),'42501','archived project denies source search');
 perform pg_temp.stage_error(format('select public.create_reviewed_project_pipeline_configuration(%L,%L,%L,%L,%L,%L::jsonb,1000)',org,eng,publication,group_id,gen_random_uuid(),decisions),'42501','archived project denies reviewed configuration');
 update public.projects set archived_at=null where id=project;
 update public.organization_memberships set member_kind='client',role='client_viewer' where organization_id=org and user_id=actor;
 set local role authenticated;
 if exists(select 1 from public.project_pipeline_stage_reviews where organization_id=org) then raise exception 'Client received team stage history';end if;raise notice 'PASS client RLS hides reviewed stage history';
 perform pg_temp.stage_error(format('select public.list_project_pipeline_stage_artifacts(%L,%L)',org,eng),'42501','client cannot enumerate stage sources');
 reset role;
 update public.organization_memberships set member_kind='team',role='operations_admin' where organization_id=org and user_id=actor;
 if has_table_privilege('authenticated','public.project_pipeline_stage_reviews','INSERT') or has_table_privilege('service_role','public.project_pipeline_stage_reviews','INSERT') or has_function_privilege('service_role','public.create_reviewed_project_pipeline_configuration(uuid,uuid,uuid,uuid,uuid,jsonb,bigint)','EXECUTE') or has_function_privilege('authenticated','private.current_pipeline_stage_review(uuid,uuid)','EXECUTE') then raise exception 'Stage authority widened';end if;raise notice 'PASS closed stage table/helper/command grants';
end;$$;
rollback;
