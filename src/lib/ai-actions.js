import { supabase } from './supabase'

export async function executeAction(action) {
  const { type, params } = action

  switch (type) {
    case 'team.create_task':
      return await createTask(params)

    case 'team.complete_task':
      return await completeTask(params)

    case 'team.create_project':
      return await createProject(params)

    default:
      throw new Error(`Unsupported action type: ${type}`)
  }
}

async function createTask({ title, project_id = null, assignee = null, priority = 'medium', due_date = null }) {
  const payload = {
    title,
    project_id,
    assigned_to: assignee,
    priority,
    due_date,
    status: 'todo',
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return { success: true, data }
}

async function completeTask({ task_id }) {
  const { data, error } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    .eq('id', task_id)
    .select()
    .single()

  if (error) throw error
  return { success: true, data }
}

async function createProject({ name, description = null, department = null, due_date = null, priority = 'medium' }) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new Error('Not authenticated')
  }

  const payload = {
    name,
    description,
    department_id: department,
    owner_id: user.id,
    status: 'active',
    priority,
    due_date,
  }

  const { data, error } = await supabase
    .from('projects')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return { success: true, data }
}
