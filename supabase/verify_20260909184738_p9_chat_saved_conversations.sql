-- P9-CHAT-1 rollback-only verifier. Run after the migration in a disposable database.
begin;

do $$
declare
  v_definition text;
begin
  if not exists (
    select 1 from pg_class
    where oid = 'public.department_chat_conversations'::regclass and relrowsecurity
  ) then raise exception 'conversation_rls_not_enabled'; end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.department_chat_messages'::regclass and relrowsecurity
  ) then raise exception 'message_rls_not_enabled'; end if;

  if has_table_privilege('anon', 'public.department_chat_conversations', 'select')
     or has_table_privilege('anon', 'public.department_chat_messages', 'select')
     or has_table_privilege('authenticated', 'public.department_chat_conversations', 'insert')
     or has_table_privilege('authenticated', 'public.department_chat_conversations', 'update')
     or has_table_privilege('authenticated', 'public.department_chat_conversations', 'delete')
     or has_table_privilege('authenticated', 'public.department_chat_messages', 'insert')
     or has_table_privilege('authenticated', 'public.department_chat_messages', 'update')
     or has_table_privilege('authenticated', 'public.department_chat_messages', 'delete')
  then raise exception 'browser_acl_not_read_only'; end if;

  select pg_get_expr(policy.polqual, policy.polrelid)
  into v_definition
  from pg_policy policy
  where policy.polrelid = 'public.department_chat_conversations'::regclass
    and policy.polname = 'Owners can read Department Chat conversations';
  if v_definition not like '%owner_id = ( SELECT auth.uid() AS uid)%'
     and v_definition not like '%owner_id = ( SELECT auth.uid()%' then
    raise exception 'conversation_owner_policy_missing';
  end if;

  select pg_get_expr(policy.polqual, policy.polrelid)
  into v_definition
  from pg_policy policy
  where policy.polrelid = 'public.ai_runs'::regclass
    and policy.polname = 'Leaders can audit organization AI runs';
  if v_definition not like '%department_chat_conversation_id IS NULL%' then
    raise exception 'private_run_leadership_exclusion_missing';
  end if;

  select pg_get_expr(policy.polqual, policy.polrelid)
  into v_definition
  from pg_policy policy
  where policy.polrelid = 'public.department_chat_proposals'::regclass
    and policy.polname = 'Proposers and leaders can read Department Chat proposals';
  if v_definition not like '%conversation_id IS NULL%' then
    raise exception 'private_proposal_leadership_exclusion_missing';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.create_department_chat_conversation(uuid,uuid,uuid,text,uuid,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.begin_department_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.save_department_chat_conversation_proposal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)',
    'execute'
  ) then raise exception 'conversation_rpc_browser_execute_not_revoked'; end if;

  select pg_get_functiondef(
    'public.begin_department_chat_turn(uuid,uuid,uuid,uuid,text,uuid,uuid,text)'::regprocedure
  ) into v_definition;
  if v_definition not like '%FOR UPDATE%'
     or v_definition not like '%client_request_id = p_client_request_id%'
     or v_definition not like '%next_sequence = next_sequence + 1%' then
    raise exception 'turn_concurrency_contract_missing';
  end if;

  select pg_get_functiondef(
    'public.save_department_chat_conversation_proposal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint)'::regprocedure
  ) into v_definition;
  if v_definition not like '%public.save_department_chat_proposal(%'
     or v_definition not like '%department_chat_conversation_id = p_conversation_id%'
     or v_definition not like '%conversation_id = p_conversation_id%' then
    raise exception 'atomic_proposal_link_contract_missing';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'department_chat_conversations'
      and column_name in ('quick_task_id', 'quick_task_revision_id')
  ) or exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'department_chat_messages'
      and column_name in ('quick_task_id', 'quick_task_revision_id')
  ) then raise exception 'quick_task_storage_was_reused'; end if;
end;
$$;

rollback;
