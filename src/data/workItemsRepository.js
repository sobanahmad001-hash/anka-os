import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Work Items query failed')
  return data
}

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('work-items', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Work Items function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const workItems = Object.freeze({
  list: engagementId => dataOrThrow(
    supabase.from('work_items')
      .select('*')
      .eq('engagement_id', engagementId)
      .is('deleted_at', null)
      .order('position')
      .order('created_at')
  ),
  save: input => invoke('save', input),
  remove: workItemId => invoke('delete', { workItemId }),
})
