# Phase 11 — Admin + Development Refactor

## Goal
Refactor the two most mature environments first:
- Admin
- Development

## Admin Files
- src/apps/AdminDashboard.jsx
- src/apps/UserManagement.jsx

## Admin Direction
Admin becomes:
- organizational overview
- portfolio visibility
- team oversight
- blocker oversight
- decision visibility

## Admin Views to Shape
- Overview
- Portfolio
- Blockers
- Decisions
- Teams / Allocation
- Rules

## Development Files
- src/apps/DevDashboard.jsx
- src/apps/ApiDocs.jsx
- src/apps/Kanban.jsx
- src/apps/Terminal.jsx
- src/components/DevSidebar.jsx
- src/lib/github.js

## Development Direction
Development becomes:
- technical execution environment
- repo/release-aware
- blocker-aware
- decision-aware
- queue/sprint-aware

## Development Mapping
- DevDashboard.jsx -> Development Overview
- ApiDocs.jsx -> Code / Release Context
- Kanban.jsx -> Sprint / Work Queue
- Terminal.jsx -> Development context tool
- DevSidebar.jsx -> may be merged into environment-aware sidebar
- github.js -> keep as dev integration support

## Test After Phase 11
- Admin screens load inside new shell
- Development screens load inside new shell
- Projects still render where expected
- no broken imports/routes
- no shell regressions

