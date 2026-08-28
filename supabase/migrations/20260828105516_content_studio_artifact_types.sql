-- Anka OS - additive Content Studio vocabulary.
-- Intentionally isolated: only existing CHECK constraints are widened. No
-- columns, policies, grants, RLS settings, or actor rules change here.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.artifacts
  drop constraint artifacts_artifact_type_check;

alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (artifact_type in (
    'discovery',
    'vision',
    'audience',
    'website_architecture',
    'keyword_strategy',
    'content',
    'campaign_messaging',
    'scripts',
    'channel_strategy',
    'campaign_brief',
    'measurement_plan',
    'marketing_report'
  ));

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
    'design_direction_released',
    'campaign_created',
    'campaign_updated',
    'artifact_draft_proposed_via_chat'
  ));

commit;
