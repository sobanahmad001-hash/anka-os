do $$
declare org uuid:='11111111-1111-4111-8111-111111111111';
 dept_id uuid:='dddddddd-3333-4333-8333-333333333333';
 brand_memory_id uuid:='22222222-ffff-4fff-8fff-ffffffffffff';
 client_memory_id uuid:='33333333-ffff-4fff-8fff-ffffffffffff';
 requester uuid:='22222222-2222-4222-8222-222222222222';
 owner uuid:='33333333-3333-4333-8333-333333333333';
 request_one uuid:='11111111-7777-4777-8777-777777777777';
 request_two uuid:='22222222-7777-4777-8777-777777777777';
 history jsonb; preview jsonb; result jsonb;
begin
 perform set_config('request.jwt.claim.sub',requester::text,true);
 begin
   perform public.get_promoted_ai_memory_history(org);
   raise exception 'Non-owner read promoted history';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 history:=public.get_promoted_ai_memory_history(org);
 if jsonb_array_length(history->'department')<>1
   or jsonb_array_length(history->'client_brand')<>2 then
   raise exception 'Owner promotion history failed: %',history; end if;
 preview:=public.preview_promoted_ai_memory_purge(org,'department',dept_id);
 if preview->>'status'<>'retired'
   or preview->>'statement'<>'Check hierarchy for every visual variant' then
   raise exception 'Revoked department history preview failed: %',preview; end if;
 begin
   perform public.purge_promoted_ai_memory(org,'department',dept_id,request_one,
     repeat('0',64),'PURGE','Owner requested scoped memory erasure');
   raise exception 'Stale department fingerprint accepted';
 exception when sqlstate '40001' then null;
 end;
 perform set_config('request.jwt.claim.sub',requester::text,true);
 begin
   perform public.purge_promoted_ai_memory(org,'department',dept_id,request_one,
     preview->>'fingerprint','PURGE','Owner requested scoped memory erasure');
   raise exception 'Non-owner promoted purge accepted';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 result:=public.purge_promoted_ai_memory(org,'department',dept_id,request_one,
   preview->>'fingerprint','PURGE','Owner requested scoped memory erasure');
 if result->>'idempotent_replay'<>'false'
   or exists(select 1 from public.ai_department_memory where id=dept_id)
   or exists(select 1 from private.ai_department_memory_decisions where memory_id=dept_id) then
   raise exception 'Department history not fully purged'; end if;
 result:=public.purge_promoted_ai_memory(org,'department',dept_id,request_one,
   preview->>'fingerprint','PURGE','Owner requested scoped memory erasure');
 if result->>'idempotent_replay'<>'true' then raise exception 'Department purge replay failed'; end if;
 begin
   perform public.purge_promoted_ai_memory(org,'department',dept_id,request_one,
     repeat('0',64),'PURGE','Owner requested scoped memory erasure');
   raise exception 'Different preview replay accepted';
 exception when sqlstate '23505' then null;
 end;
 preview:=public.preview_promoted_ai_memory_purge(org,'client_brand',brand_memory_id);
 if preview->>'statement' is not null then raise exception 'Client-brand preview copied source text'; end if;
 result:=public.purge_promoted_ai_memory(org,'client_brand',brand_memory_id,request_two,
   preview->>'fingerprint','PURGE','Owner requested scoped memory erasure');
 if result->>'idempotent_replay'<>'false'
   or exists(select 1 from public.ai_client_brand_memory where id=brand_memory_id)
   or exists(select 1 from private.ai_client_brand_memory_decisions where memory_id=brand_memory_id)
   or (select count(*) from public.ai_client_brand_memory where id=client_memory_id)<>1 then
   raise exception 'Client-brand purge crossed records'; end if;
 if (select count(*) from private.ai_promoted_memory_purges)<>2
   or exists(select 1 from private.ai_promoted_memory_purges where length(reason_sha256)<>64)
   or exists(select 1 from information_schema.columns where table_schema='private'
     and table_name='ai_promoted_memory_purges' and column_name='reason')
   or has_table_privilege('authenticated','private.ai_promoted_memory_purges','SELECT')
   or has_function_privilege('anon','public.purge_promoted_ai_memory(uuid,text,uuid,uuid,text,text,text)','EXECUTE') then
   raise exception 'Promoted purge tombstone or ACL failed'; end if;
end;
$$;
select 'isolated promoted memory retention checks passed' as result;
