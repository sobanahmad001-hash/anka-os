# Development Studio review gate

This PR is intentionally a tracking-only extension to the Operating Spine. It
must remain stacked on `feat/proofing-layer` until PRs #23, #24, and #25 are
reviewed and merged in order.

## Review the migration in isolation

Review `20260828153231_development_studio_minimal.sql` before the application
diff. It may only:

- add `team_notes` to the existing `engagement_stage_instances` table;
- widen the existing stage, artifact, and engagement-event vocabularies;
- add service-role-only, security-invoker functions for atomic stage and
  artifact-plus-audit writes.

It must not add a Development task, ticket, repository, build, deployment, or
client-portal table. Existing RLS policies and Data API grants remain unchanged.

Run `supabase/verify_20260828153231_development_studio_minimal.sql` after the
migration. Every returned value must be `true`.

## Application scope

- The Development tab appears only on an engagement with an active Development
  service.
- It shows only the instantiated Development stages and two artifact types:
  `technical_brief` and `launch_checklist`.
- Stage status is limited to `not_started`, `in_progress`, `blocked`, or
  `complete`.
- Saving a stage status or artifact version writes the same organization,
  engagement, actor, record, action, and version fields used by the shared
  engagement audit timeline.
- Development artifact versions are append-only and AI use remains disabled.

## Explicit exclusions

Confirm the PR contains no repository connector, source-code view, commit or
diff tracking, coding agent, build trigger, deployment automation, assignment,
sprint, dependency, or client-portal exposure.

## Release boundary

This review does not authorize merging, running the migration, deploying the
`development-studio` Edge Function, or promoting the frontend. Publish only
after the stacked PRs have been approved and their migration order has been
recorded in the release runbook.
