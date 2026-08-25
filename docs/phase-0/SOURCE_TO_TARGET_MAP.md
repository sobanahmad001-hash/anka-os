# Source-to-Target Map

This map decides what is reused, refactored, replaced, referenced, or excluded for Release 1.

| Current source | Useful capability | Release 1 target | Decision |
|---|---|---|---|
| `AnkaSphereProjects.jsx` | Project phases, tasks, deliverables, handoffs | Project workspace and execution flow | Refactor around canonical entities and smaller route components. |
| `AnkaSphereTeamBoard.jsx` | Team workload view | Department/team operations board | Reuse after assignment, capacity, and permissions are normalized. |
| `AnkaSphereClients.jsx` | Client records | Internal client management | Reuse UI concepts; bind to canonical client and contact model. |
| `AnkaSpherePortal.jsx` | Client project view and signoff concepts | Dedicated, permission-safe Client Portal | Replace data access and workflow state model; retain UX concepts. |
| `SphereCreativeStudio.jsx` | Brand and creative generation | Design workspace with AI support | Split into assets, brand system, generation, and review modules; proxy all providers server-side. |
| `SphereMarketing.jsx` | Strategy, content, campaign, SEO concepts | Marketing workspace | Split into focused modules and use shared project/task/document entities. |
| `SphereFigmaWorkspace.jsx` | Figma workflow | Design integration | Retain as optional integration after secure token model exists. |
| `SphereWPEngine.jsx` | Website/page delivery | Delivery/Development workspace | Reuse workflow; move WordPress credentials and writes server-side. |
| `AnkaAssistant.jsx` and `AssistantFloat.jsx` | AI conversation and proposed actions | Contextual AI support layer | Reuse through authenticated gateway; require human confirmation for mutations. |
| `LivingProductDocument.jsx` | Product documentation concept | Living Project Record per project | Rebuild as an automatic, versioned project record rather than one global document. |
| Generic `projects/tasks/clients` code | Earlier shared work model | Canonical project graph | Reference only until schema consolidation; do not build new work on both models. |
| Diversify routes and development apps | Software-product tooling | Outside Anka Sphere Release 1 | Removed from active runtime; retain history until archive cleanup is approved. |
| Uploaded Angular application | Alternative feature ideas | Feature reference | Reference only; no Angular runtime, migration, or parallel product. |
| Existing phase folders and `CURRENT_STATUS.md` | Historical planning | Current authority under `docs/product` and `docs/phase-0` | Retain as history; superseded where conflicts exist. |

## Canonical target modules

| Module | Minimum Release 1 responsibility |
|---|---|
| Identity and access | Team/client identity, role, department, project membership, least-privilege authorization. |
| Client management | Client organization, contacts, communication preferences, linked projects. |
| Project control | Templates, phases, milestones, status, owners, health, dependencies. |
| Work management | Tasks, subtasks, assignments, due dates, blockers, comments, attachments, activity. |
| Shared research | Briefs, questions, findings, sources, decisions, department/project links. |
| Deliverables and quality | Versions, internal review, issues, release to client, audit trail. |
| Client collaboration | Approved progress view, messages, feedback, revision requests, later approvals. |
| Living Project Record | Automatic project history, decisions, research, deliverables, revisions, approvals, closure. |
| AI support | Retrieval, summarization, drafting, recommendations, and proposed actions with human control. |
| Notifications and audit | Event-driven notifications and immutable records of sensitive actions. |

## Data consolidation rule

No new feature may create another parallel project, task, client, document, approval, or notification model. Phase 1 must select canonical tables and provide a migration/compatibility plan for every legacy table used by an active screen.
