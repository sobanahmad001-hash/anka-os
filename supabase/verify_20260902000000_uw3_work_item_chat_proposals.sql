-- UW3 rollback-safe verification. Run only after the UW3 migration is applied.
-- This transaction creates one representative chat-proposed work item and rolls it back.

begin;

create temporary table uw3_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_engagement public.engagements;
  v_actor_id uuid;
  v_work_item public.work_items;
begin
  select engagement.* into v_engagement
  from public.engagements engagement
  where exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = engagement.organization_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  )
  limit 1;

  if not found then
    insert into uw3_runtime_checks values
      ('chat_proposal_provenance_persisted', false),
      ('creation_event_records_provenance', false);
    return;
  end if;

  select membership.user_id into v_actor_id
  from public.organization_memberships membership
  where membership.organization_id = v_engagement.organization_id
    and membership.member_kind = 'team'
    and membership.status = 'active'
  limit 1;

  select * into v_work_item
  from public.save_work_item(
    null, v_engagement.id, 'UW3 chat proposal verification',
    'Rollback-only verifier for AI chat provenance.', 'task', 'medium',
    'not_started', null, null, null, null, null, null, null, 0, null,
    v_actor_id, 'ai_chat_proposal'
  );

  insert into uw3_runtime_checks values (
    'chat_proposal_provenance_persisted',
    v_work_item.created_via = 'ai_chat_proposal'
  );

  insert into uw3_runtime_checks values (
    'creation_event_records_provenance',
    exists (
      select 1 from public.engagement_events event
      where event.engagement_id = v_engagement.id
        and event.event_type = 'work_item_created'
        and event.payload ->> 'record_id' = v_work_item.id::text
        and event.payload ->> 'created_via' = 'ai_chat_proposal'
    )
  );
end;
$$;

select jsonb_build_object(
  'created_via_column_default_and_not_null', (
    select column_default = '''manual''::text' and is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'work_items'
      and column_name = 'created_via'
  ),
  'created_via_check_constraint', (
    select pg_get_constraintdef(constraint.oid)
    from pg_constraint constraint
    where constraint.conrelid = 'public.work_items'::regclass
      and constraint.conname = 'work_items_created_via_check'
  ) like '%ai_chat_proposal%',
  'save_work_item_is_service_role_only',
    has_function_privilege(
      'service_role',
      'public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)',
      'EXECUTE'
    )
