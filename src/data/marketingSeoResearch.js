export const SEO_RESEARCH_TYPES = Object.freeze([
  Object.freeze({ value: 'domain', label: 'Domain review' }),
  Object.freeze({ value: 'page', label: 'Page review' }),
])

function text(value, max = 4000) {
  return String(value || '').trim().slice(0, max)
}

export function normalizeResearchUrl(value) {
  const raw = text(value, 2048)
  if (!raw) throw new Error('Target URL is required')
  let parsed
  try { parsed = new URL(raw) } catch { throw new Error('Target URL must be a valid HTTP or HTTPS address') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Target URL must be a valid HTTP or HTTPS address without embedded credentials')
  }
  parsed.hash = ''
  parsed.hostname = parsed.hostname.toLowerCase()
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) parsed.port = ''
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString()
}

export function validateSeoResearchInput(value = {}) {
  const researchType = text(value.research_type, 40)
  const market = text(value.market, 240)
  if (!SEO_RESEARCH_TYPES.some(item => item.value === researchType)) throw new Error('Choose a supported research type')
  if (!market) throw new Error('Market is required so the research scope is explicit')
  return Object.freeze({
    research_type: researchType,
    target_url: normalizeResearchUrl(value.target_url),
    market,
    language: null,
    device: null,
    seed_keywords: Object.freeze([...new Set(String(value.seed_keywords || '').split('\n').map(item => text(item, 200)).filter(Boolean))].slice(0, 50)),
    content_strategy_version_id: text(value.content_strategy_version_id, 80) || null,
  })
}

export function buildContentUpdatePreview(research, values = {}) {
  if (!research?.source_facts?.length && !research?.interpretations?.length) throw new Error('Run research before preparing a Content request')
  const target = research.input?.target_url || 'https://unavailable.invalid'
  const evidence = research.source_facts.map(item => `- ${item.observation} (${item.source}, ${item.evidence_date || 'date unavailable'})`).join('\n')
  const actions = research.interpretations.map(item => `- ${item.proposed_action}`).join('\n')
  return Object.freeze({
    title: text(values.title, 240) || `Review SEO evidence for ${new URL(target).hostname}`,
    description: text(values.description, 20000) || `Review the linked Marketing SEO research and update the existing canonical Content artifact where appropriate.\n\nSource facts\n${evidence || '- No usable source facts were returned.'}\n\nMarketing interpretation\n${actions || '- No interpretation was recorded.'}\n\nDo not create a competing strategy or copy.`,
    status: 'not_started', work_item_type: 'request', target_department: 'content',
    content_strategy_version_id: research.input?.content_strategy_version_id || null,
  })
}

export function sourceAvailabilitySummary(value = {}) {
  const pages = Number(value.technicalSeoPages || 0)
  const keywords = Number(value.trackedKeywords || 0)
  const strategies = value.contentStrategies || []
  return Object.freeze([
    Object.freeze({ key: 'technical_seo', label: 'Stored technical SEO', available: pages > 0, detail: `${pages} tracked page${pages === 1 ? '' : 's'}` }),
    Object.freeze({ key: 'keyword_history', label: 'Stored keyword history', available: keywords > 0, detail: `${keywords} tracked keyword${keywords === 1 ? '' : 's'}` }),
    Object.freeze({ key: 'content_strategy', label: 'Canonical Content strategy versions', available: strategies.length > 0, detail: `${strategies.length} exact version${strategies.length === 1 ? '' : 's'}` }),
  ])
}

export function shouldApplySeoResearchResponse(request, current, generation, currentGeneration) {
  return !request.signal?.aborted && request.organizationId === current.organizationId &&
    request.brandId === current.brandId && request.engagementId === current.engagementId &&
    request.revision === current.revision && generation === currentGeneration
}
