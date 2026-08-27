-- Anka OS - additive audit vocabulary for artifacts and Design Workshop.
-- Intentionally isolated: this migration changes only the existing event_type
-- CHECK constraint. Columns, RLS, grants, policies, and actor rules are untouched.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.engagement_events
  drop constraint engagement_events_event_type_check;

alter table public.engagement_events
  add constraint engagement_events_event_type_check
  check (event_type in (
    'engagement_created',
    'service_activated',
    'blueprint_instantiated',
    'artifact_version_created',
    'artifact_approved',
    'design_direction_released'
  ));

commit;
