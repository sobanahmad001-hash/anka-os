# Layout Refactor Map

## Header
Header should become environment-aware, not generic workspace-aware.

Header should show:
- current environment
- current view
- project/context selector where relevant
- role-aware quick actions

## Sidebar
Sidebar should become environment-first.

## Main Content
Main content should show environment views, not floating app windows.

## Remove Direction
Downgrade:
- window shell feeling
- floating desktop/app feel
- third-party app launcher feel

## Keep Direction
Keep reusable:
- layout foundation
- role/access logic
- route structure where useful
- components that can be repurposed into environment UI

