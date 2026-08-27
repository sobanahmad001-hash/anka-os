-- Read-only verification for the isolated engagement event vocabulary change.

with event_columns as (
  select array_agg(column_name order by ordinal_position) as names
  from information_schema.columns
  where table_schema = 'public' and table_name = 'engagement_events'
), event_policies as (
  select
    bool_or(policyname = 'Team can read engagement events') as read_policy_unchanged,
    bool_or(
      policyname = 'Team can record engagement events'
      and cmd = 'INSERT'
      and with_check ilike '%actor_id%'
      and with_check ilike '%auth.uid()%'
    ) as actor_insert_policy_unchanged
  from pg_policies
  where schemaname = 'public' and tablename = 'engagement_events'
), event_constraint as (
  select pg_get_constraintdef(constraint_record.oid) as definition
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.engagement_events'::regclass
    and constraint_record.conname = 'engagement_events_event_type_check'
)
select jsonb_build_object(
  'columns_unchanged', event_columns.names = array[
    'id', 'organization_id', 'engagement_id', 'event_type',
    'actor_id', 'payload', 'occurred_at'
  ]::text[],
  'rls_still_enabled', (
    select relation.relrowsecurity
    from pg_class relation
    where relation.oid = 'public.engagement_events'::regclass
  ),
  'read_policy_unchanged', event_policies.read_policy_unchanged,
  'actor_insert_policy_unchanged', event_policies.actor_insert_policy_unchanged,
  'all_six_event_types_allowed', event_constraint.definition ilike all(array[
    '%engagement_created%', '%service_activated%', '%blueprint_instantiated%',
    '%artifact_version_created%', '%artifact_approved%',
    '%design_direction_released%'
  ]),
  'authenticated_grants_unchanged', (
    select bool_and(privilege_type in ('SELECT', 'INSERT'))
      and bool_or(privilege_type = 'SELECT')
      and bool_or(privilege_type = 'INSERT')
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'engagement_events'
      and grantee = 'authenticated'
  )
)
from event_columns, event_policies, event_constraint;
