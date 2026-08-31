export const CONTENT_REQUEST_FORMATS = Object.freeze([
  ['reel', 'Reel'],
  ['carousel', 'Carousel'],
  ['single_image', 'Single image'],
  ['stories', 'Stories'],
  ['carousel_stories', 'Carousel + stories'],
  ['reel_carousel', 'Reel + carousel'],
  ['web_design_element', 'Web design element'],
])

export const CONTENT_REQUEST_OUTPUT_PATHS = Object.freeze([
  ['internal_engine', 'Generate with Anka OS'],
  ['figma_handoff', 'Prepare for Figma handoff'],
])

export function newContentRequest(engagement) {
  return {
    mode: 'project',
    engagement_id: engagement?.id || '',
    brand_id: engagement?.brand_id || '',
    linked_event_id: '',
    output_path: 'internal_engine',
    format: 'single_image',
    brief: '',
    create_event_link: false,
    event_content_type: 'social',
    lead_time_days: 0,
    media_type: 'image',
    model_registry_id: '',
  }
}

export function serializeContentRequest(form) {
  const linkedEventId = String(form.linked_event_id || '').trim() || null
  return {
    mode: 'project',
    engagement_id: String(form.engagement_id || '').trim(),
    brand_id: String(form.brand_id || '').trim(),
    linked_event_id: linkedEventId,
    output_path: form.output_path,
    format: form.format,
    brief: String(form.brief || '').trim(),
    queue_entry_id: null,
    create_event_link: Boolean(linkedEventId && form.create_event_link),
    event_content_type: form.event_content_type || 'social',
    lead_time_days: Number(form.lead_time_days || 0),
  }
}

export function requestAssets(request, assets) {
  return (assets || []).filter(asset => asset.content_request_id === request.id)
}

export function mediaStatusTone(status) {
  if (status === 'ready') return 'emerald'
  if (status === 'failed' || status === 'unavailable') return 'red'
  if (status === 'generating') return 'blue'
  return 'amber'
}
