# Release 1 Execution Backlog

Priority meanings: P0 blocks safe production use; P1 blocks a complete internal release; P2 improves scale or experience after core correctness.

## Phase 0 - Foundation and safety

| ID | Priority | Work item | Acceptance gate | Status |
|---|---|---|---|---|
| F0-01 | P0 | Preserve baseline and isolate execution branch | Baseline tag and branch exist | Done |
| F0-02 | P0 | Establish Release 1 authority | Scope and exclusions are committed | Done |
| F0-03 | P0 | Remove Diversify from active runtime | No active route or navigation reference remains | Done |
| F0-04 | P0 | Move text AI behind authenticated server boundary | No browser OpenAI/Anthropic text credential path remains | Done |
| F0-05 | P1 | Add lint and CI build gates | Lint has zero errors and production build passes | Done |
| F0-06 | P0 | Identify live Supabase target and migration history | Project target and schema verified; SQL Editor ledger reconciliation remains | Partially done |
| F0-07 | P0 | Rotate any credential ever exposed through `VITE_*` | Server-only architecture done; owner must rotate old provider credentials before deployment | Deployment action |
| F0-08 | P0 | Move image/video, GitHub, Figma, and WordPress privileged calls server-side | Done; secure gateway added and obsolete browser/media paths removed from Release 1 |

## Phase 1 - Canonical platform core

| ID | Priority | Work item | Acceptance gate |
|---|---|---|---|
| C1-01 | P0 | Define canonical entity model | Done; Migrations 1–5 live and verified |
| C1-02 | P0 | Define workflow state machines | Done; task and deliverable-version triggers live |
| C1-03 | P0 | Create least-privilege RLS matrix | Structural boundary done; live client-isolation fixtures pending Phase 4 |
| C1-04 | P0 | Write idempotent migration and rollback plan | Done for canonical core; SQL Editor ledger repair remains |
| C1-05 | P1 | Add typed data-access layer | Canonical repository now serves Projects & Retainers and all four department workspaces |
| C1-06 | P1 | Add automated test foundation | Node/CI foundation done; component and live policy suites remain |
| C1-07 | P1 | Add route-level code splitting | Built; major workspaces load independently, final bundle measurement remains for consolidated testing |

## Phase 2 - Internal delivery OS

| ID | Priority | Work item | Acceptance gate |
|---|---|---|---|
| O2-01 | P1 | Client and project intake | Done; canonical workspace creates clients, projects, retainers, internal initiatives, and selected workstreams |
| O2-02 | P1 | Project templates | Built; Custom, Branding, Website Delivery, and Campaign templates seed versioned stages and quality criteria |
| O2-03 | P1 | Phase/task/dependency execution | Built; intake generates ordered tasks and approval-aware project-scoped dependencies; optional visual editing remains |
| O2-04 | P1 | Department workspaces | Done; Content, Design, Marketing, and Delivery use one canonical queue/research/deliverable/request/milestone surface |
| O2-05 | P1 | Shared research capability | Core done; shared and department research records are available in each project and workshop |
| O2-06 | P1 | Automatic Living Project Record | Done; mutations advance source version and the reporting workspace preserves internal/client snapshots and safe exports |
| O2-07 | P1 | Notifications and activity | Done; database triggers capture delivery activity and create recipient-only realtime notifications |

## Phase 3 - Quality and deliverables

| ID | Priority | Work item | Acceptance gate |
|---|---|---|---|
| Q3-01 | P0 | Internal quality gate | Done; exact-version release requires an authorized recorded internal approval |
| Q3-02 | P1 | Deliverable versioning | Done; private uploads, immutable versions, summaries, status, author, and timestamps are preserved |
| Q3-03 | P1 | Review issue workflow | Done; exact-version comments support section/page/frame/timecode/coordinate anchors and tracked revisions stay separate |
| Q3-04 | P1 | Department-specific checklists | Built into versioned workflow-stage exit criteria and the internal human review checklist |

## Phase 4 - Client Portal

| ID | Priority | Work item | Acceptance gate |
|---|---|---|---|
| P4-01 | P0 | Client authentication and isolation | Built; secure invite creates a client identity and explicit per-project access, never team membership |
| P4-02 | P1 | Real-time progress | Built; portal subscribes to sanitized projections, released items, requests, and comments only |
| P4-03 | P1 | Communication | Built; client-shared project messages remain project-linked and RLS-scoped |
| P4-04 | P1 | Revision requests | Built; client feedback targets the exact released deliverable version |
| P4-05 | P1 | Controlled file review | Built; released files use authorization-checked five-minute signed URLs |
| P4-06 | P1 | Approval feature flag | Done for UAT state; formal approval UI/mutation remains disabled by default |

## Phase 5 - AI support

| ID | Priority | Work item | Acceptance gate |
|---|---|---|---|
| A5-01 | P0 | AI permission boundary | Built; Edge Function retrieves context through the caller's RLS session and stores a record-ID manifest |
| A5-02 | P1 | Human-confirmed actions | Built; only task/research proposals are supported and canonical creation requires a separate confirmation |
| A5-03 | P1 | Project intelligence | Built; project pulse and daily brief cover status, risks, blockers, reviews, deadlines, and history |
| A5-04 | P1 | Department assistants | Core built; research, writing, quality review, and action proposal capabilities use scoped server prompts |
| A5-05 | P1 | AI audit and cost controls | Built; provider/model, context, latency, tokens, optional estimated cost, rate limit, budget, and human outcome are recorded |

## Phase 6 - Pilot and release

| ID | Priority | Work item | Acceptance gate |
|---|---|---|---|
| R6-01 | P0 | Security review | RLS, storage, Edge Functions, secrets, audit, and abuse controls pass review |
| R6-02 | P1 | Internal UAT | Real projects complete end-to-end with no P0/P1 workflow defect |
| R6-03 | P1 | Private client pilot | Selected clients review work and submit revisions successfully |
| R6-04 | P1 | Approval activation decision | Evidence-based go/no-go is recorded; default remains off if uncertain |
| R6-05 | P1 | Operations readiness | Backups, monitoring, incident response, support ownership, and release notes are ready |

## Immediate next implementation slice

1. Repair the Supabase migration ledger for manually applied Migrations 1–5.
2. Deploy queued Migrations 6–11 and authenticated Edge Functions.
3. Rotate old provider credentials and configure only server-side secrets.
4. Connect frontend hosting and run browser, security, and multi-role UAT.
