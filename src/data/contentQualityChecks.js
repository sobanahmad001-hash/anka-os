export const CONTENT_LENGTH_UNITS = Object.freeze([
  ['none', 'Not configured'],
  ['words', 'Words'],
  ['characters', 'Characters'],
])

const LIMITS = Object.freeze({
  required_sections: { items: 30, characters: 120 },
  required_terms: { items: 100, characters: 200 },
  source_citations: { items: 100, characters: 1000 },
})

function clean(value) {
  return String(value || '').trim()
}

export function configuredLines(value) {
  return String(value || '').split(/\r?\n/).map(clean).filter(Boolean)
}

function wholeNumber(value) {
  const text = clean(value)
  if (!text) return null
  const number = Number(text)
  return Number.isInteger(number) && number > 0 ? number : Number.NaN
}

function listIssue(value, label, limit) {
  const items = configuredLines(value)
  if (items.length > limit.items) return `${label} supports at most ${limit.items} entries.`
  if (items.some(item => item.length > limit.characters)) {
    return `${label} entries must be ${limit.characters} characters or fewer.`
  }
  return ''
}

function citationReferenceValid(value) {
  const reference = clean(value)
  if (reference.length < 3) return false
  if (!reference.includes('://')) return true
  try {
    const url = new URL(reference)
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function contentQualityConfigurationIssues(form = {}) {
  const issues = {}
  const sectionIssue = listIssue(form.required_sections, 'Required sections', LIMITS.required_sections)
  const termIssue = listIssue(form.required_terms, 'Required terms', LIMITS.required_terms)
  const citationIssue = listIssue(form.source_citations, 'Source citations', LIMITS.source_citations)
  if (sectionIssue) issues.required_sections = sectionIssue
  if (termIssue) issues.required_terms = termIssue
  if (citationIssue) issues.source_citations = citationIssue
  else if (configuredLines(form.source_citations).some(item => !citationReferenceValid(item))) {
    issues.source_citations = 'Each source citation must be a label of at least 3 characters or a valid HTTP(S) URL.'
  }

  const unit = clean(form.length_unit) || 'none'
  if (!CONTENT_LENGTH_UNITS.some(([value]) => value === unit)) {
    issues.length_unit = 'Choose words, characters, or Not configured.'
    return issues
  }
  if (unit === 'none') return issues
  const minimum = wholeNumber(form.min_length)
  const maximum = wholeNumber(form.max_length)
  const unitMaximum = unit === 'words' ? 30000 : 120000
  if (minimum === null && maximum === null) {
    issues.length_rule = 'Enter at least one positive whole-number length bound.'
  } else if (Number.isNaN(minimum) || Number.isNaN(maximum)) {
    issues.length_rule = 'Length bounds must be positive whole numbers.'
  } else if ((minimum || 0) > unitMaximum || (maximum || 0) > unitMaximum) {
    issues.length_rule = `${unit === 'words' ? 'Word' : 'Character'} bounds cannot exceed ${unitMaximum.toLocaleString()}.`
  } else if (minimum !== null && maximum !== null && minimum > maximum) {
    issues.length_rule = 'Minimum length cannot exceed maximum length.'
  }
  return issues
}

export function contentQualityConfiguration(form = {}) {
  const issues = contentQualityConfigurationIssues(form)
  if (Object.keys(issues).length) throw new Error(Object.values(issues)[0])
  const unit = clean(form.length_unit) || 'none'
  const requiredSections = configuredLines(form.required_sections)
  const requiredTerms = configuredLines(form.required_terms)
  const requireSourceCitations = Boolean(form.require_source_citations)
  const configured = requiredSections.length > 0 || requiredTerms.length > 0
    || unit !== 'none' || requireSourceCitations
  return {
    quality_requirements: configured ? {
      required_sections: requiredSections,
      length_unit: unit === 'none' ? null : unit,
      min_length: unit === 'none' ? null : wholeNumber(form.min_length),
      max_length: unit === 'none' ? null : wholeNumber(form.max_length),
      required_terms: requiredTerms,
      require_source_citations: requireSourceCitations,
    } : null,
    source_citations: configuredLines(form.source_citations),
  }
}

export function contentCounts(value) {
  const text = String(value || '')
  return {
    words: text.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length || 0,
    characters: Array.from(text).length,
  }
}

function normalized(value) {
  return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase()
}

function structuralSections(body) {
  const sections = new Map()
  let current = ''
  for (const line of String(body || '').split(/\r?\n/)) {
    const markdown = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    const labelled = markdown ? null : line.match(/^\s*([^:\n]{1,80}):\s*(.*)$/)
    if (markdown || labelled) {
      current = normalized(markdown ? markdown[1] : labelled[1])
      if (!sections.has(current)) sections.set(current, '')
      const inline = labelled?.[2]?.trim()
      if (inline) sections.set(current, inline)
    } else if (current && line.trim()) {
      sections.set(current, `${sections.get(current) || ''}\n${line.trim()}`.trim())
    }
  }
  return sections
}

function check(id, label, status, detail) {
  return { id, label, status, detail }
}

export function unresolvedPlaceholders(value) {
  const pattern = /\{\{[^{}\n]+\}\}|\[\[[^\[\]\n]+\]\]|<<[^<>\n]+>>|\[(?:placeholder|insert[^\]\n]*)\]|\b(?:TODO|TBD|TK)\b/giu
  return [...new Set(String(value || '').match(pattern) || [])]
}

export function checkContentQuality(content = {}) {
  const body = String(content.body || '')
  const counts = contentCounts(body)
  const requirements = content.quality_requirements
  const checks = []
  const configured = requirements && typeof requirements === 'object' && !Array.isArray(requirements)

  const requiredSections = configured && Array.isArray(requirements.required_sections)
    ? requirements.required_sections : []
  if (!requiredSections.length) {
    checks.push(check('required_sections', 'Required sections', 'not_configured', 'No section labels were configured for this request.'))
  } else {
    const sections = structuralSections(body)
    const missing = requiredSections.filter(label => !clean(sections.get(normalized(label))))
    checks.push(check('required_sections', 'Required sections', missing.length ? 'attention' : 'pass',
      missing.length
        ? `Missing or empty structural heading/label: ${missing.join(', ')}.`
        : `All ${requiredSections.length} configured heading/label sections contain text. This does not assess meaning.`))
  }

  const unit = configured ? requirements.length_unit : null
  const minimum = configured ? requirements.min_length : null
  const maximum = configured ? requirements.max_length : null
  if (!unit) {
    checks.push(check('length', 'Configured length', 'not_configured', 'No word or character bounds were configured.'))
  } else {
    const actual = counts[unit]
    const outside = (minimum !== null && actual < minimum) || (maximum !== null && actual > maximum)
    const range = minimum !== null && maximum !== null ? `${minimum}–${maximum}`
      : minimum !== null ? `at least ${minimum}` : `at most ${maximum}`
    checks.push(check('length', 'Configured length', outside ? 'attention' : 'pass',
      `${actual} ${unit}; configured range is ${range}.`))
  }

  const requiredTerms = configured && Array.isArray(requirements.required_terms)
    ? requirements.required_terms : []
  if (!requiredTerms.length) {
    checks.push(check('required_terms', 'Required terms', 'not_configured', 'No required phrases were configured.'))
  } else {
    const searchable = normalized(`${body}\n${content.cta || ''}`)
    const missing = requiredTerms.filter(term => !searchable.includes(normalized(term)))
    checks.push(check('required_terms', 'Required terms', missing.length ? 'attention' : 'pass',
      missing.length
        ? `Missing configured phrase presence: ${missing.join(', ')}.`
        : `All ${requiredTerms.length} configured phrases are present. This does not assess semantic use.`))
  }

  const placeholders = unresolvedPlaceholders(`${body}\n${content.cta || ''}`)
  checks.push(check('placeholders', 'Unresolved placeholders', placeholders.length ? 'attention' : 'pass',
    placeholders.length ? `Resolve: ${placeholders.join(', ')}.` : 'No supported placeholder pattern was found.'))

  const cta = clean(content.cta)
  if (!cta) {
    checks.push(check('cta', 'Selected CTA', 'not_configured', 'No CTA is selected for this request.'))
  } else {
    const present = normalized(body).includes(normalized(cta))
    checks.push(check('cta', 'Selected CTA', present ? 'pass' : 'attention',
      present ? 'The selected CTA text is present in the draft.' : 'The selected CTA text is absent from the draft.'))
  }

  const citationsRequired = Boolean(configured && requirements.require_source_citations)
  const citations = Array.isArray(content.source_citations) ? content.source_citations.filter(item => clean(item)) : []
  if (!citationsRequired) {
    checks.push(check('citations', 'Source citations', 'not_configured', 'Source citations were not requested.'))
  } else {
    checks.push(check('citations', 'Source citations', citations.length ? 'pass' : 'attention',
      citations.length
        ? `${citations.length} selected reference${citations.length === 1 ? '' : 's'} present. Accuracy, accessibility, and support are not assessed.`
        : 'Source citations were requested but no selected references are present.'))
  }

  return {
    counts,
    checks,
    attention: checks.filter(item => item.status === 'attention').length,
    configured: checks.filter(item => item.status !== 'not_configured').length,
  }
}
