-- P9 proposal execution metadata verifier. This script always rolls back.
begin;

create temporary table p9_proposal_execution_metadata_checks (
  check_name text primary key,
  passed boolean not null,
  detail text not null
) on commit drop;

do $verify$
declare
  v_proposal regprocedure :=
    'public.save_department_chat_proposal_with_execution_metadata(uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint,uuid,text,text[],text[])'::regprocedure;
  v_conversation regprocedure :=
    'public.save_department_chat_conversation_proposal_with_execution_metadata(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb,jsonb,jsonb,uuid[],text,uuid,text,uuid,text,text,integer,integer,integer,bigint,uuid,text,text[],text[])'::regprocedure;
  v_helper regprocedure :=
    'private.apply_department_chat_execution_metadata(jsonb,uuid,uuid,text,text,text[],text[])'::regprocedure;
  v_definition text;
  v_function regprocedure;
begin
  foreach v_function in array array[v_proposal, v_conversation] loop
    if (select prosecdef from pg_proc where oid = v_function)
       or exists (
         select 1
         from pg_proc procedure
         cross join lateral aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) privilege
         where procedure.oid = v_function
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Proposal execution metadata RPC ACL invalid: %', v_function;
    end if;
  end loop;
  insert into p9_proposal_execution_metadata_checks values (
    'service_rpc_acl', true,
    'Both public wrappers are SECURITY INVOKER and executable only by service_role.'
  );

  if exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(coalesce(
      procedure.proacl, acldefault('f', procedure.proowner)
    )) privilege
    where procedure.oid = v_helper
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
  ) or not has_function_privilege('service_role', v_helper, 'EXECUTE')
    or (select prosecdef from pg_proc where oid = v_helper) then
    raise exception 'Private execution metadata helper ACL invalid';
  end if;
  insert into p9_proposal_execution_metadata_checks values (
    'private_helper_acl', true,
    'The fixed-search-path helper is SECURITY INVOKER and unavailable to browser roles.'
  );

  v_definition := lower(pg_get_functiondef(v_proposal));
  if position('save_department_chat_proposal_with_model' in v_definition) = 0
     or position('save_department_chat_proposal(' in v_definition) = 0
     or position('apply_department_chat_execution_metadata' in v_definition) = 0 then
    raise exception 'Non-conversation wrapper does not preserve both canonical save paths';
  end if;
  v_definition := lower(pg_get_functiondef(v_conversation));
  if position('save_department_chat_conversation_proposal_with_model' in v_definition) = 0
     or position('save_department_chat_conversation_proposal(' in v_definition) = 0
     or position('apply_department_chat_execution_metadata' in v_definition) = 0 then
    raise exception 'Conversation wrapper does not preserve both canonical save paths';
  end if;
  insert into p9_proposal_execution_metadata_checks values (
    'canonical_atomic_wrappers', true,
    'Each wrapper calls the existing canonical proposal function and binds telemetry before its transaction returns.'
  );

  v_definition := lower(pg_get_functiondef(v_helper));
  if position('update public.ai_runs' in v_definition) = 0
     or position('selected_model_id' in v_definition) = 0
     or position('actual_model_id' in v_definition) = 0
     or position('requested_tools' in v_definition) = 0
     or position('executed_tools' in v_definition) = 0
     or position('organization_id = p_organization_id' in v_definition) = 0
     or position('department_chat_model_configuration_id is not distinct from p_model_configuration_id' in v_definition) = 0
     or position('context_manifest ?& array[' in v_definition) = 0
     or position('jsonb_build_object(' in v_definition) = 0
     or position(') = v_execution_metadata' in v_definition) = 0
     or position('context_manifest @> v_execution_metadata' in v_definition) <> 0
     or position('v_updated <> 1' in v_definition) = 0 then
    raise exception 'Execution metadata helper does not fail closed on the exact AI run';
  end if;
  insert into p9_proposal_execution_metadata_checks values (
    'exact_run_metadata_contract', true,
    'Selected and actual models plus requested/executed tool arrays update exactly one tenant/configuration-bound AI run, and any replay must match every telemetry field exactly.'
  );
end;
$verify$;

table p9_proposal_execution_metadata_checks;

do $assert$
begin
  if exists (select 1 from p9_proposal_execution_metadata_checks where not passed)
     or (select count(*) from p9_proposal_execution_metadata_checks) <> 4 then
    raise exception 'P9 proposal execution metadata verification failed';
  end if;
end;
$assert$;

rollback;
