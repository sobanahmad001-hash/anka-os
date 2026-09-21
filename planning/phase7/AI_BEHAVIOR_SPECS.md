# AI Behavior Specs

## Shared AI Rules
All AI environments should:
- understand project context
- preserve continuity
- understand blockers
- understand updates and decisions
- suggest next actions
- avoid generic chatbot behavior

## Admin AI
### Role
Strategic oversight helper

### Helps with
- organizational summaries
- portfolio risk
- repeated blockers
- department bottlenecks
- priority guidance
- leadership summaries

### Tone
clear, high-level, operational

## Development AI
### Role
Technical execution helper

### Helps with
- project state summaries
- technical blockers
- work breakdown
- PR/release summaries
- dependency awareness
- technical risk

### Tone
technical, practical, execution-focused

## Design AI
### Role
Creative coordination helper

### Helps with
- brief summaries
- feedback grouping
- revision pattern detection
- handoff summaries
- stalled review visibility

### Tone
clear, creative-supportive, coordination-focused

## Marketing AI
### Role
Campaign and content coordination helper

### Helps with
- campaign summaries
- content pipeline visibility
- approval bottlenecks
- update drafting
- outcome-linked summaries

### Tone
planning-aware, campaign-aware, concise

## Consolidated N1–N8 alignment (2026-09-21)

This extends the current N-series build; released work is retained. OS management assistance and Workshop production are separate surfaces. They share effective authority, scoped context, an approved provider/model registry, durable jobs, cost controls, output lineage and audit. Deterministic server rules decide permissions, assignments, approvals and budgets. AI may propose; it cannot turn a proposal into an official change without the existing human confirmation path.

### Shared execution contracts before N6

- Context: select only authorized, relevant current assets and exact immutable versions. Include organization, department, client/brand, project or private scope as applicable. Recheck access and revocation before execution, reuse, export and promotion. Pass a bounded subset, not entire histories.
- Provider routing: configure responsibility-specific ordered eligible models (primary, secondary, third) only after provider capabilities and model IDs are verified. The OS automatically moves to the next eligible model for a confirmed outage, rate limit or timeout. A recovered primary serves new requests; an in-flight backup finishes. Do not fail over on a permission, budget, data-restriction or safety refusal. Unknown accepted paid outcomes must be reconciled before any resubmission.
- Workshop choice: show staff approved compatible models with a recommended economical default, explicit selection and visible fallback/actual model. Choose the lowest cost that satisfies the requested quality and capability. Never silently downgrade resolution or other quality requirements.
- Job and budget: one durable intent/idempotency key across retries and staff, while explicit variants use new intents. Reserve budget atomically across concurrent users/projects before provider submission, record measured actual cost and release or reconcile unused reservation. Enforce spend limits and expose job state, cost and alerts. No budget amount or paid action is authorized by this planning text.
- Outputs: check suitable licensed, current, permitted assets/templates before generation. Edit only affected sections or media layers where supported. Preserve originals, immutable versions, source/model lineage and deliberate variant identity. Private experiments stay private; explicit Use in project creates a project draft only.
- Memory: organization, department, client/brand, project and private scopes remain separate. Revisions produce sourced candidate lessons with approval and supersession state. Department-wide learning requires deliberate permitted promotion and sanitization, never automatic propagation.

### Existing contract and acceptance matrix

| Phase | Already covered in current build | Alignment or new scope | Acceptance still required |
| --- | --- | --- | --- |
| N1 Authority | Effective project/department authority, RLS and AI-use/classification controls | Apply effective authority to provider/model/asset/spend controls; no role redesign | Role, revoked-access and cross-client denial at each job boundary |
| N2 Workspace | Project/engagement context, exact artifact versions and private Design experiments | Shared asset/template lookup, lineage and applicable provider/budget settings | Context/asset isolation and revocation |
| N3 Communication | Proposals, approvals, exact-version handoffs and explicit private promotion | Scoped memory candidates and approval-aware reuse | Proposal remains draft until authorized confirmation; lesson promotion and supersession |
| N4 Planning | Existing task/job state, attention surfaces and some AI budget checks | Measured cost, atomic reservations across staff/projects and budget alerts | Concurrent reservation/retry race; actual-cost reconciliation |
| N5 Workshops | OpenAI department allowlists/selection, uncertain-outcome handling, versioned output and private experiments | Compatible model-choice/fallback UX, reusable media, targeted edits and shared job/cost hooks; Design video/assembly is added scope | Real capability, resolution, audio, account and provider evidence; no silent quality downgrade |
| N6 Pipelines | Versioned presets and manual planning foundation | Consume the shared context/router/job/idempotency/budget/output contracts for manual-start runs | Pinned inputs, limits, recovery, approvals and deterministic control |
| N7 AI and memory | Existing department chat and specialist generation foundations | Connected OS assistance, governed scoped memory and shared provider/budget controls | Source/citation, scope, confirmation, fallback and memory-revocation tests |
| N8 Acceptance | Incremental local tests and exact-head release gates | Cross-surface and concurrent fallback/retry/budget/permission/cache/promotion journeys | Signed-in and paid/provider acceptance remain separate and unpassed until real authorized evidence exists |

OpenAI, Google and Claude are planned by responsibility. Exact model IDs and routing order remain undecided. No connector, paid request, top-up, account creation or production fixture is activated by this direction.
