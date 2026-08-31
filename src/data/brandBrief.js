export const BRAND_STATEMENT_TYPE = 'brand_statement'
export const BRAND_STATEMENT_SOURCE_TYPES = Object.freeze(['discovery', 'vision', 'audience'])

export function brandBriefEditor(brief = null) {
  return {
    target_market: brief?.target_market || '',
    price_tier: brief?.price_tier || '',
    operating_principles: (brief?.operating_principles || []).join('\n'),
    competitor_references: (brief?.competitor_references || []).join('\n'),
    raw_brief: brief?.raw_brief || '',
  }
}

export function serializeBrandBrief(editor) {
  return {
    target_market: String(editor.target_market || '').trim(),
    price_tier: String(editor.price_tier || '').trim(),
    operating_principles: lines(editor.operating_principles),
    competitor_references: lines(editor.competitor_references),
    raw_brief: String(editor.raw_brief || '').trim(),
  }
}

export function brandStatementEditor(content = {}) {
  return {
    statement: content.statement || '',
    target_market: content.target_market || '',
    price_tier: content.price_tier || '',
    positioning: content.positioning || '',
    value_proposition: content.value_proposition || '',
    audience_summary: content.audience_summary || '',
    operating_principles: (content.operating_principles || []).join('\n'),
    proof_points: (content.proof_points || []).join('\n'),
    competitor_references: (content.competitor_references || []).join('\n'),
  }
}

export function serializeBrandStatement(editor, sourceManifest) {
  return {
    statement: String(editor.statement || '').trim(),
    target_market: String(editor.target_market || '').trim(),
    price_tier: String(editor.price_tier || '').trim(),
    positioning: String(editor.positioning || '').trim(),
    value_proposition: String(editor.value_proposition || '').trim(),
    audience_summary: String(editor.audience_summary || '').trim(),
    operating_principles: lines(editor.operating_principles),
    proof_points: lines(editor.proof_points),
    competitor_references: lines(editor.competitor_references),
    source_manifest: sourceManifest,
  }
}

function lines(value) {
  return String(value || '').split('\n').map(item => item.trim()).filter(Boolean)
}
