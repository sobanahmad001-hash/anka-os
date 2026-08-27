select jsonb_build_object(
  'artifact_columns_unchanged', (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'artifacts'
  ) = array[
    'id', 'organization_id', 'brand_id', 'engagement_id',
    'engagement_stage_instance_id', 'artifact_type', 'title', 'created_by',
    'created_at'
  ]::text[],
  'all_seven_artifact_types_allowed', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.artifacts'::regclass
      and conname = 'artifacts_artifact_type_check'
  ) like all (array[
    '%discovery%', '%vision%', '%audience%', '%channel_strategy%',
    '%campaign_brief%', '%measurement_plan%', '%marketing_report%'
  ]),
  'all_eight_event_types_allowed', (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.engagement_events'::regclass
      and conname = 'engagement_events_event_type_check'
  ) like all (array[
    '%engagement_created%', '%service_activated%', '%blueprint_instantiated%',
    '%artifact_version_created%', '%artifact_approved%',
    '%design_direction_released%', '%campaign_created%', '%campaign_updated%'
  ]),
  'artifact_rls_still_enabled', (
    select relrowsecurity from pg_class where oid = 'public.artifacts'::regclass
  ),
  'engagement_event_rls_still_enabled', (
    select relrowsecurity from pg_class where oid = 'public.engagement_events'::regclass
  )
);
