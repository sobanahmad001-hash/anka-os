# Phase 0 Baseline Audit

Date: 2026-08-25

Repository: `sobanahmad001-hash/anka-os`

Baseline commit: `c8605135dc62b2e420e0021aa5dcf75cc6608947`

Preservation tag: `pre-phase-0-2026-08-25`

Execution branch: `codex/phase-0-foundation`

## Baseline inventory

| Area | Observed baseline | Phase 0 decision |
|---|---:|---|
| Tracked files | 163 | Preserve history; make incremental changes. |
| Source files | 72 after Phase 0 additions | React application is the production source. |
| Supabase files | 28 | Audit before applying any migration to a live project. |
| SQL `CREATE TABLE` statements | 75 across committed SQL | Consolidate overlapping models before deployment. |
| Application table names | 44 unique names referenced by client code | Map each to a canonical Release 1 entity. |
| Production build | Passes | Keep as a required CI gate. |
| Lint at first run | 6 errors, 132 warnings | Hook errors fixed; warnings become tracked debt. |
| Main JavaScript bundle | 842.98 kB minified, 224.63 kB gzip | Introduce route-level code splitting in Phase 1. |

## Confirmed architecture

- React 19, Vite 6, React Router, and Supabase are already connected in the implementation.
- Supabase Edge Functions exist for AI, invitations, and selected provider proxies.
- The active UI mixed Anka Sphere with legacy Anka Diversify routes. Phase 0 removes Diversify from active navigation and routing without deleting its historical source files.
- The uploaded Angular ZIP is an older feature reference and is not a second runtime.

Angular reference SHA-256: `52bea092055069be20e4849cc750739a72ca39453a50e21df769e302e7ca327d`

## Highest-risk findings

### P0 - credential boundaries

Text AI and WordPress page-generation calls were made directly from the browser with provider credentials. Phase 0 routes those calls through the authenticated `ai-chat` Edge Function.

The following browser-side credential paths remain blocked for production until server-side adapters replace them:

- Image/video provider keys in `SphereCreativeStudio.jsx`.
- GitHub personal token use in `src/lib/github.js` and legacy `CodingAgent.jsx`.
- Direct third-party tokens stored or submitted by department tools, including Figma and WordPress credentials.

No secret values are recorded in this audit.

### P0 - database authority and RLS

The repository contains both generic tables such as `projects`, `tasks`, and `clients` and Sphere-prefixed tables such as `as_projects`, `as_tasks`, and `as_clients`. Some policies grant broad access to every authenticated user. The current client portal can read project tasks without a dedicated client-visibility field, while signoff records can be updated by clients without the new feature gate.

Therefore:

- No existing migration should be applied blindly.
- A canonical schema and explicit role/organization/project membership model must be approved first.
- Client visibility must be field- and policy-controlled, not inferred from page routing.
- Formal approval UI is disabled while the feature flag is off; server-side mutation denial is a required Phase 1 schema/RLS gate.

### P1 - engineering quality

- No CI workflow existed.
- ESLint 9 dependencies existed but no flat configuration existed.
- Two components violated React's Rules of Hooks.
- No automated test suite exists.
- The initial bundle exceeds the recommended chunk size.

Phase 0 adds CI, lint configuration, fixes the hook errors, and retains warnings as an explicit cleanup backlog.

## Live-environment safety boundary

The local repository has Supabase configuration, but this audit did not establish a reviewed production target or confirm the migration history of a live database. Application code and documentation may proceed; database deployment, secret rotation, and production provider configuration require environment identification and verification first.

## Phase 0 exit evidence

- Anka Sphere is the default and only active delivery environment.
- Unknown and legacy routes redirect to `/sphere/projects`.
- Client approvals default to disabled in `src/config/featureFlags.js`.
- Text AI calls use an authenticated server-side gateway.
- CI runs dependency installation, lint, and production build.
- Lint reports zero errors; warnings are visible.
- Production build succeeds.
