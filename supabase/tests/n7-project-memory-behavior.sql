do $$
declare
  org uuid := '11111111-1111-4111-8111-111111111111';
  project uuid := '55555555-5555-4555-8555-555555555555';
  requester uuid := '22222222-2222-4222-8222-222222222222';
  reviewer uuid := '33333333-3333-4333-8333-333333333333';
  outsider uuid := '44444444-4444-4444-8444-444444444444';
  memory1 uuid := '88888888-8888-4888-8888-888888888888';
  memory2 uuid := '99999999-9999-4999-8999-999999999999';
  result jsonb;
begin
  if not has_function_privilege('authenticated',
      'public.propose_project_ai_memory(uuid,uuid,uuid,uuid,text,uuid)','EXECUTE')
    or has_function_privilege('anon',
      'public.propose_project_ai_memory(uuid,uuid,uuid,uuid,text,uuid)','EXECUTE')
    or has_table_privilege('authenticated','public.ai_project_memory','SELECT')
    or has_table_privilege('service_role','public.ai_project_memory','DELETE') then
    raise exception 'N7 memory grant boundary failed';
  end if;
  perform set_config('request.jwt.claim.sub',requester::text,true);
  result := public.propose_project_ai_memory(org,project,memory1,
    '66666666-6666-4666-8666-666666666666','Check brief revisions before drafting');
  if result->>'status'<>'candidate' or result->>'idempotent_replay'<>'false' then
    raise exception 'Project candidate was not recorded';
  end if;
  result := public.propose_project_ai_memory(org,project,memory1,
    '66666666-6666-4666-8666-666666666666','Check brief revisions before drafting');
  if result->>'idempotent_replay'<>'true' then raise exception 'Candidate replay failed'; end if;
  begin
    perform public.propose_project_ai_memory(org,project,
      'aaaaaaaa-1111-4111-8111-111111111111',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Leak another client');
    raise exception 'Cross-project source accepted';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.review_project_ai_memory(org,project,memory1,
      'bbbbbbbb-1111-4111-8111-111111111111','confirm','same actor');
    raise exception 'Requester confirmed own candidate';
  exception when sqlstate '42501' or sqlstate '55000' then null;
  end;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin
    perform public.get_project_ai_memory(org,project);
    raise exception 'Other organization read project memory';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  result := public.get_project_ai_memory(org,project);
  if jsonb_array_length(result->'confirmed')<>0
    or jsonb_array_length(result->'candidates')<>1 then
    raise exception 'Candidate visibility failed: %',result;
  end if;
  result := public.review_project_ai_memory(org,project,memory1,
    'cccccccc-1111-4111-8111-111111111111','confirm','Source checked with owner');
  if result->>'status'<>'confirmed' or result->>'idempotent_replay'<>'false' then
    raise exception 'Independent confirmation failed';
  end if;
  result := public.review_project_ai_memory(org,project,memory1,
    'cccccccc-1111-4111-8111-111111111111','confirm','Source checked with owner');
  if result->>'idempotent_replay'<>'true' then raise exception 'Review replay failed'; end if;
  perform set_config('request.jwt.claim.sub',requester::text,true);
  result := public.get_project_ai_memory(org,project);
  if jsonb_array_length(result->'confirmed')<>1
    or jsonb_array_length(result->'candidates')<>0 then
    raise exception 'Confirmed scoped read failed';
  end if;
  perform public.propose_project_ai_memory(org,project,memory2,
    '77777777-7777-4777-8777-777777777777',
    'Use the newest approved brief revision',memory1);
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  perform public.review_project_ai_memory(org,project,memory2,
    'dddddddd-1111-4111-8111-111111111111','confirm','Verified superseding source');
  result := public.get_project_ai_memory(org,project);
  if jsonb_array_length(result->'confirmed')<>1
    or result->'confirmed'->0->>'id'<>memory2::text
    or (select status from public.ai_project_memory where id=memory1)<>'superseded' then
    raise exception 'Supersession did not replace old lesson';
  end if;
  update public.comments set content='Changed after confirmation'
    where id='77777777-7777-4777-8777-777777777777';
  result := public.get_project_ai_memory(org,project);
  if jsonb_array_length(result->'confirmed')<>0 then
    raise exception 'Changed source did not revoke memory reuse';
  end if;
  result := public.review_project_ai_memory(org,project,memory2,
    'eeeeeeee-1111-4111-8111-111111111111','retire','Source was changed');
  if result->>'status'<>'retired' then
    raise exception 'Revoked memory could not be retired';
  end if;
  result := public.review_project_ai_memory(org,project,memory2,
    'dddddddd-1111-4111-8111-111111111111','confirm','Verified superseding source');
  if result->>'status'<>'confirmed' or result->>'idempotent_replay'<>'true' then
    raise exception 'Review replay lost its original decision';
  end if;
  delete from public.comments where id='77777777-7777-4777-8777-777777777777';
  if (select count(*) from public.ai_project_memory where id=memory2)<>1 then
    raise exception 'Source removal erased protected memory history';
  end if;
  perform set_config('request.jwt.claim.sub',requester::text,true);
  perform public.propose_project_ai_memory(org,project,
    'aaaaaaaa-2222-4222-8222-222222222222',
    '66666666-6666-4666-8666-666666666666','Temporary unconfirmed lesson');
  update public.ai_project_memory set candidate_expires_at=clock_timestamp() - interval '1 second'
    where id='aaaaaaaa-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  result := public.get_project_ai_memory(org,project);
  if jsonb_array_length(result->'candidates')<>0 then
    raise exception 'Expired candidate remained reusable';
  end if;
  begin
    perform public.review_project_ai_memory(org,project,
      'aaaaaaaa-2222-4222-8222-222222222222',
      'bbbbbbbb-2222-4222-8222-222222222222','confirm','Late review');
    raise exception 'Expired candidate was confirmed';
  exception when sqlstate '55000' then null;
  end;
  if (select count(*) from private.ai_project_memory_decisions)<>3 then
    raise exception 'Memory decision audit count failed';
  end if;
end;
$$;
select 'isolated N7 sourced memory checks passed' as result;
