-- Rollback-only P9 conversation-search schema, ACL, and privacy verification.
begin;

do $$
declare v_definition text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'department_chat_conversations'
      and column_name = 'search_vector' and is_generated = 'ALWAYS'
  ) then raise exception 'conversation_search_vector_missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'department_chat_messages'
      and column_name = 'search_vector' and is_generated = 'ALWAYS'
  ) then raise exception 'message_search_vector_missing'; end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'idx_department_chat_conversations_search'
      and indexdef ilike '%using gin%'
  ) then raise exception 'conversation_search_index_missing'; end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'idx_department_chat_messages_search'
      and indexdef ilike '%using gin%'
  ) then raise exception 'message_search_index_missing'; end if;

  select pg_get_functiondef(
    'public.search_department_chat_conversations(uuid,uuid,uuid,text,uuid,text,boolean,integer,timestamptz,uuid)'::regprocedure
  ) into v_definition;
  if v_definition not ilike '%private.is_current_department_chat_contributor%'
     or v_definition not ilike '%share.revoked_at is null%'
     or v_definition not ilike '%conversation.organization_id = p_organization_id%'
     or v_definition not ilike '%conversation.project_id = p_project_id%'
     or v_definition not ilike '%conversation.engagement_id = p_engagement_id%'
     or v_definition not ilike '%conversation.department_id = p_department_id%'
  then raise exception 'search_current_access_filter_missing'; end if;
  if v_definition ilike '%ts_headline%'
     or v_definition ilike '%message.body%'
     or v_definition ilike '%count(%'
  then raise exception 'search_result_leak_contract_failed'; end if;
  if v_definition not ilike '%p_limit not between 1 and 50%'
     or v_definition not ilike '%order by conversation.last_activity_at desc, conversation.id%'
     or v_definition not ilike '%conversation.id > p_before_id%'
  then raise exception 'search_keyset_pagination_contract_missing'; end if;

  if has_function_privilege('public', 'public.search_department_chat_conversations(uuid,uuid,uuid,text,uuid,text,boolean,integer,timestamptz,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.search_department_chat_conversations(uuid,uuid,uuid,text,uuid,text,boolean,integer,timestamptz,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.search_department_chat_conversations(uuid,uuid,uuid,text,uuid,text,boolean,integer,timestamptz,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.search_department_chat_conversations(uuid,uuid,uuid,text,uuid,text,boolean,integer,timestamptz,uuid)', 'EXECUTE')
  then raise exception 'search_function_acl_invalid'; end if;
end;
$$;

rollback;
