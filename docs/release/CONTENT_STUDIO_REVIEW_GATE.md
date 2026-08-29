# Content Studio review gate

This phase is stacked on PR #23 because the execution brief assumes Marketing
Studio is already approved and live, while PR #23 is currently open and green.
Keep `feat/content-studio` unmerged until #23 lands. Building a preview is not
permission to merge, migrate, or deploy production functions.

## Safe Design Workshop relocation

- Discovery, Vision, and Audience retain their existing artifact identities,
  immutable versions, exact approvals, and engagement events.
- Content Studio is now their only active authoring and approval entry point.
- Design Workshop keeps a read-only approved-context view and its session
  compiler is unchanged: it selects exact approved versions, requires
  `ai_use_allowed`, and rejects restricted data.
- Review must create or revise all three artifacts in Content Studio, approve
  exact versions, compile a Design session, generate directions, select one,
  and release it. A UI-only smoke test is insufficient.

## Shared Department Chat boundary

- The component and Edge Function are department-generic, but only Content is
  enabled in this phase.
- A run uses exactly one engagement-mapped verified OpenAI connection and one
  model. There is no multi-model routing or Anthropic fallback.
- The only external endpoint is OpenAI Responses API. No business connector,
  publishing, CMS, advertising, messaging, deployment, or spend endpoint is
  callable.
- Approved artifact context is included only when the exact version is marked
  AI-safe and is not restricted.
- Every run is subject to the existing per-user rate limit and organization AI
  budget, and records tokens and estimated cost in the canonical AI-run audit.
- A proposal creates a canonical `artifact_versions` row with
  `ai_use_allowed = false`, no approval, and an
  `artifact_draft_proposed_via_chat` event whose actor is the human user.
- The normal Content manager approval action is the only path to an exact
  `artifact_approvals` record.

## Migration review

Review `20260828105516_content_studio_artifact_types.sql` in isolation. It may
only widen the existing `artifacts` and `engagement_events` CHECK constraints.
It must not create a table, column, policy, grant, trigger, or RLS change.

No new table is required for this phase. Content reuses canonical artifacts,
approvals, AI-run audit, engagement events, services, stages, and connector
mappings.

## Verification checklist

- [ ] The isolated vocabulary verifier returns only `true` results.
- [ ] All eight Content artifact forms create canonical immutable versions.
- [ ] Website Architecture stores structured pages and page goals.
- [ ] Keyword Strategy stores service, search-demand, and brand lenses per page.
- [ ] A manual draft follows draft → exact approval → downstream consumption.
- [ ] A chat proposal follows the identical draft → exact approval path.
- [ ] The chat event credits the human actor and references the model audit run.
- [ ] Design compiles approved Discovery, Vision, and Audience end to end.
- [ ] Static review finds only the allowlisted OpenAI model endpoint in chat.
- [ ] Application tests, lint, full Deno checks, and production build pass.
- [ ] No Client Portal, CMS publishing, external send, spend, multi-model chat,
      Marketing duplication, or Development Studio work appears in the diff.
- [ ] PR #23 is merged before this stacked PR is retargeted to `main`.
- [ ] Nothing is merged or deployed without separate review approval.

## Future release order after approval

1. Merge and publish PR #23 using its approved release gate.
2. Retarget/rebase the Content Studio PR to the resulting `main` and rerun CI.
3. Apply `20260828105516_content_studio_artifact_types` and run its verifier.
4. Deploy `content-studio`, `department-chat`, and the updated
   `design-workshop` function.
5. Deploy a frontend preview and execute both manual and chat trace tests.
6. Merge and promote only after separate explicit production sign-off.
