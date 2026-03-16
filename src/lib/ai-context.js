import { supabase } from './supabase'

async function safeSelect(queryBuilder) {
  try {
    const { data, error } = await queryBuilder
    if (error) {
      console.warn('AI context query failed:', error.message)
      return []
    }
    return data || []
  } catch (error) {
    console.warn('AI context exception:', error.message)
    return []
  }
}

export async function buildAIContext(currentPage, user) {
  const userId = user?.id || null

  const context = {
    currentPage,
    userId,
    userRole: user?.role || null,
    department: user?.department || null,
    timestamp: new Date().toISOString(),
  }

  const [recentProjects, recentTasks, recentActivity] = await Promise.all([
    safeSelect(
      supabase
        .from('projects')
        .select('id, name, status, priority, progress, due_date')
        .order('updated_at', { ascending: false })
        .limit(8)
    ),
    safeSelect(
      supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, project_id, assigned_to')
        .order('created_at', { ascending: false })
        .limit(12)
    ),
    safeSelect(
      supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(6)
    ),
  ])

  context.recentProjects = recentProjects
  context.recentTasks = recentTasks
  context.recentActivity = recentActivity
  context.blockedTasks = recentTasks.filter((task) =>
    ['blocked', 'blocked_review'].includes(String(task.status || '').toLowerCase())
  )

  if (currentPage.startsWith('/projects')) {
    context.projectView = {
      projectCount: recentProjects.length,
      projects: recentProjects,
    }
  }

  if (currentPage.startsWith('/tasks') || currentPage.startsWith('/kanban')) {
    context.taskView = {
      myTasks: userId
        ? recentTasks.filter((task) => task.assigned_to === userId)
        : [],
      blockedTasks: context.blockedTasks,
      queue: {
        todo: recentTasks.filter((t) => String(t.status) === 'todo').length,
        in_progress: recentTasks.filter((t) =>
          ['in_progress', 'review'].includes(String(t.status))
        ).length,
        done: recentTasks.filter((t) =>
          ['done', 'completed'].includes(String(t.status))
        ).length,
      },
    }
  }

  if (currentPage.startsWith('/dev-dashboard')) {
    const [sprints, docs] = await Promise.all([
      safeSelect(
        supabase
          .from('sprints')
          .select('id, name, status, goal, start_date, end_date')
          .order('start_date', { ascending: false })
          .limit(4)
      ),
      safeSelect(
        supabase
          .from('api_docs')
          .select('id, title, category, method, endpoint')
          .order('category', { ascending: true })
          .limit(12)
      ),
    ])

    context.developmentView = {
      sprints,
      apiDocs: docs,
      blockedTasks: context.blockedTasks,
      recentProjects,
      recentTasks,
    }
  }

  if (currentPage.startsWith('/api-docs')) {
    const docs = await safeSelect(
      supabase
        .from('api_docs')
        .select('id, title, category, method, endpoint')
        .order('category', { ascending: true })
        .limit(20)
    )

    context.apiDocsView = {
      docs,
      categories: [...new Set(docs.map((d) => d.category).filter(Boolean))],
    }
  }

  if (currentPage.startsWith('/terminal')) {
    context.terminalView = {
      note: 'Terminal is a support surface inside the Development environment.',
      recentTasks,
      blockedTasks: context.blockedTasks,
    }
  }

  return context
}

export function detectIntent(message) {
  const lower = message.toLowerCase()

  if (/\b(finished|completed|done|deployed|merged)\b/.test(lower)) {
    return { intent: 'task_completion', confidence: 0.85 }
  }

  if (/\b(stuck|blocked|waiting on|waiting for|can't|cannot)\b/.test(lower)) {
    return { intent: 'blocker', confidence: 0.92 }
  }

  if (/\b(create|make|add)\b/.test(lower) && /\b(project)\b/.test(lower)) {
    return { intent: 'project_creation', confidence: 0.88 }
  }

  if (/\b(create|make|add|need to|have to|todo|task)\b/.test(lower)) {
    return { intent: 'task_creation', confidence: 0.8 }
  }

  if (/\b(should we|what if|decide|choice|option)\b/.test(lower) && /\bor\b/.test(lower)) {
    return { intent: 'decision', confidence: 0.8 }
  }

  return { intent: 'query', confidence: 1.0 }
}
