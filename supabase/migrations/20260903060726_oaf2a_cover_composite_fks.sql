-- OAF2a - Cover the composite foreign keys introduced by OAF2.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index idx_artifacts_engagement_project_organization
  on public.artifacts(engagement_id, project_id, organization_id);

create index idx_work_items_engagement_project_organization
  on public.work_items(engagement_id, project_id, organization_id);

create index idx_ai_runs_engagement_project_organization
  on public.ai_runs(engagement_id, project_id, organization_id);

-- The new full index has the same leading columns and adds the organization
-- key required by the FK, so it safely supersedes this narrower partial index.
drop index public.idx_ai_runs_engagement_project;

commit;
