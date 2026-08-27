# Artifacts and Design Workshop review gate

This phase is branch-only. Do not merge, migrate, deploy the Edge Function, or
promote the application until the accountable reviewer explicitly approves each
gate below.

## 1. Isolated shared-audit exception

Review commit `0d21da2` by itself before the rest of the feature. It contains
only:

- `20260827160000_engagement_events_artifact_types.sql`
- its matching verification script

The migration replaces only the existing `event_type` CHECK constraint. It
retains every existing value and adds:

- `artifact_version_created`
- `artifact_approved`
- `design_direction_released`

Confirm that it adds no column, changes no RLS policy or grant, and does not
alter the `actor_id = auth.uid()` browser insert rule. The verification script
checks those invariants. Each new event uses the normal organization,
engagement, event type, actor, payload and occurrence fields. Its payload uses
the same `record_type`, `record_id`, `version_id`, and `action` shape.

## 2. Artifacts and Design Workshop schema

Review `20260827170000_artifacts_design_workshop.sql` and its verification
script. Confirm:

- Discovery, Vision and Audience content is stored as immutable versions.
- approvals point to one exact artifact version.
- Workshop context points to the exact approved versions and approvals.
- generation runs retain provider, model, slot, attempt and checksums.
- generated direction versions are immutable and never auto-approved.
- human selection and accountable release are separate immutable records.
- authenticated browser roles can read these records but cannot write them.
- organization membership RLS is enabled on every new table.
- no Client Portal, WordPress Studio, Marketing Studio, connector, or existing
  Operating Spine relationship is changed.

## 3. Function and application review

Confirm that `design-workshop`:

- verifies the signed-in user and the required department authority;
- validates engagement, brand and optional stage scope;
- accepts only explicitly AI-safe, non-restricted approved context;
- reuses an already verified OpenAI connector mapped to the engagement and
  Design department;
- requests three materially different structured directions and silently
  rejects cosmetic duplicates;
- attributes each accepted direction to its model and generation run;
- allows refinement only as a new immutable version;
- requires a human selection before a Design manager or leader can release.

The UI previews structured visual territories (palette, typography, layout,
imagery and rationale). It does not claim to generate final production image or
video assets in this phase.

## 4. Verification evidence

Before approval, record the results of:

1. application unit tests;
2. lint and production build;
3. Deno check and unit tests for `design-workshop`;
4. SQL verification against a disposable or approved target after migrations;
5. a Supabase linked dry run showing only the expected pending migrations;
6. preview testing with a Design-enabled engagement and verified connector.

Current branch evidence (2026-08-27):

- application tests: 98 passed, 0 failed;
- Edge Function tests: 5 passed, 0 failed;
- lint: 0 errors (the repository's existing JSX-parser warnings remain);
- production build: passed, including an independent Design Workshop chunk;
- Deno type-check: passed;
- linked Supabase dry run: no changes applied; it reported, in order,
  Operating Spine `140000`/`150000`, audit exception `160000`, and Artifacts /
  Design Workshop `170000` as pending;
- preview workflow test: still required after an explicitly approved migration
  and function deployment.

## 5. Explicit release sequence

After approval only:

1. merge/deploy the Operating Spine dependency first;
2. apply `20260827160000` and review its verification output;
3. apply `20260827170000` and review its verification output;
4. deploy `design-workshop`;
5. deploy the application preview and complete the human workflow smoke test;
6. promote to production only after a second explicit approval.
