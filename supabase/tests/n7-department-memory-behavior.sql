do $$
declare
  org uuid:='11111111-1111-4111-8111-111111111111';
  project uuid:='55555555-5555-4555-8555-555555555555';
  source_id uuid:='bbbbbbbb-3333-4333-8333-333333333333';
  memory_id uuid:='dddddddd-3333-4333-8333-333333333333';
  result jsonb;
begin
  if has_table_privilege('authenticated','public.ai_department_memory','SELECT')
    or has_function_privilege('anon','public.get_department_ai_memory(uuid,text)','EXECUTE') then
    raise exception 'Department memory grant boundary failed'; end if;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  result:=public.propose_department_ai_memory(org,project,'design',memory_id,source_id,
    'Check hierarchy for every visual variant',
    'Removed all client names, visual assets, and project-specific language.');
  if result->>'status'<>'candidate' then raise exception 'Sanitized proposal failed'; end if;
  begin
    perform public.propose_department_ai_memory(org,project,'content',
      'eeeeeeee-4444-4444-8444-444444444444',source_id,
      'Unrelated method','Excluded all client and project identifiers.');
    raise exception 'Inactive target department accepted';
  exception when sqlstate '42501' then null;
  end;
  update public.organization_memberships set role='department_manager'
    where organization_id=org and user_id='22222222-2222-4222-8222-222222222222';
  begin
    perform public.review_department_ai_memory(org,'design',memory_id,
      'eeeeeeee-3333-4333-8333-333333333333','confirm','Self-review');
    raise exception 'Requester self-reviewed department memory';
  exception when sqlstate '42501' or sqlstate '55000' then null;
  end;
  perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
  begin
    perform public.get_department_ai_memory(org,'design');
    raise exception 'Foreign organization read department memory';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  result:=public.get_department_ai_memory(org,'design');
  if jsonb_array_length(result->'candidates')<>1 then raise exception 'Reviewer candidate read failed'; end if;

  update public.project_department_participation set status='paused'
    where organization_id=org and project_id=project and department_id='design';
  begin
    perform public.review_department_ai_memory(org,'design',memory_id,
      'ffffffff-3333-4333-8333-333333333333','confirm','Sanitization and source verified');
    raise exception 'Paused department source was confirmed';
  exception when sqlstate '55000' then null;
  end;
  update public.project_department_participation set status='active'
    where organization_id=org and project_id=project and department_id='design';
  result:=public.review_department_ai_memory(org,'design',memory_id,
    'ffffffff-3333-4333-8333-333333333333','confirm','Sanitization and source verified');
  if result->>'status'<>'confirmed' then raise exception 'Independent department review failed'; end if;


  result:=public.review_department_ai_memory(org,'design',memory_id,
    'ffffffff-3333-4333-8333-333333333333','confirm','Sanitization and source verified');
  if result->>'idempotent_replay'<>'true' then raise exception 'Review replay failed'; end if;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  result:=public.get_department_ai_memory(org,'design');
  if jsonb_array_length(result->'confirmed')<>1
    or result->'confirmed'->0->>'id'<>memory_id::text then
    raise exception 'Department-scoped confirmed read failed'; end if;
  update public.projects set archived_at=clock_timestamp() where id=project;
  result:=public.get_department_ai_memory(org,'design');
  if jsonb_array_length(result->'confirmed')<>0 then
    raise exception 'Archived source project remained reusable'; end if;
  update public.projects set archived_at=null where id=project;
  update public.comments set content='Revoked source content'
    where id='aaaaaaaa-3333-4333-8333-333333333333';
  result:=public.get_department_ai_memory(org,'design');
  if jsonb_array_length(result->'confirmed')<>0 then
    raise exception 'Source revocation did not stop department reuse'; end if;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  result:=public.review_department_ai_memory(org,'design',memory_id,
    'aaaaaaaa-4444-4444-8444-444444444444','retire','Source revoked after confirmation');
  if result->>'status'<>'retired'
    or (select count(*) from private.ai_department_memory_decisions)<>2 then
    raise exception 'Department retirement or audit failed'; end if;
  perform public.purge_project_ai_memory(org,project,source_id,
    'bbbbbbbb-4444-4444-8444-444444444444',array[source_id],
    'PURGE','Explicit owner purge of the project source');
  if (select count(*) from public.ai_department_memory where id=memory_id)<>1 then
    raise exception 'Source purge erased protected department history'; end if;
  result:=public.get_department_ai_memory(org,'design');
  if jsonb_array_length(result->'confirmed')<>0 then
    raise exception 'Source purge did not stop wider reuse'; end if;
end;
$$;
select 'isolated N7 department promotion checks passed' as result;
