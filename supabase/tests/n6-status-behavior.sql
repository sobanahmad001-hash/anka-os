do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  actor uuid := '22222222-2222-4222-8222-222222222222';
  content jsonb;
  released jsonb;
  uncertain jsonb;
begin
  if not has_function_privilege('authenticated',
      'public.get_pipeline_ai_job_status(uuid,uuid)','EXECUTE')
    or has_function_privilege('anon',
      'public.get_pipeline_ai_job_status(uuid,uuid)','EXECUTE')
    or has_table_privilege('authenticated','private.ai_execution_dispatch_claims','SELECT') then
    raise exception 'Execution-status read boundary failed';
  end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  content := public.get_pipeline_ai_job_status(org,
    '88888888-8888-4888-8888-888888888888');
  if content->>'job_id' <> '88888888-8888-4888-8888-888888888888'
    or jsonb_array_length(content->'steps') <> 2 then
    raise exception 'Scoped job status is incomplete: %', content;
  end if;
  select value into released from jsonb_array_elements(content->'steps')
    where value->>'step_id'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select value into uncertain from jsonb_array_elements(content->'steps')
    where value->>'step_id'='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if released->>'reservation_status' <> 'released'
    or released->>'claimed_routes' <> '1'
    or released->>'confirmed_rejections' <> '1'
    or uncertain->>'reservation_status' <> 'uncertain'
    or uncertain->>'claimed_routes' <> '3'
    or uncertain->>'confirmed_rejections' <> '2' then
    raise exception 'Execution status does not distinguish safe release and unknown outcome: %', content;
  end if;
  update public.organization_memberships set role='member' where user_id=actor;
  begin
    perform public.get_pipeline_ai_job_status(org,
      '88888888-8888-4888-8888-888888888888');
    raise exception 'Non-owner read private N6 status';
  exception when sqlstate '42501' then null;
  end;
  update public.organization_memberships set role='system_owner' where user_id=actor;
  begin
    perform public.get_pipeline_ai_job_status(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '88888888-8888-4888-8888-888888888888');
    raise exception 'Cross-organization status read accepted';
  exception when sqlstate '42501' then null;
  end;
end;
$$;
select 'isolated N6 scoped execution status passed' as result;
