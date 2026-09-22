do $$
declare
 org uuid:='11111111-1111-4111-8111-111111111111';
 source_project uuid:='55555555-5555-4555-8555-555555555555';
 source_comment uuid:='11111111-eeee-4eee-8eee-eeeeeeeeeeee';
 source_memory uuid:='11111111-ffff-4fff-8fff-ffffffffffff';
 brand_memory uuid:='22222222-ffff-4fff-8fff-ffffffffffff';
 client_memory uuid:='33333333-ffff-4fff-8fff-ffffffffffff';
 requester uuid:='22222222-2222-4222-8222-222222222222';
 reviewer uuid:='33333333-3333-4333-8333-333333333333';
 result jsonb;
begin
 perform set_config('request.jwt.claim.sub',requester::text,true);
 perform public.propose_project_ai_memory(org,source_project,source_memory,source_comment,
   'Use approved brand terminology');
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 perform public.review_project_ai_memory(org,source_project,source_memory,
   '44444444-ffff-4fff-8fff-ffffffffffff','confirm','Verified approved source');
 perform set_config('request.jwt.claim.sub',requester::text,true);
 result:=public.propose_client_brand_ai_memory(org,source_project,brand_memory,source_memory,'brand');
 if result->>'status'<>'candidate' then raise exception 'Brand candidate failed'; end if;
 begin
   perform public.review_client_brand_ai_memory(org,source_project,brand_memory,
     '55555555-ffff-4fff-8fff-ffffffffffff','confirm','Self review');
   raise exception 'Self review accepted';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 result:=public.review_client_brand_ai_memory(org,source_project,brand_memory,
   '55555555-ffff-4fff-8fff-ffffffffffff','confirm','Independent brand review');
 if result->>'status'<>'confirmed' then raise exception 'Brand confirm failed'; end if;
 result:=public.get_client_brand_ai_memory(org,'11111111-cccc-4ccc-8ccc-cccccccccccc');
 if jsonb_array_length(result->'confirmed')<>1
   or result->'confirmed'->0->>'scope_kind'<>'brand' then
   raise exception 'Same-brand reuse failed: %',result; end if;
 result:=public.get_client_brand_ai_memory(org,'22222222-cccc-4ccc-8ccc-cccccccccccc');
 if jsonb_array_length(result->'confirmed')<>0 then raise exception 'Brand crossed to sibling brand'; end if;
 perform set_config('request.jwt.claim.sub',requester::text,true);
 perform public.propose_client_brand_ai_memory(org,source_project,client_memory,source_memory,'client');
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 perform public.review_client_brand_ai_memory(org,source_project,client_memory,
   '66666666-ffff-4fff-8fff-ffffffffffff','confirm','Independent client review');
 result:=public.get_client_brand_ai_memory(org,'22222222-cccc-4ccc-8ccc-cccccccccccc');
 if jsonb_array_length(result->'confirmed')<>1
   or result->'confirmed'->0->>'scope_kind'<>'client' then
   raise exception 'Same-client reuse failed: %',result; end if;
 result:=public.get_client_brand_ai_memory(org,'33333333-cccc-4ccc-8ccc-cccccccccccc');
 if jsonb_array_length(result->'confirmed')<>0 then raise exception 'Cross-client leak'; end if;
 perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
 begin
   perform public.get_client_brand_ai_memory(org,source_project);
   raise exception 'Cross-tenant read accepted';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 update public.comments set content='Source changed' where id=source_comment;
 result:=public.get_client_brand_ai_memory(org,'11111111-cccc-4ccc-8ccc-cccccccccccc');
 if jsonb_array_length(result->'confirmed')<>0 then raise exception 'Changed source reused'; end if;
 if (select count(*) from public.ai_client_brand_memory)<>2 then
   raise exception 'Protected promotion history lost'; end if;
 if has_table_privilege('authenticated','public.ai_client_brand_memory','SELECT')
   or has_table_privilege('authenticated','public.ai_client_brand_memory','INSERT')
   or has_table_privilege('authenticated','private.ai_client_brand_memory_decisions','SELECT') then
   raise exception 'Direct table grant leaked'; end if;
end;
$$;
select 'isolated client and brand promotion checks passed' as result;
