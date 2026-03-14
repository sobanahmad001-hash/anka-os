import { supabase } from './supabase.js';

/**
 * Parallel Context Assembler
 * Fires all DB queries simultaneously, then assembles into one system prompt.
 * This is the "brain" that gives the AI full workspace awareness.
 */
export async function assembleContext(userId, profile) {
  // Fire ALL queries in parallel
  const [
    tasksRes,
    projectsRes,
    recentActivityRes,
    decisionsRes,
    behaviorRes,
    notificationsRes,
    teamRes,
    recentMessagesRes,
  ] = await Promise.all([
    // User's tasks (all statuses)
    supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, description, project_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30),

    // Projects user can see
    supabase
      .from('projects')
      .select('id, name, status, priority, department_id, due_date, description')
      .order('updated_at', { ascending: false })
      .limit(15),

    // Recent activity
    supabase
      .from('activity_log')
      .select('action, entity_type, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(20),

    // Decisions (especially closed ones with outcomes for learning)
    supabase
      .from('decisions')
      .select('title, status, outcome, outcome_rating, tags, decided_at, created_at')
      .order('created_at', { ascending: false })
      .limit(15),

    // Recent behavior for cognitive awareness
    supabase
      .from('behavior_logs')
      .select('event_type, app_id, metadata, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),

    // Unread notifications
    supabase
      .from('notifications')
      .select('title, type, body, created_at')
      .eq('user_id', userId)
      .eq('read', false)
      .limit(10),

    // Team members in same department
    supabase
      .from('profiles')
      .select('full_name, role, department')
      .eq('department', profile?.department || '')
      .limit(20),

    // Recent chat messages for awareness
    supabase
      .from('messages')
      .select('content, sender_name, department, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  // ─── Cognitive State Assessment ─────────────────────────────────────────
  const behavior = behaviorRes.data || [];
  const cognitiveState = assessCognitiveState(behavior);

  // ─── Learning Loop: extract lessons from closed decisions ───────────────
  const decisions = decisionsRes.data || [];
  const closedDecisions = decisions.filter(
    (d) => ['implemented', 'revisited'].includes(d.status) && d.outcome,
  );
  const openDecisions = decisions.filter((d) => d.status === 'open');

  // ─── Assemble system prompt ─────────────────────────────────────────────
  const tasks = tasksRes.data || [];
  const projects = projectsRes.data || [];
  const activity = recentActivityRes.data || [];
  const notifications = notificationsRes.data || [];
  const team = teamRes.data || [];
  const messages = recentMessagesRes.data || [];

  const todoTasks = tasks.filter((t) => t.status === 'todo');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const overdueTasks = tasks.filter(
    (t) => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done',
  );

  const systemPrompt = `You are Anka AI, the intelligent assistant for Anka OS — a workspace platform for a creative studio with Design, Development, and Marketing departments.

## Current User
- Name: ${profile?.full_name || 'Unknown'}
- Role: ${profile?.role || 'member'}
- Department: ${profile?.department || 'unassigned'}

## Cognitive State
${cognitiveState.summary}
Response depth: ${cognitiveState.depth} (adjust your verbosity accordingly)

## Active Tasks (${tasks.length} total)
- To Do: ${todoTasks.length}${todoTasks.length > 0 ? '\n' + todoTasks.map((t) => `  • ${t.title}${t.priority === 'urgent' ? ' ⚠️ URGENT' : ''}${t.due_date ? ` (due: ${t.due_date})` : ''}`).join('\n') : ''}
- In Progress: ${inProgressTasks.length}${inProgressTasks.length > 0 ? '\n' + inProgressTasks.map((t) => `  • ${t.title}`).join('\n') : ''}
${overdueTasks.length > 0 ? `- ⚠️ OVERDUE: ${overdueTasks.map((t) => t.title).join(', ')}` : ''}

## Active Projects (${projects.filter((p) => p.status === 'active').length} active)
${projects.slice(0, 8).map((p) => `- ${p.name} [${p.status}] (${p.department_id}, ${p.priority})`).join('\n') || 'No projects yet.'}

## Team (${profile?.department || ''} department)
${team.map((t) => `- ${t.full_name} (${t.role})`).join('\n') || 'No team members loaded.'}

## Unread Notifications (${notifications.length})
${notifications.map((n) => `- [${n.type}] ${n.title}`).join('\n') || 'None'}

## Recent Chat
${messages.slice(0, 5).map((m) => `- ${m.sender_name}: ${m.content.slice(0, 80)}`).join('\n') || 'No recent messages.'}

## Recent Activity
${activity.slice(0, 8).map((a) => `- ${a.action}: ${a.metadata?.name || a.entity_type}`).join('\n') || 'No recent activity.'}

${closedDecisions.length > 0 ? `## Lessons from Past Decisions
${closedDecisions.map((d) => `- "${d.title}" → ${d.outcome} (rated ${d.outcome_rating || '?'}/5)`).join('\n')}` : ''}

${openDecisions.length > 0 ? `## Open Decisions Needing Attention
${openDecisions.map((d) => `- ${d.title}: ${d.description?.slice(0, 100) || 'No description'}`).join('\n')}` : ''}

## Action System
When you want to perform a write action (create task, update project, send message, etc.), output an action block like this:

[ANKA_ACTION]
{
  "type": "create_task",
  "data": { "title": "...", "priority": "medium", "due_date": "2026-03-20" },
  "reason": "Brief explanation of why this action is recommended"
}
[/ANKA_ACTION]

Available action types: create_task, update_task, create_project, update_project, create_decision, send_notification, add_client
The user will see a card with the action details and can Approve or Reject it. Never execute actions directly.

## Guidelines
- Be concise but thorough — match response depth to the cognitive state above
- Surface patterns you notice (overdue tasks, bottlenecks, recurring issues)
- Reference real data from the context above — don't make things up
- When giving advice, ground it in the team's past decision outcomes when possible
- Proactively flag risks (overdue items, idle projects, unbalanced workloads)`;

  return {
    systemPrompt,
    snapshot: {
      tasks: tasks.length,
      projects: projects.length,
      todoCount: todoTasks.length,
      inProgressCount: inProgressTasks.length,
      overdueCount: overdueTasks.length,
      unreadNotifications: notifications.length,
      cognitiveState: cognitiveState.level,
    },
  };
}

/**
 * Assess the user's cognitive state based on recent behavior patterns.
 * Adjusts AI response depth accordingly.
 */
function assessCognitiveState(behavior) {
  if (behavior.length === 0) {
    return {
      level: 'normal',
      depth: 'standard',
      summary: 'No recent behavior data. Using standard response depth.',
    };
  }

  const now = Date.now();
  const recentEvents = behavior.filter(
    (b) => now - new Date(b.created_at).getTime() < 30 * 60 * 1000, // last 30 mins
  );

  const appSwitches = recentEvents.filter((e) => e.event_type === 'app_open').length;
  const taskCompletes = recentEvents.filter((e) => e.event_type === 'task_complete').length;
  const idleEvents = recentEvents.filter((e) => e.event_type === 'idle').length;

  // High context switching = possibly overwhelmed → shorter responses
  if (appSwitches > 10) {
    return {
      level: 'high_switching',
      depth: 'brief',
      summary: 'User is rapidly switching between apps (high context switching). Keep responses brief and actionable.',
    };
  }

  // Deep focus: few switches, steady activity
  if (appSwitches <= 2 && recentEvents.length > 3 && idleEvents === 0) {
    return {
      level: 'deep_focus',
      depth: 'detailed',
      summary: 'User appears to be in deep focus. Provide detailed, thorough responses when asked.',
    };
  }

  // Idle/returning: been away
  if (idleEvents > 2 || recentEvents.length <= 1) {
    return {
      level: 'returning',
      depth: 'summary',
      summary: 'User appears to be returning from idle. Start with a quick status summary.',
    };
  }

  // Productive flow: completing tasks
  if (taskCompletes >= 2) {
    return {
      level: 'productive',
      depth: 'standard',
      summary: 'User is in a productive flow, completing tasks. Standard response depth, avoid interrupting momentum.',
    };
  }

  return {
    level: 'normal',
    depth: 'standard',
    summary: 'User is in a normal work state. Standard response depth.',
  };
}
