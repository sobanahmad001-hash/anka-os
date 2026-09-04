# WCH2 Department Profiles and Canonical Context — Review Gate

Status: branch-only implementation. Admin/Testing retains merge, deployment, release, and live-database authority.

## Scope

- One versioned JSON profile source is consumed by both the frontend and the department-chat Edge Function.
- Content, Design, Marketing, and Development have explicit artifact, context-artifact, work-item, and mount allowlists.
- Development profile and strict `technical_brief` / `launch_checklist` schemas are defined for later WCH3 use, but Development is not runtime-enabled and no Development Chat UI is mounted.
- Department Chat resolves the OAF2 canonical `clients` and `projects` roots plus their one-to-one `agency_clients` and `engagements` operating extensions.
- Canonical/extension disagreement, incomplete ownership, inactive department service, ambiguous connector selection, missing credential, and missing explicit `model_id` all fail closed.
- AI-run context manifests freeze the profile version, canonical and extension IDs, brand, active services, exact approved artifact-version IDs, connector, model, optional stage, and a deterministic content checksum.

## Explicit boundaries

- No schema migration is required. The next migration timestamp remains unclaimed and must be later than `20260903071848` if a later wave needs one.
- No WCH3 proposal table, 24-hour expiry, proposer-only decision policy, accept/reject lifecycle, Development proposal invocation, or Development official-record write path is implemented here.
- `tasks` and `work_items` remain separate; WCH2 does not converge or dual-write them.
- No connector fallback, Anthropic path, business connector call, publish, approval, release, deployment, or stage transition is added.
- The existing Content, Design, and Marketing draft behavior remains otherwise unchanged pending WCH3.

## Collision review

- PR #75 (`RET1`) changes recurring-plan files, CI, and migration `20260903071706`; it does not overlap WCH2 implementation files.
- PR #76 (`QTS1`) changes Quick Tasks, Supabase config, and migration `20260903071848`; it does not overlap WCH2 implementation files.
- The uncommitted WKS2 worktree changes routing, portfolio, and new project-engagement workspace files. WCH2 does not modify those files.

## Approval checklist

- [ ] Confirm the shared profile source is the only WCH artifact/context allowlist authority.
- [ ] Confirm Development profiles and schemas exist without a Development Chat mount or runtime enablement.
- [ ] Confirm OAF2 canonical roots and one-to-one extensions are re-resolved server-side and never accepted from the browser.
- [ ] Confirm exact approved versions and context checksum are present in every completed Department Chat AI run.
- [ ] Confirm connector resolution requires exactly one verified engagement-and-department mapping and an explicit model.
- [ ] Confirm no fallback provider or business connector is callable.
- [ ] Confirm direct Development `propose_artifact` and `propose_work_item` calls fail before model access or any official write.
- [ ] Confirm WCH3 persistence and accept/reject remain out of this wave.

## Required evidence

- Full Node test suite.
- Department-chat Deno type-check and focused Deno tests, including negative Development action coverage.
- ESLint with zero errors.
- Production build.
- `git diff --check`.
- Exact branch head and successful CI before Admin/Testing review.

No merge, deployment, function deployment, migration application, or production mutation is authorized from this branch.
