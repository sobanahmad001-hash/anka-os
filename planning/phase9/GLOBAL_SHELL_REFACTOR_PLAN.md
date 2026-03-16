# Global Shell Refactor Plan

## Files
- src/components/Header.jsx
- src/components/Layout.jsx
- src/components/Sidebar.jsx

## Direction
Refactor shell from:
- generic workspace shell
to:
- environment-first shell

## New Top-Level Environments
- Admin
- Development
- Design
- Marketing

## Responsibilities
### Header
- current environment
- current view
- context/project selector
- role-aware quick actions

### Sidebar
- environment-first navigation
- environment-specific subviews
- no generic app shelf as primary structure

### Layout
- render environment-aware shell
- reduce desktop/window feel
- support environment-based content

