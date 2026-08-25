# Anka Sphere OS - Current Status

Last updated: 2026-08-25

Active branch: `chore/repo-hygiene-and-test-flags`

Product authority: `docs/product/RELEASE_1_AUTHORITY.md`

## Current outcome

Phase 0 is complete, the Phase 1 canonical database foundation is deployed, and the main Phase 2 delivery surfaces are built. Anka Sphere is the only active delivery environment, text AI uses the authenticated server gateway, client approvals / AI assistance / integration tests default to enabled for full-path testing, and CI/lint/build gates are established.

Migration 1 (`20260825010000_organization_access_foundation`) is live and verified on Supabase project `fhoxaogfjszftoqtnbav`. It establishes the organization and membership boundary, the four approved work environments, canonical client-contact/project-access/workstream tables, and default-deny legacy client visibility.

Migration 2 (`20260825020000_security_boundary_hardening`) is also live and verified. Anonymous public-table grants and unnecessary elevated authenticated grants are removed, privileged functions have safe execution boundaries, and deliverable storage is restricted to internal team memberships without removing stored objects.

Migration 3 (`20260825030000_guarded_test_data_reset`) is live and verified. It cleared all 128 owner-approved test application rows while preserving five identities, five profiles, five memberships, one organization, four departments, and seven storage objects.

Migration 4 (`20260825040000_canonical_delivery_core`) is live and structurally verified. It defines the canonical delivery records, database-enforced task and deliverable-version lifecycles, immutable internal approvals and history, the automatic Living Project Record, and sanitized client portal projections. All canonical tables, RLS boundaries, grants, triggers, and client-approval gates passed.

Migration 5 (`20260825050000_retire_legacy_design_review_access`) is live and verified. The retired design review subsystem has zero policies, zero anonymous grants, zero authenticated grants, zero rows, and RLS remains enabled.

Migration 6 (`20260825060000_team_profile_alignment`) is prepared but intentionally not deployed during the build-first pass. It aligns display profiles with all four canonical departments without granting authorization from editable metadata. The rewritten invitation function authorizes against organization memberships and creates both the invited identity and active membership.

Migration 7 (`20260825070000_release1_workflow_templates`) is prepared but not deployed. It seeds versioned Custom, Branding, Website Delivery, and Campaign workflows, including department ownership, explicit entry/exit quality criteria, human review gates, and project-scoped task dependency enforcement.

Migration 8 (`20260825080000_canonical_activity_notifications`) is prepared but not deployed. It replaces the permissive legacy notification policy with recipient-only read/update access, removes browser notification insertion, captures authorized delivery activity in private database triggers, advances the Living Project Record, and publishes the canonical notification feed to Realtime.

Migration 9 (`20260825090000_ai_audit_and_human_control`) is prepared but not deployed. It adds immutable AI run evidence with caller/project/capability, authorized source manifests, provider/model, latency, token usage, optional cost estimates, and separately recorded human decisions. Browser writes are unavailable; the authenticated AI Edge Function owns audit mutations.

Migration 10 (`20260825100000_secure_integration_gateway`) is prepared but not deployed. It stores secret-free GitHub, Figma, and WordPress connection metadata behind team-only RLS, keeps browser writes revoked, and records immutable connection audit events. Credentials are resolved only from named Supabase Edge Function secrets.

Migration 11 (`20260825110000_version_review_annotations`) is prepared but not deployed. It adds structured section, page, frame, timecode, and normalized-coordinate anchors to exact-version comments without changing the separate revision-request workflow.

Migration 13 (`20260825130000_enable_client_approvals_for_testing`) is prepared. It turns on `client_approvals_enabled`, allows authorized clients to record approvals against released versions, and advances the exact-version lifecycle.

The active project route now uses the canonical delivery repository. Content, Design, Marketing, and Delivery & Development each have a reusable canonical workshop with task queues, shared research, deliverables, cross-department requests, and milestones. No specialist workspace duplicates project or task records.

My Work now combines assigned tasks, handoffs, owned deliverables, internal reviews, and controlled releases. Exact deliverable versions support private file upload, immutable metadata, human internal quality decisions, and sanitized client release.

