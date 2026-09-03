# QTS2 sandbox chat review gate

## Scope

This change adds owner-private Quick Task messages, explicit Quick Task AI-run provenance, organization-and-department verified model selection, bounded sandbox revisions, and a chat panel inside the existing Quick Tasks screen. It extends only the dedicated `quick-tasks` Edge Function and does not modify Shared Department Chat.

## Required evidence

- The branch and merge base begin at OAI1-integrated main `bf8e77a063ce23c37464d3f6c54965ffc9e70e52`, which already includes merged QTS1.
- Migration `20260903100732` was generated with `supabase migration new` and follows applied QTS1 migration `20260903071848` without changing it.
- Quick Task messages are owner-only under RLS, append-only, tenant-consistent, and unavailable to organization leadership unless the leader owns the Quick Task.
- QTS AI runs use the explicit `quick_task_chat` capability and bind organization, owner, Quick Task, source revision, department, and verified OpenAI connection.
- The provider request uses `store: false`, a pseudonymous safety identifier, a strict notes/checklist schema, and no business tools or connector action surface.
- The Edge Function loads only the owned Quick Task revision and its private transcript. It does not load projects, engagements, clients, artifacts, work items, content requests, approvals, releases, or restricted context.
- Successful chat recording atomically inserts the AI audit, user and assistant messages, one validated `quick_chat` revision, and the ordinary revision lifecycle event.
- Failed and blocked model calls are audited without changing `last_activity_at`, `expires_at`, the current revision, or the transcript.
- Hourly user limits and the existing organization AI budget are enforced before the model call.
- Static review and the rollback verifier prove that QTS2 cannot insert or mutate canonical records.
- The existing JWT-verified `quick-tasks` registration, CI Deno coverage, and deployment manifest include the affected function.
- Focused/full Node, affected/full Deno, frozen type-check, lint, production build, and `git diff --check` pass at the exact PR head.
- The rollback verifier is ready for Admin/Testing execution. Container-backed migration/verifier execution is not claimed when Docker or Podman is unavailable, and no live Supabase fallback is permitted in this phase.

## Phase exclusions

- No promotion, lifecycle retention operation, expiry/purge job, Cron schedule, adapter, canonical destination, or client-visible action.
- No Shared Department Chat, Anka Assistant, canonical artifact, work-item, task, request, approval, release, publishing, deployment, messaging, advertising, or spend behavior changes.
- No live migration, verifier execution, Edge Function deployment, merge, or production smoke test. Admin and Testing retain those actions.

## Admin handoff

Admin should reject the PR if a non-owner can read transcript or QTS AI content, if any model or connector is selected without the task organization and authorized department mapping, if a failed call extends expiry, if provider retention is enabled, or if any canonical read/write path appears in the QTS2 function.
