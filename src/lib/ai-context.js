import { supabase } from './supabase'

export async function buildAIContext(currentPage, user) {
  const context = {
    currentPage,
    userRole: user?.role,
    department: user?.department,
    timestamp: new Date().toISOString(),
  }
  
  // Fetch relevant data based on current page
  if (currentPage.startsWith('/projects')) {
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, status')
      .limit(10)
    context.recentProjects = projects
  }
  
  if (currentPage.startsWith('/tasks')) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, status, assigned_to')
      .eq('assigned_to', user.id)
      .limit(10)
    context.myTasks = tasks
  }
  
  // Fetch recent team activity
  const { data: recentActivity } = await supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)
  context.recentActivity = recentActivity
  
  return context
}

export function detectIntent(message) {
  const lower = message.toLowerCase()
  
  // Task completion detection
  if (/\b(finished|completed|done|deployed|merged)\b/.test(lower)) {
    return { intent: 'task_completion', confidence: 0.8 }
  }
  
  // Blocker detection
  if (/\b(stuck|blocked|waiting on|waiting for|can't)\b/.test(lower)) {
    return { intent: 'blocker', confidence: 0.9 }
  }
  
  // Decision detection
  if (/\b(should we|what if|decide|choice|option)\b/.test(lower) && /\bor\b/.test(lower)) {
    return { intent: 'decision', confidence: 0.85 }
  }
  
  // Task creation detection
  if (/\b(need to|have to|task|todo|must)\b/.test(lower)) {
    return { intent: 'task_creation', confidence: 0.7 }
  }
  
  return { intent: 'query', confidence: 1.0 }
}
