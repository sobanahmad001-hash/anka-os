import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Content queue query failed')
  return data
}

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('content-studio', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Content queue action failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const contentQueue = Object.freeze({
  async load() {
    const [entries, brands, events] = await Promise.all([
      dataOrThrow(supabase.from('content_queue_entries')
        .select('*, content_requests(id, output_path, status)')
        .order('planned_date').order('created_at')),
      dataOrThrow(supabase.from('brands')
        .select('id, organization_id, name, status').eq('status', 'active').order('name')),
      dataOrThrow(supabase.from('external_events')
        .select('id, organization_id, brand_id, event_name, event_category, start_date')
        .order('start_date')),
    ])
    return { entries, brands, events }
  },
  create: input => invoke('create_queue_entry', input),
  action: (queueEntryId, outputPath) => invoke('action_queue_entry', {
    queue_entry_id: queueEntryId, output_path: outputPath,
  }),
  skip: queueEntryId => invoke('skip_queue_entry', { queue_entry_id: queueEntryId }),
})
