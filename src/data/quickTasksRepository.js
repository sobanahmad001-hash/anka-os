import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Quick Tasks query failed')
  return data
}

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('quick-tasks', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Quick Tasks function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const quickTasks = Object.freeze({
  list: organizationId => dataOrThrow(
    supabase.from('quick_tasks').select('*').eq('organization_id', organizationId).order('updated_at', { ascending: false })
  ),
  revision: revisionId => dataOrThrow(
    supabase.from('quick_task_revisions').select('*').eq('id', revisionId).single()
  ),
  messages: quickTaskId => dataOrThrow(
    supabase.from('quick_task_messages').select('*').eq('quick_task_id', quickTaskId).order('created_at')
  ),
  create: input => invoke('create', input),
  append: input => invoke('append', input),
  fork: input => invoke('fork', input),
  chat: input => invoke('chat', input),
  lifecycle: (action, quickTaskId) => invoke(action, { quickTaskId }),
})
