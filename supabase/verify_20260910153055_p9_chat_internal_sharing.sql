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
    'public.can_access_department_chat_conversation(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into v_definition;
  if lower(v_definition) not like '%private.is_current_department_chat_contributor%'
     or lower(v_definition) like '%public.is_team_organization_member%' then
    raise exception 'service_role_actor_membership_contract_missing';
  end if;


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


-- Exercise the real service-role call path used by the Edge function. In
-- particular, auth.uid() is intentionally null while p_actor_id is explicit.
do $$
declare
  v_organization_id constant uuid := '10000000-0000-4000-8000-000000000001';
  v_owner_id constant uuid := '20000000-0000-4000-8000-000000000001';
  v_recipient_id constant uuid := '20000000-0000-4000-8000-000000000002';
  v_revoked_id constant uuid := '20000000-0000-4000-8000-000000000003';
  v_suspended_id constant uuid := '20000000-0000-4000-8000-000000000004';
  v_wrong_department_id constant uuid := '20000000-0000-4000-8000-000000000005';
  v_nonmember_id constant uuid := '20000000-0000-4000-8000-000000000006';
  v_legacy_client_id uuid;
  v_agency_client_id uuid;
  v_brand_id uuid;
  v_project_id uuid;
  v_engagement_id uuid;
  v_service_id uuid;
  v_conversation_id uuid;
begin
  insert into public.organizations (id, name, slug, status)
  values (v_organization_id, 'P9 CHAT-2 access verifier', 'p9-chat-2-access-verifier', 'active');

  insert into auth.users (id) values
    (v_owner_id), (v_recipient_id), (v_revoked_id), (v_suspended_id),
    (v_wrong_department_id), (v_nonmember_id);

  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values
    (v_organization_id, v_owner_id, 'team', 'contributor', 'content', 'active'),
    (v_organization_id, v_recipient_id, 'team', 'contributor', 'content', 'active'),
    (v_organization_id, v_revoked_id, 'team', 'contributor', 'content', 'active'),
    (v_organization_id, v_suspended_id, 'team', 'contributor', 'content', 'suspended'),
    (v_organization_id, v_wrong_department_id, 'team', 'contributor', 'design', 'active');

  insert into public.clients (name, company, owner_id, organization_id)
  values ('P9 CHAT-2 access verifier', 'P9', v_owner_id, v_organization_id)
  returning id into v_legacy_client_id;

  insert into public.agency_clients (
    organization_id, legacy_client_id, canonical_client_id, name, owner_id, created_by
  ) values (
    v_organization_id, v_legacy_client_id, v_legacy_client_id,
    'P9 CHAT-2 access verifier', v_owner_id, v_owner_id
  ) returning id into v_agency_client_id;

  insert into public.brands (organization_id, client_id, name, is_default, created_by)
  values (v_organization_id, v_agency_client_id, 'P9 CHAT-2 access verifier', true, v_owner_id)
  returning id into v_brand_id;

  insert into public.projects (
    name, department_id, status, owner_id, organization_id, client_id, engagement_type
  ) values (
    'P9 CHAT-2 access verifier', 'content', 'active', v_owner_id,
    v_organization_id, v_legacy_client_id, 'project'
  ) returning id into v_project_id;

  insert into public.engagements (
    organization_id, client_id, brand_id, legacy_project_id, project_id,
    name, engagement_type, status, created_by
  ) values (
    v_organization_id, v_agency_client_id, v_brand_id, v_project_id, v_project_id,
    'P9 CHAT-2 access verifier', 'project', 'active', v_owner_id
  ) returning id into v_engagement_id;

  insert into public.service_catalog (organization_id, department_id, slug, name)
  values (v_organization_id, 'content', 'p9_chat_2_access_verifier', 'P9 CHAT-2 access verifier')
  returning id into v_service_id;

  insert into public.engagement_services (
    organization_id, engagement_id, service_id, status, activated_by
  ) values (v_organization_id, v_engagement_id, v_service_id, 'active', v_owner_id);

  insert into public.department_chat_conversations (
    organization_id, project_id, engagement_id, department_id, owner_id, title
  ) values (
    v_organization_id, v_project_id, v_engagement_id, 'content', v_owner_id,
    'P9 CHAT-2 service-role access verifier'
  ) returning id into v_conversation_id;

  insert into public.department_chat_conversation_shares (
    conversation_id, organization_id, project_id, engagement_id, department_id,
    owner_id, recipient_id, shared_by, revoked_at
  ) values
    (v_conversation_id, v_organization_id, v_project_id, v_engagement_id, 'content',
      v_owner_id, v_recipient_id, v_owner_id, null),
    (v_conversation_id, v_organization_id, v_project_id, v_engagement_id, 'content',
      v_owner_id, v_revoked_id, v_owner_id, clock_timestamp()),
    (v_conversation_id, v_organization_id, v_project_id, v_engagement_id, 'content',
      v_owner_id, v_suspended_id, v_owner_id, null),
    (v_conversation_id, v_organization_id, v_project_id, v_engagement_id, 'content',
      v_owner_id, v_wrong_department_id, v_owner_id, null),
    (v_conversation_id, v_organization_id, v_project_id, v_engagement_id, 'content',
      v_owner_id, v_nonmember_id, v_owner_id, null);

  create temporary table p9_chat_2_access_fixture (
    organization_id uuid, project_id uuid, engagement_id uuid,
    conversation_id uuid, owner_id uuid, recipient_id uuid,
    revoked_id uuid, suspended_id uuid, wrong_department_id uuid, nonmember_id uuid
  ) on commit drop;
  insert into p9_chat_2_access_fixture values (
    v_organization_id, v_project_id, v_engagement_id, v_conversation_id,
    v_owner_id, v_recipient_id, v_revoked_id, v_suspended_id,
    v_wrong_department_id, v_nonmember_id
  );
end;
$$;

grant select on p9_chat_2_access_fixture to service_role;
set local role service_role;

do $$
declare v p9_chat_2_access_fixture%rowtype;
begin
  select * into strict v from p9_chat_2_access_fixture;
  if not public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, v.project_id, v.engagement_id, 'content', v.owner_id
  ) then raise exception 'active_owner_service_role_access_failed'; end if;
  if not public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, v.project_id, v.engagement_id, 'content', v.recipient_id
  ) then raise exception 'active_recipient_service_role_access_failed'; end if;
  if public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, v.project_id, v.engagement_id, 'content', v.revoked_id
  ) then raise exception 'revoked_recipient_service_role_access_allowed'; end if;
  if public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, v.project_id, v.engagement_id, 'content', v.suspended_id
  ) then raise exception 'suspended_recipient_service_role_access_allowed'; end if;
  if public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, v.project_id, v.engagement_id, 'content', v.wrong_department_id
  ) then raise exception 'wrong_department_recipient_service_role_access_allowed'; end if;
  if public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, v.project_id, v.engagement_id, 'content', v.nonmember_id
  ) then raise exception 'nonmember_recipient_service_role_access_allowed'; end if;
  if public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, gen_random_uuid(), v.engagement_id, 'content', v.owner_id
  ) or public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, v.project_id, gen_random_uuid(), 'content', v.owner_id
  ) or public.can_access_department_chat_conversation(
    v.conversation_id, v.organization_id, v.project_id, v.engagement_id, 'design', v.owner_id
  ) or public.can_access_department_chat_conversation(
    v.conversation_id, gen_random_uuid(), v.project_id, v.engagement_id, 'content', v.owner_id
  ) then raise exception 'wrong_context_service_role_access_allowed'; end if;
end;
$$;

reset role;
rollback;
