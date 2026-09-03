# Design B01 — P9 reconciliation review gate

Status: **READY FOR TESTING APPROVAL** as a local-only candidate. This record does not authorize push, PR, merge, deployment, migration application, live-data access, provider action, or policy change.

## Change identity

- Approved integration base: `36c3da9a607a532e09a1a1e3adff0122ddfa1013`.
- Approved B01 intent head: `96fb70e350300f5d64f7fd5a6471ed0cf7cc6aed`.
- Successor branch: `feat/design-b01-p9-reconciled-20260904`.
- Successor worktree: `C:\Users\Soban\Documents\ChatGPT\Anka Sphere\anka-os-design-b01-p9-reconciled-20260904`.
- Frozen P9 navigation, shared Workshop shell, Gate 0 resolver, migrations, and Edge Functions are unchanged.

## Intent mapping

- Retained B01 explicit entry modes: generic Design entry remains **Choose work**, client work is never auto-selected, and **Private experiment** is deliberate and browse-only.
- Retained B01 organization-scoped reads, abort-aware requests, visible recovery, capability labels, official-action guards, and dirty-modal **Stay / Save to current context / Discard** handling.
- Retained B01 multi-service behavior: one or more active Design services are eligible, zero is blocked, and the session form still selects the exact service.
- Retained the final B01 reviewer correction: active team members keep the promotion capability while the visible experiment must still be creator-owned or explicitly shared with that reviewer.
- Retained the explicit **Video not configured** state and removed the video generation control.

## Replaced and dropped hunks

- Replaced the B01-owned `readDesignEntry` legacy parser with the shared P9 `parseWorkshopNavigation`, `validateWorkshopNavigation`, `workspaceReturnTarget`, and `WorkshopContextShell` consumer path.
- Replaced legacy chooser serialization with P9 serialization. It preserves canonical organization/client/project/engagement/brand identity, exact route/tab and Workspace origin, and typed `project_task` or `engagement_work_item` identity.
- Added organization-scoped resolution for the exact typed work record. Archived Project Tasks and deleted Engagement Work Items fail closed.
- Added canonical resolution of exact Design session/output version, active service, stage, and durable `private_experiment` draft pointers. Unavailable pointers become stale and block official actions.
- Exact output versions are displayed when available; the pointed private experiment is ordered first and marked **Restored draft**. Unsaved draft text is never inferred.
- Cross-organization links retain P9 recovery copy and never switch the active organization. Safe Back behavior falls back to Workspace when the requested context is rejected.
- Dropped B01’s obsolete “P9 is absent” copy and its legacy-only adapter tests.
- Dropped all duplicate server/Gate 0 work. No shared resolver, Edge Function, migration, or P9 module hunk was ported or edited.
- Updated older static Design tests only where they had assumed that Design could never read a Work Item or that `load` had no P9 navigation argument. The new allowance is read-only and mutation surfaces remain prohibited.

## Local verification

- `npm ci`: PASS using the lockfile.
- `npm run lint`: PASS with 0 errors and 380 existing warning-profile findings.
- `npm test`: PASS, 606/606.
- Focused B01/P9 suite: PASS, 31/31.
- CI exact `deno test --frozen ...` file list: PASS with the existing local Deno 2 runtime.
- CI exact `deno check --frozen ...` file list: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS; only expected Windows line-ending notices were emitted.
- Narrow secret-pattern scan: PASS.
- Supabase changelog review: no current breaking change affects this client-only reconciliation; no schema or live Supabase operation was performed.

## Testing focus

Testing should verify an authenticated matrix for generic entry, exact Project Task entry, exact Engagement Work Item entry, stale record, stale output/version, durable draft, cross-organization URL, multi-service selection, dirty modal switching, invited-reviewer promotion, and exact Back-to-work return. Synthetic automated coverage is present, but this local candidate does not claim authenticated browser evidence without a supplied test actor and seeded scenario.

Recovery is a normal revert of the single local reconciliation commit. The approved base and both frozen source worktrees remain untouched.
