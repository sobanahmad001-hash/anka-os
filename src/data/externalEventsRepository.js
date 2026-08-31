import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'External events query failed')
  return data
}

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('external-events', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'External events function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const externalEvents = Object.freeze({
  listBrands: () => dataOrThrow(supabase.from('brands').select('id, organization_id, name').order('name')),
  listEngagements: brandId => dataOrThrow(supabase.from('engagements')
    .select('id, organization_id, brand_id, name, status').eq('brand_id', brandId).order('name')),
  listWorkItems: brandId => dataOrThrow(supabase.from('work_items')
    .select('id, organization_id, engagement_id, brand_id, title, status, deleted_at')
    .eq('brand_id', brandId).is('deleted_at', null).order('created_at', { ascending: false })),
  list: brandId => dataOrThrow(supabase.from('external_events').select('*')
    .eq('brand_id', brandId).order('start_date').order('event_name')),
  async listLinks(eventId) {
    const links = await dataOrThrow(supabase.from('content_event_links')
      .select('*, work_items(id, title, status, deleted_at)').eq('external_event_id', eventId)
      .order('content_type').order('created_at'))
    const sessionIds = links.filter(link => link.content_type === 'design_asset').map(link => link.id)
    const sessions = sessionIds.length ? await dataOrThrow(supabase.from('design_workshop_sessions')
      .select('id, engagement_id, output_family, status').in('id', sessionIds)) : []
    const sessionsById = new Map(sessions.map(session => [session.id, session]))
    return links.map(link => ({ ...link, design_workshop_session: sessionsById.get(link.id) || null }))
  },
  listDue: brandId => dataOrThrow(supabase.from('content_event_links_due').select('*')
    .eq('brand_id', brandId).order('due_date').order('event_start_date')),
  saveEvent: input => invoke(input.eventId ? 'update_event' : 'create_event', input),
  saveLink: input => invoke(input.linkId ? 'update_link' : 'create_link', input),
})
