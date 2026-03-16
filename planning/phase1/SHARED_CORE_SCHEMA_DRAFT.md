# Shared Core Schema Draft

## Organizational Spine
- organizations
- departments
- teams
- profiles
- roles_permissions

## Execution Spine
- projects
- project_members
- tasks
- task_dependencies
- project_updates
- blockers
- decisions
- documents

## Intelligence Spine
- ai_project_memory
- ai_session_memory
- activity_events
- rules

## Relationship Rules
- every task belongs to a project
- every blocker belongs to a project and optionally a task
- every decision belongs to a project
- every document belongs to a project or organization context
- every environment inherits the same project core
- Admin sees across departments
- department environments specialize workflow, integrations, and AI behavior

