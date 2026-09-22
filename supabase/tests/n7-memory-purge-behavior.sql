do $$
declare
  org uuid:='11111111-1111-4111-8111-111111111111';
  project uuid:='55555555-5555-4555-8555-555555555555';
  first_id uuid:='88888888-8888-4888-8888-888888888888';
  next_id uuid:='99999999-9999-4999-8999-999999999999';
  purge_id uuid:='eeeeeeee-3333-4333-8333-333333333333';
  preview jsonb; result jsonb; ids uuid[];
begin
  if not has_function_privilege('authenticated',
      'public.preview_project_ai_memory_purge(uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('anon',
      'public.purge_project_ai_memory(uuid,uuid,uuid,uuid,uuid[],text,text)','EXECUTE')
    or has_table_privilege('service_role','private.ai_project_memory_purges','DELETE') then
    raise exception 'Purge grant boundary failed';
  end if;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  begin
    perform public.get_project_ai_memory_history(org,project);
    raise exception 'Non-owner accessed protected memory history';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.preview_project_ai_memory_purge(org,project,first_id);
    raise exception 'Non-owner accessed memory purge preview';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  result:=public.get_project_ai_memory_history(org,project);
  if jsonb_array_length(result->'records')<>3 then
    raise exception 'Owner history did not preserve revoked and expired records';
  end if;
  preview:=public.preview_project_ai_memory_purge(org,project,first_id);
  if jsonb_array_length(preview->'memory_ids')<>2 then
    raise exception 'Purge preview missed linked memory: %',preview;
  end if;
  select array_agg(value::uuid order by value::uuid) into ids
    from jsonb_array_elements_text(preview->'memory_ids') value;
  begin
    perform public.purge_project_ai_memory(org,project,first_id,purge_id,
      array[first_id], 'PURGE','Owner requested explicit history purge');
    raise exception 'Incomplete lineage was purged';
  exception when sqlstate '40001' then null;
  end;
  if (select count(*) from public.ai_project_memory where id in (first_id,next_id))<>2 then
    raise exception 'Failed purge preview partially erased memory';
  end if;
  result:=public.purge_project_ai_memory(org,project,first_id,purge_id,
    ids,'PURGE','Owner requested explicit history purge');
  if jsonb_array_length(result->'purged_memory_ids')<>2
    or result->>'idempotent_replay'<>'false' then
    raise exception 'Exact preview purge failed: %',result;
  end if;
  result:=public.purge_project_ai_memory(org,project,first_id,purge_id,
    ids,'PURGE','Owner requested explicit history purge');
  if result->>'idempotent_replay'<>'true' then
    raise exception 'Purge replay failed';
  end if;
  if (select count(*) from public.ai_project_memory where id in (first_id,next_id))<>0
    or (select count(*) from private.ai_project_memory_decisions)<>0
    or (select count(*) from private.ai_project_memory_purges where purge_request_id=purge_id)<>2
    or (select count(*) from public.ai_project_memory)<>1 then
    raise exception 'Purge scope or content-free tombstone failed';
  end if;
end;
$$;
select 'isolated N7 explicit purge checks passed' as result;
