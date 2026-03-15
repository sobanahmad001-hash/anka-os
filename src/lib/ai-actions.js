import { supabase } from './supabase'

export async function executeAction(action) {
  const { type, params } = action
  
  switch (type) {
    case 'team.create_task':
      return await createTask(params)
    
    case 'team.complete_task':
      return await completeTask(params)
    
    case 'team.flag_blocker':
      return await flagBlocker(params)
    
    case 'team.log_decision':
      return await logDecision(params)
    
    case 'team.create_project':
      return await createProject(params)
    
    case 'team.add_project_update':
      return await addProjectUpdate(params)
    
    default:
      throw new Error(`Unknown action type: ${type}`)
  }
}

async function createTask({ title, project_id, assignee, priority, due_date }) {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title,
      project_id,
      assigned_to: assignee,
      priority,
      due_date,
      status: 'todo',
    })
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

async function flagBlocker({ task_id, blocker_type, description, waiting_on }) {
  const { data: user } = await supabase.auth.getUser()
  
  const { data, error } = await supabase
    .from('blockers')
    .insert({
      task_id,
      blocker_type,
      description,
      blocked_user: user.user.id,
      waiting_on,
    })
    .select()
    .single()
  
  if (error) throw error
  return { success: true, data }
}

async function logDecision({ context, verdict, probability, project_id, participants }) {
  const { data, error } = await supabase
    .from('team_decisions')
    .insert({
      context,
      verdict,
      probability,
      project_id,
      participants,
      outcome: 'open',
    })
    .select()
    .single()
  
  if (error) throw error
  return { success: true, data }
}

async function createProject({ name, description, department }) {
  const { data: user } = await supabase.auth.getUser()
  
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name,
      description,
      department_id: department,
      owner_id: user.user.id,
      status: 'active',
    })
    .select()
    .single()
  
  if (error) throw error
  return { success: true, data }
}

async function addProjectUpdate({ project_id, content, update_type, next_actions }) {
  const { data: user } = await supabase.auth.getUser()
  
  const { data, error } = await supabase
    .from('project_updates')
    .insert({
      project_id,
      content,
      update_type,
      next_actions,
      created_by: user.user.id,
      created_by_ai: true,
    })
    .select()
    .single()
  
  if (error) throw error
  return { success: true, data }
}
