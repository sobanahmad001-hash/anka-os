-- P9 CHAT-3 rollback-only catalog/security verifier. Run after the migration in a disposable database.
begin;

do $$
declare v_definition text; v_function regprocedure;
begin
  if not exists (
    select 1 from storage.buckets where id = 'department-chat-attachments'
      and public = false and file_size_limit = 5242880
      and allowed_mime_types @> array['text/plain', 'text/markdown', 'image/png', 'image/jpeg']::text[]
      and not ('application/pdf' = any(allowed_mime_types))
  ) then raise exception 'attachment_private_bucket_contract_missing'; end if;

  if not exists (select 1 from pg_class where oid = 'public.department_chat_attachments'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.department_chat_message_attachments'::regclass and relrowsecurity)
  then raise exception 'attachment_rls_not_enabled'; end if;

  if has_table_privilege('anon', 'public.department_chat_attachments', 'SELECT')
     or has_table_privilege('authenticated', 'public.department_chat_attachments', 'SELECT')
     or has_table_privilege('authenticated', 'public.department_chat_attachments', 'INSERT')
     or has_table_privilege('authenticated', 'public.department_chat_message_attachments', 'SELECT')
     or not has_table_privilege('service_role', 'public.department_chat_attachments', 'SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'attachment_tables_not_server_only'; end if;

  if not exists (
    select 1 from pg_constraint where conrelid = 'public.department_chat_attachments'::regclass
      and conname = 'department_chat_attachments_paths_check'
  ) or not exists (
    select 1 from pg_constraint where conrelid = 'public.department_chat_attachments'::regclass
      and conname = 'department_chat_attachments_final_state_check'
  ) or not exists (
    select 1 from pg_constraint where conrelid = 'public.department_chat_attachments'::regclass
      and conname = 'department_chat_attachments_extraction_type_check'
  ) then raise exception 'attachment_state_or_identity_constraints_missing'; end if;

  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.department_chat_conversation_shares'::regclass
      and tgname = 'department_chat_share_source_guard' and not tgisinternal
  ) then raise exception 'source_share_guard_missing'; end if;
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.department_chat_messages'::regclass
      and tgname = 'department_chat_attachment_dispatch_guard' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger where tgrelid = 'public.department_chat_messages'::regclass
      and tgname = 'department_chat_attachment_dispatch_marker' and not tgisinternal
  ) then raise exception 'source_dispatch_guards_missing'; end if;

  foreach v_function in array array[
    'public.reserve_department_chat_attachment(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,boolean,boolean,timestamptz)'::regprocedure,
    'public.claim_department_chat_attachment_finalization(uuid,uuid,uuid,uuid,uuid,text,uuid)'::regprocedure,
    'public.finish_department_chat_attachment(uuid,uuid,text,bigint,text,text,text,text)'::regprocedure,
    'public.fail_department_chat_attachment(uuid,uuid,text,text,text)'::regprocedure,
    'public.begin_department_chat_turn_with_attachments(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid[])'::regprocedure
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not has_function_privilege('service_role', v_function, 'EXECUTE')
    then raise exception 'attachment_rpc_acl_invalid: %', v_function; end if;
    if (select prosecdef from pg_proc where oid = v_function)
    then raise exception 'attachment_rpc_must_be_security_invoker: %', v_function; end if;
  end loop;

  select pg_get_functiondef('public.finish_department_chat_attachment(uuid,uuid,text,bigint,text,text,text,text)'::regprocedure)
  into v_definition;
  if lower(v_definition) not like '%for update%'
     or lower(v_definition) not like '%require_accessible_department_chat_conversation%'
  then raise exception 'finalization_reauthorization_missing'; end if;

  select pg_get_functiondef('public.begin_department_chat_turn_with_attachments(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid[])'::regprocedure)
  into v_definition;
  if lower(v_definition) not like '%cardinality(v_ids) > 3%'
     or lower(v_definition) not like '%different attachment manifest%'
     or lower(v_definition) not like '%is_current_department_chat_contributor%'
     or lower(v_definition) not like '%share_with_recipients%'
  then raise exception 'exact_turn_manifest_or_revocation_gate_missing'; end if;

  select pg_get_functiondef('private.guard_department_chat_attachment_dispatch()'::regprocedure)
  into v_definition;
  if lower(v_definition) not like '%sha256_hex <> link.attachment_sha256_hex%'
     or lower(v_definition) not like '%is_current_department_chat_contributor%'
  then raise exception 'dispatch_hash_or_source_revocation_gate_missing'; end if;
end;
$$;

select 'attachment_private_bucket_contract' as check_name, true as passed
union all select 'attachment_server_only_acl', true
union all select 'attachment_exact_manifest_and_hash', true
union all select 'attachment_share_and_dispatch_revocation', true
union all select 'attachment_finalization_reauthorization', true;

rollback;
