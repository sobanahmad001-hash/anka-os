# Anka Sphere OS

Internal Team OS and Client Portal for Anka Sphere.

Live: https://anka-os.vercel.app

This repository is the production application. Do not start a parallel app.

## What it is

Anka Sphere is a department-centred delivery system:

- Team OS: clients, projects, workshops, reviews, handoffs, Living Project Record
- Client Portal: released progress, exact versions, comments, revisions, and formal approval
- Workshops: Content, Design, Marketing, Delivery & Development
- Shared records: one project record, many views
- AI assistance: grounded drafts and reviews through an authenticated Edge Function
- Integrations: GitHub, Figma, and WordPress connection tests through a secret-free gateway

## Stack

- React 19 + Vite + React Router
- Tailwind CSS 4
- Supabase (Postgres, RLS, Edge Functions)
- Vercel hosting

## Local setup

```bash
npm ci
cp .env.example .env.local   # if present; otherwise set the two Vite keys below
npm run dev
```

Required frontend variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional testing flags (all default **on**):

- `VITE_CLIENT_APPROVALS_ENABLED`
- `VITE_AI_ASSISTANCE_ENABLED`
- `VITE_EXTERNAL_INTEGRATIONS_ENABLED`

Never put provider credentials or the service-role key in `VITE_*` variables.

## Scripts

```bash
npm run dev
npm test
npm run lint
npm run build
```

## Product and ops docs

- `docs/product/RELEASE_1_AUTHORITY.md` — product authority
- `CURRENT_STATUS.md` — live status and blockers
- `docs/release/DEPLOYMENT_RUNBOOK.md` — deploy sequence
- `docs/release/OPERATING_SPINE_REVIEW_GATE.md` — required review and explicit
  approval gates for the branch-only Operating Spine release
- `docs/release/ARTIFACTS_DESIGN_WORKSHOP_REVIEW_GATE.md` — isolated audit-event
  review plus approval gates for the Artifacts and Design Workshop release
- `ARCHITECTURE.md` — architecture notes

## Current testing posture

Client approvals, AI assistance, and integration tests are enabled in the app so the full Team OS + Client Portal path can be exercised. External publish/write operations remain blocked in the integration gateway. The linked database is current through migration `20260825130000`; any later branch migrations must pass their release gate and receive explicit deployment approval before every backend path is live.
