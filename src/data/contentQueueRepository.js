import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Content queue query failed'), {
    status: error.status || error.statusCode,
  })
  return data
}

async function invoke(organizationId, action, input = {}, { signal } = {}) {
  const { data, error } = await supabase.functions.invoke('content-studio', {
    body: { ...input, action, organization_id: organizationId }, signal,
  })
  if (error) throw Object.assign(new Error(error.message || 'Content queue action failed'), {
    status: error.status || error.statusCode || error.context?.status,
  })
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export function createContentQueueScope(organizationId, { signal } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const options = { signal }
  return Object.freeze({
  organizationId,
  async load() {
    const [entries, brands, events] = await Promise.all([
      dataOrThrow(supabase.from('content_queue_entries')
        .select('*, content_requests(id, output_path, status)')
        .eq('organization_id', organizationId).order('planned_date').order('created_at'), options),
      dataOrThrow(supabase.from('brands')
        .select('id, organization_id, name, status').eq('organization_id', organizationId).eq('status', 'active').order('name'), options),
      dataOrThrow(supabase.from('external_events')
        .select('id, organization_id, brand_id, event_name, event_category, start_date')
        .eq('organization_id', organizationId).order('start_date'), options),
    ])
    return { entries, brands, events }
  },
  create: input => invoke(organizationId, 'create_queue_entry', input, options),
  action: (queueEntryId, outputPath) => invoke(organizationId, 'action_queue_entry', {
    queue_entry_id: queueEntryId, output_path: outputPath,
  }, options),
  skip: queueEntryId => invoke(organizationId, 'skip_queue_entry', { queue_entry_id: queueEntryId }, options),
  })
}

export const contentQueue = Object.freeze({
  forOrganization: createContentQueueScope,
})
