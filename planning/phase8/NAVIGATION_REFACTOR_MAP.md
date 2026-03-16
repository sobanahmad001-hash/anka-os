# Navigation Refactor Map

## Current Direction to Replace
- app shelf
- generic workspace navigation
- window-based mental model
- utility-first top-level structure

## New Top-Level Navigation
1. Admin
2. Development
3. Design
4. Marketing

## Shared Navigation Rules
- environments are top-level
- apps/utilities are secondary
- projects/tasks/blockers/decisions/docs stay inside environment context
- shared core should be accessible through environment-aware views

## Sidebar Direction
Replace generic app-first sidebar with environment-first sidebar.

### Admin Sidebar
- Overview
- Portfolio
- Blockers
- Decisions
- Teams & Allocation
- Rules

### Development Sidebar
- Overview
- Project Execution
- Sprint / Work Queue
- Technical Blockers
- Technical Decisions
- Code / Release Context

### Design Sidebar
- Overview
- Briefs & Deliverables
- Review Cycles
- Feedback & Revisions
- Handoff
- Assets & Context

### Marketing Sidebar
- Overview
- Campaigns
- Content Pipeline
- Approvals
- Calendar & Publishing
- Performance & Insights

