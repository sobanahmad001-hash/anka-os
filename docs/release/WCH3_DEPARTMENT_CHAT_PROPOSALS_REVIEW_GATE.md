# WCH3 Department Chat Proposals — Admin/Testing Review Gate

Date: 2026-09-04

Correction status: the current correction evidence in WCH3_CORRECTION_EVIDENCE.md supersedes the original local counts and database-runtime limitation below. The corrected runtime matrix has been executed on isolated portable PostgreSQL with synthetic data. Admin acceptance remains pending.

## Release position

WCH3 is implemented on branch feat/wch3-proposals and rebased onto exact origin/main commit c30b4fab1cf95ed2eec88f7c211e05a2d9cd3607 after the release target advanced during implementation.

This packet is for Admin/Testing review only. Nothing in this branch has been pushed, applied to a live database, merged, published, or deployed.

The later Operating Architecture decision controls the QTS5 relationship: Workshop Chat keeps the canonical human-confirmed WCH3 path. Quick Tasks remain a separate optional exploration and are not imported into this implementation.

## Capability boundary

| Department | Allowed artifact proposals | Allowed work-item proposals |
| --- | --- | --- |
| Content | discovery, vision, audience, website_architecture, keyword_strategy, content, campaign_messaging, scripts | task, bug, request |
| Design | design_system | task, bug, request |
| Marketing | channel_strategy, campaign_brief, measurement_plan | task, bug, request |
| Development | technical_brief, launch_checklist | task, bug, request |

Confirmation may create exactly one ordinary unapproved immutable artifact version, with a parent artifact only when required, or one unassigned not_started work item. It cannot create or update tasks, approvals, releases, stage state, publishing, deployment, connector mutations, or external business effects.

## WCH3 controls

- Preview creation atomically stores one completed action_proposal AI run and one pending department_chat_proposals row. It creates no official artifact, version, work item, or task.
- Proposal source data is immutable and expires no later than 24 hours after creation.
- Browser roles have read-only proposal access. Save, confirm, and reject RPCs are service-role only.
- Confirmation and rejection are proposer-only and recheck active team membership plus department or leadership authority.
- Confirmation re-resolves canonical engagement context, exact approved version IDs, the single eligible verified OpenAI connector, its explicit model, and the active department service.
- Changed context, connector, model, or eligibility fails closed. The proposal is marked stale where applicable and the user is told to regenerate.
- Confirmation locks the proposal row. A repeated accepted confirmation returns the same official IDs without creating another record.
- Artifact confirmation inserts ai_use_allowed = false, data_classification = internal, no approval, and a traceable engagement event.
- Work-item confirmation calls the canonical save_work_item function with status = not_started, no assignee, and created_via = ai_chat_proposal.

## WCH4 validation matrix

The rollback-only verifier is supabase/verify_20260903235243_department_chat_proposals.sql.

It fails closed unless all of these hold:

- proposal RLS is enabled;
- browser proposal access is read-only;
- mutation RPCs are service-role only;
- preview creates no official record;
- confirmation is proposer-only;
- a confirmed work item is not_started;
- accepted confirmation replay is idempotent;
- cross-actor confirmation fails;
- rejection creates no official record;
- stale confirmation creates no official record;
- expired confirmation creates no official record;
- confirmed artifact version is internal, AI-disabled, and unapproved;
- an injected artifact-version failure rolls back the parent artifact and leaves the proposal pending;
- legacy tasks are untouched;
- the entire verifier ends with ROLLBACK.

Admin/Testing must apply the migration in an approved non-production environment, run the verifier in the same reviewed schema state, inspect its JSON result, and require every named check to be true before release. This local implementation environment has no Docker or Podman runtime, so the SQL verifier was statically reviewed but not executed against a database here.

## Local gate results

- Focused Node WCH2/WCH3/WCH4 structural tests: 11 passed, 0 failed.
- Related Content, Design, Marketing, and RP2 regression tests: 27 passed, 0 failed.
- Full Node data suite after fresh-main rebase: 460 passed, 0 failed.
- Deno type-check: passed for the Department Chat function and its test.
- Focused Deno Department Chat suite: 14 passed, 0 failed.
- ESLint: 0 errors; 349 repository warnings remain.
- Production build: passed.
- Git whitespace check: passed.
- No local or live database mutation was performed.

## Files in review scope

- supabase/migrations/20260903235243_department_chat_proposals.sql
- supabase/verify_20260903235243_department_chat_proposals.sql
- supabase/functions/department-chat/index.ts
- supabase/functions/department-chat/index.test.ts
- src/components/DepartmentChat.jsx
- src/components/DevelopmentTrackingPanel.jsx
- src/data/departmentChatRepository.js
- src/data/departmentChatProfiles.test.js
- src/data/departmentChatProposals.test.js
- src/data/contentStudio.test.js
- src/data/designDepartmentChat.test.js
- src/data/marketingStudio.test.js
- src/data/rp2SitemapKeywordLinking.test.js
- docs/release/WCH3_DEPARTMENT_CHAT_PROPOSALS_REVIEW_GATE.md

## Migration order and rollback

Reserved migration timestamp: 20260903235243.

The migration is additive. Before release, Admin/Testing should confirm no migration timestamp collision and that the reviewed commit still descends directly from the release target.

If validation fails before commit, the migration transaction rolls back. The verifier always rolls back. After a production commit, rollback requires an Admin-authored forward migration that first disables the WCH3 UI/function path, then safely removes the three RPCs, trigger, policies, proposal table, and the added AI-run composite uniqueness constraint only after checking that no other schema object depends on it. Existing confirmed canonical artifacts, versions, work items, and AI audit rows must not be deleted.
