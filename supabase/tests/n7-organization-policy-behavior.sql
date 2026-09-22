do $$
declare org uuid:='11111111-1111-4111-8111-111111111111';
 requester uuid:='22222222-2222-4222-8222-222222222222';
 reviewer uuid:='33333333-3333-4333-8333-333333333333';
 outsider uuid:='44444444-4444-4444-8444-444444444444';
 first_id uuid:='11111111-1111-4111-8111-aaaaaaaaaaaa';
 second_id uuid:='22222222-2222-4222-8222-aaaaaaaaaaaa';
 expired_id uuid:='33333333-3333-4333-8333-aaaaaaaaaaaa';
 result jsonb;
begin
 perform set_config('request.jwt.claim.sub',requester::text,true);
 result:=public.propose_organization_ai_policy(org,first_id,
   'Use an explicit human review for client-facing releases.',
   'Agency release policy proposed from the internal quality process.');
 if result->>'status'<>'candidate' then raise exception 'Policy candidate not saved'; end if;
 result:=public.propose_organization_ai_policy(org,first_id,
   'Use an explicit human review for client-facing releases.',
   'Agency release policy proposed from the internal quality process.');
 if result->>'idempotent_replay'<>'true' then raise exception 'Policy replay failed'; end if;
 begin
   perform public.review_organization_ai_policy(org,first_id,
     '44444444-4444-4444-8444-aaaaaaaaaaaa','confirm','Self review');
   raise exception 'Team member reviewed policy';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 result:=public.review_organization_ai_policy(org,first_id,
   '44444444-4444-4444-8444-aaaaaaaaaaaa','confirm','Owner verified governing policy');
 if result->>'status'<>'confirmed' then raise exception 'Independent policy approval failed'; end if;
 result:=public.get_organization_ai_policy(org);
 if jsonb_array_length(result->'confirmed')<>1
   or result->'confirmed'->0->>'id'<>first_id::text then
   raise exception 'Confirmed organization policy missing'; end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
   perform public.get_organization_ai_policy(org);
   raise exception 'Cross-tenant policy read accepted';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('request.jwt.claim.sub',requester::text,true);
 perform public.propose_organization_ai_policy(org,second_id,
   'Require a separate internal reviewer before any client-facing release.',
   'Corrected agency policy wording after the approved quality review.',first_id);
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 perform public.review_organization_ai_policy(org,second_id,
   '55555555-5555-4555-8555-aaaaaaaaaaaa','confirm','Owner approved correction');
 result:=public.get_organization_ai_policy(org);
 if jsonb_array_length(result->'confirmed')<>1
   or result->'confirmed'->0->>'id'<>second_id::text
   or (select status from public.ai_organization_policy_memory where id=first_id)<>'superseded'
   or (select review_evidence from public.ai_organization_policy_memory where id=first_id)<>'Owner verified governing policy' then
   raise exception 'Correction did not preserve prior policy decision'; end if;
 perform set_config('request.jwt.claim.sub',requester::text,true);
 perform public.propose_organization_ai_policy(org,expired_id,
   'Unconfirmed draft with an expired review window.',
   'Internal draft source basis that should expire before review.');
 update public.ai_organization_policy_memory set candidate_expires_at=clock_timestamp()-interval '1 second'
   where id=expired_id;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 result:=public.get_organization_ai_policy(org);
 if jsonb_array_length(result->'candidates')<>0 then raise exception 'Expired candidate still available'; end if;
 begin
   perform public.review_organization_ai_policy(org,expired_id,
     '66666666-6666-4666-8666-aaaaaaaaaaaa','confirm','Late review');
   raise exception 'Expired policy approved';
 exception when sqlstate '55000' then null;
 end;
 update public.ai_organization_policy_memory set statement='Tampered policy' where id=second_id;
 result:=public.get_organization_ai_policy(org);
 if jsonb_array_length(result->'confirmed')<>0 then raise exception 'Changed policy source reused'; end if;
 result:=public.review_organization_ai_policy(org,second_id,
   '77777777-7777-4777-8777-aaaaaaaaaaaa','retire','Retire changed policy');
 if result->>'status'<>'retired' then raise exception 'Policy retirement failed'; end if;
 if has_table_privilege('authenticated','public.ai_organization_policy_memory','SELECT')
   or has_table_privilege('authenticated','public.ai_organization_policy_memory','INSERT')
   or has_table_privilege('authenticated','private.ai_organization_policy_decisions','SELECT')
   or has_function_privilege('anon','public.get_organization_ai_policy(uuid)','EXECUTE') then
   raise exception 'Policy grant leaked'; end if;
end;
$$;
select 'isolated organization policy checks passed' as result;
