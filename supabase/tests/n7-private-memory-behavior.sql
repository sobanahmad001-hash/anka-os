do $$
declare
  org uuid:='11111111-1111-4111-8111-111111111111';
  note_id uuid:='cccccccc-5555-4555-8555-555555555555';
  revised_id uuid:='dddddddd-5555-4555-8555-555555555555';
  job_id uuid:='eeeeeeee-5555-4555-8555-555555555555';
  result jsonb; preview jsonb; ids uuid[];
begin
  if has_table_privilege('authenticated','public.ai_private_memory','SELECT')
    or has_function_privilege('anon','public.get_private_ai_memory(uuid)','EXECUTE') then
    raise exception 'Private memory grant boundary failed'; end if;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  result:=public.save_private_ai_memory(org,note_id,'owner_note',
    'I prefer clear visual hierarchy',null,'Use clear hierarchy in my private experiments');
  if result->>'status'<>'confirmed' then raise exception 'Private note save failed'; end if;
  result:=public.save_private_ai_memory(org,note_id,'owner_note',
    'I prefer clear visual hierarchy',null,'Use clear hierarchy in my private experiments');
  if result->>'idempotent_replay'<>'true' then raise exception 'Private note replay failed'; end if;
  begin
    perform public.save_private_ai_memory(org,'ffffffff-5555-4555-8555-555555555555',
      'design_experiment',null,'bbbbbbbb-5555-4555-8555-555555555555',
      'Reuse someone else private work');
    raise exception 'Foreign private experiment accepted';
  exception when sqlstate '42501' then null;
  end;
  perform public.save_private_ai_memory(org,revised_id,'owner_note',
    'I prefer stronger hierarchy',null,'Use strong hierarchy',note_id);
  if (select status from public.ai_private_memory where id=note_id)<>'superseded' then
    raise exception 'Private correction did not supersede prior note'; end if;
  perform public.save_private_ai_memory(org,job_id,'design_experiment',null,
    'aaaaaaaa-5555-4555-8555-555555555555','Explore high-contrast concept');
  result:=public.get_private_ai_memory(org);
  if jsonb_array_length(result->'confirmed')<>2
    or jsonb_array_length(result->'history')<>3 then
    raise exception 'Owner-private read failed'; end if;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  result:=public.get_private_ai_memory(org);
  if jsonb_array_length(result->'confirmed')<>0 or jsonb_array_length(result->'history')<>0 then
    raise exception 'Private memory leaked to another organization member'; end if;
  begin
    perform public.retire_private_ai_memory(org,job_id,
      'aaaaaaaa-6666-4666-8666-666666666666','Not the owner');
    raise exception 'Foreign owner retired private memory';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  update public.design_private_experiment_jobs set prompt='Changed source prompt'
    where id='aaaaaaaa-5555-4555-8555-555555555555';
  result:=public.get_private_ai_memory(org);
  if jsonb_array_length(result->'confirmed')<>1
    or jsonb_array_length(result->'history')<>3 then
    raise exception 'Private experiment source revocation failed'; end if;
  result:=public.retire_private_ai_memory(org,job_id,
    'aaaaaaaa-6666-4666-8666-666666666666','Source changed after confirmation');
  if result->>'status'<>'retired' then raise exception 'Private retirement failed'; end if;
  result:=public.retire_private_ai_memory(org,job_id,
    'aaaaaaaa-6666-4666-8666-666666666666','Source changed after confirmation');
  if result->>'idempotent_replay'<>'true'
    or (select count(*) from private.ai_private_memory_events)<>1 then
    raise exception 'Private retirement replay or audit failed'; end if;
  preview:=public.preview_private_ai_memory_purge(org,note_id);
  if jsonb_array_length(preview->'memory_ids')<>2 then
    raise exception 'Private correction chain preview failed'; end if;
  select array_agg(value::uuid order by value::uuid) into ids
    from jsonb_array_elements_text(preview->'memory_ids') value;
  begin
    perform public.purge_private_ai_memory(org,note_id,
      'bbbbbbbb-6666-4666-8666-666666666666',array[note_id],
      'PURGE','Private owner requested explicit purge');
    raise exception 'Incomplete private chain was purged';
  exception when sqlstate '40001' then null;
  end;
  result:=public.purge_private_ai_memory(org,note_id,
    'bbbbbbbb-6666-4666-8666-666666666666',ids,
    'PURGE','Private owner requested explicit purge');
  if jsonb_array_length(result->'purged_memory_ids')<>2 then
    raise exception 'Exact private purge failed'; end if;
  result:=public.purge_private_ai_memory(org,note_id,
    'bbbbbbbb-6666-4666-8666-666666666666',ids,
    'PURGE','Private owner requested explicit purge');
  if result->>'idempotent_replay'<>'true'
    or (select count(*) from public.ai_private_memory)<>1
    or (select count(*) from private.ai_private_memory_purges)<>2 then
    raise exception 'Private purge replay or retained sibling failed'; end if;
end;
$$;
select 'isolated N7 owner-private memory checks passed' as result;
