# Phase 10 — Shell Refactor

## Goal
Refactor the app shell from workspace/app-first into environment-first.

## Files
- src/components/Header.jsx
- src/components/Layout.jsx
- src/components/Sidebar.jsx

## Refactor Direction
Replace:
- generic workspace feel
- app shelf feel
- utility-first primary nav

With:
- Admin
- Development
- Design
- Marketing

## Header Should Show
- active environment
- active view
- current context/project if relevant
- role-aware quick actions

## Sidebar Should Show
### Admin
- Overview
- Portfolio
- Blockers
- Decisions
- Teams
- Rules

### Development
- Overview
- Project Execution
- Sprint / Queue
- Blockers
- Decisions
- Code / Release Context

### Design
- Overview
- Briefs
- Reviews
- Feedback
- Handoff
- Assets

### Marketing
- Overview
- Campaigns
- Content Pipeline
- Approvals
- Publishing
- Performance

## Layout Should
- render environment-first structure
- reduce desktop/window feel
- support reusable environment sections

## Test After Phase 10
- app loads
- nav renders
- environment switching works
- no broken routes from shell changes

