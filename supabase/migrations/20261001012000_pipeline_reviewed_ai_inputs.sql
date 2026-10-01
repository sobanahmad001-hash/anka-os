-- Exact reviewed stage inputs for the existing authenticated pipeline worker only.
-- No provider invocation, publication, budget reservation or new source store.
begin;
do $$begin
 if md5(replace(pg_get_functiondef(to_regprocedure('public.preflight_pipeline_ai_job(uuid,uuid,uuid)')),chr(13),'')) is distinct from 'f1832d0922943e428a1eb959be451c63' then raise exception 'Reviewed input preflight prerequisite differs' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.current_pipeline_stage_review(uuid,uuid)')),chr(13),'')) is distinct from '4a0485cb3872e0872b6c4f59660b5d69' then raise exception 'Reviewed input lineage prerequisite differs' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.require_pipeline_approved_artifact(uuid,uuid,uuid,text,text)')),chr(13),'')) is distinct from '033f6c233c35b8c2641716b861a63cd2' then raise exception 'Reviewed artifact authority prerequisite differs' using errcode='55000';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('private.n6_project_configuration_authorized(uuid,uuid,uuid)')),chr(13),'')) is distinct from 'b5005c1ed90d7fe6cf8acc091c1cfb81' then raise exception 'Current project authority prerequisite differs' using errcode='55000';end if;
end;$$;
create function public.get_pipeline_ai_step_input_context(p_organization_id uuid,p_job_id uuid,p_step_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.ai_execution_jobs;intent public.pipeline_run_intents;engagement public.engagements;step public.ai_execution_configured_steps;
 activation public.project_pipeline_activations;review jsonb;decision jsonb;requirement jsonb;input jsonb;pinned jsonb;ref jsonb;content jsonb;readiness jsonb;
 manual_values jsonb:='[]';approved_sources jsonb:='[]';result jsonb;begin
 select * into job from public.ai_execution_jobs where id=p_job_id and organization_id=p_organization_id;
 select * into intent from public.pipeline_run_intents where id=job.run_intent_id and organization_id=p_organization_id;
 select * into engagement from public.engagements where id=intent.engagement_id and organization_id=p_organization_id;
 if job.id is null or job.requested_by is distinct from p_actor_id or engagement.id is null
  or not private.n6_project_configuration_authorized(p_organization_id,engagement.project_id,p_actor_id) then raise exception 'Current exact actor/project input authority required' using errcode='42501';end if;
 select * into step from public.ai_execution_configured_steps where id=p_step_id and job_id=job.id and organization_id=p_organization_id;
 if step.id is null or step.reused_artifact_version_id is not null or not coalesce(step.definition_step->>'kind' in ('ai_assisted','automatic'),false) then raise exception 'Only a generating AI step may resolve reviewed inputs' using errcode='42501';end if;
 -- Reuse the preserved exact-job acknowledgement, activation, work, membership and route checks.
 readiness:=public.preflight_pipeline_ai_job(p_organization_id,job.id,p_actor_id);
 select * into activation from public.project_pipeline_activations where id=intent.project_activation_id and organization_id=p_organization_id;
 review:=private.current_pipeline_stage_review(p_organization_id,activation.configuration_id);
 if review is distinct from intent.input_manifest->'stage_review' then raise exception 'Exact reviewed inputs are no longer current' using errcode='55000';end if;
 if review is not null then
  select value into decision from jsonb_array_elements(review->'decisions') where value->>'key'=step.step_key;
  if decision->>'action' is distinct from 'run' then raise exception 'This reviewed stage cannot regenerate a satisfied source' using errcode='42501';end if;
  for requirement in select value from jsonb_array_elements(coalesce(step.definition_step->'stage_contract'->'required_inputs','[]')) loop
   select value into input from jsonb_array_elements(decision->'inputs') where value->>'key'=requirement->>'key';
   if input is null then raise exception 'Pinned required input is missing' using errcode='55000';end if;
   if requirement->>'kind'='manual' then
    manual_values:=manual_values||jsonb_build_array(jsonb_build_object('key',requirement->>'key','label',requirement->>'label','value',input->>'value'));
   elsif requirement->>'kind'='approved_artifact' then
    select value->'reference' into pinned from jsonb_array_elements(review->'resolved_artifacts') where value->>'step_key'=step.step_key and value->>'input_key'=requirement->>'key';
    ref:=private.require_pipeline_approved_artifact(p_organization_id,engagement.project_id,(input->>'artifact_version_id')::uuid,requirement->>'artifact_type',requirement->>'output_type');
    if ref is distinct from pinned or ref->>'ai_use_allowed' is distinct from 'true' then raise exception 'Exact approved input does not permit this AI use' using errcode='42501';end if;
    select v.content into content from public.artifact_versions v where v.id=(ref->>'artifact_version_id')::uuid and v.organization_id=p_organization_id;
    if content is null or encode(sha256(convert_to(content::text,'UTF8')),'hex') is distinct from ref->>'content_checksum' then raise exception 'Exact canonical input checksum differs' using errcode='55000';end if;
    approved_sources:=approved_sources||jsonb_build_array(jsonb_build_object('key',requirement->>'key','label',requirement->>'label','reference',ref,'content',content));
   else raise exception 'Unknown reviewed input kind' using errcode='55000';end if;
  end loop;
 elsif step.definition_step ? 'stage_contract' then raise exception 'Declared input requires its immutable review' using errcode='55000';end if;
 result:=jsonb_build_object('readiness',readiness,'step_key',step.step_key,'stage_review_id',review->>'id','stage_review_sha256',review->>'review_sha256','manual_values',manual_values,'approved_sources',approved_sources);
 if octet_length(result::text)>24000 then raise exception 'Exact reviewed inputs exceed the worker bound; choose a smaller approved source version' using errcode='22023';end if;
 return result;
end;$$;
revoke all on function public.get_pipeline_ai_step_input_context(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_pipeline_ai_step_input_context(uuid,uuid,uuid,uuid) to service_role;
commit;
