select jsonb_build_object(
  'stage_notes_added_without_new_tracking_table', (
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'engagement_stage_instances'
        and column_name = 'team_notes'
        and is_nullable = 'NO'
    ) and not exists (
      select 1 from information_schema.tables
      where table_schema = 'public'
        and table_name in ('development_tasks', 'development_tickets', 'development_repositories')
    )
  ),
  'four_development_statuses_allowed', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.engagement_stage_instances'::regclass
      and conname = 'engagement_stage_instances_status_check'
  ) like all (array['%not_started%', '%in_progress%', '%blocked%', '%complete%']),
  'development_artifact_types_added', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.artifacts'::regclass
      and conname = 'artifacts_artifact_type_check'
  ) like all (array['%technical_brief%', '%launch_checklist%']),
  'stage_event_added_without_removing_existing_events', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.engagement_events'::regclass
      and conname = 'engagement_events_event_type_check'
  ) like all (array[
    '%engagement_created%', '%service_activated%', '%blueprint_instantiated%',
    '%artifact_version_created%', '%artifact_approved%',
    '%design_direction_released%', '%campaign_created%', '%campaign_updated%',
    '%artifact_draft_proposed_via_chat%', '%stage_status_changed%'
  ]),
  'existing_rls_boundaries_preserved', (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.engagement_stage_instances'::regclass,
      'public.artifacts'::regclass,
      'public.artifact_versions'::regclass,
      'public.engagement_events'::regclass
    )
  ),
  'write_functions_are_service_role_only',
    has_function_privilege('service_role', 'public.update_development_stage_tracking(uuid,text,text,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_development_stage_tracking(uuid,text,text,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.update_development_stage_tracking(uuid,text,text,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.save_development_artifact_version(uuid,uuid,uuid,text,text,jsonb,text,text,boolean,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.save_development_artifact_version(uuid,uuid,uuid,text,text,jsonb,text,text,boolean,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.save_development_artifact_version(uuid,uuid,uuid,text,text,jsonb,text,text,boolean,uuid)', 'EXECUTE')
);
