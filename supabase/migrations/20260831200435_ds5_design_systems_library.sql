-- Anka OS DS5 - register the persistent Design Systems artifact vocabulary.

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
    'brand_statement',
    'website_architecture',
    'keyword_strategy',
    'content',
    'campaign_messaging',
    'scripts',
    'channel_strategy',
    'campaign_brief',
    'measurement_plan',
    'marketing_report',
    'technical_brief',
    'launch_checklist',
    'design_system'
  ));

comment on constraint artifacts_artifact_type_check on public.artifacts is
  'Canonical artifact vocabulary, including the persistent Design Systems library type.';

commit;
