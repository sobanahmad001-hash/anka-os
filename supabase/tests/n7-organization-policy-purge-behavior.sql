do $$
declare org uuid:='11111111-1111-4111-8111-111111111111';
 first_id uuid:='11111111-1111-4111-8111-aaaaaaaaaaaa';
 second_id uuid:='22222222-2222-4222-8222-aaaaaaaaaaaa';
 requester uuid:='22222222-2222-4222-8222-222222222222';
 owner uuid:='33333333-3333-4333-8333-333333333333';
 purge_id uuid:='99999999-9999-4999-8999-aaaaaaaaaaaa';
 preview jsonb; result jsonb; ids uuid[];
begin
 perform set_config('request.jwt.claim.sub',requester::text,true);
 begin
   perform public.preview_organization_ai_policy_purge(org,first_id);
   raise exception 'Non-owner preview accepted';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 preview:=public.preview_organization_ai_policy_purge(org,first_id);
 if jsonb_array_length(preview->'policy_ids')<>2 then
   raise exception 'Exact correction chain preview failed: %',preview; end if;
 select array_agg((value#>>'{}')::uuid) into ids
   from jsonb_array_elements(preview->'policy_ids') value;
 begin
   perform public.purge_organization_ai_policy(org,first_id,purge_id,
     ids,'DELETE','Explicit owner purge of prior policy');
   raise exception 'Wrong purge confirmation accepted';
 exception when sqlstate '22023' then null;
 end;
 begin
   perform public.purge_organization_ai_policy(org,first_id,purge_id,
     array[first_id],'PURGE','Explicit owner purge of prior policy');
   raise exception 'Partial chain accepted';
 exception when sqlstate '40001' then null;
 end;
 perform set_config('request.jwt.claim.sub',requester::text,true);
 begin
   perform public.purge_organization_ai_policy(org,first_id,purge_id,
     ids,'PURGE','Explicit owner purge of prior policy');
   raise exception 'Non-owner purge accepted';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 result:=public.purge_organization_ai_policy(org,first_id,purge_id,
   ids,'PURGE','Explicit owner purge of prior policy');
 if result->>'idempotent_replay'<>'false'
   or jsonb_array_length(result->'purged_policy_ids')<>2 then
   raise exception 'Exact policy purge failed: %',result; end if;
 if exists(select 1 from public.ai_organization_policy_memory where id=any(ids))
   or exists(select 1 from private.ai_organization_policy_decisions where policy_id=any(ids))
   or (select count(*) from private.ai_organization_policy_purges where policy_id=any(ids))<>2 then
   raise exception 'Policy purge did not remove content and retain tombstones'; end if;
 if exists(select 1 from private.ai_organization_policy_purges
   where policy_id=any(ids) and length(reason_sha256)<>64)
   or exists(select 1 from information_schema.columns where table_schema='private'
     and table_name='ai_organization_policy_purges' and column_name='reason') then
   raise exception 'Purge tombstone retained raw reason text'; end if;
 result:=public.purge_organization_ai_policy(org,first_id,purge_id,
   ids,'PURGE','Explicit owner purge of prior policy');
 if result->>'idempotent_replay'<>'true' then raise exception 'Purge replay failed'; end if;
 if has_table_privilege('authenticated','private.ai_organization_policy_purges','SELECT')
   or has_table_privilege('authenticated','private.ai_organization_policy_purges','INSERT')
   or has_function_privilege('anon','public.purge_organization_ai_policy(uuid,uuid,uuid,uuid[],text,text)','EXECUTE') then
   raise exception 'Policy purge grant leaked'; end if;
end;
$$;
select 'isolated organization policy purge checks passed' as result;
