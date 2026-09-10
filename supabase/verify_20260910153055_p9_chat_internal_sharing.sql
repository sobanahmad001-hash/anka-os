-- P9-CHAT-2 rollback-only verifier. Run after the migration in a disposable database.
begin;

do $$
declare
  v_definition text;
  v_function regprocedure;
begin
  if not exists (
    select 1 from pg_class
    where oid = 'public.department_chat_conversation_shares'::regclass and relrowsecurity
  ) then raise exception 'share_rls_not_enabled'; end if;

  if has_table_privilege('anon', 'public.department_chat_conversation_shares', 'SELECT')
     or has_table_privilege('authenticated', 'public.department_chat_conversation_shares', 'INSERT')
     or has_table_privilege('authenticated', 'public.department_chat_conversation_shares', 'UPDATE')
     or has_table_privilege('authenticated', 'public.department_chat_conversation_shares', 'DELETE')
     or not has_table_privilege('authenticated', 'public.department_chat_conversation_shares', 'SELECT')
  then raise exception 'share_browser_acl_not_read_only'; end if;

  select pg_get_constraintdef(oid) into v_definition
  from pg_constraint
  where conrelid = 'public.ai_runs'::regclass
    and conname = 'ai_runs_department_chat_conversation_fkey';
  if lower(v_definition) not like '%department_chat_conversation_owner_id%'
     or lower(v_definition) like '%engagement_id, user_id)%' then
    raise exception 'ai_run_actor_owner_separation_missing';
  end if;

  select pg_get_constraintdef(oid) into v_definition
  from pg_constraint
  where conrelid = 'public.department_chat_proposals'::regclass
    and conname = 'department_chat_proposals_conversation_scope_fkey';
  if lower(v_definition) not like '%conversation_owner_id%'
     or lower(v_definition) like '%department_id, proposer_id)%' then
    raise exception 'proposal_actor_owner_separation_missing';
  end if;

  select pg_get_expr(polqual, polrelid) into v_definition
  from pg_policy
  where polrelid = 'public.ai_runs'::regclass
    and polname = 'Users can read own standalone AI runs';
  if lower(coalesce(v_definition, '')) not like '%department_chat_conversation_id is null%' then
    raise exception 'legacy_own_run_revocation_bypass_present';
  end if;

  select pg_get_expr(polqual, polrelid) into v_definition
  from pg_policy
  where polrelid = 'public.department_chat_conversations'::regclass
    and polname = 'Owners and active recipients can read Department Chat conversations';
  if lower(coalesce(v_definition, '')) not like '%recipient_id%'
     or lower(v_definition) not like '%revoked_at is null%' then
    raise exception 'conversation_revocable_read_policy_missing';
  end if;

  select pg_get_expr(polqual, polrelid) into v_definition
  from pg_policy
  where polrelid = 'public.ai_runs'::regclass
    and polname = 'Active participants can read linked Department Chat AI runs';
  if lower(coalesce(v_definition, '')) not like '%department_chat_conversation_owner_id%'
     or lower(v_definition) not like '%recipient_id%'
     or lower(v_definition) not like '%revoked_at is null%' then
    raise exception 'linked_run_participant_policy_missing';
  end if;

  select pg_get_expr(polqual, polrelid) into v_definition
  from pg_policy
  where polrelid = 'public.department_chat_proposals'::regclass
    and polname = 'Proposers, leaders, and active recipients can read Department Chat proposals';
  if lower(coalesce(v_definition, '')) not like '%conversation_id is null%'
     or lower(v_definition) not like '%conversation_owner_id%'
     or lower(v_definition) not like '%recipient_id%'
     or lower(v_definition) not like '%conversation_id is null%' then
    raise exception 'linked_proposal_participant_policy_missing';
  end if;

  foreach v_function in array array[
    'public.can_access_department_chat_conversation(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure,
    'public.set_department_chat_conversation_shares(uuid,uuid,uuid,uuid,text,uuid,uuid[])'::regprocedure
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not has_function_privilege('service_role', v_function, 'EXECUTE')
    then raise exception 'sharing_rpc_browser_execute_not_revoked: %', v_function; end if;
    if (select prosecdef from pg_proc where oid = v_function)
    then raise exception 'sharing_rpc_must_be_security_invoker: %', v_function; end if;
  end loop;

  select pg_get_functiondef(
    'public.set_department_chat_conversation_shares(uuid,uuid,uuid,uuid,text,uuid,uuid[])'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%conversation.owner_id = p_actor_id%'
     or lower(v_definition) not like '%private.is_current_department_chat_contributor%'
     or lower(v_definition) not like '%set revoked_at = now()%'
     or lower(v_definition) not like '%on conflict (conversation_id, recipient_id) do update%' then
    raise exception 'creator_selected_revocation_contract_missing';
  end if;

  select pg_get_functiondef(
    'public.begin_department_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%for update%'
     or lower(v_definition) not like '%v_message.author_id <> p_actor_id%'
     or lower(v_definition) not like '%v_message.body <> btrim(p_prompt)%'
     or lower(v_definition) not like '%next_sequence = next_sequence + 1%' then
    raise exception 'collaborative_turn_concurrency_contract_missing';
  end if;

  select pg_get_functiondef(
    'public.mark_department_chat_turn_dispatched(uuid,uuid,uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%require_accessible_department_chat_conversation%'
     or lower(v_definition) not like '%message.author_id = p_actor_id%'
     or lower(v_definition) not like '%provider_dispatched_at = clock_timestamp()%' then
    raise exception 'collaborative_dispatch_contract_missing';
  end if;

  select pg_get_functiondef(
    'public.mark_department_chat_turn_unknown(uuid,uuid,uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%message.author_id = p_actor_id%'
     or lower(v_definition) not like '%provider_dispatched_at is null%'
     or lower(v_definition) not like '%error_code = ''outcome_unknown''%' then
    raise exception 'collaborative_unknown_outcome_contract_missing';
  end if;

  select pg_get_functiondef(
    'public.expire_department_chat_pending_turns(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%author_id = p_actor_id%'
     or lower(v_definition) not like '%then ''interrupted'' else ''outcome_unknown''%' then
    raise exception 'collaborative_expiry_contract_missing';
  end if;

  select pg_get_functiondef(
    'public.save_department_chat_conversation_proposal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%message.author_id = p_actor_id%'
     or lower(v_definition) not like '%department_chat_conversation_owner_id = v_conversation.owner_id%'
     or lower(v_definition) not like '%conversation_owner_id = v_conversation.owner_id%' then
    raise exception 'collaborative_attribution_link_contract_missing';
  end if;

  select pg_get_functiondef('private.protect_department_chat_proposal()'::regprocedure)
  into v_definition;
  if lower(v_definition) not like '%conversation_owner_id%'
     or lower(v_definition) not like '%department chat proposal source data is immutable%' then
    raise exception 'proposal_owner_immutability_missing';
  end if;
  if has_function_privilege('anon', 'private.protect_department_chat_proposal()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.protect_department_chat_proposal()', 'EXECUTE')
  then raise exception 'proposal_protector_execute_not_revoked'; end if;
end;
$$;

rollback;