The client portal and client administration surfaces now use canonical records. Client contacts receive explicit per-project access without team membership. The portal receives only sanitized projections and released versions, supports live updates, project conversations and exact-version revisions, and uses short-lived authorization-checked file links. Formal client approval is enabled behind the feature flag and organization setting.

Project intake now activates the selected workflow, generates sequenced execution tasks, and creates finish-to-start or approval dependencies. Legacy provider screens that expose browser credentials or write `as_*` records are no longer imported or linked; their old URLs safely redirect to the appropriate canonical workshop while secure replacements are evaluated.

The agency command centre now presents active engagements, risk exceptions, workload by department, overdue work, review/release queues, milestones, and recent database-generated activity. These are operational pressure signals and are not treated as employee performance scores.

The active Anka AI surface now uses canonical records instead of `as_*` context. Project Pulse, Daily Brief, Research Support, Writing Support, Quality Review, and Action Proposal retrieve context through the caller's RLS session. AI cannot approve or execute directly; supported task/research proposals require a separate human confirmation and outcome audit. The unaudited floating mini-chat has been retired.

Reports & Living Records is now a first-class Sphere workspace. It composes the current canonical project state, preserves immutable internal or client snapshot checkpoints using the existing RLS-protected tables, and exports Markdown, JSON, or print-ready output. Client projections are allowlisted to client-visible milestones, released exact deliverable versions, client requests, and client-visible activity; they exclude tasks, research, scope, exclusions, internal activity, provider prompts, and costs.

All major application surfaces now use route-level lazy loading with a shared loading boundary. Projects, Portal, clients, workshops, AI, admin, settings, and reporting no longer have to ship as one initial application chunk.

The Admin Settings surface is now a secure Integration Center. GitHub repository, Figma file, and WordPress site connections can be configured and tested without entering credentials into the browser or database. Release 1 provider operations are read/test-only; external modification and publishing remain disabled during UAT.

Obsolete desktop-shell, duplicate project/workshop, browser-credential, and unaudited media-generation modules have been removed from the release source. They remain recoverable from Git history if a future secure feature intentionally reuses their product ideas.

## Verification

- Production build: passing; route-split initial JavaScript is approximately 426 kB (125 kB gzip), reduced from approximately 911 kB.
- ESLint: passing with zero errors and 119 tracked warnings.
- Active Diversify routes/navigation: none.
- Database target: `fhoxaogfjszftoqtnbav`, verified.
- Migration 1 live verification: passed.
- Foundation tables: all five present.
- Organization memberships: five for five authentication users.
- Client-visible legacy records: zero.
- Formal client signoff update policy: absent.
- `sphere-deliverables` bucket: private.
- Anonymous public-table grants: zero.
- Elevated authenticated table grants: zero.
- Reviewed privileged functions with anonymous execution: zero.
- Internal deliverable storage policies: four.
- Preserved `sphere-deliverables` objects: seven.
- Canonical repository, route, workflow, workshop, quality, AI, command-centre, notification, portal, annotation, reporting, integration, export-privacy, performance, security, and provisioning tests: sixty-eight passing.
- Migration 4 static security checks: passing.
- Migration 5 live verification: passed.

## Current blockers

1. Live multi-user RLS tests require seeded team/client fixtures before client portal activation.
2. The Supabase migration ledger still needs Migrations 1–5 marked applied before automated deployment.
3. Migrations 6–13 and authenticated Edge Functions are prepared but not deployed.
4. Any provider key previously included as a browser `VITE_*` value must be rotated before production use.
5. Component/browser and multi-role UAT remain deployment-stage gates.
6. Frontend hosting must be confirmed and connected after the controlled Supabase deployment.

## Next gate

Testing flags are on in the application. Follow `docs/release/DEPLOYMENT_RUNBOOK.md` for migration-history repair, controlled database/function deployment of migrations 6–13, frontend hosting, and multi-role UAT.

See `docs/phase-1/MIGRATION_1_VERIFICATION.md`, `LIVE_SUPABASE_INVENTORY_FINDINGS.md`, and `MIGRATION_1_RUNBOOK.md` for current evidence.
